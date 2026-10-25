# Tenant Maintenance Dashboard - Implementation Spec

*Last updated 2026-10-19. This spec describes the app as currently built. What changed from the original brief is listed under "Revision notes" at the end.*

## Goal and scope

Build a small, polished, **single-page** dashboard for a property manager handling tenant maintenance requests across multiple properties. This is a first project and a demo. Ticket data comes from a live **Airtable** base, with a local CSV as the fallback and as the format for uploads. The interface and sample data are in English; currency is USD. Do not claim a live connection to Zillow, TurboTenant, tenants, or an AI model. The external services are Airtable (read-only ticket data), Apify (vendor search, local server only), and the keyless public weather services described under Weather & Property Alerts (U.S. Census Geocoder and Open-Meteo); AI summaries are sample content.

Deliver a working responsive app, `maintenance_requests.csv` (fallback data), and `demo_upload_sample.csv` (a file to try Upload CSV with). Use a straightforward web stack with no build step: vanilla HTML, CSS, and JavaScript, with PapaParse (CSV parsing) and Chart.js (charts) loaded from a CDN. `serve.ps1` is a local PowerShell server (no Node or Python needed) that serves the files and hosts the local API for Vendor Research. Credentials:

- The Airtable token in `app.js` is a **read-only, single-base** token. It is public by design so the deployed page works without a login. Never use a token with write access or access to other bases.
- The Apify token lives only in a gitignored `.env` file (`APIFY_TOKEN`) and is read by `serve.ps1`. It must never appear in the browser, the repo, or the docs. `.env.example` lists the variable names only.

## Layout and behavior

One page, with these sections in order:

1. Header: **Tenant Maintenance Dashboard** (no subtitle), a small **data source badge** ("Live: Airtable" or "Sample data (CSV)"), one **Property** selector defaulting to **All Properties**, and four actions: **Download demo CSV**, **Upload CSV**, **Vendor Research**, and **+ New Request** (each specified below). Include every unique property from the loaded data in the selector. Changing the property updates every KPI, chart, request count, table, cost summary, and the Vendor Research ticket list. A status banner under the header reports load, upload, and validation messages.
2. Four KPI cards: **Open Requests**, **Urgent Open Requests**, **Resolved This Month**, **Avg. Resolution Time**.
3. **Weather & Property Alerts**: one compact weather card per property (see Weather & Property Alerts).
4. Two charts: **Requests by Category** (donut) and **Requests by Status** (bar). Both reflect *all* requests for the selected property, independent of the Open/Resolved tab, and show category/status labels and counts. Use a clear legend or directly labeled bars.
5. **Maintenance Requests** with two tabs, **Open Requests (count)** and **Resolved (count)**. Default to Open. Tabs filter the requests in the table; switching properties preserves the selected tab. Show all matching requests, with no arbitrary top-ten cutoff. Open rows: Date, Property, Issue, Category, Priority, Status, Assigned To. Resolved rows may also show Date Resolved. Clicking a row opens an accessible dialog showing ID, property, tenant, original issue, category, priority, status, assignee, created/resolved dates if present, actual cost if present, and AI Summary. A blank assignee or cost displays `-` or `Not recorded`, never `$0` by default. For **New** and **In Progress** tickets only, the dialog also shows a **Vendor Research** button (see Vendor Research).
6. **Maintenance Costs Year to Date by Property**: a compact table listing each property and its total actual maintenance cost for the year to date. When All Properties is selected, list every property in the data sorted by cost descending and show a clearly labeled portfolio total. When a property is selected, show only that property's row and its total. This section does not change with the Open/Resolved tab. Show `$0` only when there are no recorded costs for a property in the date range.

The **Vendor Research** header button switches the page to a second view in place of sections 2-6 (the header and status banner stay); its label changes to **← Back to Dashboard** while that view is open. It is a view inside the same page, not a separate URL.

No sidebar, search box, or extra filters, and no ticket edit workflow. Include helpful empty states if a selected property has no requests in a tab or no resolved requests this month.

### Upload CSV and demo CSV

- **Upload CSV** opens a file picker. A valid file replaces the dashboard's data for the current browser session only (the badge changes to "Sample data (CSV)" and the property filter resets to All Properties). Reloading the page returns to the default data source.
- The file uses the same 13 columns and validation rules as `maintenance_requests.csv`. Invalid rows are skipped and reported; if no row is valid, the current data is kept and an error is shown.
- **Download demo CSV** downloads `demo_upload_sample.csv`: 36 fictional requests (`DEMO-1` to `DEMO-36`) across three properties (10 Harbor View, 22 Lakeside Dr, 5 Forest Hill Rd), covering every status, priority, and category, valid for upload. The download is generated in the browser (a Blob), so it also works when the page is opened as a file.

### + New Request

- A modal form adds one request by hand: Property (pick an existing one or type a new one), Tenant, Issue (required), Category, Priority, Status (defaults to New), Assigned To (optional), Date Created (defaults to and cannot exceed the as-of date), Date Resolved (shown only when Status is Resolved), Actual Cost (optional), Cost Date (shown only when a cost is entered), and an optional AI Summary note.
- The ID is generated (`MR-<next number>`). The request goes through the same validation as every other source; errors appear inline in the form. The dialog is accessible (focus trap, Escape to close, focus returns to the button).
- New requests exist only in the current browser session. Nothing is written to Airtable or the CSV.

### Vendor Research

A view for finding local vendors for an open ticket.

- **Ticket list:** only open tickets (New, Scheduled, In Progress) for the selected property, sorted like the Open table (priority, then newest). Each entry shows ID, priority badge, issue, property, category, and status. Selecting one shows its **issue** and **full address** and a **Find Vendors** button.
- **Entry points:** the header button, and the **Vendor Research** button in the ticket details dialog (New and In Progress tickets only; not Scheduled or Resolved). The dialog button closes the dialog and opens this view with that ticket already selected and focused. Neither entry point starts a search.
- **Nothing runs until Find Vendors is clicked.** Then:
  1. Derive a short search term from the ticket's issue and category with fixed keyword rules, falling back to a per-category default (Plumbing: plumber, HVAC: HVAC repair, Electrical: electrician, Appliance: appliance repair, Doors & Locks: locksmith, General: handyman). Example: "Furnace not producing heat" becomes "furnace repair".
  2. Run the Apify Google Maps Scraper (`compass/crawler-google-places`) for "`<term> near <full address>`", up to 5 places, English, skipping closed places. The address goes into the search text because the actor's own location field cannot geocode street addresses. Each run is capped at $0.50 (a typical run costs about $0.03 and takes 15-60 seconds).
  3. Show up to 5 vendors, each with name, category, rating (for example `4.8 / 5`), review count, phone, website link, and a Google Maps link. A missing value displays `-`. External links open in a new tab.
- **States:** a searching message that names the term and address; a no-results message; and plain error messages (for example when Apify reports a failure). A ticket with no full address cannot be searched and says why.
- **Local only:** the search runs through `serve.ps1`, which holds `APIFY_TOKEN`. On the public GitHub Pages site, or a page opened as a file, the view still opens but shows a notice and keeps **Find Vendors** disabled. `serve.ps1` never serves dotfiles such as `.env` and accepts searches only from the page it serves.

### Weather & Property Alerts

A compact section between the KPI cards and the charts showing current weather, a 7-day forecast, and maintenance alerts for each property. It follows the Property selector (All Properties shows every property; a selected property shows only its card) and is hidden in the Vendor Research view. It uses real current dates, the same "today" as the as-of date.

- **Card layout:** desktop shows all four property cards side by side in one row; two columns on tablets (up to 1180px), one column on phones (up to 700px). Cards are kept short (about 306px tall with no alerts). Each card has, top to bottom: property name and city/state/ZIP (marked "approx. location" when the location is approximate); the **condition image**; the **7-day forecast**; and the **alerts** block.
- **Condition image:** a sky image matching the current condition (clear, partly cloudy, overcast, fog, drizzle, rain, heavy rain, freezing rain, snow, thunderstorm; day or night variants) with the **current temperature** and **condition text overlaid** on it, plus two small chips: **wind** (speed, compass direction, and a direction arrow) and **chance of rain** for today. A darker gradient on the text side keeps the overlay readable. The images are generated in the browser (canvas) and cached per condition, so there are no image files, downloads, or licensing. If generation fails the card falls back to a plain blue background and stays readable. Sunrise/sunset, feels-like, humidity, and gusts are intentionally not shown.
- **7-day forecast:** one borderless row of seven columns (day name, small condition icon, high, low) with no box around each day. Today is underlined in the accent color. A small dot under a day marks an alert (red for high risk, orange for moderate).
- **Maintenance alerts (7-day risk logic):** simple rules over the daily forecast, not official warnings:

  | Alert | Moderate risk | High risk |
  | --- | --- | --- |
  | Freezing temperatures / hard freeze | low at or below 32°F | low at or below 20°F |
  | Heavy rain | 1 in or more in a day | 2 in or more |
  | Snow | 1 in or more | 4 in or more |
  | Strong winds | gusts of 40 mph or more | 58 mph or more |
  | Extreme heat | high of 90°F or more | 100°F or more |

  Alerts today appear in a prominent panel (red for high, orange for moderate) with the alert name, the metric (for example "Low 14°F" or "Gusts 45 mph"), and a one-line maintenance suggestion, and the card gets a matching ring and an "N alerts today" pill. Alerts on later days appear as one compact line per day. With no risks, the card shows "No weather risks in the next 7 days".
- **Data:** the property's `full_address` is located with the **U.S. Census Geocoder** (JSONP, because it sends no CORS headers); exact matches are cached in `localStorage`. If the Census has no match, the card falls back to the address's ZIP area and says the location is approximate. The forecast comes from **Open-Meteo** (free, non-commercial, no key) and is cached in memory for 15 minutes. A credit line under the cards attributes Open-Meteo (CC BY 4.0) and the Census Geocoder and states that alerts are not official warnings.
- **States:** a loading state per card; a plain error with a **Try again** button when a lookup fails; a notice instead of cards when the data has no addresses (CSV and uploads); a notice for a property with no address.

## Data definitions and calculations

The **as-of date is today** on the viewer's clock (local calendar date), held in one variable and re-read at every hourly refresh so a tab left open past midnight rolls over. Data must contain no dates after it; **any row from any source (Airtable, CSV, upload, or New Request) with a date after it is rejected by validation and reported.** All date comparisons use calendar dates, inclusive, rather than rolling 30-day windows.

| Metric | Calculation after property selection |
| --- | --- |
| Open Requests | Count status `New`, `Scheduled`, or `In Progress`. |
| Urgent Open Requests | Count open requests with priority `Urgent`. |
| Resolved This Month | Count status `Resolved` with `date_resolved` in the as-of date's calendar month (for example October 2026 on any day in October 2026). |
| Avg. Resolution Time | Mean of `date_resolved - date_created`, in calendar days, among all resolved requests for the selected property as of the as-of date. Show one decimal and `-` if none qualify. Same-day resolution is 0 days. |
| Category / status charts | Count all requests for the selected property, including resolved ones. Zero-count categories may be omitted consistently. |
| YTD cost per property | Sum numeric `cost` for rows with `cost_date` from January 1 of the as-of date's year through the as-of date, inclusive, grouped by property. Blank cost is excluded. The portfolio total is the sum of displayed property totals. |

`cost` is an **actual recorded cost**, not an estimate. A request can have a partial recorded cost while still open; its `cost_date` then records when that cost was incurred. Consequently, YTD cost must not be calculated from `date_created` or only from resolved requests. Do not use future costs. For the demo, a single request has at most one total actual cost and one corresponding cost date; this is a deliberate simplification.

Sort Open requests by priority (Urgent, High, Medium, Low), then newest `date_created`. Sort Resolved requests by newest `date_resolved`. Use ID as a stable tiebreaker.

## Data sources

On load the app tries **Airtable** first and falls back to **`maintenance_requests.csv`** (loaded from the file, or from the embedded `data.js` copy when the page is opened as a file) if Airtable is unconfigured or the request fails for any reason. The data source badge always shows which one is active.

Airtable base **Property Maintenance Tickets**:

- **Maintenance Tickets** table: the same 13 field names as the CSV (below). `category`, `priority`, and `status` are single selects and must use the allowed values. `property` is a **linked record** to the Properties table (the API returns record IDs, which the app translates into property names; an ID it can't resolve is reported as a validation error rather than shown). A **`Full Address`** lookup pulls the linked property's address.
- **Properties** table: `Property` (the display name shown in the dashboard), `City`, `State`, `ZIP Code`, and `Full Address` (a formula such as "10 Harbor View, Pittsburgh, PA 15211").
- Every row in the app carries a `full_address` value (blank for CSV rows). It is not shown in the tables; Vendor Research uses it as the search location.
- All sources go through the same validation. Invalid rows are excluded and counted in the status banner, with details in the browser console.

**Automatic refresh:** the app does not poll continuously. Once an hour (and when the tab becomes visible again after an hour or more away), it re-reads Airtable and refreshes the weather, then redraws only if something changed. The Property filter, selected tab, and open dialogs are left alone. A failed refresh keeps the data already on screen and is logged to the console only (no banner). If the page started on the CSV fallback and Airtable is reachable later, it switches to Airtable. A CSV uploaded this session is never replaced, and requests added with + New Request are kept. Failed weather lookups are retried on the same schedule.

### Demo mode

Opening the dashboard with `?demo=1` switches the data source to a fully fictional demo for **10 Harbor View**, kept in `demo/` (see `demo/README.md`). It is for building and testing the dashboard, equipment history and the AI Maintenance Agent without touching real data.

- **Data:** `demo/properties.json` (the property and its address) and `demo/tickets.csv` (30 tickets, 13 open and 17 resolved or closed, in the standard 13-column format, validated like every other source) plus `demo/ticket_details.json` (extra per-ticket fields, see Tickets in demo mode). Each ticket gets the property's full address, so the weather section works unchanged.
- **Isolation:** demo mode reads nothing from and writes nothing to Airtable, skips the Airtable refresh, and never changes the real data. Without `?demo=1` the dashboard behaves exactly as before.
- **Display:** the data source badge reads "Demo data (fictional)" (pale lavender), a note under the header says the data is fictional, and the page title ends with "(Demo)". Upload CSV and + New Request still work for the session. The hourly refresh only moves "today" on and refreshes the weather.
- **Other demo files:** `equipment.json`, `manuals.json` (verified manufacturer documents for four items), `equipment_history.json` (manual events that have no ticket), `utilities.json`, `shutoffs.json` and placeholder attachments under `demo/files/` hold fictional equipment, history, utilities, shutoffs and documents. They mirror the planned Airtable table shapes and are shown in the Systems & Equipment view.
- **Needs a web server:** like Vendor Research, demo mode does not work from a file opened directly, and says so.

#### Systems & Equipment (demo mode only)

A **Systems & Equipment** header button, shown only in demo mode, opens a view in place of the dashboard sections (like Vendor Research; its label becomes "← Back to Dashboard", and opening one view leaves the other). It is implemented in `systems.js` and `systems.css`, which do nothing without `?demo=1`.

- **Categories:** expandable (keyboard-operable, `aria-expanded`) groups: Appliances (Refrigerator, Range/Stove, Garbage Disposal, Dishwasher, Microwave, Range Hood, Washing Machine, Dryer), Heating & Cooling (heating and cooling types, several systems per property), Water Heater, Roof & Gutters, Garage & Garage Door (garage, door and opener as separate items), Electrical Panel, Plumbing & Drains, Doors/Windows/Locks, Smoke & CO Detectors, Basement & Foundation, Exterior & Landscaping, and Utilities & Shutoff Locations. Each header shows the item count and a warranty alert when one is expiring within 90 days. "Expand all" and "Collapse all" are available.
- **Shared fields (where relevant):** presence (Yes / No / Not Provided, where Not Provided means unknown), ownership, brand, model, serial number, manufacture year and accuracy, purchase date and seller, installation date and company, installer contact, separate product and workmanship warranties with expiry status (active, expiring soon, expired), location, photos, receipts, manuals and warranty documents, notes, information status (Verified / Estimated / Unknown) and visibility (Internal Only / Tenant Accessible). Each category also has its own fields (for example water heater type, fuel and capacity; roof material and condition; panel amperage and protection type), and shared fields that don't apply are hidden. When presence is No, the detail fields are hidden. Custom equipment types are supported.
- **Utilities:** Gas, Electric, Water, Sewer and Trash records with provider, phones, website, account holder, responsible payer, billing arrangement, "Included with" (shown only for "Included in Another Utility"), notes, information status and visibility. **Shutoff records** (water, gas, electrical panel / main breaker, other safety devices) have exact location, description, photos, tenant instructions with an explicit "approved for tenants" flag, information status and visibility. Nothing is invented: a missing location or instruction is shown as "not on file".
- **History:** see Equipment maintenance history below.
- **Attachments:** images are loaded lazily when they come near the screen. Attachments are kept as durable references (id, file name, type) with a file path, or a small data URL for files added in the demo (up to 300 KB); a function resolves the address to display, which is where production will request a fresh Airtable link, since those links expire after about 2 hours.
- **Visibility:** a new item defaults to Internal Only. A "View as" switch offers Manager view and Tenant preview. The preview shows only Tenant Accessible records, hides costs, vendors and all edit controls, and shows shutoff instructions only when approved. It is a preview only: real enforcement belongs on the server later.
- **Editing and storage:** add, edit and delete (delete needs a second click) work for equipment, utilities and shutoffs, with validation (year, email, website, number fields, approval needs instruction text). Edits are saved in the browser's localStorage and never sent anywhere; "Reset demo data" restores the original fictional records. The view is responsive and has no horizontal overflow on phones.

#### Tickets in demo mode: search, statuses, details and equipment links

These behaviors exist only with `?demo=1` (the extra code paths are guarded, and the real dashboard keeps its four statuses and its current layout). Everything is stored in the browser (localStorage key `dashboardPractice.demoTickets.v1`); nothing is written to Airtable, Make or the tenant portal. The Claude API and the AI agent are not connected: the AI Handling Status and the Vendor Brief are fields for a future agent to fill in.

- **Search and filters:** above the requests table, a **Category** filter (the existing six categories) and a **Search tickets** box work together, inside the selected property, and can be cleared with **Reset filters**. The search is case-insensitive, matches every word typed (so "bathtub slowly" needs both), and looks at the ticket id, title/description, category, priority, status, vendor, summary, internal notes, vendor brief, AI handling status, the word "emergency", and the names, brands, models and locations of linked equipment. A third tab, **All Tickets**, lists open and closed tickets together (the other tabs are Open and **Resolved / Closed**). Tab counts and a summary line ("N of M tickets match") follow the filters, and an empty tab says how many tickets match in the other tab. The KPIs, charts and cost totals ignore the filters.
- **Statuses:** New, Awaiting Tenant, Scheduling Required, Scheduled, In Progress, Resolved, Closed. Resolved and Closed both count as finished (they need a resolved date, appear in Resolved / Closed, and count toward Resolved This Month and the average resolution time). The status chart and badges use extra soft pastel colors for the new statuses.
- **Priority and Emergency Flag:** the existing priority system (Low, Medium, High, Urgent) is unchanged. A separate **Emergency Flag** shows as a red "Emergency" badge next to the priority in the table, the mobile cards and the ticket dialog.
- **AI Handling Status (internal):** Not Started, Analyzing, Waiting for Tenant, Escalated, Completed, Failed. It is shown in the ticket dialog and is searchable; nothing sets it automatically yet.
- **Ticket details:** the existing ticket dialog also shows the emergency flag, AI handling status, internal notes, attachments (images loaded lazily, same viewer as equipment attachments) and linked equipment (each a button that opens that item and its history in Systems & Equipment). The **Vendor Brief** is an editable text area with **Save brief** and **Copy brief** buttons (it copies the text currently in the box; an empty box says there is nothing to copy). **Edit ticket** opens a form for category, priority, status, emergency flag, AI handling status, assigned to (the servicing company), date resolved (shown for Resolved and Closed), cost and cost date, repair date, repair summary, receipts and invoices, internal notes, linked equipment and the vendor brief. Saving runs the same validation as every other source (for example the resolved date can't be before the created date and the cost date can't be after the resolved date). The ticket dialog on a phone shows each label above its value.
- **Equipment links:** a ticket is linked to equipment from the ticket (`equipment_ids`, several allowed). Deleting an equipment item removes the link from its tickets and leaves the tickets.
- **Equipment maintenance history:** an item's history is built from two kinds of entries: the **tickets linked to it**, and **manual events with no ticket** (purchase, installation, inspection). Ticket entries read the date (the repair date when recorded, labeled Repaired; otherwise the resolved date, or the created date for open tickets, labeled Reported), repair summary (the ticket's repair summary, or its sample summary when none is written), vendor (the ticket's Assigned To), cost, ticket id, status and **receipts** from the ticket, and are never copied, so the ticket is the single source of truth. Each receipt appears as a clickable link that opens the original file (see Repair details and receipts). Each ticket entry is a button that opens that ticket in the existing ticket dialog; closing it returns focus to the entry, and the dialog's equipment buttons lead back to the item. Missing information is shown as "No vendor recorded", "Cost not recorded" or "No repair summary recorded.", never invented. The history header shows the number of entries and the total of recorded costs. The Tenant preview shows ticket entries as plain text without vendor, cost or receipts. Manual events can be added on an item; they have no ticket, and can carry photos and documents (see Manual history event attachments).
- **Manual history event attachments (manager only):** **Add history event** (and **Edit event** on an existing one) opens a dialog with the date, type, what happened, company or vendor and cost, plus two file lists: **Photos** (condition, installation, inspection or maintenance; images only: PNG, JPEG, WebP or GIF) and **Receipts, invoices and other documents** (PDF or images). Each list takes several files at once (up to 10 per list, 5 MB each) and offers **View**, **Download** and **Remove** per file. This reuses the receipt file workflow: files are staged in the form and only stored when it is saved, **Cancel** stores nothing, removed files are deleted only on save, and if storing fails the event is not saved and files stored in that attempt are undone. The event keeps only small references (id, file name, type, size); the files are in the browser's IndexedDB and survive a reload. Each history entry shows its attachments directly: photo thumbnails (loaded lazily) and file tiles for documents, each opening the original on click, with a Download link. **Delete event** (two clicks) also deletes its files, and so does deleting the equipment item. Attachments are manager only: the Tenant preview shows none of them, nor the Add or Edit buttons. Stored files carry a scope ("ticket" or "history") so "Reset demo ticket edits" deletes only ticket receipts and "Reset demo data" deletes only history attachments. Two seeded events carry fictional attachments (a furnace inspection photo and a refrigerator purchase receipt). The same persistence limits as receipts apply.
- **Repair details and receipts (manager only):** each ticket can record the **servicing company** (the ticket's Assigned To), the **repair date**, the **cost** and cost date, and a **repair summary** (written by a person, separate from the sample "AI summary"). The repair date must be on or after the created date, not in the future, and not after the resolved date. A ticket can hold up to 10 **receipts or invoices** (PDF, PNG, JPEG, WebP or GIF; SVG is refused because an SVG opened from the site can run scripts; up to 5 MB each). In the edit form a manager picks several files at once, sees them listed, and can **View** (opens the original file in a new tab), **Download** (saves it under its own name) or **Remove** each one. Files are staged: nothing is stored until the ticket is saved, **Cancel** stores nothing, and removing a receipt deletes its file only on save. If storing a file fails (for example the browser's storage is full), the ticket is not saved and any files stored in that attempt are undone. The ticket dialog lists the receipts with View and Download. Receipts, vendors and costs are manager only: the equipment history hides all three in the Tenant preview.
- **Receipt storage (demo):** the ticket keeps only a small durable reference per receipt (id, file name, type and size); the file itself is stored in the browser's **IndexedDB** under that id, never in localStorage (which holds about 5 MB of text and would be filled by a few PDFs). Equipment history only links to the ticket's references, so no file or detail is ever copied. Seeded demo receipts (on `HV-006` and `HV-009`) are static fictional files referenced by path. **Persistence limits:** the files stay in this browser only; they are lost if the browser's site data is cleared, may not persist in private or incognito windows (the form then says receipts can't be added), may be evicted by the browser under heavy storage pressure, and can't be seen from another browser or device. "Reset demo ticket edits" deletes the stored files. In production the same references become Airtable attachment ids, served through the backend with fresh links, with the manager-only rule enforced on the server.
- **Saved data from Task 1:** earlier saved equipment data (version 1) is upgraded when loaded: ticket-linked history copies become ticket links, manual events are kept, and equipment added to the demo since is merged in.
- **Demo limits:** edits live only in this browser and can be undone with "Reset demo ticket edits" (tickets) and "Reset demo data" (equipment); there is no real sign-in, so the Manager view and Tenant preview are a visual preview of what the server must enforce later; issue photos on a ticket (the Attachments row) can be displayed but not yet added in the form, whereas receipts can be added; the New Request form sets none of the extra ticket details.

## AI Maintenance Agent (Task 3 design, built as a local demo)

**Status.** The agent is **built and working as a local demo**. It runs on one machine behind `localhost`, on the fictional "10 Harbor View" demo data, and is not deployed publicly, not connected to Airtable, Make or e-mail, and has no sign-in. Repository: <https://github.com/stavdayan-netizen/Dashboard-Practice>. How the pieces connect, the trigger, the output and the information-flow diagram are in [`Architecture.md`](Architecture.md). The longer working specification, the twelve emergency scenarios and the test history are in `agent/AGENT_SPEC.md`, `agent/EMERGENCY_RULES.md` and `agent/STAGE6_PLAN.md`.

### 1. Purpose and assigned task

The agent is a **tenant-facing maintenance assistant** for a property manager. When a tenant reports a problem, it:

1. Classifies the situation as **Routine**, **Urgent** or **Emergency**.
2. Takes one of three paths: **A** safe, simple self-troubleshooting (one focused step at a time, only steps that are safe for a non-professional); **B** hand-off to professional service; **C** emergency (safety instructions first, no troubleshooting).
3. Uses read-only tools to look at the ticket, the equipment, its maintenance history and verified manufacturer guidance.
4. **Drafts a proposed ticket update** for the property manager, who approves or rejects it. The agent cannot change a ticket itself.

Replies to the tenant are delivered immediately and are not held for review; only ticket changes need manager approval.

### 2. Who does what

- **Tenant:** chats with the agent in the demo portal (`tenant.html?demo=1`, local server only). Submitting a request starts the conversation, and the assistant speaks first.
- **Manager:** reads the full conversation, the tool trace and the proposals in the dashboard (`index.html?demo=1`), approves or rejects each proposal, and separately confirms applying an approved one to the demo ticket.
- **Agent:** reads through tools and drafts proposals. It cannot write to a ticket, schedule work, contact anyone, spend money or claim that an action was done.

### 3. Emergency and safety requirements

Potential emergencies (water near electrical fixtures or wiring, gas smell, smoke or fire, carbon monoxide, shock or sparks) must be flagged and escalated:

- The agent tells the tenant at once to stay away from the hazard, to call 911 when there is immediate danger, and to contact the property manager.
- It never suggests a hazardous DIY repair, never operating electrical switches near water, never investigating a gas leak, and never any shutoff, pilot, breaker, panel or furnace step in an emergency. For gas it must also say not to create sparks (no switches, flames or phones near the leak).
- It does not delay escalation to ask troubleshooting questions.
- It names **no gas company or phone number**: the demo gas record is "Estimated", so it is not verified (`agent/EMERGENCY_RULES.md`).
- It never claims that 911 or the manager has been notified.
- Warranty, cost, vendor, receipt and Internal Only data are never given to a tenant.
- Server-side guards enforce these rules whatever the model says (section 8).

### 4. Prompt

The system prompt is two texts joined at run time:

- **Base prompt:** `agent/system-prompt.draft.md`, the prompt tested in the Anthropic Playground, used **verbatim** (SHA-256 begins `f199ec78`).
- **Connected-mode addendum:** `agent/system-prompt.connected-addendum.md`, revision 6 (SHA-256 begins `40f732c7`). It adapts the Playground prompt to the connected tools and the manager-approval flow, and holds the lessons from the live tests (for example: draft the proposal in the same turn as the hand-off, one action per reply, do not open the manual for a simple first check).

Both texts are checked against `agent/prompt-hashes.json`. If either changed without the owner running `Update-PromptHashes.ps1 -Confirm`, the agent refuses to start. The hashes used are stored with every conversation. The prompt files are in the repository and can be read in full.

### 5. Tools

All tools run on the local server against the demo files. The audience (`tenant` or `manager`) is set by the route, never by tool input; tool input with unknown properties, wrong types, oversized text or control characters is rejected; every id is checked against a strict pattern and the demo data.

| Tool | Input | What it does |
| --- | --- | --- |
| `get_ticket_details` | `ticket_id` | Ticket fields, status, priority, Emergency Flag, AI Handling Status, linked equipment ids and tenant-safe notes; or `not_found` |
| `get_equipment_info` | `equipment_id` | Category, type, brand, exact model, location, tenant-accessible details, whether a manual is available. Estimated years are labelled; serial numbers that start with `FICT-` are flagged as fictional |
| `get_maintenance_history` | `equipment_id`, optional `limit` | Previous repairs and recurring issues built from linked tickets, newest first |
| `get_equipment_manual_guidance` | `equipment_id`, `question` | From `demo/manuals.json`: `matched` true or false; when matched, manufacturer, document title, official link, page references, a short summary written for this project and a `delivery_rule`. Guidance is **series-level** (the manufacturer's manual covers a series, not only the exact unit), so the agent must not claim an exact-model match. When not matched it returns a reason (`no_manual_registered`, `manual_unavailable`, `model_missing`, `brand_model_mismatch`, `model_unverified`). No manufacturer PDF is stored |
| `draft_ticket_update` | `ticket_id`, `fields`, `reason`, optional `tenant_confirmed_resolution` | The **only write**, and it writes only a **pending proposal** in `agent-data/proposals/`. It refuses `priority` (the classification goes in a separate AI urgency field), unknown fields, other tickets and equipment outside the tenant's scope; `Resolved` is accepted only with the tenant's confirmation; unchanged values are filtered out; a new draft for the same conversation and ticket is merged into one pending proposal (at most 5 pending proposals per conversation); a `based_on` list records what the draft rests on |

Tenant scope is strict: a tenant call must belong to an existing conversation, sees only the conversation's ticket and the Tenant Accessible equipment linked to it, and never receives cost, vendor, warranty, receipt or Internal Only fields (a warranty text filter is also applied). The manager actions (approve, reject, mark applied) are server functions that need the manager audience; they are **not** agent tools.

### 6. Memory management

The Messages API is stateless, so memory is built by the server on every turn from the stored conversation.

- **Full transcript, always stored, never edited:** one JSON file per conversation in `agent-data/conversations/` (UTF-8, ISO 8601 timestamps, role, text, source). Limits: tenant text 2000 characters, assistant text 4000, 200 messages per conversation.
- **Short conversations:** the model input is the whole history.
- **Long conversations** (more than 20 messages, or more than about 40,000 characters): the model input is a **server-built facts block** + a **model-written structured summary** of the older part + the **last 8 messages**. The summary is **validated** by the server against the transcript and a deterministic **facts ledger** (safety reports made by the tenant, refusals, checks already attempted, whether the introduction was given). If the validation fails the summary is regenerated once with feedback; if it still fails the server falls back to the full history or a trimmed recent window with the facts block. A valid summary is reused until about 16 more messages accumulate.
- **Context block:** the ticket id, the tenant-visible equipment linked to the ticket and, right after a portal submission, a "just submitted" note are added to the model input only (they are not stored in the transcript).
- **No memory across conversations.** Each conversation is bound to one ticket and one token (only a hash is stored). Cross-ticket knowledge exists only through the maintenance-history tool.
- **Tool results** are used within the run that requested them; they are not stored as tenant-visible text. The manager sees a trace of the tool calls.

### 7. Model configuration

Called with `Invoke-WebRequest` (no SDK) to the fixed address `https://api.anthropic.com/v1/messages`, header `anthropic-version: 2023-06-01`, tool use enabled.

| Setting | Value |
| --- | --- |
| Model | `claude-haiku-5-5` by default (`AGENT_MODEL=haiku`); `claude-sonnet-5-5` selectable (`sonnet`) but **not tested live** |
| Effort | `medium` (`AGENT_EFFORT`, sent as `output_config.effort`) |
| Sampling, prefill, forced tool choice | None; thinking is left to the model default |
| Prompt caching | A cache breakpoint on the system block |
| Tool rounds per run | 6 (ceiling 12) |
| Output tokens per call | 4096 (ceiling 8192) |
| Estimated input tokens per call | 60,000 (ceiling 150,000) |
| Run time / call timeout | 90 s (ceiling 300) / 60 s (ceiling 120) |
| Retries | 2 (ceiling 3), only for 429, 5xx and timeouts |
| Spend limits | $0.25 per run, $1 per day, $5 in total (ceilings $2, $20, $100); the worst case of a call must fit before it is sent; a ledger is kept in `agent-data/spend.json` |
| Live calls | Need `ANTHROPIC_API_KEY` and `AGENT_LIVE_ENABLED=1` in the git-ignored `.env`; the key is never printed, stored elsewhere or logged |

Values typed in `.env` are clamped to the hard ceilings.

### 8. Safety controls (enforced by the server)

- **Leak guard:** a reply containing a tool name, an internal marker or a credential-like string is replaced by a fixed message.
- **Fail-safe messages:** a fixed safe message is used when the model path fails (API error, limit hit, refusal, truncation, no key) and for confirmed emergencies (gas, smoke or fire, carbon monoxide, shock), decided by a keyword check that understands simple negations ("I don't smell gas").
- **Emergency reply bar:** a model reply to a confirmed emergency that lacks the basic safety instructions (leave and call 911; for gas also no sparks) is replaced by the fixed message.
- **Emergency proposal fallback:** if an emergency is confirmed and the model drafted no emergency proposal, the server drafts a pending one from a fixed template and the tenant's own words, labelled as server-drafted.
- **Reply check:** after each turn the server records which basic safety instructions the reply really contained versus what the proposal text claims.
- **Plain-text cleanup** of every reply; limits on rounds, tokens, time and spend (section 7).
- **Manager-approval boundary:** nothing changes a ticket until a manager approves and then separately confirms applying it. The applied change exists only in the manager's browser (localStorage).
- **Tenant text is data:** it cannot change tools, the audience or the rules. Tokens, rate limits, atomic file writes with retries and input validation protect the routes.

### 9. Local API

All routes accept local requests only (the `Host` and `Origin` headers are checked); POSTs must be JSON. The audience is set by the route.

| Route | Audience | Purpose |
| --- | --- | --- |
| `GET /api/agent/status` | Manager | Non-secret settings, estimated spend, prompt-hash check; never the key |
| `POST /api/agent/tenant/start` | Tenant | Open a conversation for an existing demo ticket; returns the id and a one-time token |
| `POST /api/agent/tenant/submit` | Tenant | Create a demo ticket, open a conversation, start the first run (**trigger**) |
| `POST /api/agent/tenant/message` | Tenant | Needs `X-Conversation-Token`; starts one run for one message (**trigger**); 409 while a reply is being prepared |
| `POST /api/agent/tenant/resume` | Tenant | Answer the saved tenant message that has no reply yet (**trigger**) |
| `GET /api/agent/tenant/result` | Tenant | Poll a run: running, done with the reply, or failed |
| `GET /api/agent/tenant/conversation` | Tenant | Tenant view: time, role and text only |
| `GET /api/agent/manager/conversations` | Manager | Full conversations with trace, facts and spend |
| `GET /api/agent/manager/proposals` | Manager | List proposals |
| `GET /api/agent/manager/submitted-tickets` | Manager | Demo tickets created through the portal |
| `POST /api/agent/manager/proposals/decide` | Manager | Approve or reject |
| `POST /api/agent/manager/proposals/applied` | Manager | Record that the dashboard applied an approved proposal |

### 10. Storage

`agent-data/` (git-ignored) holds JSON files: demo tickets, conversations, proposals, run files and the spend ledger. The `demo/` data is never modified.

### 11. Limits (honest)

- **Localhost only, no sign-in.** Tenant and manager are separated only by route (and a per-conversation token). The manager routes are **not** a security boundary. **Real authentication, per-user roles, ticket-ownership checks and protected manager routes are required before any real-world deployment.**
- Not connected to Airtable, Make, e-mail or SMS; the manager is alerted only by the on-page banner and counts.
- The server cannot see edits made only in a browser; plain files on one machine, no backup.
- Emergency detection is keyword based and covers the basic cases.
- Model wording varies; what is guaranteed is what the server checks.
- Haiku 5.5 was tested live (dishwasher, refrigerator, dishwasher filter, gas, the portal flow and a carbon monoxide alarm; about $0.03 in total). Sonnet 5.5, the remaining emergency scenarios and a long real-model conversation were not run live. The remaining live-test plan is `agent/FINAL_LIVE_TEST_PLAN.md`.

### 12. Testing

Five PowerShell suites run with a scripted mock model, no key and no network (**784 checks**, all passing): `agent/tests/Test-AgentTools.ps1` (265), `Test-AgentLoop.ps1` (247), `Test-AgentRoutes.ps1` (86), `Test-AgentChat.ps1` (140), `Test-AgentScenarios.ps1` (46). Mocked end-to-end scenario transcripts: `agent/scenarios/SCENARIOS.md`; browser failure tests: `agent/scenarios/FAILURE_TESTS.md`. Run one with `powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentTools.ps1`.

### 13. Acceptance criteria

1. With `?demo=1` on the local server, a tenant message gets an answer produced by the real model through the tools; without `?demo=1` or on GitHub Pages the portal and dashboard behave as before.
2. Each tool returns data from the demo files; unknown ids are rejected; a tenant conversation never contains Internal Only, cost, vendor, warranty or receipt data.
3. `draft_ticket_update` changes nothing until a manager approves; a rejected proposal changes nothing.
4. The conversation, with timestamps, appears in the manager's view and survives a server restart; the tenant sees only tenant-visible text.
5. The manual tool returns guidance only for a matched manual, with references, and never invents instructions.
6. The emergency scenarios in `agent/EMERGENCY_RULES.md` pass (mocked; a subset live).
7. No secret appears in any tracked file; `.env` and `agent-data/` are ignored; the real dashboard, Airtable data, Make scenarios and the live tenant portal behave as before.

### 14. Build stages

| Stage | Content | Status |
| --- | --- | --- |
| 1 | `Architecture.md` and this specification | Done |
| 2 | Playground prompt stored, reconciled with the emergency rules | Done |
| 3 | Demo equipment with real brands and models; `demo/manuals.json` | Done 2026-10-21 |
| 4 | Tools, validation and JSON store, tested without any API call | Done 2026-10-21 |
| 5 | Agent loop, API call, polling, limits | Complete 2026-10-24 |
| 6 | Tenant chat, manager conversations and proposals, portal submit, failure handling | Done; documented in `agent/STAGE6_PLAN.md` |
| 7 | Scenario tests, documentation | Mocked scenarios done; live-test plan not completed (batches A0 and B1 done) |

### 15. File map

| Path | What it is |
| --- | --- |
| `agent/agent-config.ps1`, `agent-lib.ps1`, `agent-loop.ps1`, `agent-runs.ps1`, `agent-api.ps1` | Settings and prompt loading; tools and store; model loop, memory, guards; background runs; routes |
| `agent/system-prompt.draft.md`, `system-prompt.connected-addendum.md`, `prompt-hashes.json` | The prompt and its hashes |
| `agent-chat.js/css`, `agent-manager.js/css`, `agent-proposals.js/css` | Tenant chat, manager conversations, proposal review |
| `demo/` | Fictional data and `manuals.json` |
| `agent/AGENT_SPEC.md`, `EMERGENCY_RULES.md`, `STAGE6_PLAN.md`, `FINAL_LIVE_TEST_PLAN.md`, `scenarios/` | Working spec, emergency rules, plans, scenarios |
| `agent/tests/` | The five suites |

## CSV format (fallback data and uploads)

`maintenance_requests.csv` is one UTF-8 CSV with exactly these headers in this order. `demo_upload_sample.csv` and any uploaded file use the same format:

```csv
id,date_created,property,tenant,issue,category,priority,status,assigned_to,date_resolved,cost,cost_date,ai_summary
```

| Column | Format / rule |
| --- | --- |
| `id` | Unique `MR-1001`, `MR-1002`, etc. |
| `date_created` | ISO `YYYY-MM-DD`, on or before as-of date. |
| `property` | Consistent property display name or address. `maintenance_requests.csv` uses eight fictional US rental properties. |
| `tenant` | Fictional tenant name. |
| `issue` | Short natural-language tenant report; retain the original meaning. Quote CSV fields containing commas or quotes. |
| `category` | Exactly one of `Plumbing`, `HVAC`, `Electrical`, `Appliance`, `Doors & Locks`, `General`. |
| `priority` | Exactly one of `Low`, `Medium`, `High`, `Urgent`. |
| `status` | Exactly one of `New`, `Scheduled`, `In Progress`, `Resolved`. |
| `assigned_to` | Fictional vendor or staff member, or empty for unassigned requests. |
| `date_resolved` | ISO date for `Resolved` only; otherwise empty. Must be on/after `date_created` and on/before as-of date. |
| `cost` | Nonnegative number without `$` or commas, e.g. `99` or `142.50`; blank if no actual cost has been recorded. Zero only for a confirmed no-charge job. |
| `cost_date` | ISO date if and only if `cost` is present. On/after `date_created`, on/before as-of date; for a resolved request, on/before `date_resolved`. |
| `ai_summary` | Short, useful *sample* summary and suggested next step, written as demo content. It is not generated live. |

`maintenance_requests.csv` contains **40 fictional requests across eight fictional properties**, spanning January through September 23, 2026. Counts vary by property, status, priority, category, cost, and resolution time; it includes several urgent open requests, September resolutions, older resolutions, both blank and nonblank costs for open requests, and at least one property with no YTD cost. Every status and category appears. It contains no actual tenants' names, addresses, phone numbers, or real vendor details. The data makes each KPI, chart, property filter, tab, dialog, and cost summary visibly testable.

Example schema row (illustrative, not a required real record):

```csv
MR-1001,2026-09-20,123 Cedar St,Jordan Lee,Kitchen sink is leaking,Plumbing,High,In Progress,Sample Plumbing Co,,85,2026-09-21,Active sink leak; follow up with plumber and tenant.
```

Parse CSV with a proper CSV parser, not manual `split(',')`. Derive counts and totals in code. Validate IDs, dates, allowed values, and cost/cost-date consistency. If malformed rows exist, report them clearly instead of silently displaying wrong totals. The README states that editing the CSV and refreshing/rebuilding the app is how the fallback data is updated (rerun `generate-data.ps1` to refresh `data.js` when opening the page as a file), and documents the Airtable and Vendor Research setup.

## Visual design

Use a clean modern property-management SaaS style: near-white page background, white cards, generous spacing, subtle borders and shadows, moderately rounded corners, and a restrained deep blue or indigo accent. Use readable sans-serif typography similar to Inter. Do not color entire table rows. Give the cost summary enough visual weight to be discoverable without overpowering the request table. Keep charts legible and avoid ornamental graphics.

- **Priority badges:** red/pink Urgent, orange High, yellow Medium, green Low, each with a matching border so the three warm levels stay distinguishable. Badge text keeps at least 4.5:1 contrast. Status badges: gray New, pale indigo Scheduled, orange In Progress, green Resolved.
- **Chart colors:** soft pastels. The category donut uses six distinct pastels (blue, mint, yellow, lavender, pink, peach). The status bar chart uses its own four pastels (gray New, blue Scheduled, orange In Progress, mint Resolved), kept distinct from each other and a shade paler or hue-shifted from the donut's closest colors. Legend swatches use the same colors as the charts, and labels never depend on color alone.
- **Weather cards:** same white cards, border, radius, and shadow as the rest of the dashboard. The condition image is the one colorful, photographic element and is rounded to match; alert colors reuse the Urgent (red) and High (orange) palette, and the no-alert message uses the Low (green) palette.
- The data source badge is green for "Live: Airtable" and gray for "Sample data (CSV)".

## Desktop, phone, and accessibility

- Desktop: aligned header/selector, four KPI cards in a row when space permits, the four weather cards in one row, charts side by side, full table below, cost summary below it. Vendor Research shows the ticket list beside the selected ticket's details and results.
- Phone: no horizontal page overflow; stack KPI cards and charts, keep the property selector and tabs usable with touch, and render each request as a compact card with its key fields rather than squeezing a seven-column table. Render the cost summary as a stacked list or responsive table. Dialogs fit the viewport, scroll internally if needed, and have a visible close button. Vendor Research stacks into one column.
- Provide visible keyboard focus, proper button/selector labels, adequate contrast, chart labels that do not depend on color alone, keyboard-operable tabs and dialogs, Escape to close dialogs, and sensible focus return after closing. Focus trapping skips hidden controls. Vendor Research ticket entries are buttons that report their selected state, and search progress is announced through a status region.

## Acceptance checks

- `maintenance_requests.csv` has exactly 40 valid rows, eight distinct fictional properties, and the specified header; the app renders it without errors when Airtable is unavailable, and the badge reads "Sample data (CSV)".
- With Airtable available the badge reads "Live: Airtable", the Property column and selector show property names (never record IDs), and invalid Airtable rows are excluded and reported (for example a duplicate ID or a date after the as-of date).
- Switching a property changes all four KPIs, both charts, both tab counts and their rows, the YTD cost section, and the Vendor Research ticket list consistently.
- Switching Open/Resolved changes only the request list, not the charts, KPIs, or YTD costs.
- YTD total equals the sum of eligible actual costs by `cost_date`; requests with blank costs contribute nothing, and costs from open requests count when incurred this year.
- The dialog shows original text and the clearly labeled sample AI summary; it makes no claim of live AI classification.
- Upload CSV: the demo file loads all 36 rows; an invalid file keeps the current data and shows an error. + New Request: a valid request appears in the lists and updates KPIs, charts, and costs; invalid input shows an inline error; nothing is persisted.
- Vendor Research: only open tickets are listed; the dialog button appears only for New and In Progress tickets and opens the view with that ticket selected; selecting a ticket shows its issue and full address; no Apify request is made until Find Vendors is clicked; results show up to 5 vendors with all seven fields; on a non-local page the notice appears and the button is disabled.
- `APIFY_TOKEN` appears in no tracked file or served page; `.env` is gitignored and `serve.ps1` does not serve it.
- Weather & Property Alerts: with live data, one card per property appears between the KPIs and the charts (four in one row on desktop, one column on phones) and follows the Property selector; each card shows the condition image with temperature and conditions overlaid, wind and chance of rain, a borderless 7-day strip, and alerts (today's highlighted); no sunrise/sunset, feels-like, humidity, or gusts are shown; the section shows a notice for CSV data without addresses and is hidden in Vendor Research; no API key appears in any tracked file.
- Demo mode: `?demo=1` shows the fictional 10 Harbor View demo (13 open, 17 resolved or closed, 3 urgent open, 3 resolved this month, $862.00 year to date as of 2026-10-19) with the "Demo data (fictional)" badge and note, the weather card for 10 Harbor View, no validation banner and no Airtable calls; without `?demo=1` nothing changes.
- Systems & Equipment (demo mode): the header button exists only with `?demo=1`; the view lists 12 expandable categories with the demo counts (Appliances 7, Heating & Cooling 3, Water Heater 1, Roof & Gutters 1, Garage 1, Electrical Panel 1, Plumbing & Drains 4, Doors/Windows/Locks 2, Smoke & CO 2, Basement 0, Exterior 0, 5 utilities and 4 shutoffs); adding, editing, deleting and attaching files persist across a reload and "Reset demo data" restores the originals; invalid input is rejected without saving; the Tenant preview shows only Tenant Accessible records and no costs or edit controls; images load only when they near the screen; the real dashboard is unchanged.
- Tickets in demo mode: filtering by category shows the matching tickets (for example Plumbing 3 open and 4 closed); searching "bathtub" finds only the bathtub ticket; category and text filters combine; the search reaches closed tickets and internal notes, and an empty tab points to matches in the other tab; Reset filters clears both; every history entry on an item opens its own ticket and returns focus to the entry; a ticket's equipment link adds or removes the entry in that item's history without copying vendor, cost or summary; manual history events without a ticket are kept; edits (statuses, emergency flag, AI handling status, notes, vendor brief, links) are validated, persist after a reload and can be reset; Copy brief puts the brief text on the clipboard; the real dashboard keeps four statuses and shows none of this.
- Agent tools and storage (Stage 4): `powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentTools.ps1` ends with "185 passed, 0 failed"; a tenant call cannot read another ticket, unlinked or Internal Only equipment, costs, vendors, internal notes or the tool trace; an unknown id and an unauthorized id give the identical tenant error; manual guidance returns matched false with a reason for missing or mismatched manuals and labels every match as series or general guidance, not exact-model guidance; drafting only writes a pending proposal and never changes `demo/`; approvals need the manager audience and follow pending, approved, applied or rejected; conversations and proposals survive a new process; `git status` shows no change to the dashboard, tenant portal, `serve.ps1` or `demo/`.
- Agent loop and local API (Stage 5, mocked): `Test-AgentLoop.ps1` and `Test-AgentRoutes.ps1` end with 0 failed (175 and 67 checks) with no key and no real API call; the system prompt is the verbatim base plus the addendum and a changed text stops the agent; live calls need both a key and `AGENT_LIVE_ENABLED=1`; limits on tool rounds, tokens, time and spend stop a run and are enforced before the call; failed tools, API errors, refusals and truncated replies end in a fixed fail-safe message, and gas, fire, CO or shock reports still get safety instructions when the model path fails; tool results, traces, costs and the key never appear in a tenant reply, run file or stored conversation; summaries are validated against the transcript and never replace it; four concurrent writer processes lose nothing; `serve.ps1`'s existing routes behave as before and `agent-data/` is never served.
- Demo manuals registry: `demo/manuals.json` is valid JSON; every `manual_id` on an equipment record exists and its manufacturer, model and equipment id match; the four linked records keep their ids, ticket links and history; the 22 records and category counts are unchanged; each verified entry cites the manufacturer's model page, the document number and page references; every verified entry names tenant-safe checks separately from professional-only items, and gas-system service steps are never listed as tenant checks; no manufacturer PDF is tracked in the repository.
- Receipts and repair details (demo mode): several receipts (PDF and images) can be added to one ticket at once, listed, viewed in a new tab, downloaded under their own name and removed; wrong file types, empty files and files over 5 MB are refused with a clear message; nothing is stored until Save and Cancel stores nothing; the saved files and the ticket's references survive a reload and the stored bytes are identical to the original; a failed store leaves the ticket unchanged; the repair date is validated against the created, resolved and today dates; the equipment history shows the repair date, summary, servicing company, cost, ticket id, status and clickable receipts from the ticket, a chip opens the same original file, and the entry itself still opens the ticket; the Tenant preview shows none of the receipts, vendor or cost; "Reset demo ticket edits" deletes the stored files; the layout has no sideways overflow on a phone.
- Manual history event attachments (demo mode): several photos (images only) and documents (PDF or images) can be added to a manual history event when creating or editing it, and each can be viewed, downloaded and removed; wrong file types are refused (a PDF can't be a photo) and nothing is stored until Save, and Cancel stores nothing; the files and their original bytes survive a reload; the history entry shows the attachments directly (lazy photo thumbnails, document tiles, Download links) and an Edit event button; deleting an event or its equipment deletes its files; a failed store leaves the event unsaved and the stored files undone; the Tenant preview shows no attachments or edit controls; resetting tickets keeps history attachments and resetting equipment data keeps ticket receipts; the layout has no sideways overflow on a phone.
- AI agent documentation: `agent/EMERGENCY_RULES.md`, `agent/AGENT_SPEC.md` and `agent/system-prompt.draft.md` exist, state the emergency requirements, the three conversation paths, the selective manual retrieval rules, the five tools and the 12 emergency + 18 functional test scenarios, list the unresolved decisions, describe the agent as originally planned (the built agent is described in the agent section above), and contain no key, token, webhook URL or credential.
- Hourly refresh: an Airtable change appears within an hour without reloading; the selected property and tab are preserved; a failed refresh keeps the current data; an uploaded CSV is never overwritten; requests added with + New Request survive a refresh.
- At common desktop and phone widths, all controls remain usable and the page has no horizontal overflow.

## Revision notes

Approved changes since the original brief:

- Removed the header subtitle; added the data source badge and the Download demo CSV, Upload CSV, Vendor Research, and + New Request actions.
- Ticket data now comes from Airtable (read-only token), with the CSV as fallback, replacing "local CSV as the sole data source". The Property field became a linked record to a Properties table; the `Full Address` lookup is kept on every row for vendor search.
- Added Upload CSV, the 36-row demo CSV, and a working + New Request form. The original brief excluded a New Request button; this replaces that exclusion.
- Added the Vendor Research view (Apify Google Maps Scraper through the local server) and its button in the ticket details dialog.
- Added the Weather & Property Alerts section (Census Geocoder and Open-Meteo, no keys): a compact four-across row of property cards, each with a generated condition image with the temperature and conditions overlaid, wind and chance of rain, a borderless 7-day forecast, and rule-based maintenance alerts. Sunrise/sunset, feels-like, humidity, and gusts were deliberately left out.
- Added demo mode (`?demo=1`) with a fictional data pack for 10 Harbor View under `demo/`, as the isolated base for the Systems & Equipment views and the AI Maintenance Agent. Real data and the default dashboard are unchanged.
- Added the Systems & Equipment view (demo mode only): categories, equipment, utilities, shutoffs, history, attachments, visibility and a tenant preview, on the fictional 10 Harbor View data. It uses localStorage only; real data and the default dashboard are unchanged.
- Added, in demo mode only, ticket search and category filtering with an All Tickets tab; three more statuses (Awaiting Tenant, Scheduling Required, Closed); an Emergency Flag separate from priority; an internal AI Handling Status; an editable Vendor Brief with Copy; ticket attachments and equipment links; and equipment history built from linked tickets (the ticket is the single source of truth) with clickable entries. Demo data grew to 30 tickets and 22 equipment items. The real dashboard, the Make scenarios and the tenant portal are unchanged.
- Added, in demo mode only, a repair documentation workflow: managers can record the servicing company, repair date, cost and repair summary on a ticket and upload, view, download and remove several repair receipts or invoices (PDF or images, stored in the browser's IndexedDB, kept out of localStorage). The equipment history shows each linked ticket's receipts as links to the ticket's own files and never copies them. Receipts, vendors and costs are manager only. The real dashboard, the Make scenarios and the tenant portal are unchanged.
- Added, in demo mode only, photos and documents on manually added equipment history events (several per event, upload, preview, download and removal, manager only, kept in the browser's IndexedDB with a per-feature scope and shown directly in the history entry).
- Recorded the AI agent's emergency and safety requirements (automatic flagging and escalation, immediate tenant safety guidance, forbidden advice, manager review that never delays safety) in this spec, in `agent/EMERGENCY_RULES.md` and in a draft system prompt. The agent itself is not built or connected.
- Extended the agent documentation (documentation only, nothing built): added `agent/AGENT_SPEC.md` (three conversation paths with the one-time Path A introduction, troubleshooting strategy, selective manual retrieval, planned tools and boundaries, 12 functional tests, unresolved decisions); added the simplified emergency contact policy (`EMERGENCY_RULES.md` section 4a) and clarified that there are no automatic emergency notifications at this stage; rewrote the draft prompt sections accordingly. The 12 emergency scenarios remain mandatory release gates.
- Added `Architecture.md` (system architecture, data flows, trust boundaries) and the Task 3 implementation specification for a working local AI agent (tools, local API, storage, validation, acceptance criteria, build stages). Documentation only; `agent-data/` was added to `.gitignore`. The agent's behavior waits for the tested Playground system prompt.
- Owner decisions of 2026-10-22: Haiku first then Sonnet, both safety nets confirmed, default spend limits confirmed, medium effort (now the explicit default), and addendum revision 3 (911 follows danger signs or a credible, imminent threat, not dripping water alone; addendum hash re-recorded, base prompt unchanged).
- Stage 5 of the agent plan: added the local Anthropic Messages API client and tool-use loop (`agent/agent-config.ps1`, `agent-loop.ps1`, `agent-runs.ps1`, `agent-api.ps1`), prompt hash guard, spend ledger and limits, fail-safe and output guards, validated conversation summaries with a facts ledger, background runs with file locking, the `/api/agent/*` routes (additive hook in `serve.ps1`, `agent-data/` blocked from static serving), owner scripts `Check-AgentSetup.ps1` and `Run-LiveTest.ps1`, and 242 mocked tests. Two restricted-procedure notes in `demo/manuals.json` were reworded to name the work, not the steps. No live API call was made; the chat UI is Stage 6.
- Stage 4 of the agent plan: added `agent/agent-lib.ps1` (the five demo-only tools, local timestamped conversation and pending-proposal storage under the git-ignored `agent-data/`, manager decision functions, tool definitions) and `agent/tests/Test-AgentTools.ps1` (185 direct checks). Tickets, equipment, history, the dashboard, the tenant portal, `serve.ps1` and all production integrations are unchanged; no API key and no network code were added. `priority` is not an allowed proposal field. The routes and the chat UI come in Stages 5 and 6.
- Stage 3 of the agent plan: refreshed four demo equipment records with a real manufacturer and exact model (GE GTS18GTHWW refrigerator, GE GDF530PSMSS dishwasher, GE GTW465ASNWW washing machine, Trane S9V2B040U3PSCA gas furnace) and added `demo/manuals.json`, a registry of verified manufacturer documents with page references and short tenant-safe guidance. Equipment ids, ticket links, history, warranties and category counts are unchanged; manufacture years were adjusted to the models' production windows; no manufacturer PDF is stored. The furnace was first Goodman GMES800803BN, replaced by the Trane because no matching owner manual was found.
- Recorded the owner's decisions on the prompt conflicts (risk-based electrical rule, model-written safety messages, word-for-word shutoff quote, "once you are safe", immediate tenant replies with only ticket proposals reviewed, separate AI urgency field, conversations always attached to an existing demo ticket, deferred photo upload) and drafted the connected-mode addendum `agent/system-prompt.connected-addendum.md`, awaiting approval. Documentation only; the tested prompt is unchanged.
- Stored the tested Anthropic Playground system prompt verbatim in `agent/system-prompt.draft.md` as the authoritative behavior spec and reconciled the agent documentation with it (Path B by Routine or Urgent, separate Routine/Urgent/Emergency classification, one step at a time, no announcement of proposals to the tenant, plain-text replies, conversation memory, six added Playground scenarios). Open conflicts and decisions are recorded in `agent/AGENT_SPEC.md` section 7 and `agent/EMERGENCY_RULES.md` section 9. Documentation only; the emergency rules were not weakened.
- Added an hourly automatic refresh of the Airtable data and the weather (see Data sources). Before this, data loaded once per page load.
- Chart colors changed to soft pastels, and priority badges changed to red/pink, orange, and yellow with borders (previously red, orange, amber).
- The as-of date is now today's date instead of the fixed demo date `2026-09-23`, so tickets from the Tenant Maintenance Portal (dated today) are accepted. As a result "Resolved This Month" follows the current calendar month and year to date starts on January 1 of the current year; the sample data still ends on 2026-09-23.
- The KPI and cost definitions (apart from the date they are measured against), the CSV format, and the accessibility requirements are unchanged.

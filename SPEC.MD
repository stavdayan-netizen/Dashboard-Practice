# Tenant Maintenance Dashboard - Implementation Spec

*Last updated 2026-10-05. This spec describes the app as currently built. What changed from the original brief is listed under "Revision notes" at the end.*

## Goal and scope

Build a small, polished, **single-page** dashboard for a property manager handling tenant maintenance requests across multiple properties. This is a first project and a demo. Ticket data comes from a live **Airtable** base, with a local CSV as the fallback and as the format for uploads. The interface and sample data are in English; currency is USD. Do not claim a live connection to Zillow, TurboTenant, tenants, or an AI model. The only external services are Airtable (read-only ticket data) and Apify (vendor search, local server only); AI summaries are sample content.

Deliver a working responsive app, `maintenance_requests.csv` (fallback data), and `demo_upload_sample.csv` (a file to try Upload CSV with). Use a straightforward web stack with no build step: vanilla HTML, CSS, and JavaScript, with PapaParse (CSV parsing) and Chart.js (charts) loaded from a CDN. `serve.ps1` is a local PowerShell server (no Node or Python needed) that serves the files and hosts the local API for Vendor Research. Credentials:

- The Airtable token in `app.js` is a **read-only, single-base** token. It is public by design so the deployed page works without a login. Never use a token with write access or access to other bases.
- The Apify token lives only in a gitignored `.env` file (`APIFY_TOKEN`) and is read by `serve.ps1`. It must never appear in the browser, the repo, or the docs. `.env.example` lists the variable names only.

## Layout and behavior

One page, with these sections in order:

1. Header: **Tenant Maintenance Dashboard** (no subtitle), a small **data source badge** ("Live: Airtable" or "Sample data (CSV)"), one **Property** selector defaulting to **All Properties**, and four actions: **Download demo CSV**, **Upload CSV**, **Vendor Research**, and **+ New Request** (each specified below). Include every unique property from the loaded data in the selector. Changing the property updates every KPI, chart, request count, table, cost summary, and the Vendor Research ticket list. A status banner under the header reports load, upload, and validation messages.
2. Four KPI cards: **Open Requests**, **Urgent Open Requests**, **Resolved This Month**, **Avg. Resolution Time**.
3. Two charts: **Requests by Category** (donut) and **Requests by Status** (bar). Both reflect *all* requests for the selected property, independent of the Open/Resolved tab, and show category/status labels and counts. Use a clear legend or directly labeled bars.
4. **Maintenance Requests** with two tabs, **Open Requests (count)** and **Resolved (count)**. Default to Open. Tabs filter the requests in the table; switching properties preserves the selected tab. Show all matching requests, with no arbitrary top-ten cutoff. Open rows: Date, Property, Issue, Category, Priority, Status, Assigned To. Resolved rows may also show Date Resolved. Clicking a row opens an accessible dialog showing ID, property, tenant, original issue, category, priority, status, assignee, created/resolved dates if present, actual cost if present, and AI Summary. A blank assignee or cost displays `-` or `Not recorded`, never `$0` by default. For **New** and **In Progress** tickets only, the dialog also shows a **Vendor Research** button (see Vendor Research).
5. **Maintenance Costs Year to Date by Property**: a compact table listing each property and its total actual maintenance cost for the year to date. When All Properties is selected, list every property in the data sorted by cost descending and show a clearly labeled portfolio total. When a property is selected, show only that property's row and its total. This section does not change with the Open/Resolved tab. Show `$0` only when there are no recorded costs for a property in the date range.

The **Vendor Research** header button switches the page to a second view in place of sections 2-5 (the header and status banner stay); its label changes to **← Back to Dashboard** while that view is open. It is a view inside the same page, not a separate URL.

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

## Data definitions and calculations

Use `2026-09-23` as the demo **as-of date**, defined in one easy-to-change configuration constant. Data must contain no dates after it; **any row from any source (Airtable, CSV, upload, or New Request) with a date after it is rejected by validation and reported.** All date comparisons use calendar dates, inclusive, rather than rolling 30-day windows.

| Metric | Calculation after property selection |
| --- | --- |
| Open Requests | Count status `New`, `Scheduled`, or `In Progress`. |
| Urgent Open Requests | Count open requests with priority `Urgent`. |
| Resolved This Month | Count status `Resolved` with `date_resolved` in September 2026 (the as-of date's month). |
| Avg. Resolution Time | Mean of `date_resolved - date_created`, in calendar days, among all resolved requests for the selected property as of the as-of date. Show one decimal and `-` if none qualify. Same-day resolution is 0 days. |
| Category / status charts | Count all requests for the selected property, including resolved ones. Zero-count categories may be omitted consistently. |
| YTD cost per property | Sum numeric `cost` for rows with `cost_date` from January 1, 2026 through the as-of date, inclusive, grouped by property. Blank cost is excluded. The portfolio total is the sum of displayed property totals. |

`cost` is an **actual recorded cost**, not an estimate. A request can have a partial recorded cost while still open; its `cost_date` then records when that cost was incurred. Consequently, YTD cost must not be calculated from `date_created` or only from resolved requests. Do not use future costs. For the demo, a single request has at most one total actual cost and one corresponding cost date; this is a deliberate simplification.

Sort Open requests by priority (Urgent, High, Medium, Low), then newest `date_created`. Sort Resolved requests by newest `date_resolved`. Use ID as a stable tiebreaker.

## Data sources

On load the app tries **Airtable** first and falls back to **`maintenance_requests.csv`** (loaded from the file, or from the embedded `data.js` copy when the page is opened as a file) if Airtable is unconfigured or the request fails for any reason. The data source badge always shows which one is active.

Airtable base **Property Maintenance Tickets**:

- **Maintenance Tickets** table: the same 13 field names as the CSV (below). `category`, `priority`, and `status` are single selects and must use the allowed values. `property` is a **linked record** to the Properties table (the API returns record IDs, which the app translates into property names; an ID it can't resolve is reported as a validation error rather than shown). A **`Full Address`** lookup pulls the linked property's address.
- **Properties** table: `Property` (the display name shown in the dashboard), `City`, `State`, `ZIP Code`, and `Full Address` (a formula such as "10 Harbor View, Pittsburgh, PA 15211").
- Every row in the app carries a `full_address` value (blank for CSV rows). It is not shown in the tables; Vendor Research uses it as the search location.
- All sources go through the same validation. Invalid rows are excluded and counted in the status banner, with details in the browser console.

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
- The data source badge is green for "Live: Airtable" and gray for "Sample data (CSV)".

## Desktop, phone, and accessibility

- Desktop: aligned header/selector, four KPI cards in a row when space permits, charts side by side, full table below, cost summary below it. Vendor Research shows the ticket list beside the selected ticket's details and results.
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
- At common desktop and phone widths, all controls remain usable and the page has no horizontal overflow.

## Revision notes

Approved changes since the original brief:

- Removed the header subtitle; added the data source badge and the Download demo CSV, Upload CSV, Vendor Research, and + New Request actions.
- Ticket data now comes from Airtable (read-only token), with the CSV as fallback, replacing "local CSV as the sole data source". The Property field became a linked record to a Properties table; the `Full Address` lookup is kept on every row for vendor search.
- Added Upload CSV, the 36-row demo CSV, and a working + New Request form. The original brief excluded a New Request button; this replaces that exclusion.
- Added the Vendor Research view (Apify Google Maps Scraper through the local server) and its button in the ticket details dialog.
- Chart colors changed to soft pastels, and priority badges changed to red/pink, orange, and yellow with borders (previously red, orange, amber).
- The as-of date (`2026-09-23`), the KPI and cost definitions, the CSV format, and the accessibility requirements are unchanged.

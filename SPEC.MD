# Tenant Maintenance Dashboard - Implementation Spec

## Goal and scope

Build a small, polished, **single-page** dashboard for a property manager handling tenant maintenance requests across multiple properties. This is a first project and a demo: use a local CSV as the sole data source. The interface and sample data are in English; currency is USD. Do not claim a live connection to Zillow, TurboTenant, tenants, or an AI model.

Deliver a working responsive app and `maintenance_requests.csv`. Choose a straightforward web stack appropriate to the existing project, if any. Avoid unnecessary backend services and API keys.

## Layout and behavior

One page, with these sections in order:

1. Header: **Tenant Maintenance Dashboard**, a short subtitle, and one **Property** selector defaulting to **All Properties**. Include every unique property from the CSV in the selector. Changing the property updates every KPI, chart, request count, table, and cost summary.
2. Four KPI cards: **Open Requests**, **Urgent Open Requests**, **Resolved This Month**, **Avg. Resolution Time**.
3. Two charts: **Requests by Category** (donut) and **Requests by Status** (bar). Both reflect *all* requests for the selected property, independent of the Open/Resolved tab, and show category/status labels and counts. Use a clear legend or directly labeled bars.
4. **Maintenance Requests** with two tabs, **Open Requests (count)** and **Resolved (count)**. Default to Open. Tabs filter the requests in the table; switching properties preserves the selected tab. Show all matching requests from the 40-row sample, with no arbitrary top-ten cutoff. Open rows: Date, Property, Issue, Category, Priority, Status, Assigned To. Resolved rows may also show Date Resolved. Clicking a row opens an accessible dialog showing ID, property, tenant, original issue, category, priority, status, assignee, created/resolved dates if present, actual cost if present, and AI Summary. A blank assignee or cost displays `-` or `Not recorded`, never `$0` by default.
5. **Maintenance Costs Year to Date by Property**: a compact table listing each property and its total actual maintenance cost for the year to date. When All Properties is selected, list all eight properties sorted by cost descending and show a clearly labeled portfolio total. When a property is selected, show only that property's row and its total. This section does not change with the Open/Resolved tab. Show `$0` only when there are no recorded costs for a property in the date range.

No sidebar, search box, separate pages, extra filters, or nonfunctional **New Request** button in this version. Do not add a ticket edit workflow. Include helpful empty states if a selected property has no requests in a tab or no resolved requests this month.

## Data definitions and calculations

Use `2026-09-23` as the demo **as-of date**, defined in one easy-to-change configuration constant. The data must contain no dates after it. All date comparisons use calendar dates, inclusive, rather than rolling 30-day windows.

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

## CSV to create

Create **one UTF-8 CSV** named `maintenance_requests.csv` with exactly these headers in this order:

```csv
id,date_created,property,tenant,issue,category,priority,status,assigned_to,date_resolved,cost,cost_date,ai_summary
```

| Column | Format / rule |
| --- | --- |
| `id` | Unique `MR-1001`, `MR-1002`, etc. |
| `date_created` | ISO `YYYY-MM-DD`, on or before as-of date. |
| `property` | Consistent full display address; one of eight fictional US rental properties. |
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

Generate **40 fictional requests across eight fictional properties**, spanning January through September 23, 2026. Vary counts by property, statuses, priorities, categories, costs, and resolution times; include several urgent open requests, September resolutions, older resolutions, both blank and nonblank costs for open requests, and at least one property with no YTD cost. Every status and category should appear. Use plausible maintenance descriptions (leaks, heating, locks, appliances, etc.) and plausible USD costs. Do not put actual tenants' names, addresses, phone numbers, or real vendor details into the demo CSV. The data should make each KPI, chart, property filter, tab, dialog, and cost summary visibly testable.

Example schema row (illustrative, not a required real record):

```csv
MR-1001,2026-09-20,123 Cedar St,Jordan Lee,Kitchen sink is leaking,Plumbing,High,In Progress,Sample Plumbing Co,,85,2026-09-21,Active sink leak; follow up with plumber and tenant.
```

Parse the CSV with a proper CSV parser, not manual `split(',')`. Keep CSV as the source of truth; derive counts and totals in code. Validate IDs, dates, allowed values, and cost/cost-date consistency. If malformed rows exist, report them clearly during development instead of silently displaying wrong totals. State in the README that editing the CSV and refreshing/rebuilding the app is how the demo data is updated.

## Visual design

Use a clean modern property-management SaaS style: near-white page background, white cards, generous spacing, subtle borders and shadows, moderately rounded corners, and a restrained deep blue or indigo accent. Use readable sans-serif typography similar to Inter. Use semantic badges for urgency and status: red Urgent, orange High, amber Medium, green Low/Resolved. Do not color entire table rows. Give the cost summary enough visual weight to be discoverable without overpowering the request table. Keep charts legible and avoid ornamental graphics.

## Desktop, phone, and accessibility

- Desktop: aligned header/selector, four KPI cards in a row when space permits, charts side by side, full table below, cost summary below it.
- Phone: no horizontal page overflow; stack KPI cards and charts, keep the property selector and tabs usable with touch, and render each request as a compact card with its key fields rather than squeezing a seven-column table. Render the cost summary as a stacked list or responsive table. Dialog fits the viewport, scrolls internally if needed, and has a visible close button.
- Provide visible keyboard focus, proper button/selector labels, adequate contrast, chart labels that do not depend on color alone, keyboard-operable tabs and dialog, Escape to close the dialog, and sensible focus return after closing.

## Acceptance checks

- CSV has exactly 40 valid rows, eight distinct fictional properties, and the specified header; the app loads it and renders without errors.
- Switching a property changes all four KPIs, both charts, both tab counts and their rows, and the YTD cost section consistently.
- Switching Open/Resolved changes only the request list, not the charts, KPIs, or YTD costs.
- YTD total equals the sum of eligible actual costs by `cost_date`; requests with blank costs contribute nothing, and costs from open requests count when incurred this year.
- The dialog shows original text and the clearly labeled sample AI summary; it makes no claim of live AI classification.
- At common desktop and phone widths, all controls remain usable and the page has no horizontal overflow.

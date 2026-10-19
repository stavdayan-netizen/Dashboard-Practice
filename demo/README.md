# Demo data pack: 10 Harbor View (fictional)

Everything in this folder is **fictional test data**. It is used by the dashboard's demo mode and, later, by the AI Maintenance Agent tests. It is never read from or written to Airtable, and no real property, tenant, vendor, phone number or email is in it (phones use `555-01xx`, emails and websites use `example.com`).

Open it with `index.html?demo=1` (needs a web server, for example `serve.ps1` then `http://localhost:8531/?demo=1`, or the GitHub Pages address with `?demo=1`). Without `?demo=1` the dashboard behaves exactly as before and uses the real Airtable data.

## Why 10 Harbor View
It is one of the existing fictional properties in the dashboard (Airtable Properties record `recBuim4HdvIeouCI`, address "10 Harbor View, Holtwood, PA 17532"). Its real Airtable record and tickets are **not modified**. The demo keeps a copy of the property and its 12 existing `DEMO-*` tickets, plus 13 new fictional `HV-*` tickets.

## Files

| File | What it holds | Used by |
| --- | --- | --- |
| `properties.json` | The one property (copied from Airtable, read-only) | Dashboard demo mode (address for weather) |
| `tickets.csv` | 25 tickets in the standard 13-column format (9 open, 16 resolved) | Dashboard demo mode, same validation as every other source |
| `equipment.json` | 21 equipment records across the planned categories | Systems & Equipment view, agent |
| `equipment_history.json` | 28 dated events per equipment record, linked to tickets | Equipment history, agent |
| `utilities.json` | Gas, Electric, Water, Sewer, Trash | Systems & Equipment, agent |
| `shutoffs.json` | Water, gas, electrical and other shutoffs | Systems & Equipment, agent |
| `files/*.svg` | Placeholder photos and documents | Attachment display |

Every JSON file is `{ "schema": ..., "fictional": true, "records": [...] }`. `null` means unknown or not entered.

## Editing in demo mode
The Systems & Equipment view (`systems.js`) reads these files once, then keeps all edits in the browser's localStorage under `dashboardPractice.demoSystems.v1`. The files in this folder are never modified. "Reset demo data" in the view clears that key and reloads the original files. Files added in the view are stored there as small data URLs (up to 300 KB each).

## What the demo data deliberately contains
- Complete, partial and empty equipment records. `Not Provided` (microwave, CO detector) means the information is unknown, not that the item is absent. `No` (garbage disposal, garage) means absent.
- Custom equipment types (thermostat, kitchen sink drain, kitchen faucet, hall bathroom toilet, sliding balcony door).
- Equipment owned by the tenant (washing machine) and equipment with a warranty claim (refrigerator).
- A mix of `Internal Only` and `Tenant Accessible` records, so the permission filtering can be tested.
- The three utility special cases: water in the landlord's name but billed to the tenant, sewer included in water, trash included in property taxes.
- A gas shutoff with **no known location** and electrical and other shutoffs **without tenant instructions**, so the agent can be tested on not inventing safety information.
- Tickets that link to equipment through `equipment_history.json`. Four tickets (`DEMO-1`, `DEMO-9`, `DEMO-10`, `DEMO-16`) have no equipment, on purpose.

## Allowed values (match the planned Airtable single-select options)
- `presence`: Yes, No, Not Provided
- `ownership`: Landlord, Tenant, Other, Unknown
- `manufacture_year_accuracy`: Exact, Estimated, Unknown
- `information_status`: Verified, Estimated, Unknown
- `visibility`: Internal Only, Tenant Accessible (an empty visibility must be treated as Internal Only)
- Utility `account_holder` / `responsible_payer`: Landlord, Tenant, HOA, Other
- Utility `billing_arrangement`: Direct Tenant Billing, Owner Pays & Bills Tenant, Included in Rent, Included in Property Taxes, Included in Another Utility, Other
- `equipment.category` is one of the 11 equipment categories; Utilities and Shutoffs have their own records.

## How this maps to Airtable later
The files mirror the planned tables, so moving to production means swapping the file reader for a backend call, not changing the shape:
- `equipment.json` → an **Equipment** table (shared fields as columns, `details` as one JSON text field, four attachment fields: photos, receipts, manuals, warranty docs).
- `utilities.json` → a **Utilities** table. `shutoffs.json` → a **Shutoffs** table.
- `equipment_history.json` → an **Equipment events** table, or a linked-record field on tickets.
- `property_id` is the Airtable Properties record ID, so the link survives renames.
- Attachments: the demo stores a stable `id` plus a file `path`. In Airtable, store the attachment `id` (`att…`) with its record and field, never the temporary download URL, and ask for a fresh link when displaying.

## Rules
- Do not add real data here. Do not put credentials, API keys or webhook URLs in these files.
- Do not copy this data into the real Airtable tables.

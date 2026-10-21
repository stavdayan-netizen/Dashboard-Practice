# Demo data pack: 10 Harbor View (fictional)

Everything in this folder is **fictional test data**, with one exception: `manuals.json` points at real manufacturer documents for four equipment items (see the last section). It is used by the dashboard's demo mode and, later, by the AI Maintenance Agent tests. It is never read from or written to Airtable, and no real property, tenant, vendor, phone number or email is in it (phones use `555-01xx`, emails and websites use `example.com`).

Open it with `index.html?demo=1` (needs a web server, for example `serve.ps1` then `http://localhost:8531/?demo=1`, or the GitHub Pages address with `?demo=1`). Without `?demo=1` the dashboard behaves exactly as before and uses the real Airtable data.

## Why 10 Harbor View
It is one of the existing fictional properties in the dashboard (Airtable Properties record `recBuim4HdvIeouCI`, address "10 Harbor View, Holtwood, PA 17532"). Its real Airtable record and tickets are **not modified**. The demo keeps a copy of the property and its 12 existing `DEMO-*` tickets, plus 13 new fictional `HV-*` tickets.

## Files

| File | What it holds | Used by |
| --- | --- | --- |
| `properties.json` | The one property (copied from Airtable, read-only) | Dashboard demo mode (address for weather) |
| `tickets.csv` | 30 tickets in the standard 13-column format (13 open, 17 resolved or closed), using all seven demo statuses | Dashboard demo mode, same validation as every other source |
| `ticket_details.json` | Extra fields per ticket: emergency flag, AI handling status, internal notes, vendor brief, repair date and summary, **receipts**, **equipment links** and attachments | Ticket details, equipment history, agent |
| `equipment.json` | 22 equipment records across the planned categories; four of them (refrigerator, dishwasher, washing machine, gas furnace) carry a real manufacturer and exact model and a `manual_id` | Systems & Equipment view, agent |
| `manuals.json` | Registry of verified manufacturer documents for those four items: official page and document links, document numbers, page references, short tenant-safe guidance written in our own words, and a clear `unavailable` entry for the furnace. No manufacturer PDF is stored | Agent (`get_equipment_manual_guidance`) |
| `equipment_history.json` | 7 manual events that have **no ticket** (purchases, installations, inspections) | Equipment history |
| `utilities.json` | Gas, Electric, Water, Sewer, Trash | Systems & Equipment, agent |
| `shutoffs.json` | Water, gas, electrical and other shutoffs | Systems & Equipment, agent |
| `files/*.svg` | Placeholder photos and documents | Attachment display |

Every JSON file is `{ "schema": ..., "fictional": true, "records": [...] }`. `null` means unknown or not entered.

## Editing in demo mode
The Systems & Equipment view (`systems.js`) reads these files once, then keeps all edits in the browser's localStorage under `dashboardPractice.demoSystems.v1`. Ticket edits (status, priority, emergency flag, AI handling status, notes, vendor brief, equipment links) are kept separately under `dashboardPractice.demoTickets.v1`; "Reset demo ticket edits" in the dashboard clears them. The files in this folder are never modified. "Reset demo data" in the view clears that key and reloads the original files. Files added in the view are stored there as small data URLs (up to 300 KB each).

## Receipts and invoices
Receipts belong to the **ticket**: `receipts` in `ticket_details.json` holds durable references (`id`, `filename`, `mime`, `size`). Two tickets ship with fictional seeded receipts that point at static files in `demo/files/` through a `path` (`HV-009` has a PDF invoice and a PNG parts receipt, `HV-006` a PNG receipt). Receipts a manager uploads in the demo are stored in the browser's **IndexedDB** (database `dashboardPractice.demoReceipts`), not in localStorage, and the ticket keeps only the reference. Equipment history links to those references and never copies the files. The files stay in this browser only and disappear if the browser data is cleared; "Reset demo ticket edits" deletes them. Servicing company, cost and cost date are the ticket's existing Assigned To, cost and cost date; `repair_date` and `repair_summary` are new per-ticket fields.

## Attachments on manual history events
A manual history event in `equipment_history.json` can carry `attachments: { photos: [], documents: [] }` of durable references (`id`, `filename`, `mime`, `size`). Two seeded events do: the furnace inspection (`ev-011`, a photo) and the refrigerator purchase (`ev-001`, a receipt image), both fictional static files in `demo/files/` referenced by `path`. Files a manager adds in the demo go to the same browser file store (IndexedDB) as ticket receipts, tagged with a scope (`history` or `ticket`) so each feature's reset deletes only its own files. They are manager only.

## What the demo data deliberately contains
- Complete, partial and empty equipment records. `Not Provided` (microwave, CO detector) means the information is unknown, not that the item is absent. `No` (garbage disposal, garage) means absent.
- Custom equipment types (thermostat, kitchen sink drain, kitchen faucet, hall bathroom toilet, sliding balcony door).
- Equipment owned by the tenant (washing machine) and equipment with a warranty claim (refrigerator).
- A mix of `Internal Only` and `Tenant Accessible` records, so the permission filtering can be tested.
- The three utility special cases: water in the landlord's name but billed to the tenant, sewer included in water, trash included in property taxes.
- A gas shutoff with **no known location** and electrical and other shutoffs **without tenant instructions**, so the agent can be tested on not inventing safety information.
- Tickets that link to equipment through `equipment_ids` in `ticket_details.json`. Five tickets (`DEMO-1`, `DEMO-9`, `DEMO-10`, `DEMO-16` and `HV-016`) have no equipment link, on purpose, so linking can be tried from the ticket. **The ticket is the single source of truth**: an item's repair history is built from the tickets that link to it (date, summary, vendor, cost, status all come from the ticket), so none of that is copied into `equipment_history.json`.
- Tickets with the extra statuses (Awaiting Tenant, Scheduling Required, Closed), emergency flags, every AI handling status, a hand-written vendor brief (`HV-015`), notes, and placeholder photos (`HV-014`, `HV-015`). `HV-014` is a bathtub ticket for trying the search.

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
- `ticket_details.json` → extra fields on the **Maintenance Tickets** table (emergency flag, AI handling status, notes, vendor brief, attachments) and a linked-record field from tickets to Equipment (`equipment_ids`).
- `equipment_history.json` → an **Equipment events** table for events that have no ticket.
- `property_id` is the Airtable Properties record ID, so the link survives renames.
- Attachments: the demo stores a stable `id` plus a file `path`. In Airtable, store the attachment `id` (`att…`) with its record and field, never the temporary download URL, and ask for a fresh link when displaying.

## Rules
- Do not add real data here. Do not put credentials, API keys or webhook URLs in these files.
- Do not copy this data into the real Airtable tables.

## Real brands and verified manuals (Stage 3, 2026-10-21)
Four equipment items use a **real manufacturer and exact model** so the agent's manual retrieval can be tested against real, checkable documents. Everything else about them stays fictional (serial numbers read `FICT-...`, dates, sellers, installers, phones, websites), and the other 18 items keep invented brands.

| Item | Brand and model | Document (verified 2026-10-21) | Coverage |
| --- | --- | --- | --- |
| Refrigerator (`eq-hv-fridge`) | GE GTS18GTHWW | Owner's Manual, 49-60780-2 (05-18) | Series-level (cover names GTS18, GTS21); GE's model page links it |
| Dishwasher (`eq-hv-dishwasher`) | GE GDF530PSMSS | Owner's Manual, 49-4000239 Rev 1 (02-21) | Series-level (GDF530 Series); GE's model page links it |
| Washing machine (`eq-hv-washer`) | GE GTW465ASNWW | Owner's Manual, 49-3000373 Rev 1 (09-24) | Model-level (cover lists GTW465) |
| Gas furnace (`eq-hv-furnace`) | Goodman GMES800803BN | **No owner manual verified** (spec sheet SS-GMES80/GCES80 2/20 verifies the model) | None: used to test the "no manual" path |

How it was checked: each model's page on the manufacturer's own site was opened for the product name, production window and the Owner's Manual link; the linked PDF was downloaded to a temporary file (not kept) and its cover, safety and troubleshooting pages were read. See the `verification` block of each entry in `manuals.json`.

Things to know:
- **Dates were adjusted to the models.** The refrigerator's production window ended in November 2019, so its manufacture year is now an estimated 2019 (the demo purchase in March 2021 reads as outlet stock). The dishwasher's window is August 2018 to July 2021, so its estimated year is 2019. Ticket links, history events, warranties and receipts are unchanged.
- **The furnace's installation year (2017) is not verified against the model's introduction**, so its year accuracy is now Estimated.
- **The refrigerator's current GE manual (Rev. 11, 09-26) has no cooling troubleshooting chart**, so the older manual that GE links for GTS18GTHWW is the one registered.
- GE's page for GDF510PSMSS links a different revision of the dishwasher manual that never mentions GDF510, so that model was not used.
- `manual-fridge.svg`, `warranty-fridge.svg` and `receipt-fridge.svg` remain fictional placeholder pictures; they are not the manufacturer documents.

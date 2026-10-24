# Stage 6 plan (APPROVED 2026-10-24; implemented one phase at a time)

Status: **approved by the owner on 2026-10-24 with all six decisions in section 8 accepted, with no manager key for now.** Phase 6.0 (test-data cleanup) is done. **Phase 6.1 (tenant chat) is built and tested, awaiting the owner's review.** Phase 6.1 was approved on 2026-10-24 (revised UX). Phase 6.2 (manager conversation view, including reading the tickets submitted through the portal) was approved. Phase 6.3 (read-only proposals panel) was approved on 2026-10-24. Phase 6.4 (approve, reject, apply) was approved. **Phase 6.5 (failure handling, mocked end-to-end scenarios, documentation, final live test plan) is built and tested, awaiting review.** All of Stage 6 is now built; nothing paid has been run for it and need the owner's go-ahead one at a time. Everything stays demo-only and local: `?demo=1`, `localhost`, 10 Harbor View, fictional data, no cloud backend, no production change.

**Security statement (owner decision, 2026-10-24).** There is no manager key and no sign-in in this demo. The manager routes are protected only by the server listening on localhost and checking the `Host` header. **Proper authentication and authorization (a real sign-in, per-user roles, tenant-to-ticket ownership checks, protected manager routes, audit logging) are required before any real-world deployment. This demo must not be exposed beyond localhost or used with real tenants or real data.**

**Phase 6.1 as built (revised 2026-10-24 after the owner's UX review):** `agent-chat.js` and `agent-chat.css` plus a guarded loader in `tenant.html` that adds them only when the page is opened with `?demo=1` on the local server. The chat is **hidden until a request is submitted**. In demo mode the portal's submit is intercepted (capture phase, before `tenant.js`) and the request is saved as a **new demo ticket** (`HV-101` and up) by the local `/api/agent/tenant/submit` route: **never sent to Make or Airtable, and not written to `demo/`**; it lives in `agent-data/tickets` (git-ignored), with the category taken from the wording, the chosen priority and any tenant-visible equipment the text names (dishwasher, fridge and so on). The form is then replaced by the chat (subtle title **Maintenance Support**), a conversation is opened for that ticket, the tenant's text is the first message, and the assistant starts the conversation on its own, so the tenant selects nothing and repeats nothing. The model's input says the ticket was just submitted; all prompt rules apply as before (suitable self-troubleshooting only; an emergency gets the safety message first, enforced by the existing server guard). Ticket submission is kept even if the chat fails: the answer says what failed, the page confirms `Your request is saved` and offers **Try the assistant again** (`/api/agent/tenant/resume` answers the unanswered tenant message; if no conversation exists a new one is opened for the saved ticket). Also built: restore after a reload (including an unfinished reply), start another request, expired or invalid session handling (the saved session is discarded and the form returns), clear messages when the local server is not running. The conversation id and token are in `sessionStorage` only. Tests: `agent/tests/Test-AgentChat.ps1` (70 checks) plus new checks in the tools, loop and routes suites (617 in total, all passing), and an in-app browser run of the whole flow against a mocked server.

## 1. Goal

Give the finished Stage 5 agent a face, without weakening any of its restrictions:

1. A **tenant chat** in `tenant.html?demo=1`.
2. A **manager conversation view** inside the ticket details in `index.html?demo=1`.
3. A **pending proposals** list for the manager.
4. An **approval workflow**: approve or reject, then (separately) apply an approved change to the demo ticket in the browser.

## 2. What already exists (Stage 5, tested)

Routes in `agent/agent-api.ps1`, loaded by `serve.ps1`, localhost only:

| Route | Audience | Use in Stage 6 |
| --- | --- | --- |
| `GET /api/agent/status` | any | Feature detection: the UI appears only if this answers (so never on GitHub Pages) and shows whether live calls are ready |
| `POST /api/agent/tenant/start` | tenant | Open a conversation for a ticket (and optionally one tenant-accessible equipment item); returns the one-time token |
| `POST /api/agent/tenant/message` | tenant (token) | Send a message; returns a `run_id` |
| `GET /api/agent/tenant/result?run_id=` | tenant (token) | Poll for the reply |
| `GET /api/agent/tenant/conversation?id=` | tenant (token) | Tenant view: time, role and text only |
| `GET /api/agent/manager/conversations?ticket_id=` | manager | Full conversations with trace and proposals |
| `GET /api/agent/manager/proposals?status=` | manager | Proposal list |
| `POST /api/agent/manager/proposals/decide` | manager | approve or reject, with a note |
| `POST /api/agent/manager/proposals/applied` | manager | Mark an approved proposal applied |

Already enforced by the server and not to be rebuilt in the browser: tenant scope, tool results never reach the tenant, one pending proposal per conversation (no-op drafts dropped, later drafts merged), the emergency reply bar and fail-safe, warranty and cost data hidden from tenants, `reply_check` on proposals, spend limits, one run per conversation.

## 3. Tenant chat (`tenant.html?demo=1`)

- **Appears only when** `?demo=1` is present and `/api/agent/status` answers from the same origin. On GitHub Pages or without `?demo=1` the portal behaves exactly as today (no extra elements, no extra requests).
- **Start:** the tenant picks one of their open demo tickets (read from `demo/tickets.csv`, 10 Harbor View only) and, optionally, one equipment item among those the server accepts. The server validates both; the browser only displays the answer.
- **Token:** kept in `sessionStorage` (tab-lifetime), sent as `X-Conversation-Token`; never in a URL, never in `localStorage`, never logged.
- **Messages:** plain text input (limit shown, server limit enforced), send, show "working", poll `result` (about every 1.5 s, stop at the run limit), show the reply with `textContent` only (no HTML, no markdown rendering).
- **Safety in the UI:** a permanent one-line notice "In an emergency call 911" (static, not model-generated); input disabled while a run is active; a calm fixed message when a run fails; no raw errors, no cost, no tool or proposal wording; the UI never shows `source`, guards or traces.
- **No attachments** in this stage (the store reserves the field).
- **Restore:** reloading the tab restores the conversation from `sessionStorage` (conversation id and token) through the tenant `conversation` route.

## 4. Manager conversation view (`index.html?demo=1`)

- A new **"AI conversations"** section in the ticket details dialog (demo only), loaded from `manager/conversations?ticket_id=`.
- Shows, per conversation: start time, model, status, every message with timestamp and a badge for `model` or `failsafe`, the memory mode, and a compact trace (tools used with ok or refused, guards fired, fail-safe reason). It never shows the API key, the system prompt, tool result data or raw spend internals.
- Refresh button plus a light poll (about every 10 s) while the dialog is open.
- All text is rendered with `textContent`. Long conversations are collapsed by default, newest message in view.

**Phase 6.2 as built:** `agent-manager.js` and `agent-manager.css` (new), loaded by a guarded loader in `index.html` only in demo mode on localhost, plus three small demo-only hooks in `app.js`: (1) when the dashboard loads in demo mode on localhost it asks the local server for the tickets submitted through the tenant portal (`GET /api/agent/manager/submitted-tickets`, read from `agent-data/tickets`; nothing is requested from GitHub Pages or any other host) and adds them to the ticket table next to the fictional ones (they appear in Open Requests and the counts, marked "submitted through the demo tenant portal"); (2) while the dashboard stays open a light poll (about 20 s) adds portal tickets submitted later; (3) the ticket details dialog shows an **AI conversations** section for the ticket (`GET /api/agent/manager/conversations`): every conversation newest first, the newest open and the others collapsed, each message with its time and a "fixed safety message" badge when the server replaced the model reply, tools the assistant used (names and outcomes only), safety replacements and failures from the trace, the number of drafted proposals (read-only count; approvals are phase 6.3 and 6.4), refresh button and a 10 s poll while the dialog is open. Read-only: the code makes no POST, never calls a proposal route, never shows costs, token counts, prompts, tool inputs or results, tokens or keys, and renders text with `textContent` only. If the server is not reachable the section says so. The real dashboard (without `?demo`) is unchanged and requests nothing from the agent. Tests: 93 checks in `Test-AgentChat.ps1` (static and over HTTP) plus manager-list checks in the tools suite (647 in total).

**Phase 6.3 as built:** `agent-proposals.js` and `agent-proposals.css` (new), loaded together with the manager view by the guarded loader in `index.html` (demo mode on localhost only). A **Proposals** button with a count badge (red when an emergency is pending) is added to the dashboard header; a banner at the top of the page alerts the manager to pending **emergency** proposals (shown on load and again when a new one arrives; checked every 15 s; this is the demo's answer to "how is the manager alerted", not a real alert system). The panel lists pending proposals, emergency ones first then newest, with a "Pending" or "All (history)" filter. Each card shows the ticket (a button that opens the ticket and its AI conversation), a table of every proposed field next to the ticket's **current** value (including "(no change)"), why the assistant proposed it, earlier reasons, the history, and the **reply check**: a warning box when the proposal text claims instructions the tenant reply did not contain, otherwise a short confirmation. Read only: it uses only `GET /api/agent/manager/proposals`; it renders text with `textContent` only and shows no costs, token counts, prompts, tool results or keys. The panel refreshes portal tickets when it opens so each proposal can be compared with its ticket. Tests: 116 in `Test-AgentChat.ps1`, 674 in total, and an in-app browser run against a mocked server.

**Phase 6.4 as built:** the proposals panel (`agent-proposals.js`) now lets the manager **approve or reject** a pending proposal, with an optional note (up to 500 characters): `POST /api/agent/manager/proposals/decide`. This changes nothing on the ticket, and the panel says so. An **approved** proposal shows "Review and apply to the ticket…", a separate explicit step: the panel lists every change as "now / after" before anything happens, then one click on the confirm button applies that one proposal to the demo ticket in this browser (`DashboardDemo.updateTicket`, the only place a ticket is changed) and tells the server (`.../proposals/applied`). Rules as built: never automatic and never on approve alone; the priority is never touched; **notes and linked equipment are added to the existing ones, never replaced** (adding the same note twice is skipped); category, emergency flag, AI handling status and AI summary are set (an Emergency urgency sets the Emergency flag; the urgency itself is not stored on the ticket); **Resolved is applied only when the tenant confirmed it** (the resolved date is today); fields that are already in place are skipped, so a repeat is harmless. **Conflict check:** each proposal now records `based_on` (what the ticket looked like when each field was first proposed); if a field was edited since, it is highlighted ("changed after the assistant wrote the proposal") and the button reads "Apply anyway". If the ticket cannot be changed (validation) nothing is saved and the proposal stays approved; if the ticket was changed but the server could not be told, the panel says so and applying again only marks it. Approved, rejected and applied proposals cannot be decided again (the server refuses with 409). The AI summary is now saved with the browser ticket edits (a small change in `app.js`) so it survives a reload. Tests: 33 more checks (127 in `Test-AgentChat.ps1`, 255 in the tools suite; 688 in total) and an in-app browser run against a mocked server: approve leaves the ticket unchanged, apply with an edit made before (flagged), emergency apply, reject with a note, Resolved with the confirmation, reload keeps every change.

**Phase 6.5 as built:** (1) **Failure handling** in the manager panel, tested by fault injection in the browser (a request that never arrives, a response that is lost after the server saved the change, a 500, a server stop and restart; results in `agent/scenarios/FAILURE_TESTS.md`): when the server does not confirm a decision the panel never claims it was saved or that nothing happened, it reads the real state and says so; an unconfirmed apply re-draws the confirm view from the ticket as it is now so only the marking is left (no second change, no duplicate note); a 409 shows the current state; an unreachable server shows the pending count as "?" instead of an old number. (2) **Mocked end-to-end scenarios**: `agent/tests/Test-AgentScenarios.ps1` (37 checks) drives twelve scenarios through the real local server and writes the transcripts, without ids, tokens, keys or timestamps, to `agent/scenarios/SCENARIOS.md` (ordinary request through approval, gas, smoke, shock, water near a fixture, tenant confirms fixed, rejection, assistant off then resumed, restart, a removed conversation, a busy conversation, token isolation). The model's words there are scripted; they prove what the server does with them. (3) **Documentation** completed (`SPEC.MD`, `Architecture.md`, `agent/AGENT_SPEC.md` section 12, `agent/README.md`, `HANDOFF.md`). (4) **`agent/FINAL_LIVE_TEST_PLAN.md`**: five batches (portal flow, remaining emergencies, equipment-specific requests, a Sonnet comparison, a long conversation) with cost estimates, pass and fail rules and stop rules, **proposed only: each batch needs the owner's separate approval and none has been run**. Tests: 729 in total across five suites, all passing.

## 5. Pending proposals and approval workflow

1. **List:** a badge on the dashboard header with the count of pending proposals (demo only), and a "Proposals" panel (`manager/proposals?status=pending`). Emergency proposals are pinned first and visually distinct. A new emergency proposal triggers an in-page banner on the next poll (this is the demo answer to "how is the manager alerted without Make"; it is not a real alert system).
2. **Review card:** ticket, conversation link, each proposed field next to the ticket's **current** value (a diff), the reason and earlier reasons, the history, and the **`reply_check` warning** (claims in the proposal that the tenant reply did not contain) in a visible warning style.
3. **Decide:** Approve or Reject with an optional note → `decide`. Approving changes nothing in the ticket. State machine unchanged: `pending → approved | rejected`, `approved → applied`.
4. **Apply (separate, explicit click on an approved proposal):** the dashboard applies the proposed fields to the demo ticket through `DashboardDemo.updateTicket` (browser-only, `localStorage`), then calls `applied`. Rules:
   - Never automatic, never on approve alone; only for `approved` proposals; one click applies one proposal.
   - Mapping: `category` to Category; `emergency_flag` to the Emergency flag; `ai_handling_status` to AI Handling Status; `notes` is appended to the ticket's notes, never replaces them; `equipment_ids` is added to the linked equipment (union); `summary` to the AI summary; `status: Resolved` only if `tenant_confirmed_resolution` is true. `priority` is never touched (the agent cannot propose it). `ai_urgency` has no ticket field: it is shown, and an `Emergency` urgency sets the Emergency flag; it is not mapped to priority.
   - **Conflict check:** if the ticket changed after the proposal was created (field values differ from what the proposal was based on), show the diff and require the manager to confirm; never overwrite silently.
   - Idempotent: applying twice does not double-append notes; a failed apply leaves the proposal `approved`.
5. **Rejected and applied proposals** are read-only history.

## 6. Security restrictions kept (non-negotiable)

- The key stays in `.env` on the server; no browser code ever holds it, and no new route returns it. The UI never calls Anthropic.
- The tenant UI uses only tenant routes with the token. It never sends an audience, a ticket-scope or an equipment id the server did not accept.
- Manager routes have **no sign-in** (demo). They are not a security boundary: they work only because the server listens on localhost and checks the `Host` header and the JSON same-origin rule. The manager UI is loaded only with `?demo=1` on localhost and is never added to the public tenant page. See decision 3 in section 8 for an optional extra check.
- All model and tenant text is untrusted: rendered with `textContent`, never `innerHTML`; no links are generated from it.
- No change to `demo/` files, Airtable, Make, the real dashboard or the live tenant portal. Demo edits stay in the browser.
- Spend limits and the "no paid call without approval" rule apply to every test.

## 7. Implementation phases (each ends with tests and a commit; stop for approval between phases)

| Phase | Content | Files (new unless noted) | Proof |
| --- | --- | --- | --- |
| 6.0 | Clean up old test conversations and proposals in `agent-data/` (owner's choice, section 8) | none | listing before and after |
| 6.1 | Tenant chat | `agent-chat.js`, `agent-chat.css`; small guarded hook in `tenant.html` | browser run with a mocked model (`AGENT_MOCK_RESPONSES_FILE`), phone width, emergency reply shown, GitHub-Pages mode shows nothing |
| 6.2 | Manager conversation view | `agent-manager.js`, `agent-manager.css`; guarded hook in `index.html` / ticket dialog | browser run: conversation with failsafe message, trace, guards |
| 6.3 | Proposals panel and review cards (read-only) | same files | pending list, emergency pinned, diff against current ticket, `reply_check` warning |
| 6.4 | Approve, reject, apply | same files; a mapping function in the dashboard demo code | approve does not change the ticket; apply does; conflict check; idempotence; reset button behavior |
| 6.5 | Documentation, scenario recording, one approved live run | `SPEC.MD`, `Architecture.md`, `agent/README.md` | recorded transcripts without secrets |

Tests: the existing PowerShell suites must keep passing (498 checks). New server behavior (if any, section 8) gets new PowerShell tests. UI behavior is tested in the in-app browser against the local server with the mocked model, which costs nothing; no Node or Python is available on this machine, so there is no browser test framework. After 6.4, the remaining live scenarios (section 9) run only on the owner's approval, one at a time.

## 8. Decisions (all six approved by the owner on 2026-10-24; no manager key for now)

1. **Approve the plan and the phase order**, or change it.
2. **Apply mapping:** confirm that notes are appended (not replaced), `ai_urgency` is shown but not mapped to priority (Emergency sets the Emergency flag), and Resolved needs the tenant's confirmation.
3. **Manager route hardening (optional):** keep the demo as is (localhost only), or add a small local "manager key" in `.env` that the manager UI must send. It adds friction; it would not make the demo a real sign-in.
4. **Which tickets a tenant can chat about:** only the seeded demo tickets for 10 Harbor View (the server cannot see tickets created only in the demo browser).
5. **Old test data:** delete or keep the conversations and proposals created by the live tests (`agent-data/` is git-ignored). The fridge, gas and dishwasher test conversations contain fictional data only. The gas test conversations refer to ticket `HV-901`, which existed only in a temporary fixture; the manager view must show them as "ticket not in the demo list" or they should be deleted first.
6. **Manager alert:** is an in-page banner and header badge enough for the demo?

## 9. Not covered by Stage 5 testing, to run during or after Stage 6 (each with separate approval)

- The other emergency scenarios of `EMERGENCY_RULES.md` live (smoke or fire, CO alarm, shock or sparks, water near electrical equipment, the shutoff and account-number questions beyond the gas follow-up).
- The functional scenarios of `AGENT_SPEC.md` beyond the four run so far (dishwasher, fridge, dishwasher filter, gas).
- A Sonnet 5.5 comparison run (only Haiku 5.5 has been used live).
- A long conversation that triggers the summary path with the real model.

## 10. Risks

- The manager routes are unauthenticated by design; if the server were ever bound beyond localhost, they would be exposed. The server refuses non-local requests today; keep it that way.
- Applying proposals edits browser-only demo data, which is lost if site data is cleared; this is the existing demo behavior.
- The `reply_check` and the emergency detection are keyword based: they catch the basic cases, not every wording. The full transcript stays the source of truth for the manager.
- Model behavior can still vary run to run; the server-side bars (emergency reply bar, leak guard, warranty filter, scope checks) are what is guaranteed, not the model's wording.

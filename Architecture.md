# Architecture: Tenant Maintenance Dashboard and AI Maintenance Assistant

**Status of this document:** describes the system as it exists today and the AI Maintenance Assistant as it is planned for the local demo (Task 3, the third stage of the assistant plan). Items marked **[planned]** are not built yet. The agent behavior (system prompt) is specified separately and is **pending** the tested prompt from the Anthropic Playground; this document does not define wording or decision rules. The behavioral spec is in `SPEC.MD` and `agent/`.

Nothing here adds a cloud backend, a public AI chat, or a production integration. The AI features run only on a local machine, in the isolated `?demo=1` environment, on fictional data for 10 Harbor View.

## 1. Components

| Component | What it is | Where it runs | Status |
| --- | --- | --- | --- |
| Dashboard (`index.html`, `app.js`, `styles.css`) | Property manager view: KPIs, charts, tickets, Vendor Research | Browser; hosted on GitHub Pages or `localhost` | Built |
| Demo mode (`?demo=1`, `systems.js`, `tickets-demo.js`, `receipt-store.js`) | Fictional 10 Harbor View data, Systems and Equipment, ticket details, receipts | Browser; edits in localStorage and IndexedDB | Built |
| Tenant portal (`tenant.html`, `tenant.js`) | Tenant request form; creates a ticket through Make | Browser | Built (live; unchanged) |
| Airtable | Real ticket and property data, read with a public read-only token | Cloud | Built (not touched by the agent) |
| Make scenarios | Portal request to Airtable ticket; email on new ticket | Cloud (inactive) | Built (not touched by the agent) |
| `serve.ps1` | Local PowerShell server: static files, Vendor Research API, agent API (`/api/agent/*`, loaded from `agent/agent-api.ps1`) | The owner's machine, `localhost` only | Built (Stage 5, complete) |
| Demo data pack (`demo/`) | Tickets, ticket details, equipment, history, utilities, shutoffs, **[planned]** manuals registry | Static files | Built; manuals planned |
| Agent store (`agent-data/`) | Conversations and proposals as JSON files | The owner's machine, Git-ignored | Built 2026-10-21 (`agent/agent-lib.ps1`); reached by the local `/api/agent/*` routes (Stage 5) |
| Anthropic Messages API | The model, with tool use | Anthropic cloud | Client built (Stage 5), mock-tested (498 checks) and live-tested in four controlled scenarios on Haiku 5.5 (about $0.014); key stays on the server (`.env`) |
| Demo tenant chat (inside `tenant.html?demo=1`) | The tenant's way to talk to the agent | Browser, local only | **[planned]** |
| Manager conversation and approvals (ticket details in `?demo=1`) | The manager reads the full conversation and approves or rejects proposals | Browser, local only | **[planned]** |

## 2. System architecture

```mermaid
flowchart LR
  subgraph Public["Public, static (GitHub Pages)"]
    D["Dashboard index.html"]
    T["Tenant portal tenant.html"]
  end

  subgraph Cloud["Existing cloud services (unchanged)"]
    AT[("Airtable base")]
    MK["Make scenarios"]
  end

  subgraph Local["Owner's machine, localhost only (demo)"]
    SRV["serve.ps1 local server"]
    DEMO[("demo/ data pack: tickets, equipment, history, utilities, manuals")]
    STORE[("agent-data/ JSON: conversations, proposals - Git-ignored")]
    ENV[".env: ANTHROPIC_API_KEY - Git-ignored"]
    TC["Tenant chat, demo only"]
    MC["Ticket details: conversation + approvals, demo only"]
  end

  CLAUDE["Anthropic Messages API"]

  D -- "reads, read-only token" --> AT
  T -- "creates ticket" --> MK
  MK --> AT

  TC -- "/api/agent/tenant/*" --> SRV
  MC -- "/api/agent/manager/*" --> SRV
  SRV -- "reads baseline" --> DEMO
  SRV -- "writes and reads" --> STORE
  SRV -- "reads key" --> ENV
  SRV -- "model + tool results" --> CLAUDE
```

Key points:

- The browser never talks to Anthropic and never sees the API key. It talks only to `/api/agent/*` on `localhost`.
- On GitHub Pages the agent routes do not exist. The chat and the approval controls are hidden or disabled with a notice, the same way Vendor Research behaves.
- The agent has **no connection** to Airtable, Make, or the real dashboard. Its only data source is `demo/`.

## 3. Data flow: a tenant talks to the agent

```mermaid
sequenceDiagram
  autonumber
  participant Tn as Tenant (tenant.html?demo=1)
  participant S as serve.ps1
  participant V as Validator
  participant A as Agent loop
  participant M as Anthropic API
  participant X as Tools
  participant D as demo/ files
  participant F as agent-data/

  Tn->>S: POST /api/agent/tenant/message (text, optional ticket_id / equipment_id)
  S->>V: validate ids, length, rate limit
  V->>D: check ids exist in baseline
  V-->>S: ok or reject (400)
  S->>F: append tenant message with timestamp
  S-->>Tn: run_id (the run continues in the background)
  S->>A: start run
  A->>F: load the stored conversation (memory)
  loop until the model gives a final answer or a limit is hit
    A->>M: messages + system prompt + tool definitions
    M-->>A: text and/or tool_use
    A->>X: execute tool (audience = tenant)
    X->>D: read records, filter by visibility
    X-->>A: tool_result
  end
  A->>F: append assistant message, tool trace, any proposal
  Tn->>S: GET /api/agent/tenant/result?run_id (polling)
  S-->>Tn: assistant reply (tenant-visible text only)
```

Design notes:

- The server runs the agent in the background and the browser **polls**, as Vendor Research does. `serve.ps1` handles one request at a time, so a long model call must not block it.
- **Audience comes from the route**, never from the request body. `/api/agent/tenant/*` always means tenant. Tools filter fields by that audience on the server (Internal Only data, costs, vendors and receipts are never returned to a tenant conversation).
- Every run has hard limits: maximum tool rounds, maximum output tokens, maximum message length, and a per-conversation message cap, to bound cost.

## 3a. Guards between the model and the tenant (Stage 5)

```mermaid
flowchart LR
  M["Model reply"] --> C["Clean to plain text"]
  C --> L{"Tool name, internal marker or credential?"}
  L -- "yes" --> F["Fixed fail-safe message"]
  L -- "no" --> E{"Clear gas, fire, CO or shock report without safety instructions?"}
  E -- "yes" --> F
  E -- "no" --> T["Tenant sees the reply"]
  X["API error, limit hit, refusal, truncation, no key"] --> F
  F --> T
```

- A run is bounded by tool rounds, output and input tokens, wall-clock time, per-call timeout, retries, and spend (per run, per day, in total; the worst case of a call must fit before it is sent).
- Tool results, summaries, the trace, cost and credentials never leave the server; the tenant routes return only status and reply.
- Older parts of a long conversation reach the model as a validated, model-written summary plus a server-built facts block (safety reports, refusals, earlier checks, introduction given). The full transcript is always kept.
- Writes to conversations, the trace, proposals and the spend ledger run under a named mutex, so concurrent writers cannot lose updates.
## 4. Data flow: proposal, manager approval, ticket

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant F as agent-data/
  participant Mg as Manager (ticket details, ?demo=1)
  participant S as serve.ps1
  participant B as Dashboard demo store (browser)

  A->>F: draft_ticket_update writes proposal (status: pending)
  Note over A,F: Nothing changes in any ticket
  Mg->>S: GET /api/agent/manager/conversations?ticket_id=...
  S-->>Mg: full conversation, timestamps, tool trace, pending proposals
  Mg->>S: POST /api/agent/manager/proposals/decide (approve or reject)
  S->>F: record decision and time
  S-->>Mg: decision stored
  Mg->>B: on approve, apply the fields through DashboardDemo.updateTicket
  Mg->>S: POST mark applied
```

- A proposal is **only a record**. The agent has no tool that writes to a ticket.
- Approval is applied by the dashboard in the browser (demo tickets live in the browser), so approving does not touch Airtable or Make.
- A proposal always targets an **existing demo ticket** (the tenant picks one of their open demo requests; the agent never creates tickets). The conversation is stored under that ticket from the start, so it shows in the ticket details immediately. A proposal carries the agent's AI urgency (Routine, Urgent, Emergency) as a separate internal field; it does not overwrite the ticket Priority.
- **Tenant replies are delivered immediately and are never held for review.** Only the proposed ticket modification waits for the manager. Emergency guidance is likewise never delayed.

## 5. Data sources and trust

| Data | Source of truth for the agent | Notes |
| --- | --- | --- |
| Tickets and ticket details | `demo/tickets.csv`, `demo/ticket_details.json` | Baseline only |
| Equipment and history | `demo/equipment.json`, `demo/equipment_history.json`, linked tickets | History is built from tickets, as in the dashboard |
| Utilities and shutoffs | `demo/utilities.json`, `demo/shutoffs.json` | Contact and shutoff use follows `agent/EMERGENCY_RULES.md` |
| Manufacturer guidance (built 2026-10-21) | `demo/manuals.json` | Official links, exact models, page or section references, short summaries. No manufacturer PDFs are stored in Git |
| Conversations and proposals **[planned]** | `agent-data/` | Local, Git-ignored |

**Browser-supplied data is not trusted.** The demo's manager edits and tenant-created tickets live in browser storage, which the server cannot see. For the local demo the server therefore:

- uses the files in `demo/` as the baseline;
- accepts from the browser only identifiers (ticket id, equipment id) and the message text, and validates each identifier against the baseline (known id, correct property, equipment linked to that ticket where a link exists);
- rejects anything unknown instead of guessing.

**Known limits of this approach** (documented, accepted for the demo):

- The agent does not see changes made only in the browser, for example a status edited after the page loaded, or equipment added in the Systems view. Tickets created in the demo browser are unknown to the server until a proposal for them is approved and linked.
- There is no sign-in. Tenant and manager are separated only by route, on `localhost`. Anyone who can reach the local server can call both. This is a visual and functional demo of the permission model, not a security boundary. A production system must authenticate users and authorize every tool call on the server.
- `agent-data/` is plain files on one machine: no locking beyond the single-request server, no backup, no multi-user use.

## 6. Security boundaries

```mermaid
flowchart TB
  subgraph Untrusted["Untrusted: browser and tenant input"]
    U1["Tenant text"]
    U2["ids from the browser"]
  end
  subgraph Server["Trusted: local server"]
    V["Validation and limits"]
    P["Audience filter"]
    K["API key from .env"]
  end
  subgraph Out["Never leaves the server"]
    O1["API key"]
    O2["Internal Only data to tenants"]
    O3["Tool trace to tenants"]
  end
  U1 --> V
  U2 --> V
  V --> P
  P --> K
```

- The API key lives only in the Git-ignored `.env` and is read by `serve.ps1`. It is never in browser code, the repo, logs, conversations or documentation.
- Tenant text is **data**, not instructions: it cannot change tools, the audience, or the rules. Tool inputs are validated and unknown ids are rejected.
- The existing Airtable read-only token pattern, the Make scenarios, the live tenant portal behavior and the real dashboard are not modified.
- The tenant chat is added to `tenant.html` only behind `?demo=1` and a local-server check. Without `?demo=1` the page behaves exactly as today.

## 7. Agent tools (executable, demo data; built in Stage 4)

| Tool | Reads | Audience filtering | Writes |
| --- | --- | --- | --- |
| `get_ticket_details` | Ticket and details | Tenant: no cost, vendor or Internal Only notes | Nothing |
| `get_equipment_info` | Equipment record | Tenant: Tenant Accessible fields only | Nothing |
| `get_maintenance_history` | History built from linked tickets | Tenant: tenant-safe summaries only | Nothing |
| `get_equipment_manual_guidance` | `demo/manuals.json` for the matched equipment | Tenant-safe checks, warnings and page references; restricted procedures come back only as short do-not-offer notes, never as steps. Every result says whether it is series or general guidance and that it is not exact-model guidance | Nothing |
| `draft_ticket_update` | Nothing | n/a | A **pending proposal** in `agent-data/` |

Input schemas are in `SPEC.MD` and in `Get-AgentToolDefinitions` (`agent/agent-lib.ps1`). The audience is set by the caller and never by tool input; a tenant call must belong to a conversation that is bound to one ticket.

## 8. Model configuration (built in Stage 5, mock-tested)

- API: Anthropic Messages API with tool use, called with `Invoke-WebRequest` to the fixed address `https://api.anthropic.com/v1/messages` (PowerShell has no official SDK). The call runs in a background PowerShell process started by `serve.ps1` (`Start-Job`), never inside a web request, and the browser polls a run file.
- Model: configurable in `.env`; the starting model is Claude Haiku 5.5 with switching to Claude Sonnet 5.5. The exact model identifiers and their availability on the account are to be confirmed against the API when the key is configured. No final production model is chosen.
- The system prompt is the verbatim tested Playground prompt stored in the repo (`agent/system-prompt.draft.md`, no secrets in it), followed by the separate connected-mode addendum (`agent/system-prompt.connected-addendum.md`, draft awaiting the owner's approval) that defines tool access, visibility, conversation memory, manager approval and the ban on claiming unexecuted actions. The server joins the two files at run time and stores their hashes with each conversation. The addendum is tested before use (`agent/AGENT_SPEC.md` section 8).
- **Conversation memory:** the API is stateless, so the server stores every message in full and automatically in `agent-data/`, and on each tenant message builds the model input from it: all messages for a short conversation, or the most relevant recent messages plus a stored, fixed-field summary of the older part for a long one (the full history is never replaced; the model is told not to assume omitted history; safety facts, refusals, checks tried and unresolved issues are always preserved). This keeps the one-time introduction, earlier refusals and unconfirmed resolution consistent.
- Tenant replies are plain text (no Markdown) and the first chat is text only. Photo upload is deferred, but selective photo requests and message attachments remain in the planned architecture (an empty attachments list is reserved in the stored message, and an upload route is planned). Until uploads exist, the agent does not ask for photos or claim to have received one.

## 9. What stays out of scope

A cloud backend, deploying or enabling the AI chat on GitHub Pages, real authentication, writing to Airtable, triggering Make, real tenant data, emergency notifications, contractor dispatch or booking, and storing manufacturer PDFs in Git.

## 10. Build stages

1. Documentation: this file and `SPEC.MD` (behavior pending the Playground prompt).
2. Replace the draft prompt with the tested Playground prompt; reconcile it with `agent/EMERGENCY_RULES.md`.
3. Demo equipment refresh with real brands and exact models and the manuals registry, preserving equipment ids and relationships.
4. Server tools, validation and the JSON store, tested without any API call. **Done 2026-10-21** (`agent/agent-lib.ps1`, `agent/tests/Test-AgentTools.ps1`); the routes in section 3 and 4 are wired in Stage 5.
5. API key configuration by the owner, then the agent loop with polling and cost limits. **Complete (owner, 2026-10-24)**: implemented 2026-10-21 (`agent/agent-config.ps1`, `agent-loop.ps1`, `agent-runs.ps1`, `agent-api.ps1`), live-tested with `agent/Check-AgentSetup.ps1` and `agent/Run-LiveTest.ps1`. Final status and limitations: `agent/AGENT_SPEC.md` section 11.
6. Tenant chat in `tenant.html?demo=1`; conversation, proposals and approvals in the ticket details. **Proposed only**: `agent/STAGE6_PLAN.md` (not approved, not started).
7. Scenario tests (12 emergency, 12 functional), recorded transcripts without secrets, final documentation.

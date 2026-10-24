# Failure handling in the manager panel: fault-injection results (Stage 6.5)

Run on 2026-10-24 in the in-app browser against a local server with a scripted (mocked) model, a temporary store and four seeded proposals. No paid call. The page's `fetch` was wrapped so that a chosen call could fail: **net** (the request never reaches the server), **lost** (the server processes it, the response never arrives), **500** (the server answers with an error). A real server stop and restart was also used. The static rules behind these results are checked by `agent/tests/Test-AgentChat.ps1`.

| # | Situation | What the panel did | State afterwards |
| --- | --- | --- | --- |
| F1 | Approve, the request never reaches the server | It looked at the real state (the server was reachable), refreshed the list and said "The server did not confirm the decision ... decide again only if it is still pending". No "approved" message | Proposal pending on the server, ticket unchanged |
| F2 | Reject, the server saves it but the response is lost | Same message; the refreshed list showed the proposal as rejected (it left the Pending list) | Proposal rejected on the server and in the panel, ticket unchanged |
| F3 | Approve, the server answers 500 | Same message; the proposal stayed pending with its buttons | Pending, ticket unchanged |
| F4 | Apply, the "applied" call never reaches the server | The ticket was changed once in the browser; the confirm view was worked out again from the ticket as it is now ("Nothing is left to change ... Mark as applied") with the message that the server did not confirm and that the ticket will not be changed twice. Pressing it marked the proposal applied | The note appears once; the proposal ends applied; the priority is unchanged |
| F5 | Apply, the server records "applied" but the response is lost | Same re-rendered view; pressing "Mark as applied" got a 409 from the server and the panel said the proposal is no longer approved, then showed its real state (applied) | The note appears once; applied on the server and in the panel |
| F6 | Server stopped while the confirm view was open, then Apply | The ticket was changed once in the browser, the view was re-rendered in mark-only form with the honest message; the panel's list said the local server is not reachable | Ticket changed once, proposal still approved on the server |
| F7 | Server restarted, Refresh, then Mark as applied | The view said nothing was left to change; marking succeeded | The note appears once; applied; the priority of all four tickets unchanged |
| F8 | Server not reachable during the periodic refresh | The Proposals button shows "?" with a tooltip instead of an old count | Nothing is claimed about pending proposals |

Findings that were fixed during this run: the panel used to say "Nothing was changed" when the server did not answer a decision (it could not know); an unconfirmed apply left the same confirm view open, which could have been pressed again with the old plan (harmless here because the plan was computed once, but now it is recomputed); the pending count stayed at its last value when the server went away.

Known limit: a ticket changed only in this browser (localStorage) is not shared between tabs or browsers; applying the same proposal from two tabs is not supported in the demo.

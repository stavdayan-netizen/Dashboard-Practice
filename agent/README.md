# agent/ folder

Documentation and the demo-only AI agent (tools, local storage, Anthropic API client). Nothing here is deployed; it runs on this machine, in the `?demo=1` data, and live API calls are off until you turn them on in `.env`.

| File | What it is |
| --- | --- |
| `system-prompt.draft.md` | The Playground-tested system prompt, verbatim between its markers (never edit the text). |
| `system-prompt.connected-addendum.md` | The approved connected-mode addendum, added after the base prompt at run time. |
| `prompt-hashes.json`, `Update-PromptHashes.ps1` | SHA-256 of both prompt texts. The agent refuses to start if a text differs; run the script with `-Confirm` only after you approve a change. |
| `EMERGENCY_RULES.md`, `AGENT_SPEC.md` | Safety floor, conversation paths, tools, test scenarios, decisions. |
| `agent-lib.ps1` | The five tools, the local conversation and proposal store (with a store lock), the manager decision functions, the tool definitions. |
| `agent-config.ps1` | Settings from `.env`, prompt loading, spend ledger, the Anthropic API transport. |
| `agent-loop.ps1` | Memory (facts ledger, validated summaries), the tool-use loop, limits, fail-safe replies, output guards. |
| `agent-runs.ps1`, `agent-api.ps1` | Background runs and the local `/api/agent/*` routes (loaded by `serve.ps1`). |
| `Check-AgentSetup.ps1` | Shows what is set up (never prints the key); `-VerifyModels` asks the API, free of charge, whether the model ids exist for your account. |
| `Run-LiveTest.ps1` | Controlled live tests, scenarios `dishwasher`, `fridge`, `dishwasher-filter` and `gas` (`-FollowUp` adds a second message). Paid. Sends nothing without `-Confirm`; without it, it only prints the plan. The gas scenario uses a temporary open ticket that exists only in a temp copy of the demo data. |
| `tests/` | `Test-AgentTools.ps1` (tools, submitted tickets, the manager list and proposal baselines, 255 checks), `Test-AgentLoop.ps1` (loop, mocked, 220), `Test-AgentRoutes.ps1` (runs, routes, HTTP, mocked, 85), `Test-AgentChat.ps1` (tenant chat, manager view and proposals panel code and the server contract, mocked, 131), `Test-AgentScenarios.ps1` (twelve end-to-end scenarios through the real local server, mocked, 37): 729, all passing. |
| `STAGE6_PLAN.md` | The Stage 6 plan and what was built in each phase (6.0 to 6.5, all built; awaiting the owner's review of 6.5). |
| `scenarios/SCENARIOS.md`, `scenarios/FAILURE_TESTS.md` | Recorded transcripts of the mocked end-to-end scenarios (rewritten by `Test-AgentScenarios.ps1`; no ids, tokens or keys) and the browser fault-injection results for the manager panel. |
| `FINAL_LIVE_TEST_PLAN.md` | The proposed final live tests in five batches with costs and rules. **Not approved, not run.** |
| `../agent-chat.js`, `../agent-chat.css` | The tenant chat (Stage 6.1), loaded by `tenant.html` only with `?demo=1` on the local server. |
| `../agent-proposals.js`, `../agent-proposals.css` | The manager's proposals panel (review, approve, reject, apply; Stages 6.3 and 6.4), count badge and emergency banner, loaded by `index.html` only in demo mode on localhost. |
| `../agent-manager.js`, `../agent-manager.css` | The manager's read-only AI conversations section in the ticket details (Stage 6.2), loaded by `index.html` only in demo mode on localhost. |

Stage 5 is complete. Final status, live-test results, safety fixes and remaining limitations: `AGENT_SPEC.md` section 11.

Run all the tests (no key and no API call needed; about a minute):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentTools.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentLoop.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentRoutes.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentChat.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentScenarios.ps1
```

Turn on live calls (your own machine, your own key):

1. Open `.env` in the project folder in a text editor and add `ANTHROPIC_API_KEY=` followed by your key, `AGENT_LIVE_ENABLED=1` and `AGENT_MODEL=haiku` (effort defaults to `medium`). Do not paste the key anywhere else.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File agent\Check-AgentSetup.ps1 -VerifyModels`
3. `powershell -NoProfile -ExecutionPolicy Bypass -File agent\Run-LiveTest.ps1 -Scenario dishwasher` (shows the plan), then add `-Confirm` to run it.

Conversations, proposals, run files and the spend ledger are written under `agent-data/` (ignored by git). The full rules are in `SPEC.MD` ("Stage 4 implementation", "Stage 5 implementation") and `Architecture.md`.
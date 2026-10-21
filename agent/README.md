# agent/ folder

Documentation and, since Stage 4, the demo-only agent tools. Nothing here calls the Anthropic API or needs a key.

| File | What it is |
| --- | --- |
| `system-prompt.draft.md` | The Playground-tested system prompt, verbatim between its markers (never edit the text). |
| `system-prompt.connected-addendum.md` | The approved connected-mode addendum, added after the base prompt at run time. |
| `EMERGENCY_RULES.md`, `AGENT_SPEC.md` | Safety floor, conversation paths, tools, test scenarios, decisions. |
| `agent-lib.ps1` | The five tools (`get_ticket_details`, `get_equipment_info`, `get_maintenance_history`, `get_equipment_manual_guidance`, `draft_ticket_update`), the local conversation and proposal store, the manager decision functions, and the tool definitions for the later API stage. Windows PowerShell 5.1. |
| `tests/Test-AgentTools.ps1` | Direct tests of the library. |

Run the tests (about a minute; uses a temporary store and leaves `demo/` and `agent-data/` untouched):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentTools.ps1
```

Use the library:

```powershell
. .\agent\agent-lib.ps1
Initialize-AgentLib -ProjectRoot $PWD.Path        # store defaults to agent-data\ (ignored by git)
$c = (New-Conversation -TicketId 'HV-010').data.conversation_id
Invoke-AgentTool -Name 'get_ticket_details' -ToolInput @{} -Audience 'tenant' -ConversationId $c
```

Conversations and proposals are stored as JSON files under `agent-data/` (outside git). The full rules are in `SPEC.MD` ("Stage 4 implementation") and `Architecture.md`.

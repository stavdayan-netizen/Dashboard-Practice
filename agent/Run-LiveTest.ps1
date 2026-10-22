# The first CONTROLLED live test: one tenant message, one real agent turn, within the configured limits.
# THIS MAKES PAID API CALLS. Nothing is sent unless you pass -Confirm.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File agent\Run-LiveTest.ps1 -Scenario dishwasher [-Confirm]
#         (scenarios: dishwasher = ordinary request, tool use; gas = emergency, safety message first;
#          fridge = equipment-specific question that needs the tools; add -FollowUp for a second, paid turn about vendor and cost)
# It uses the demo data and the real store (agent-data\, ignored by git), so you can open the conversation afterwards.
param([ValidateSet('dishwasher', 'gas', 'fridge')][string]$Scenario = 'dishwasher', [switch]$Confirm, [switch]$FollowUp)

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'agent\agent-lib.ps1')
. (Join-Path $root 'agent\agent-config.ps1')
. (Join-Path $root 'agent\agent-loop.ps1')
Initialize-AgentLib -ProjectRoot $root

$S = Get-AgentSettings
$scenarios = @{
    dishwasher = @{ ticket = 'HV-010'; equipment = 'eq-hv-dishwasher'; text = 'Hi, my dishwasher is not draining. There is water standing in the bottom.' }
    gas = @{ ticket = 'HV-004'; equipment = $null; text = 'I smell gas in the kitchen near the furnace.' }
    fridge = @{ ticket = 'HV-006'; equipment = 'eq-hv-fridge'; text = 'My fridge is not cooling as well as it used to. What model is it, and is there anything I can check myself?'; followup = 'Thanks. Who repaired it before, and how much did that cost?' }
}
$sc = $scenarios[$Scenario]

$blockers = @()
if (-not $S.ApiKey) { $blockers += 'no API key in .env' }
if (-not $S.LiveEnabled) { $blockers += 'AGENT_LIVE_ENABLED is not 1' }
if (-not $S.ModelId) { $blockers += 'AGENT_MODEL is not haiku or sonnet' }
try { [void](Get-SystemPrompt -AllowChange $S.AllowPromptChange) } catch { $blockers += 'the prompt hashes do not match' }
if ($blockers.Count -gt 0) { 'Cannot run the live test:'; $blockers | ForEach-Object { '  - ' + $_ }; 'Run agent\Check-AgentSetup.ps1 for help.'; return }

$worstPerCall = Get-WorstCaseCostUsd $S.ModelId 20000 $S.MaxOutputTokens
'Live test plan'
'  scenario:        {0} (ticket {1})' -f $Scenario, $sc.ticket
'  tenant message:  "{0}"' -f $sc.text
'  model:           {0}' -f $S.ModelId
'  limits:          up to {0} tool rounds, {1} output tokens per call, {2} s per run' -f $S.MaxToolRounds, $S.MaxOutputTokens, $S.MaxRunSeconds
'  spend ceiling:   ${0:N2} for this run (hard stop before any call that could pass it); typical cost is a fraction of a cent' -f $S.RunUsd
'  worst case for one call at about 20,000 input tokens: ${0:N4}' -f $worstPerCall
if ($FollowUp) { if (-not $sc.followup) { 'This scenario has no follow-up message.'; return }; '  follow-up turn:  "{0}" (a second paid call; its cost is added)' -f $sc.followup }
if (-not $Confirm) { ''; 'Nothing was sent. Add -Confirm to run it.'; return }

''
'Running ...'
$c = (New-Conversation -TicketId $sc.ticket -EquipmentId $sc.equipment).data.conversation_id
$r = Invoke-AgentTurn -ConversationId $c -TenantText $sc.text
''
'Reply to the tenant (source: {0}):' -f $r.source
$r.reply
if ($FollowUp) {
    $r2 = Invoke-AgentTurn -ConversationId $c -TenantText $sc.followup
    ''; 'Follow-up reply to the tenant (source: {0}):' -f $r2.source; $r2.reply
    'Follow-up: ok={0}, model calls={1}, estimated cost ${2:N6}' -f $r2.ok, $r2.model_calls, $r2.estimated_usd
}
''
'Result: ok={0}, model calls={1}, tool rounds={2}, stop reason={3}, error code={4}' -f $r.ok, $r.model_calls, $r.tool_rounds, $r.stop_reason, $(if ($r.error_code) { $r.error_code } else { 'none' })
'Estimated cost of this run: ${0:N6}' -f $r.estimated_usd
$t = Get-SpendTotals
'Estimated spend today / total: ${0:N4} / ${1:N4}' -f $t.today_usd, $t.total_usd
''
'Tools the model used:'
$tr = @((Read-Conversation $c).trace | Where-Object { $_.tool })
if ($tr.Count -eq 0) { '  (none)' } else { $tr | ForEach-Object { '  {0}: {1}' -f $_.tool, $(if ($_.ok) { 'ok' } else { 'refused (' + $_.error_code + ')' }) } }
$props = @(Get-ProposalList -Audience 'manager' | Where-Object { $_.conversation_id -ceq $c })
'Pending proposals created: {0}' -f $props.Count
''
'Conversation id (for the manager view later): {0}' -f $c
'Check the reply against the Playground behavior: one step at a time, plain text, no mention of tools or proposals.'

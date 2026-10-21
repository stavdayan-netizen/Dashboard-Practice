# Mocked tests for the Stage 5 loop (agent-config.ps1 and agent-loop.ps1). NO real API call is made and NO API key is needed:
# every model response is scripted, and the real HTTP function is exercised only against a fake Invoke-WebRequest.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentLoop.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
. (Join-Path $root 'agent\agent-lib.ps1')
. (Join-Path $root 'agent\agent-config.ps1')
. (Join-Path $root 'agent\agent-loop.ps1')

$script:Pass = 0; $script:Fail = 0; $script:Failures = @()
function Assert([bool]$Cond, [string]$Name) { if ($Cond) { $script:Pass++ } else { $script:Fail++; $script:Failures += $Name; Write-Host "  FAIL: $Name" -ForegroundColor Red } }
function Section([string]$T) { Write-Host "== $T" }
function Keys($o) { if ($o -is [System.Collections.IDictionary]) { @($o.Keys) } else { @($o.PSObject.Properties | ForEach-Object { $_.Name }) } }

$tmp = Join-Path $env:TEMP ('agent-loop-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$store = Join-Path $tmp 'store'
$envdir = Join-Path $tmp 'env'
[void][System.IO.Directory]::CreateDirectory($envdir)
Initialize-AgentLib -ProjectRoot $root -StoreDir $store -EnvDir $envdir
$KEY = 'sk-ant-fake-NOTAREALKEYNOTAREALKEY1234567890'
$demoBefore = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''

function S([hashtable]$More) {
    $o = @{ ANTHROPIC_API_KEY = $KEY; AGENT_LIVE_ENABLED = '1'; AGENT_MODEL = 'haiku'; AGENT_RETRY_DELAY_MS = '0' }
    if ($More) { foreach ($k in $More.Keys) { $o[$k] = $More[$k] } }
    return $o
}
function Resp($Blocks, [string]$Stop = 'end_turn', [int]$In = 1000, [int]$Out = 200) {
    $o = [ordered]@{ id = 'msg_test'; type = 'message'; role = 'assistant'; model = 'claude-haiku-5-5'; content = @($Blocks); stop_reason = $Stop
        usage = [ordered]@{ input_tokens = $In; output_tokens = $Out; cache_read_input_tokens = 0; cache_creation_input_tokens = 0 } }
    return ((ConvertTo-Json -InputObject $o -Depth 20) | ConvertFrom-Json)
}
function T([string]$Text) { return @{ type = 'text'; text = $Text } }
function Tu([string]$Id, [string]$Name, $In) { return @{ type = 'tool_use'; id = $Id; name = $Name; input = $In } }
function Th { return @{ type = 'thinking'; thinking = ''; signature = 'SIG_ABC123' } }
function E([int]$Status, [string]$Type) { return @{ error = @{ status = $Status; type = $Type; message = 'scripted error' } } }
$script:Q = New-Object System.Collections.ArrayList
$script:Requests = @()
function Queue($Items) { $script:Q = New-Object System.Collections.ArrayList; foreach ($i in $Items) { [void]$script:Q.Add($i) }; $script:Requests = @() }
Set-AgentTransport {
    param($Body, $TimeoutSec, $Settings)
    $script:Requests += , ((ConvertTo-Json -InputObject $Body -Depth 40 -Compress) | ConvertFrom-Json)
    if ($script:Q.Count -eq 0) { throw (New-ApiException 0 'mock_exhausted' 'queue empty') }
    $item = $script:Q[0]; $script:Q.RemoveAt(0)
    if ($item -is [scriptblock]) { return (& $item $Body) }
    if ($item -is [hashtable] -and $item.ContainsKey('error')) { throw (New-ApiException ([int]$item.error.status) ([string]$item.error.type) ([string]$item.error.message)) }
    return $item
}
function NewConv([string]$Ticket = 'HV-010', [string]$Equip = $null) { return (New-Conversation -TicketId $Ticket -EquipmentId $Equip).data.conversation_id }
function Turn([string]$Conv, [string]$Text, [hashtable]$More) { return (Invoke-AgentTurn -ConversationId $Conv -TenantText $Text -SettingsOverride (S $More)) }
function Trace([string]$Conv) { return @((Read-Conversation $Conv).trace) }
function Msgs([string]$Conv) { return @((Read-Conversation $Conv).messages) }
function LastMsg([string]$Conv) { $m = Msgs $Conv; return $m[$m.Count - 1] }
function Reset-Spend { $p = Get-SpendPath; [System.IO.File]::Delete($p) }
$SAFE_GAS = 'Please leave the area now without touching switches or appliances. Call 911 from a safe place and do not go back in until emergency responders say it is safe. Once you are safe, please contact your property manager.'

# ============================================================== prompt loading
Section 'system prompt: verbatim base plus approved addendum, guarded by hashes'
$p = Get-SystemPrompt
Assert ($p.text.StartsWith('# AI Maintenance Assistant - Playground System Prompt (Testing Only)')) 'runtime prompt starts with the tested base prompt'
Assert ($p.text.Contains('### Path C - Emergency')) 'base prompt text is present'
Assert ($p.text.Contains('Appropriate conversation closure.')) 'base prompt is complete (last bullet present)'
Assert ($p.text.Contains('## Connected mode')) 'addendum is included'
Assert ($p.text.IndexOf('### Path C - Emergency') -lt $p.text.IndexOf('## Connected mode')) 'addendum comes after the base prompt'
Assert ($p.text.EndsWith('notes about proposals to it.')) 'addendum is complete'
Assert ($p.text.Contains("`n`n## Connected mode")) 'base and addendum are separated by a blank line'
$h = Read-JsonFile (Join-Path $root 'agent\prompt-hashes.json')
Assert (($p.base_sha256 -ceq $h.base_sha256) -and ($p.addendum_sha256 -ceq $h.addendum_sha256)) 'prompt hashes match the recorded ones'
$agentCopy = Join-Path $tmp 'agentcopy'
[void][System.IO.Directory]::CreateDirectory($agentCopy)
foreach ($f in 'system-prompt.draft.md', 'system-prompt.connected-addendum.md', 'prompt-hashes.json') { Copy-Item (Join-Path $root "agent\$f") $agentCopy }
$basePath = Join-Path $agentCopy 'system-prompt.draft.md'
$orig = [System.IO.File]::ReadAllText($basePath)
[System.IO.File]::WriteAllText($basePath, ($orig -replace "`r`n", "`n" -replace "`n", "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Assert ((Get-SystemPrompt -AgentDir $agentCopy).base_sha256 -ceq $h.base_sha256) 'CRLF line endings do not change the hash'
[System.IO.File]::WriteAllText($basePath, $orig.Replace('Safety first', 'Safety second'), (New-Object System.Text.UTF8Encoding($false)))
$threw = $false; try { [void](Get-SystemPrompt -AgentDir $agentCopy) } catch { $threw = $true }
Assert $threw 'an edited base prompt stops the agent'
Assert ((Get-SystemPrompt -AgentDir $agentCopy -AllowChange $true).text -like '*Safety second*') 'AllowChange lets a deliberate test change through'
[System.IO.File]::WriteAllText($basePath, $orig, (New-Object System.Text.UTF8Encoding($false)))
$addPath = Join-Path $agentCopy 'system-prompt.connected-addendum.md'
$addOrig = [System.IO.File]::ReadAllText($addPath)
[System.IO.File]::WriteAllText($addPath, $addOrig.Replace('Never mention tool names', 'You may mention tool names'), (New-Object System.Text.UTF8Encoding($false)))
$threw = $false; try { [void](Get-SystemPrompt -AgentDir $agentCopy) } catch { $threw = $true }
Assert $threw 'an edited addendum stops the agent'

# ============================================================== settings
Section 'settings: models, limits, ceilings, key handling'
$s0 = Get-AgentSettings -Override @{}
Assert ($s0.ModelId -ceq 'claude-haiku-5-5' -and $s0.MaxToolRounds -eq 6 -and $s0.MaxOutputTokens -eq 4096 -and $s0.LiveEnabled -eq $false) 'defaults: Haiku 5.5, 6 rounds, 4096 tokens, live disabled'
Assert ((Get-AgentSettings -Override @{ AGENT_MODEL = 'sonnet' }).ModelId -ceq 'claude-sonnet-5-5') 'sonnet alias resolves to Sonnet 5.5'
Assert ((Get-AgentSettings -Override @{ AGENT_MODEL = 'claude-sonnet-5-5' }).ModelId -ceq 'claude-sonnet-5-5') 'exact model id is accepted'
Assert ($null -eq (Get-AgentSettings -Override @{ AGENT_MODEL = 'claude-opus-5-5' }).ModelId) 'a model without a price entry is refused'
$big = Get-AgentSettings -Override @{ AGENT_RUN_SPEND_USD = '999'; AGENT_DAILY_SPEND_USD = '999'; AGENT_TOTAL_SPEND_USD = '9999'; AGENT_MAX_TOOL_ROUNDS = '500'; AGENT_MAX_OUTPUT_TOKENS = '999999'; AGENT_MAX_RUN_SECONDS = '99999' }
Assert ($big.RunUsd -le 2.0 -and $big.DailyUsd -le 20.0 -and $big.TotalUsd -le 100.0 -and $big.MaxToolRounds -le 12 -and $big.MaxOutputTokens -le 8192 -and $big.MaxRunSeconds -le 300) 'a typo cannot raise limits above the hard ceilings'
$low = Get-AgentSettings -Override @{ AGENT_RUN_SPEND_USD = 'abc'; AGENT_MAX_TOOL_ROUNDS = '-3' }
Assert ($low.RunUsd -eq 0.25 -and $low.MaxToolRounds -eq 1) 'bad numbers fall back to defaults or the minimum'
Assert ((Get-AgentSettings -Override @{ AGENT_EFFORT = 'ultra' }).Effort -ceq '') 'an unknown effort level is dropped'
$pub = Get-PublicSettings (Get-AgentSettings -Override (S @{}))
Assert (((Keys $pub) -notcontains 'ApiKey') -and $pub.KeyPresent -eq $true) 'public settings never include the key'
Assert (-not ((ConvertTo-Json $pub -Depth 4) -like "*$KEY*")) 'public settings JSON does not contain the key'
Assert ((Remove-Secrets "boom $KEY and sk-ant-xxxxxxxxxxxx" (Get-AgentSettings -Override @{ ANTHROPIC_API_KEY = $KEY })) -notmatch 'sk-ant') 'Remove-Secrets scrubs key-shaped text'

# the remaining sections live in loop-parts\*.ps1 (dot-sourced so they share these helpers and variables)
foreach ($part in (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'loop-parts') -Filter '*.ps1' | Sort-Object Name)) { . $part.FullName }

Section 'final checks'
$demoAfter = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
Assert ($demoBefore -ceq $demoAfter) 'demo/ files are byte-identical after all tests'
Assert (-not (Test-Path (Join-Path $root 'agent-data\conversations\conv-*'))) 'the real agent-data/ received no test data'
Assert ((& git -C $root status --porcelain -- app.js index.html tenant.html tenant.js systems.js tickets-demo.js 2>$null | Measure-Object).Count -eq 0) 'dashboard and tenant portal files are unchanged in git (demo/ is covered by the byte-hash check)'
if ([System.IO.Directory]::Exists($tmp)) { [System.IO.Directory]::Delete($tmp, $true) }
Write-Host ''
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { Write-Host ('Failed: ' + ($script:Failures -join '; ')); exit 1 }
exit 0

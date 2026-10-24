# Tests for the Stage 5 background runs and the local agent API (agent-runs.ps1, agent-api.ps1, and the additive hook in serve.ps1).
# NO real API call and NO API key: model responses come from a scripted mock file (AGENT_MOCK_RESPONSES_FILE), which jobs and
# the test server pick up through the environment. The HTTP section starts serve.ps1 on a local test port with a temporary store.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentRoutes.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
. (Join-Path $root 'agent\agent-api.ps1')

$script:Pass = 0; $script:Fail = 0; $script:Failures = @()
function Assert([bool]$Cond, [string]$Name) { if ($Cond) { $script:Pass++ } else { $script:Fail++; $script:Failures += $Name; Write-Host "  FAIL: $Name" -ForegroundColor Red } }
function Section([string]$T) { Write-Host "== $T" }
function J($Reply) { return ($Reply.json | ConvertFrom-Json) }

$tmp = Join-Path $env:TEMP ('agent-routes-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$store = Join-Path $tmp 'store'
$envdir = Join-Path $tmp 'env'
[void][System.IO.Directory]::CreateDirectory($envdir)
$KEY = 'sk-ant-fake-NOTAREALKEYNOTAREALKEY1234567890'
[System.IO.File]::WriteAllText((Join-Path $envdir '.env'), "ANTHROPIC_API_KEY=$KEY`nAGENT_LIVE_ENABLED=1`nAGENT_MODEL=haiku`nAGENT_RETRY_DELAY_MS=0`nAPIFY_TOKEN=not-an-agent-setting`n")
Initialize-AgentLib -ProjectRoot $root -StoreDir $store -EnvDir $envdir
$demoBefore = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
$realConvBefore = @(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data\conversations') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + $_.Length + $_.LastWriteTimeUtc.Ticks }) -join ','
$mockFile = Join-Path $tmp 'mock.json'
$env:AGENT_MOCK_RESPONSES_FILE = $mockFile

function MockResp($Blocks, [string]$Stop = 'end_turn', [int]$DelayMs = 0) {
    $o = [ordered]@{ id = 'msg_test'; type = 'message'; role = 'assistant'; model = 'claude-haiku-5-5'; content = @($Blocks); stop_reason = $Stop; usage = [ordered]@{ input_tokens = 1000; output_tokens = 200 } }
    if ($DelayMs -gt 0) { $o['delay_ms'] = $DelayMs }
    return $o
}
function SetMock($Responses) {
    foreach ($f in $mockFile, "$mockFile.pos", "$mockFile.requests.jsonl") { [System.IO.File]::Delete($f) }
    [System.IO.File]::WriteAllText($mockFile, (ConvertTo-Json -InputObject ([ordered]@{ responses = @($Responses) }) -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
}
function Api([string]$Method, [string]$Path, $Query = @{}, $Body = $null, [string]$Token = '', [string]$HostName = 'localhost:8531', [bool]$Local = $true) {
    $h = @{ Host = $HostName }
    if ($Token) { $h['X-Conversation-Token'] = $Token }
    $text = $(if ($null -ne $Body) { ConvertTo-Json -InputObject $Body -Depth 8 -Compress } else { '' })
    return (Invoke-AgentApi -Method $Method -Path $Path -Query $Query -Headers $h -BodyText $text -Port 8531 -IsLocal $Local)
}

Section 'API gate: local only, host name, JSON, unknown routes'
Assert ((Api 'GET' '/api/agent/status' @{} $null '' 'localhost:8531' $false).status -eq 403) 'a non-local request is refused'
Assert ((Api 'GET' '/api/agent/status' @{} $null '' 'evil.example.com:8531').status -eq 403) 'a request with a foreign Host header is refused (DNS rebinding)'
Assert ((Api 'GET' '/api/agent/nothing').status -eq 404) 'an unknown agent route is 404'
Assert ((Invoke-AgentApi -Method 'POST' -Path '/api/agent/tenant/start' -Query @{} -Headers @{ Host = 'localhost:8531' } -BodyText '{broken' -Port 8531 -IsLocal $true).status -eq 400) 'invalid JSON is 400'
Assert ((Invoke-AgentApi -Method 'POST' -Path '/api/agent/tenant/start' -Query @{} -Headers @{ Host = 'localhost:8531' } -BodyText '[1,2]' -Port 8531 -IsLocal $true).status -eq 400) 'a JSON array body is 400'
$st = Api 'GET' '/api/agent/status'
$sj = J $st
Assert (($st.status -eq 200) -and ($sj.LiveReady -eq $true) -and ($sj.ModelId -ceq 'claude-haiku-5-5') -and ($sj.KeyPresent -eq $true)) 'status reports live-ready and the model'
Assert (($st.json -notlike "*$KEY*") -and ($st.json -notlike '*sk-ant*') -and ($null -eq $sj.PSObject.Properties['ApiKey'])) 'status never contains the key'
Assert ($sj.PromptHashesOk -eq $true) 'status confirms the prompt hashes match'

Section 'tenant routes: start, token, message, poll'
$bad = Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = 'HV-999' }
Assert (($bad.status -eq 404) -and ((J $bad).error -ceq 'not_available')) 'starting on an unknown ticket is refused'
Assert ((Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = '../etc' }).status -eq 404) 'a malformed ticket id is refused'
Assert ((Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = 'HV-010'; equipment_id = 'eq-hv-panel' }).status -eq 404) 'Internal Only equipment cannot be chosen'
$s1 = J (Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = 'HV-010'; equipment_id = 'eq-hv-dishwasher' })
$conv = [string]$s1.conversation_id; $tok = [string]$s1.tenant_token
Assert (($conv -cmatch '^conv-\d{14}-[0-9a-f]{8}$') -and ($tok -cmatch '^[A-Za-z0-9_-]{32}$')) 'start returns a conversation id and a 32-character token'
$convFile = [System.IO.File]::ReadAllText((Get-ConversationPath $conv))
Assert (-not $convFile.Contains($tok)) 'the token itself is not stored (only its hash)'
$s2 = J (Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = 'HV-006' })
$conv2 = [string]$s2.conversation_id; $tok2 = [string]$s2.tenant_token
Assert ((Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'hello' }).status -eq 403) 'a message without a token is refused'
Assert ((Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'hello' } 'wrongwrongwrongwrongwrongwrongxx').status -eq 403) 'a wrong token is refused'
Assert ((Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'hello' } $tok2).status -eq 403) 'another conversation''s token is refused'
Assert ((Api 'GET' '/api/agent/tenant/conversation' @{ id = $conv } $null $tok2).status -eq 403) 'another conversation''s token cannot read this conversation'
Assert ((Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = '   ' } $tok).status -eq 400) 'an empty message is refused'
Assert ((Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = ('x' * 2001) } $tok).status -eq 400) 'an over-long message is refused'

SetMock @((MockResp @(@{ type = 'tool_use'; id = 'toolu_1'; name = 'get_ticket_details'; input = @{} }) 'tool_use'), (MockResp @(@{ type = 'text'; text = 'Hi! I''m your AI Maintenance Assistant. Please run the kitchen sink for about 30 seconds. Does it drain normally?' }) 'end_turn' 2500))
$m1 = Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'My dishwasher is not draining.' } $tok
$run = [string](J $m1).run_id
Assert (($m1.status -eq 200) -and ($run -cmatch '^run-\d{14}-[0-9a-f]{8}$')) 'a message starts a background run and returns at once with a run id'
$busy = Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'Are you there?' } $tok
Assert (($busy.status -eq 409) -and ((J $busy).error -ceq 'busy')) 'a second message during a run is refused (one run per conversation)'
$mid = Api 'GET' '/api/agent/tenant/result' @{ run_id = $run; conversation_id = $conv } $null $tok
Assert (((J $mid).status -ceq 'running') -and ($null -eq (J $mid).PSObject.Properties['reply'])) 'while running, the poll shows no reply'
Assert ((Api 'GET' '/api/agent/tenant/result' @{ run_id = $run; conversation_id = $conv2 } $null $tok2).status -eq 404) 'another conversation cannot poll this run'
$fin = Wait-AgentRun -RunId $run -ConversationId $conv -TimeoutSeconds 90
Assert ($fin.ok -and ($fin.data.status -ceq 'done') -and ($fin.data.reply -like 'Hi!*kitchen sink*')) 'the run finishes and the poll returns the reply'
$res = Api 'GET' '/api/agent/tenant/result' @{ run_id = $run; conversation_id = $conv } $null $tok
Assert (($res.status -eq 200) -and ((J $res).reply -like 'Hi!*')) 'the result route returns the tenant-safe reply'
Assert (($res.json -notmatch 'toolu_|usd|tokens|trace|proposal|signature|do_not_offer|sk-ant') -and ((@((J $res).PSObject.Properties | ForEach-Object { $_.Name }) -join ',') -ceq 'run_id,status,reply')) 'the poll result contains only run id, status and reply'
$tview = Api 'GET' '/api/agent/tenant/conversation' @{ id = $conv } $null $tok
$tvj = J $tview
Assert (($tview.status -eq 200) -and (@($tvj.messages).Count -eq 2) -and ($tview.json -notmatch 'toolu_|usd|trace|proposal|input_tokens|tenant_token')) 'the tenant conversation view has only the two messages'
Assert (-not (Test-Path (Get-LockPath $conv))) 'the run lock is released when the run ends'
Assert ((Get-Content "$mockFile.requests.jsonl").Count -eq 2) 'the job made exactly the two scripted model calls'
$reqs = @(Get-Content "$mockFile.requests.jsonl" | ForEach-Object { $_ | ConvertFrom-Json })
Assert (($reqs[0].model -ceq 'claude-haiku-5-5') -and ($reqs[0].system[0].text -like '*Connected mode*') -and (@($reqs[0].tools).Count -eq 5)) 'the job used the configured model, the combined prompt and the five tools'

Section 'a second run, a stale lock, and failures'
SetMock @((MockResp @(@{ type = 'text'; text = 'Thanks. What does the sink do?' })))
$m2 = Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'It drains fine.' } $tok
Assert ($m2.status -eq 200) 'after a run ends, the next message starts a new run'
$fin2 = Wait-AgentRun -RunId ([string](J $m2).run_id) -ConversationId $conv -TimeoutSeconds 90
Assert (($fin2.data.status -ceq 'done') -and ($fin2.data.reply -like 'Thanks*')) 'second run completes'
Assert ((@((Read-Conversation $conv).messages).Count) -eq 4) 'the conversation keeps all four messages'
$lock = Get-LockPath $conv
[System.IO.File]::WriteAllText($lock, 'x')
(Get-Item $lock).LastWriteTime = (Get-Date).AddMinutes(-10)
SetMock @((MockResp @(@{ type = 'text'; text = 'Sure, go ahead.' })))
$m3 = Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'One more question.' } $tok
Assert ($m3.status -eq 200) 'a stale lock (older than the run limit) does not block a new run'
$null = Wait-AgentRun -RunId ([string](J $m3).run_id) -ConversationId $conv -TimeoutSeconds 90
SetMock @()
$m4 = Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv; text = 'Is anyone there?' } $tok
$f4 = Wait-AgentRun -RunId ([string](J $m4).run_id) -ConversationId $conv -TimeoutSeconds 90
Assert (($f4.data.status -ceq 'done') -and ($f4.data.reply -like '*trouble replying*')) 'when the model path fails, the poll still returns the fail-safe reply'
Assert ((Get-ChildItem (Join-Path $store 'runs') -Filter 'run-*.json' | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match 'toolu_|usd|sk-ant' }).Count -eq 0) 'run files hold no tool data, cost or key'

Section 'emergency through the API: safety message, pending proposal, manager sees it'
$s3 = J (Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = 'HV-004' })
$conv3 = [string]$s3.conversation_id; $tok3 = [string]$s3.tenant_token
$gas = 'Please leave the area now without touching switches or appliances. Call 911 from a safe place and do not go back in until emergency responders say it is safe. Once you are safe, please contact your property manager.'
SetMock @((MockResp @(@{ type = 'tool_use'; id = 'toolu_g1'; name = 'draft_ticket_update'; input = @{ fields = @{ ai_urgency = 'Emergency'; summary = 'Gas smell reported.' }; reason = 'Path C.' } }) 'tool_use'), (MockResp @(@{ type = 'text'; text = $gas })))
$mg = Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv3; text = 'I smell gas in the kitchen.' } $tok3
$fg = Wait-AgentRun -RunId ([string](J $mg).run_id) -ConversationId $conv3 -TimeoutSeconds 90
Assert (($fg.data.status -ceq 'done') -and ($fg.data.reply -ceq $gas)) 'the emergency reply reaches the tenant through the API'
$mp = J (Api 'GET' '/api/agent/manager/proposals' @{ status = 'pending' })
$gp = @($mp.proposals | Where-Object { $_.conversation_id -ceq $conv3 })
Assert (($gp.Count -eq 1) -and ($gp[0].proposed_fields.emergency_flag -eq $true) -and ($gp[0].proposed_fields.ai_handling_status -ceq 'Escalated')) 'the manager sees the pending Emergency proposal'
Assert (($gp.Count -eq 1) -and $gp[0].reply_check -and (@($gp[0].reply_check.PSObject.Properties.Name) -contains 'claimed_but_not_delivered') -and (@($gp[0].reply_check.PSObject.Properties.Name) -contains 'delivered_in_reply') -and (@($gp[0].history).Count -ge 2) -and ($gp[0].reason) -and ($gp[0].created_at)) 'the manager proposal list carries the reply check, history, reason and time that the proposals panel shows'
$mc = J (Api 'GET' '/api/agent/manager/conversations' @{ ticket_id = 'HV-004' })
$mcc = @($mc.conversations | Where-Object { $_.id -ceq $conv3 })
Assert (($mcc.Count -eq 1) -and (@($mcc[0].trace | Where-Object { $_.tool -ceq 'draft_ticket_update' }).Count -eq 1) -and (@($mcc[0].proposals).Count -eq 1)) 'the manager view has the trace and the proposal'
Assert ((Api 'GET' '/api/agent/manager/conversations' @{ ticket_id = 'HV-999' }).status -eq 404) 'an unknown ticket gives 404 for the manager list'
Assert ((Api 'GET' '/api/agent/manager/proposals' @{ status = 'bogus' }).status -eq 400) 'an unknown proposal status is 400'

Section 'manager decisions through the API'
$pid1 = [string]$gp[0].id
Assert ((Api 'POST' '/api/agent/manager/proposals/decide' @{} @{ proposal_id = $pid1; decision = 'maybe' }).status -eq 400) 'an unknown decision is 400'
Assert ((Api 'POST' '/api/agent/manager/proposals/decide' @{} @{ proposal_id = 'prop-../x'; decision = 'approve' }).status -eq 404) 'a malformed proposal id is 404'
Assert ((Api 'POST' '/api/agent/manager/proposals/applied' @{} @{ proposal_id = $pid1 }).status -eq 409) 'a pending proposal cannot be marked applied'
$ap = Api 'POST' '/api/agent/manager/proposals/decide' @{} @{ proposal_id = $pid1; decision = 'approve'; note = 'Looks right.' }
Assert (($ap.status -eq 200) -and ((J $ap).status -ceq 'approved')) 'approve works'
Assert ((Api 'POST' '/api/agent/manager/proposals/decide' @{} @{ proposal_id = $pid1; decision = 'reject' }).status -eq 409) 'a decided proposal cannot be decided again'
Assert ((J (Api 'POST' '/api/agent/manager/proposals/applied' @{} @{ proposal_id = $pid1 })).status -ceq 'applied') 'an approved proposal can be marked applied'
Assert ((Api 'POST' '/api/agent/tenant/message' @{} @{ conversation_id = $conv3; text = 'ok' } $tok3).status -eq 200) 'tenant messaging is unaffected by manager decisions'
$null = Wait-AgentRun -RunId ([string]((Get-ChildItem (Join-Path $store 'runs') -Filter 'run-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).BaseName)) -ConversationId $conv3 -TimeoutSeconds 60
Assert (@(Get-Content -LiteralPath (Join-Path $root 'demo\tickets.csv')).Count -eq 31) 'approving a proposal changes no demo ticket (demo/tickets.csv unchanged)'

# ============================================================== demo portal: submit a request, resume, partial failures
Section 'submit route: a new demo ticket, a conversation and the assistant''s first reply; recovery when the chat cannot start'
SetMock @((MockResp @(@{ type = 'text'; text = 'Hi! Please check the sink first.' })))
$issueS = 'The dishwasher is not draining and water stands in the bottom.'
$sub = Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = $issueS; priority = 'High' }
$sj = J $sub
Assert (($sub.status -eq 200) -and ($sj.ticket_id -cmatch '^HV-1\d\d$') -and $sj.conversation_id -and $sj.tenant_token -and $sj.run_id -and ($sj.chat_available -eq $true) -and ($null -eq $sj.chat_error)) 'submit creates the ticket and conversation and starts the first reply'
Assert ((Get-ChildItem (Join-Path $store 'tickets') -Filter 'tkt-*.json').Count -ge 1) 'the new ticket is stored in the agent store'
$fs = Wait-AgentRun -RunId $sj.run_id -ConversationId $sj.conversation_id -TimeoutSeconds 90
Assert ($fs.ok -and $fs.data.status -ceq 'done' -and $fs.data.reply -like 'Hi!*') 'the first reply arrives without a tenant message from the page'
$msgsS = @((Read-Conversation $sj.conversation_id).messages)
Assert (($msgsS.Count -eq 2) -and ($msgsS[0].role -ceq 'tenant') -and ($msgsS[0].text -ceq $issueS) -and ($msgsS[1].role -ceq 'assistant')) 'the conversation is the request, then the reply (no duplicate tenant message)'
$req0 = @(Get-Content "$mockFile.requests.jsonl" | ForEach-Object { $_ | ConvertFrom-Json })[0]
$first0 = [string]$req0.messages[0].content
Assert ($first0.Contains($sj.ticket_id) -and $first0.Contains('just submitted this ticket') -and $first0.Contains('eq-hv-dishwasher') -and $first0.EndsWith($issueS)) 'the model is told which ticket was just submitted, which equipment it names, and gets the request text as the tenant message'
Assert ((Api 'GET' '/api/agent/manager/conversations' @{ ticket_id = $sj.ticket_id }).status -eq 200) 'the server knows the new ticket'
Assert ((Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = 'no'; priority = 'High' }).status -eq 400) 'a too-short description is 400'
Assert ((Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = $issueS; priority = 'Whenever' }).status -eq 400) 'an unknown priority is 400'
Assert ((Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = ('x' * 1001); priority = 'Low' }).status -eq 400) 'a description over 1000 characters is 400'

# resume: only when the last message is the tenant's, only with the token
$rs0 = Api 'POST' '/api/agent/tenant/resume' @{} @{ conversation_id = $sj.conversation_id } $sj.tenant_token
Assert ($rs0.status -eq 409) 'resume when the last message already has a reply is 409'
Assert ((Api 'POST' '/api/agent/tenant/resume' @{} @{ conversation_id = $sj.conversation_id } 'A'.PadRight(32, 'A')).status -eq 403) 'resume with a wrong token is 403'
$cr = J (Api 'POST' '/api/agent/tenant/start' @{} @{ ticket_id = $sj.ticket_id })
[void](Add-ConversationMessage -ConversationId $cr.conversation_id -Role 'tenant' -Text $issueS)
SetMock @((MockResp @(@{ type = 'text'; text = 'Hi again! Is the sink draining?' })))
$rs1 = Api 'POST' '/api/agent/tenant/resume' @{} @{ conversation_id = $cr.conversation_id } $cr.tenant_token
Assert (($rs1.status -eq 200) -and (J $rs1).run_id) 'resume answers a tenant message that has no reply yet'
$rf = Wait-AgentRun -RunId (J $rs1).run_id -ConversationId $cr.conversation_id -TimeoutSeconds 90
$msgsR = @((Read-Conversation $cr.conversation_id).messages)
Assert ($rf.ok -and $rf.data.status -ceq 'done' -and ($msgsR.Count -eq 2) -and ($msgsR[0].role -ceq 'tenant') -and ($msgsR[1].role -ceq 'assistant')) 'the resumed reply is stored after the existing tenant message without duplicating it'

# the ticket is kept when the assistant is switched off
$envFile = Join-Path $envdir '.env'
$envKeep = [System.IO.File]::ReadAllText($envFile)
[System.IO.File]::WriteAllText($envFile, "AGENT_LIVE_ENABLED=0`nAGENT_MODEL=haiku`n")
$off = Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = 'The front door lock is sticking badly.'; priority = 'Medium' }
[System.IO.File]::WriteAllText($envFile, $envKeep)
$oj = J $off
Assert (($off.status -eq 200) -and ($oj.ticket_id -cmatch '^HV-1\d\d$') -and $oj.conversation_id -and ($oj.chat_available -eq $false) -and ($oj.chat_error -ceq 'assistant_off') -and ($null -eq $oj.run_id)) 'with the assistant switched off the ticket and conversation are still created and the answer says so'
Assert (@((Read-Conversation $oj.conversation_id).messages).Count -eq 1) 'the request is stored as the tenant message even though no reply was started'
Assert (($off.json -notlike "*$KEY*") -and ($sub.json -notlike "*$KEY*")) 'the submit answers never contain the key'

# a busy conversation refuses a second run
SetMock @((MockResp @(@{ type = 'text'; text = 'Slow reply.' }) 'end_turn' 3000))
$bz = J (Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = 'The sliding balcony door will not slide.'; priority = 'Low' })
$bz2 = Api 'POST' '/api/agent/tenant/resume' @{} @{ conversation_id = $bz.conversation_id } $bz.tenant_token
Assert ($bz2.status -eq 409) 'a second run on a busy conversation is refused (409)'
[void](Wait-AgentRun -RunId $bz.run_id -ConversationId $bz.conversation_id -TimeoutSeconds 90)

# rate limit: at most 10 submits a minute (invalid ones count too, so this costs nothing)
$codes = @(1..12 | ForEach-Object { (Api 'POST' '/api/agent/tenant/submit' @{} @{ issue = 'x'; priority = 'Low' }).status })
Assert (($codes -contains 429) -and ($codes[0] -eq 400 -or $codes[0] -eq 429)) 'too many submits in a minute are refused (429)'

# ============================================================== real HTTP through serve.ps1
Section 'HTTP through serve.ps1 (test port, temporary store): existing routes unchanged, agent routes work, background run does not block the server'
$port = 8561
$env:AGENT_STORE_DIR = Join-Path $tmp 'httpstore'
$env:AGENT_ENV_DIR = $envdir
$srv = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $root 'serve.ps1') + '"'), '-Port', $port) -PassThru -WindowStyle Hidden
function Http([string]$Method, [string]$Path, $Body = $null, [hashtable]$Headers = @{}, [string]$ContentType = 'application/json', [hashtable]$Extra = @{}) {
    $p = @{ Uri = "http://localhost:$port$Path"; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30; Headers = $Headers }
    if ($null -ne $Body) { $p['Body'] = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 8 -Compress)); $p['ContentType'] = $ContentType }
    try { $r = Invoke-WebRequest @p; return @{ status = [int]$r.StatusCode; text = $r.Content } }
    catch { $code = 0; $txt = ''; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode; try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $txt = $sr.ReadToEnd() } catch { } }; return @{ status = $code; text = $txt } }
}
try {
    $up = $false
    foreach ($i in 1..40) { Start-Sleep -Milliseconds 500; $x = Http 'GET' '/api/status'; if ($x.status -eq 200) { $up = $true; break } }
    Assert $up 'the server started on the test port'
    if ($up) {
        $x = Http 'GET' '/api/status'
        Assert (($x.status -eq 200) -and (($x.text | ConvertFrom-Json).PSObject.Properties.Name -contains 'vendorSearch')) 'the existing /api/status route still works'
        Assert ((Http 'GET' '/index.html').status -eq 200) 'the dashboard page is still served'
        Assert ((Http 'GET' '/tenant.html').status -eq 200) 'the tenant portal page is still served'
        $probeDir = Join-Path $root 'agent-data'
        $madeDir = -not (Test-Path $probeDir)
        [void][System.IO.Directory]::CreateDirectory($probeDir)
        [System.IO.File]::WriteAllText((Join-Path $probeDir '_probe.txt'), 'secret')
        $x = Http 'GET' '/agent-data/_probe.txt'
        [System.IO.File]::Delete((Join-Path $probeDir '_probe.txt'))
        if ($madeDir) { [System.IO.Directory]::Delete($probeDir, $true) }
        Assert ($x.status -eq 404) 'files under agent-data/ are never served as static files'
        Assert ((Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-010' } @{ Origin = 'http://evil.example' }).status -eq 403) 'a POST from a foreign origin is refused'
        Assert ((Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-010' } @{} 'text/plain').status -eq 415) 'a POST that is not JSON is refused'
        $x = Http 'GET' '/api/agent/status'
        Assert (($x.status -eq 200) -and ($x.text -notlike '*sk-ant*') -and ((($x.text | ConvertFrom-Json).LiveReady) -eq $true)) 'agent status over HTTP is live-ready and shows no key'
        $x = Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-010' }
        $hs = $x.text | ConvertFrom-Json
        Assert (($x.status -eq 200) -and $hs.conversation_id -and $hs.tenant_token) 'start works over HTTP'
        SetMock @((MockResp @(@{ type = 'text'; text = 'Hi! I''m your AI Maintenance Assistant. Please run the kitchen sink. Does it drain?' }) 'end_turn' 3500))
        $x = Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $hs.conversation_id; text = 'My dishwasher is not draining.' } @{ 'X-Conversation-Token' = $hs.tenant_token }
        Assert ($x.status -eq 200) 'message over HTTP starts a run'
        $runId = ($x.text | ConvertFrom-Json).run_id
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $page = Http 'GET' '/index.html'
        Assert (($page.status -eq 200) -and ($sw.Elapsed.TotalSeconds -lt 2.5)) 'while the model call is pending, the server still answers other requests quickly (background run)'
        $deadline = (Get-Date).AddSeconds(90); $final = $null
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
            $q = Http 'GET' ("/api/agent/tenant/result?run_id=$runId&conversation_id=$($hs.conversation_id)") $null @{ 'X-Conversation-Token' = $hs.tenant_token }
            $qj = $q.text | ConvertFrom-Json
            if ($qj.status -cne 'running') { $final = $qj; break }
        }
        Assert (($null -ne $final) -and ($final.status -ceq 'done') -and ($final.reply -like 'Hi!*')) 'polling over HTTP returns the reply'
        $x = Http 'GET' "/api/agent/manager/conversations?ticket_id=HV-010"
        Assert (($x.status -eq 200) -and ($x.text -like '*model_call*') -and ($x.text -like "*$($hs.conversation_id)*")) 'the manager route shows the conversation and its trace'
        $x = Http 'GET' "/api/agent/tenant/conversation?id=$($hs.conversation_id)" $null @{ 'X-Conversation-Token' = $hs.tenant_token }
        Assert (($x.status -eq 200) -and ($x.text -notlike '*model_call*') -and ($x.text -notlike '*usd*')) 'the tenant route over HTTP hides the trace and cost'
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($hs.conversation_id)").status -eq 403) 'the tenant route without a token is refused over HTTP'
    }
}
finally {
    foreach ($c in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($srv.Id)" -ErrorAction SilentlyContinue)) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENT_STORE_DIR, Env:\AGENT_ENV_DIR, Env:\AGENT_MOCK_RESPONSES_FILE -ErrorAction SilentlyContinue
}

Section 'final checks'
$demoAfter = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
Assert ($demoBefore -ceq $demoAfter) 'demo/ files are byte-identical after all tests'
Assert ($realConvBefore -ceq (@(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data\conversations') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + $_.Length + $_.LastWriteTimeUtc.Ticks }) -join ',')) 'the real agent-data/ received no test data'
Assert ((& git -C $root status --porcelain -- tenant.js tenant.css systems.js tickets-demo.js 2>$null | Measure-Object).Count -eq 0) 'dashboard and tenant portal code files are unchanged in git (tenant.html carries only the guarded demo loader, checked in Test-AgentChat.ps1; demo/ is covered by the byte-hash check)'
Start-Sleep -Milliseconds 500
if ([System.IO.Directory]::Exists($tmp)) { try { [System.IO.Directory]::Delete($tmp, $true) } catch { } }
Write-Host ''
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { Write-Host ('Failed: ' + ($script:Failures -join '; ')); exit 1 }
exit 0

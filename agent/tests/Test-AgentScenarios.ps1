# Stage 6.5: free, mocked end-to-end scenarios through the real local server (serve.ps1 on a test port, temporary store).
# The model is a SCRIPTED mock (AGENT_MOCK_RESPONSES_FILE): no API key, no network, no paid call. Each scenario drives the same HTTP
# routes the tenant portal and the manager dashboard use, asserts the server-side guarantees, and records a transcript in
# agent\scenarios\SCENARIOS.md (rewritten on every run; no ids, tokens, keys or timestamps are written).
# The model's words in these transcripts are scripted test text; what the transcripts prove is what the SERVER does with them
# (guards, fail-safe messages, proposals, decisions, persistence). Real model behavior is recorded only by the approved live tests.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentScenarios.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$script:Pass = 0; $script:Fail = 0; $script:Failures = @()
function Assert([bool]$Cond, [string]$Name) {
    if ($Cond) { $script:Pass++; $script:Checks += "- pass: $Name" } else { $script:Fail++; $script:Failures += $Name; $script:Checks += "- **FAIL**: $Name"; Write-Host "  FAIL: $Name" -ForegroundColor Red }
}
$script:Checks = @()
$script:Md = New-Object System.Collections.Generic.List[string]
function Section([string]$T) { Write-Host "== $T" }

$tmp = Join-Path $env:TEMP ('agent-scn-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$envdir = Join-Path $tmp 'env'; $storeDir = Join-Path $tmp 'store'
[void][System.IO.Directory]::CreateDirectory($envdir)
$KEY = 'sk-ant-fake-NOTAREALKEYNOTAREALKEY1234567890'
$envOn = "ANTHROPIC_API_KEY=$KEY`nAGENT_LIVE_ENABLED=1`nAGENT_MODEL=haiku`nAGENT_RETRY_DELAY_MS=0`n"
$envOff = "AGENT_LIVE_ENABLED=0`nAGENT_MODEL=haiku`n"
$envFile = Join-Path $envdir '.env'
[System.IO.File]::WriteAllText($envFile, $envOn)
$mockFile = Join-Path $tmp 'mock.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$demoBefore = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
$realBefore = @(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data') -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($root.Length) + $_.Length + $_.LastWriteTimeUtc.Ticks }) -join ','

function New-MockMsg($Text, $Blocks = $null, [int]$DelayMs = 0) {
    $c = $(if ($Blocks) { $Blocks } else { @(@{ type = 'text'; text = $Text }) })
    $o = [ordered]@{ id = 'msg_s'; type = 'message'; role = 'assistant'; model = 'claude-haiku-5-5'; content = $c; stop_reason = $(if ($Blocks) { 'tool_use' } else { 'end_turn' }); usage = [ordered]@{ input_tokens = 1000; output_tokens = 100 } }
    if ($DelayMs) { $o['delay_ms'] = $DelayMs }
    return $o
}
function New-Draft($Id, $Fields, $Reason, [bool]$Confirmed = $false) {
    $in = @{ fields = $Fields; reason = $Reason }
    if ($Confirmed) { $in['tenant_confirmed_resolution'] = $true }
    return (New-MockMsg $null @(@{ type = 'tool_use'; id = $Id; name = 'draft_ticket_update'; input = $in }))
}
function Set-Mock($Responses) {
    foreach ($f in $mockFile, "$mockFile.pos", "$mockFile.requests.jsonl") { [System.IO.File]::Delete($f) }
    [System.IO.File]::WriteAllText($mockFile, (ConvertTo-Json -InputObject ([ordered]@{ responses = @($Responses) }) -Depth 20), $utf8)
}
Set-Mock @()

$port = 8573
$script:Srv = $null
function Start-TestServer {
    $env:AGENT_STORE_DIR = $storeDir; $env:AGENT_ENV_DIR = $envdir; $env:AGENT_MOCK_RESPONSES_FILE = $mockFile
    $script:Srv = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $root 'serve.ps1') + '"'), '-Port', $port) -PassThru -WindowStyle Hidden
    Remove-Item Env:\AGENT_STORE_DIR, Env:\AGENT_ENV_DIR, Env:\AGENT_MOCK_RESPONSES_FILE -ErrorAction SilentlyContinue
    foreach ($i in 1..40) { Start-Sleep -Milliseconds 500; if ((Http 'GET' '/api/status').status -eq 200) { return $true } }
    return $false
}
function Stop-TestServer {
    if ($script:Srv) {
        foreach ($c in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($script:Srv.Id)" -ErrorAction SilentlyContinue)) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $script:Srv.Id -Force -ErrorAction SilentlyContinue
        $script:Srv = $null
    }
}
function Http([string]$Method, [string]$Path, $Body = $null, [hashtable]$Headers = @{}) {
    $p = @{ Uri = "http://localhost:$port$Path"; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30; Headers = $Headers }
    if ($null -ne $Body) { $p['Body'] = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 8 -Compress)); $p['ContentType'] = 'application/json' }
    try { $r = Invoke-WebRequest @p; return @{ status = [int]$r.StatusCode; text = $r.Content } }
    catch { $code = 0; $txt = ''; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode; try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $txt = $sr.ReadToEnd() } catch { } }; return @{ status = $code; text = $txt } }
}
function J($r) { return ($r.text | ConvertFrom-Json) }
function Submit-Request([string]$Issue, [string]$Priority = 'Medium') { return (J (Http 'POST' '/api/agent/tenant/submit' @{ issue = $Issue; priority = $Priority })) }
function Wait-Run($S, [string]$RunId = $null) {
    if (-not $RunId) { $RunId = $S.run_id }
    if (-not $RunId) { return $null }
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        $q = J (Http 'GET' "/api/agent/tenant/result?run_id=$RunId&conversation_id=$($S.conversation_id)" $null @{ 'X-Conversation-Token' = $S.tenant_token })
        if ($q.status -cne 'running') { return $q }
    }
    return $null
}
function Send-Message($S, [string]$Text) { return (J (Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $S.conversation_id; text = $Text } @{ 'X-Conversation-Token' = $S.tenant_token })) }
function Get-Transcript($S) { return (J (Http 'GET' "/api/agent/tenant/conversation?id=$($S.conversation_id)" $null @{ 'X-Conversation-Token' = $S.tenant_token })).messages }
function Get-ManagerConv($S) { return @((J (Http 'GET' "/api/agent/manager/conversations?ticket_id=$($S.ticket_id)")).conversations)[0] }
function Get-Proposals([string]$Ticket) { return @((J (Http 'GET' '/api/agent/manager/proposals')).proposals | Where-Object { $_.ticket_id -ceq $Ticket }) }
function Decide([string]$PropId, [string]$Decision, [string]$Note = '') { $b = @{ proposal_id = $PropId; decision = $Decision }; if ($Note) { $b['note'] = $Note }; return (Http 'POST' '/api/agent/manager/proposals/decide' $b) }
function Mark-Applied([string]$PropId) { return (Http 'POST' '/api/agent/manager/proposals/applied' @{ proposal_id = $PropId }) }
function Get-StoredTicket([string]$Ticket) { return (@((J (Http 'GET' '/api/agent/manager/submitted-tickets')).tickets) | Where-Object { $_.row.id -ceq $Ticket })[0] }

function Begin-Scenario([string]$Title, [string]$What) {
    $script:Checks = @()
    $script:Md.Add("## $Title"); $script:Md.Add(''); $script:Md.Add($What); $script:Md.Add('')
}
function Add-Transcript($Messages, [string]$Label = 'What the tenant sees') {
    $script:Md.Add("**$Label**"); $script:Md.Add('')
    foreach ($m in $Messages) {
        $who = $(if ($m.role -ceq 'tenant') { 'Tenant' } else { 'Assistant' })
        $src = $(if ($m.PSObject.Properties['source'] -and $m.source -ceq 'failsafe') { ' (fixed safety message from the server)' } else { '' })
        $script:Md.Add("- $who$src" + ': ' + ($m.text -replace "`r?`n", ' '))
    }
    $script:Md.Add('')
}
function Add-ProposalLine($P) {
    $f = @($P.proposed_fields.PSObject.Properties | ForEach-Object { $v = $_.Value; if ($v -is [array]) { $v = ($v -join '/') }; "$($_.Name)=$v" }) -join '; '
    $rc = $(if ($P.reply_check) { 'reply check: ' + $(if (@($P.reply_check.claimed_but_not_delivered).Count) { 'NOT delivered: ' + (@($P.reply_check.claimed_but_not_delivered) -join ', ') } else { 'clean' }) + ' (' + $P.reply_check.reply_source + ')' } else { 'no reply check' })
    $script:Md.Add("- Proposal [$($P.status)] $f. Why: $($P.reason) ($rc)")
}
function End-Scenario {
    $script:Md.Add('**Checks**'); $script:Md.Add('')
    foreach ($c in $script:Checks) { $script:Md.Add($c) }
    $script:Md.Add('')
}

$SAFE_GAS = 'Please leave right now without touching any switches or appliances, and call 911 from outside. Once you are safe, contact your property manager.'
try {
    Assert (Start-TestServer) 'the test server started'
    $script:Checks = @()

    # ---------------------------------------------------------------- S1 ordinary request, approve, mark applied
    Section 'S1 ordinary request through to a manager decision'
    Begin-Scenario 'S1. An ordinary request, a follow-up, and the manager approving the proposal' 'A tenant submits a dishwasher problem. The assistant replies on its own, drafts a routine proposal, the tenant answers a question, the manager approves and marks the proposal applied. The server never changes the ticket itself.'
    Set-Mock @(
        (New-Draft 't1' @{ ai_urgency = 'Routine'; ai_handling_status = 'Waiting for Tenant'; notes = 'Tenant reports the dishwasher is not draining; the water stands in the bottom.' } 'New report: dishwasher not draining, water contained inside the appliance.'),
        (New-MockMsg 'Hi! I am your AI Maintenance Assistant. Please run the kitchen sink for about 30 seconds. Does the water drain normally?'),
        (New-MockMsg 'Thanks. Since the sink drains well, the dishwasher itself is the likely cause. Please wait about 20 minutes after your last cycle before looking at the filter. Is the dishwasher running right now?')
    )
    $s1 = Submit-Request 'My dishwasher is not draining and there is water standing in the bottom.' 'High'
    $r1 = Wait-Run $s1
    Assert (($s1.ticket_id -cmatch '^HV-1\d\d$') -and $s1.chat_available -and $r1.status -ceq 'done') 'a submitted request becomes a new demo ticket and the assistant replies without the tenant typing anything'
    $m2 = Send-Message $s1 'The sink drains fine.'
    $r1b = Wait-Run $s1 $m2.run_id
    $t1 = @(Get-Transcript $s1)
    Assert (($t1.Count -eq 4) -and ($t1[0].role -ceq 'tenant') -and ($t1[1].role -ceq 'assistant') -and ($t1[2].text -ceq 'The sink drains fine.') -and ($t1[3].role -ceq 'assistant')) 'the transcript is request, reply, answer, reply'
    $p1 = @(Get-Proposals $s1.ticket_id)
    Assert (($p1.Count -eq 1) -and ($p1[0].status -ceq 'pending') -and ($p1[0].proposed_fields.ai_handling_status -ceq 'Waiting for Tenant')) 'exactly one pending proposal was drafted'
    Add-Transcript $t1
    $tk0 = Get-StoredTicket $s1.ticket_id
    $d1 = Decide $p1[0].id 'approve' 'Looks right.'
    $tk1 = Get-StoredTicket $s1.ticket_id
    Assert (($d1.status -eq 200) -and ((Get-Proposals $s1.ticket_id)[0].status -ceq 'approved')) 'the manager approves the proposal'
    Assert (((ConvertTo-Json $tk0 -Depth 6 -Compress) -ceq (ConvertTo-Json $tk1 -Depth 6 -Compress)) -and ($tk1.row.status -ceq 'New') -and ($tk1.row.priority -ceq 'High')) 'approving changes nothing on the stored ticket (priority and status untouched)'
    Assert ((Decide $p1[0].id 'approve').status -eq 409) 'a second decision on the same proposal is refused (409)'
    $ap = Mark-Applied $p1[0].id
    Assert (($ap.status -eq 200) -and ((Get-Proposals $s1.ticket_id)[0].status -ceq 'applied')) 'the manager side marks an approved proposal as applied'
    Assert ((Mark-Applied $p1[0].id).status -eq 409) 'marking it applied twice is refused (409)'
    $script:Md.Add('**What the manager sees**'); $script:Md.Add('')
    Add-ProposalLine (Get-Proposals $s1.ticket_id)[0]
    $script:Md.Add('')
    End-Scenario

    # ---------------------------------------------------------------- S2 gas emergency
    Section 'S2 gas emergency'
    Begin-Scenario 'S2. A gas smell: troubleshooting is replaced by the fixed safety message' 'The scripted model wrongly answers a gas report with pilot-light troubleshooting and drafts a proposal that claims safety instructions were given. The server replaces the reply and records what the tenant really received.'
    Set-Mock @(
        (New-Draft 't2' @{ ai_urgency = 'Emergency'; summary = 'Tenant reports a gas smell near the furnace. Emergency instructions given: leave, avoid switches, call 911, contact the property manager.' } 'Path C: suspected gas leak.'),
        (New-MockMsg 'Let us check the pilot light. Please remove the front panel and relight it.')
    )
    $s2 = Submit-Request 'I smell gas in the kitchen near the furnace.' 'Urgent'
    $null = Wait-Run $s2
    $t2 = @(Get-Transcript $s2)
    $mc2 = Get-ManagerConv $s2
    Assert (($t2.Count -eq 2) -and ($t2[1].text -like '*911*') -and ($t2[1].text -like '*leave*') -and ($t2[1].text -like '*switches*') -and ($t2[1].text -notlike '*pilot*') -and ($t2[1].text -notlike '*panel*')) 'the troubleshooting reply never reaches the tenant; the fixed safety message does'
    Assert (($mc2.messages[1].source -ceq 'failsafe') -and (@($mc2.trace | Where-Object { $_.event -ceq 'failsafe_reply' }).Count -eq 1)) 'the manager can see that the message was a server replacement, and why'
    $p2 = @(Get-Proposals $s2.ticket_id)
    Assert (($p2.Count -eq 1) -and ($p2[0].proposed_fields.ai_urgency -ceq 'Emergency') -and ($p2[0].proposed_fields.emergency_flag -eq $true) -and ($p2[0].proposed_fields.ai_handling_status -ceq 'Escalated')) 'one pending Emergency proposal with the flag and Escalated'
    Assert (($p2[0].reply_check.reply_source -ceq 'failsafe') -and (@($p2[0].reply_check.claimed_but_not_delivered).Count -eq 0)) 'the reply check compares the claims with the fixed message the tenant received (all delivered)'
    Add-Transcript $t2
    $script:Md.Add('**What the manager sees**'); $script:Md.Add(''); Add-ProposalLine $p2[0]; $script:Md.Add('')
    End-Scenario

    # ---------------------------------------------------------------- S3 smoke, S4 shock
    Section 'S3 and S4 other emergencies'
    Begin-Scenario 'S3. Smoke from an outlet' 'A model reply that tells the tenant to reset a breaker is replaced by the smoke safety message.'
    Set-Mock @((New-MockMsg 'Let us try resetting the breaker and unplugging everything on that wall.'))
    $s3 = Submit-Request 'There is smoke coming out of the kitchen outlet.' 'Urgent'
    $null = Wait-Run $s3
    $t3 = @(Get-Transcript $s3)
    Assert (($t3[1].text -like '*911*') -and ($t3[1].text -like '*out*') -and ($t3[1].text -notlike '*breaker*') -and ($t3[1].text -notmatch '(?i)notified|dispatched')) 'smoke: leave and 911, no breaker advice, no claim that anyone was notified'
    Add-Transcript $t3
    End-Scenario
    Begin-Scenario 'S4. An electrical shock' 'A reply that suggests unplugging the machine is replaced by the stay-away message.'
    Set-Mock @((New-MockMsg 'Please unplug the washing machine and check the cord for damage.'))
    $s4 = Submit-Request 'I got an electric shock from the washing machine.' 'Urgent'
    $null = Wait-Run $s4
    $t4 = @(Get-Transcript $s4)
    Assert (($t4[1].text -like '*stay away*') -and ($t4[1].text -like '*911*') -and ($t4[1].text -notlike '*unplug*')) 'shock: stay away and 911, no DIY advice'
    Add-Transcript $t4
    End-Scenario

    # ---------------------------------------------------------------- S5 water near electrical, model answer kept
    Section 'S5 water near a light fixture'
    Begin-Scenario 'S5. Water coming through a ceiling light' 'The emergency guard covers only clear gas, fire, CO and shock reports. For water near a fixture the model decides; here the scripted reply gives safety guidance and is kept as written.'
    Set-Mock @((New-Draft 't5' @{ ai_urgency = 'Emergency'; summary = 'Water coming through a ceiling light fixture.' } 'Water near electrical equipment is an emergency.'), (New-MockMsg 'Please stay away from the light and anything electrical in that room, and do not touch any switch. If you see sparks or smell burning, leave and call 911. Please contact your property manager.'))
    $s5 = Submit-Request 'Water is dripping out of the ceiling light in the hallway.' 'Urgent'
    $null = Wait-Run $s5
    $mc5 = Get-ManagerConv $s5
    Assert (($mc5.messages[1].source -ceq 'model') -and ($mc5.messages[1].text -like '*stay away*')) 'the model''s own safety answer is delivered as written (no replacement)'
    $p5 = @(Get-Proposals $s5.ticket_id)
    Assert (($p5.Count -eq 1) -and ($p5[0].proposed_fields.emergency_flag -eq $true)) 'the Emergency proposal is still drafted and flagged'
    Add-Transcript @(Get-Transcript $s5)
    End-Scenario

    # ---------------------------------------------------------------- S6 tenant confirms fixed, S7 reject
    Section 'S6 resolved with confirmation and S7 rejection'
    Begin-Scenario 'S6. The tenant confirms it is fixed' 'The proposal to resolve the ticket carries the tenant''s confirmation; the manager approves it. (The dashboard applies it to the demo ticket in the browser; the server only records the decision.)'
    Set-Mock @(
        (New-MockMsg 'Hi! Please try the key again and tell me what happens.'),
        (New-Draft 't6' @{ status = 'Resolved'; ai_handling_status = 'Completed'; notes = 'Tenant says the lock works now.' } 'Tenant confirmed the lock works.' $true),
        (New-MockMsg 'Wonderful, I am glad it works now.')
    )
    $s6 = Submit-Request 'The front door lock is sticking and the key barely turns.' 'Low'
    $null = Wait-Run $s6
    $m6 = Send-Message $s6 'It works now, thank you!'
    $null = Wait-Run $s6 $m6.run_id
    $p6 = @(Get-Proposals $s6.ticket_id)
    Assert (($p6.Count -eq 1) -and ($p6[0].proposed_fields.status -ceq 'Resolved') -and ($p6[0].tenant_confirmed_resolution -eq $true)) 'a Resolved proposal exists and carries the tenant''s confirmation'
    Assert ((Decide $p6[0].id 'approve').status -eq 200) 'the manager approves it'
    Assert ((Get-StoredTicket $s6.ticket_id).row.status -ceq 'New') 'the server did not change the ticket status'
    Add-Transcript @(Get-Transcript $s6)
    $script:Md.Add('**What the manager sees**'); $script:Md.Add(''); Add-ProposalLine (Get-Proposals $s6.ticket_id)[0]; $script:Md.Add('')
    End-Scenario
    Begin-Scenario 'S7. The manager rejects a proposal' 'A rejected proposal keeps the manager''s note, changes nothing, and cannot be applied afterwards.'
    Set-Mock @((New-Draft 't7' @{ notes = 'Tenant reports a squeaky balcony door.' } 'Low priority note.'), (New-MockMsg 'Hi! Please check whether anything is stuck in the track.'))
    $s7 = Submit-Request 'The balcony door squeaks when it slides.' 'Low'
    $null = Wait-Run $s7
    $p7 = @(Get-Proposals $s7.ticket_id)
    $rj = Decide $p7[0].id 'reject' 'Not needed.'
    $p7b = (Get-Proposals $s7.ticket_id)[0]
    Assert (($rj.status -eq 200) -and ($p7b.status -ceq 'rejected') -and ($p7b.decision_note -ceq 'Not needed.')) 'rejecting stores the decision and the note'
    Assert (((Mark-Applied $p7[0].id).status -eq 409) -and ((Decide $p7[0].id 'approve').status -eq 409)) 'a rejected proposal can be neither applied nor approved afterwards (409)'
    Add-Transcript @(Get-Transcript $s7)
    $script:Md.Add('**What the manager sees**'); $script:Md.Add(''); Add-ProposalLine $p7b; $script:Md.Add('')
    End-Scenario

    # ---------------------------------------------------------------- S8 assistant off then resumed
    Section 'S8 assistant switched off, then resumed'
    Begin-Scenario 'S8. The assistant is switched off when the request is submitted' 'The request is still saved as a ticket with its conversation. After the assistant is switched on, the tenant''s page can resume the conversation and the reply arrives; the request is not duplicated.'
    [System.IO.File]::WriteAllText($envFile, $envOff)
    $s8 = Submit-Request 'The kitchen faucet is dripping all the time.' 'Medium'
    Assert (($s8.ticket_id -cmatch '^HV-1\d\d$') -and $s8.conversation_id -and ($s8.chat_available -eq $false) -and ($s8.chat_error -ceq 'assistant_off') -and ($null -eq $s8.run_id)) 'with the assistant off the ticket and conversation are saved and the answer says so'
    Assert (@(Get-Transcript $s8).Count -eq 1) 'the request is stored as the tenant message; no reply was invented'
    [System.IO.File]::WriteAllText($envFile, $envOn)
    Set-Mock @((New-MockMsg 'Hi! Sorry for the wait. Is the faucet dripping from the spout or from the base?'))
    $rs = J (Http 'POST' '/api/agent/tenant/resume' @{ conversation_id = $s8.conversation_id } @{ 'X-Conversation-Token' = $s8.tenant_token })
    $null = Wait-Run $s8 $rs.run_id
    $t8 = @(Get-Transcript $s8)
    Assert (($t8.Count -eq 2) -and ($t8[0].role -ceq 'tenant') -and ($t8[1].role -ceq 'assistant')) 'resuming answers the saved request once (no duplicate tenant message)'
    Add-Transcript $t8
    End-Scenario

    # ---------------------------------------------------------------- S9 restart persistence, S10 expiry, S11 busy, S12 isolation
    Section 'S9 to S12 persistence, expiry, a busy conversation and isolation'
    Begin-Scenario 'S9. The server is restarted' 'Tickets, conversations and proposals are plain files, so a restarted server shows the same data and the tenant''s saved session still works.'
    $before9 = (J (Http 'GET' '/api/agent/manager/proposals')).proposals.Count
    Stop-TestServer
    Assert (Start-TestServer) 'the server restarted'
    $after9 = (J (Http 'GET' '/api/agent/manager/proposals')).proposals.Count
    Assert (($after9 -eq $before9) -and ($after9 -ge 5)) 'all proposals are still there after the restart'
    Assert ((@(Get-Transcript $s1).Count -eq 4) -and ((Get-StoredTicket $s1.ticket_id).row.issue -like 'My dishwasher*')) 'a tenant session saved before the restart still reads its conversation, and the ticket is still known'
    End-Scenario
    Begin-Scenario 'S10. A conversation disappears' 'If the stored conversation is gone, the tenant''s calls are refused (the page then asks for a new request) while the ticket stays.'
    $conv10 = Join-Path (Join-Path $storeDir 'conversations') ($s7.conversation_id + '.json')
    [System.IO.File]::Delete($conv10)
    Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s7.conversation_id)" $null @{ 'X-Conversation-Token' = $s7.tenant_token }).status -eq 403) 'reading a removed conversation is refused (403)'
    Assert ((Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $s7.conversation_id; text = 'Hello' } @{ 'X-Conversation-Token' = $s7.tenant_token }).status -eq 403) 'sending to a removed conversation is refused (403)'
    Assert ($null -ne (Get-StoredTicket $s7.ticket_id)) 'the ticket itself is still there'
    End-Scenario
    Begin-Scenario 'S11. A second message while a reply is being prepared' 'Only one reply is prepared at a time per conversation.'
    Set-Mock @((New-MockMsg 'Hi! Please tell me more about the sticking.' $null 3500), (New-MockMsg 'Thanks.'))
    $s11 = Submit-Request 'The bedroom window will not close fully.' 'Low'
    $busy = Send-Message $s11 'Also the latch is bent.'
    $busyRaw = Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $s11.conversation_id; text = 'Also the latch is bent.' } @{ 'X-Conversation-Token' = $s11.tenant_token }
    Assert ($busyRaw.status -eq 409) 'a message sent while a reply is being prepared is refused (409)'
    $null = Wait-Run $s11
    End-Scenario
    Begin-Scenario 'S12. One tenant cannot read another tenant''s conversation' 'A conversation can be read only with its own token.'
    Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s1.conversation_id)" $null @{ 'X-Conversation-Token' = $s2.tenant_token }).status -eq 403) 'another conversation''s token is refused (403)'
    Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s1.conversation_id)").status -eq 403) 'no token is refused (403)'
    End-Scenario
}
finally {
    Stop-TestServer
}

Section 'final checks'
$script:Checks = @()
$demoAfter = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
Assert ($demoBefore -ceq $demoAfter) 'demo/ files are byte-identical after the scenarios'
$realAfter = @(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data') -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($root.Length) + $_.Length + $_.LastWriteTimeUtc.Ticks }) -join ','
Assert ($realBefore -ceq $realAfter) 'the real agent-data/ was not touched (the scenarios ran in a temporary store)'

# write the transcript file (no ids, tokens, keys or timestamps)
$head = @(
    '# Scenario transcripts (mocked model, free)',
    '',
    'Generated by `agent\tests\Test-AgentScenarios.ps1` on every run. The assistant''s words here are **scripted test text**: this file records what the **server** does with them (guards, fixed safety messages, proposals, manager decisions, persistence), through the same HTTP routes the tenant portal and the dashboard use. It contains no ids, tokens, keys or timestamps. How the real model behaves is recorded only by the approved live tests (see `agent/FINAL_LIVE_TEST_PLAN.md`).',
    ''
)
$mdText = (($head + $script:Md) -join "`n") + "`n"
$leak = @('sk-ant', 'X-Conversation-Token', 'tenant_token', 'NOTAREALKEY', 'conv-2', 'prop-2', 'run-2') | Where-Object { $mdText.Contains($_) }
Assert ($leak.Count -eq 0) ('the transcript file contains no key, token or id' + $(if ($leak.Count) { ': ' + ($leak -join ', ') }))
$outDir = Join-Path $root 'agent\scenarios'
[void][System.IO.Directory]::CreateDirectory($outDir)
[System.IO.File]::WriteAllText((Join-Path $outDir 'SCENARIOS.md'), $mdText, $utf8)
Start-Sleep -Milliseconds 500
try { [System.IO.Directory]::Delete($tmp, $true) } catch { }

Write-Host ''
Write-Host "RESULT: $($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { Write-Host ('Failed: ' + ($script:Failures -join '; ')); exit 1 }

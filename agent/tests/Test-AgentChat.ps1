# Stage 6.1 tests: the tenant chat page code (agent-chat.js, agent-chat.css, the guarded loader in tenant.html) and the server contract
# it relies on (submit a request, restore, expired conversation, wrong token, files served). NO real API call and NO API key: the model
# is a scripted mock file, the server runs on a test port with a temporary store. The browser behavior (submit, hidden chat, switch to
# the chat, restore, mid-run reload, expired session, unreachable server, phone width) was exercised in the in-app browser against the
# same kind of mocked server.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File agent\tests\Test-AgentChat.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

$script:Pass = 0; $script:Fail = 0; $script:Failures = @()
function Assert([bool]$Cond, [string]$Name) { if ($Cond) { $script:Pass++ } else { $script:Fail++; $script:Failures += $Name; Write-Host "  FAIL: $Name" -ForegroundColor Red } }
function Section([string]$T) { Write-Host "== $T" }

$js = [System.IO.File]::ReadAllText((Join-Path $root 'agent-chat.js'))
$css = [System.IO.File]::ReadAllText((Join-Path $root 'agent-chat.css'))
$html = [System.IO.File]::ReadAllText((Join-Path $root 'tenant.html'))
$demoBefore = (Get-ChildItem (Join-Path $root 'demo') -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
$realTicketsBefore = @(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data\tickets') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + $_.Length }) -join ','
$realConvBefore = @(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data\conversations') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + $_.Length + $_.LastWriteTimeUtc.Ticks }) -join ','

Section 'agent-chat.js: demo only, no key, no HTML injection, session storage only, tenant routes only'
Assert ($js -match '(?m)^\s*if \(!/\[\?&\]demo=1\(&\|\$\)/\.test\(location\.search\)\) return;') 'the script does nothing unless the page was opened with ?demo=1'
foreach ($bad in 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("', "setTimeout('") {
    Assert (-not $js.Contains($bad)) "agent-chat.js does not use $bad"
}
Assert (-not $js.Contains('localStorage')) 'no localStorage (the conversation token is kept in sessionStorage only)'
Assert ($js.Contains('sessionStorage.setItem(SESSION_KEY') -and $js.Contains('sessionStorage.getItem(SESSION_KEY') -and $js.Contains('sessionStorage.removeItem(SESSION_KEY')) 'the session is saved, read and cleared in sessionStorage'
Assert (($js -notmatch '(?i)sk-ant|x-api-key|api\.anthropic\.com|ANTHROPIC|anthropic-version') -and ($js -notmatch '(?i)api[_-]?key')) 'no API key, key header or Anthropic address in the browser code'
Assert (($js -notmatch '(?i)webhook|hook\.eu1\.make\.com|api\.airtable\.com')) 'the chat code never mentions or calls Make or Airtable'
Assert (-not ($js -match '(?i)manager')) 'the chat code never calls a manager route'
$paths = @([regex]::Matches($js, '"(/api/agent/[^"?]*)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
Assert (($paths.Count -ge 6) -and (@($paths | Where-Object { $_ -notmatch '^/api/agent/(status|tenant/(submit|resume|start|message|result|conversation))$' }).Count -eq 0)) ('the only server routes used are status and the tenant routes (' + ($paths -join ', ') + ')')
$fetches = @([regex]::Matches($js, 'fetch\(([^,)]+)') | ForEach-Object { $_.Groups[1].Value.Trim() } | Select-Object -Unique)
Assert (($fetches.Count -eq 1) -and ($fetches -contains 'path')) 'the only fetch is the API helper (no other URL is requested)'
Assert ($js -match 'headers\["X-Conversation-Token"\] = token') 'the token is sent in a header'
Assert (-not ($js -match '(?i)[?&]token=')) 'the token is never put in a URL'
Assert (-not ($js -match 'console\.(log|info|debug)')) 'nothing is written to the console'
Assert (($js -match 'RX_CONV') -and ($js -match 'RX_TOKEN') -and ($js -match 'RX_RUN') -and ($js -match 'RX_TICKET')) 'ids and the token are checked against a strict pattern before use'
Assert (@([regex]::Matches($js, 'textContent')).Count -ge 10) 'server text is placed with textContent'
Assert (($js -match 'function expired\(\)') -and ($js -match 'r\.status === 403 \|\| r\.status === 404\) \{\s*expired\(\)') -and ($js -match 'clearSession\(\);\s*if \(ui\.log\) ui\.log\.textContent = ""')) 'a 403 or 404 on restore or send clears the saved session and shows the request form again'
Assert ($js -match 'pending_run_id') 'an unfinished reply is resumed after a reload'
Assert (($js -match 'forbidden\+\+;\s*if \(forbidden >= 3\) \{ expired\(\); return; \}') -and ($js -match 'forbidden = 0;')) 'while polling, one stray 403 is retried; only a repeated refusal ends the session'
Assert ($js -match 'TEXT_MAX = 2000') 'the message limit matches the server (2000)'

Section 'agent-chat.js: the new flow (hidden chat, request replaces the form, no ticket picker, recovery)'
Assert (($js -match 'section\.hidden = true') -and ($js -match 'if \(ui\.section\) return;') -and ($js -notmatch 'getElementById\("chat-ticket"\)|chat-start|<select')) 'the chat is built hidden and only when first needed; there is no ticket picker'
Assert ($js -match 'window\.addEventListener\("submit"[\s\S]{0,400}stopImmediatePropagation\(\)[\s\S]{0,300}\}, true\);') 'the submit is intercepted in the capture phase, before the portal handler, so a demo request never goes to Make'
Assert ($js -match 'if \(mode === "unknown"\)') 'a submit is held while the demo server has not answered yet'
Assert (($js -match 'mode = "none"') -and ($js -match 'mode === "none"\) return')) 'without a demo server the portal behaves exactly as before'
Assert ($js -match '"/api/agent/tenant/submit"') 'the request goes to the local submit route'
Assert (($js -match 'form\.classList\.add\("demo-hidden"\)') -and ($js -match 'form\.classList\.remove\("demo-hidden"\)')) 'the request form is hidden when the chat opens and shown again for another request'
Assert (($js -match '"Maintenance Support"') -and -not ($js -match 'Ask the AI')) 'the title is the subtle "Maintenance Support"'
Assert (($js -match 'Try the assistant again') -and ($js -match '/api/agent/tenant/resume') -and ($js -match 'Your request is saved')) 'when the assistant cannot start the saved request is confirmed and a retry is offered'
Assert (($js -match 'r\.status === 400\) showFormMessage') -and ($js -match 'Your request was not submitted')) 'a failed submit keeps the form and says the request was not submitted'
Assert ($js -match 'SERVER_DOWN') 'an unreachable server gets a clear message'

Section 'tenant.html and the stylesheet'
Assert ($html -notmatch '<script[^>]+src="agent-chat\.js"') 'agent-chat.js is not a static script tag (it is only added when ?demo=1)'
Assert (($html -match 'if \(!/\[\?&\]demo=1\(&\|\$\)/\.test\(location\.search\)\) return;') -and $html.Contains('agent-chat.css') -and $html.Contains('agent-chat.js')) 'the loader returns before requesting anything without ?demo=1'
Assert ($html.Contains('<script src="tenant.js"></script>') -and $html.Contains('id="request-form"') -and $html.Contains('id="admin-toggle"')) 'the request form, admin toggle and tenant.js are still there'
Assert (-not ($html -match 'innerHTML|sk-ant|ANTHROPIC')) 'no key or HTML injection in tenant.html'
& git -C $root diff --quiet HEAD -- tenant.js tenant.css 2>$null
Assert ($LASTEXITCODE -eq 0) 'tenant.js and tenant.css are unchanged in git'
Assert ($css.Contains('.demo-hidden') -and $css.Contains('.chat')) 'the chat styles are scoped to .chat and .demo-hidden'
Assert (-not ($css -match '(?m)^(body|html|main|\.card|\.btn)\b')) 'the chat stylesheet does not restyle the existing portal'

Section 'Stage 6.2 manager view: agent-manager.js and the demo dashboard hooks (read-only, demo and localhost only)'
$mjs = [System.IO.File]::ReadAllText((Join-Path $root 'agent-manager.js'))
$mcss = [System.IO.File]::ReadAllText((Join-Path $root 'agent-manager.css'))
$idx = [System.IO.File]::ReadAllText((Join-Path $root 'index.html'))
$app = [System.IO.File]::ReadAllText((Join-Path $root 'app.js'))
Assert (($mjs -match 'if \(!/\[\?&\]demo\(=\|&\|\$\)/\.test\(location\.search\)\) return;') -and ($mjs -match 'if \(!/\^\(localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]\)\$/\.test\(location\.hostname\)\) return;')) 'the manager view does nothing without ?demo or off localhost'
foreach ($bad in 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function') { Assert (-not $mjs.Contains($bad)) "agent-manager.js does not use $bad" }
Assert (-not ($mjs -match '(?i)method\s*:|\bPOST\b|\bPUT\b|\bDELETE\b|\bPATCH\b|/proposals|/decide|/applied')) 'the manager view only reads: no request method, no proposal, decision or apply route'
$mpaths = @([regex]::Matches($mjs, '"(/api/agent/[^"?]*)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
Assert ((@($mpaths | Where-Object { $_ -notmatch '^/api/agent/(status|manager/conversations)$' }).Count -eq 0) -and ($mpaths.Count -eq 2)) ('the manager view uses only the status and conversations routes (' + ($mpaths -join ', ') + ')')
Assert (($mjs -notmatch '(?i)\.usd|input_tokens|output_tokens|cache_read|cache_write|spend|system_prompt|tenant_token|api[_-]?key|sk-ant|anthropic')) 'costs, token counts, prompts and keys are never read or shown'
Assert (-not ($mjs -match '(?i)\.input\b|tool_result|\.result\b')) 'tool inputs and results are not shown (only tool names and outcomes)'
Assert ($mjs.Contains('e.textContent = text') -and $mjs.Contains('createTextNode')) 'server text is placed with textContent and text nodes only'
Assert (($mjs -notmatch 'localStorage') -and ($mjs -notmatch 'sessionStorage')) 'the manager view stores nothing in the browser'
Assert (($idx -notmatch '<script[^>]+src="agent-(manager|proposals)\.js"') -and ($idx -match '"agent-manager", "agent-proposals"') -and ($idx -match '\[\?&\]demo\(=\|&\|\$\)') -and ($idx -match '\(localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]\)')) 'index.html adds agent-manager and agent-proposals only in demo mode on localhost (no static script tag)'
Assert (($app -match 'if \(DEMO_MODE && window\.AgentManagerDemo\) window\.AgentManagerDemo\.decorate\(row, body\);') -and ($app -match 'async function fetchPortalTickets\(\) \{\s*if \(!/\^\(localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]\)\$/\.test\(location\.hostname\)\) return \[\];')) 'the dashboard hooks are demo-only and the portal-ticket request is made only on localhost'
Assert (($app -match 'fetch\("/api/agent/manager/submitted-tickets"') -and (@([regex]::Matches($app, '/api/agent/')).Count -eq 1)) 'app.js makes exactly one agent request (the list of portal tickets)'
Assert (-not ($mcss -match '(?m)^(body|html|main|\.card|\.btn|table|tr|td|th)\b') -and ($mcss -notmatch '#[0-9a-fA-F]{3,6}')) 'the manager stylesheet is scoped and uses the dashboard colour variables'

Section 'Stage 6.3 proposals panel: agent-proposals.js (read-only, demo and localhost only)'
$pjs = [System.IO.File]::ReadAllText((Join-Path $root 'agent-proposals.js'))
$pcss = [System.IO.File]::ReadAllText((Join-Path $root 'agent-proposals.css'))
Assert (($pjs -match 'if \(!/\[\?&\]demo\(=\|&\|\$\)/\.test\(location\.search\)\) return;') -and ($pjs -match 'if \(!/\^\(localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]\)\$/\.test\(location\.hostname\)\) return;')) 'the proposals panel does nothing without ?demo or off localhost'
foreach ($bad in 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function') { Assert (-not $pjs.Contains($bad)) "agent-proposals.js does not use $bad" }
Assert (-not ($pjs -match '(?i)method\s*:|\bPOST\b|\bPUT\b|\bDELETE\b|\bPATCH\b|/decide|/applied')) 'the proposals panel only reads: no request method, no decide or apply route'
$ppaths = @([regex]::Matches($pjs, '"(/api/agent/[^"?]*)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
Assert ((@($ppaths | Where-Object { $_ -notmatch '^/api/agent/(status|manager/proposals)$' }).Count -eq 0) -and ($ppaths.Count -eq 2)) ('the proposals panel uses only the status and proposals routes (' + ($ppaths -join ', ') + ')')
Assert (-not ($pjs -match '(?i)approve\w*\(|reject\w*\(|decision\s*:|\.decide|Approve"|Reject"|Apply"')) 'the panel has no approve, reject or apply control'
Assert (($pjs -notmatch '(?i)\.usd|input_tokens|output_tokens|cache_read|cache_write|spend|system_prompt|tenant_token|api[_-]?key|sk-ant|anthropic')) 'costs, token counts, prompts and keys are never read or shown'
Assert (($pjs -notmatch 'localStorage') -and ($pjs -notmatch 'sessionStorage')) 'the proposals panel stores nothing in the browser'
Assert ($pjs.Contains('e.textContent = text') -and $pjs.Contains('createTextNode')) 'server text is placed with textContent and text nodes only'
Assert (($pjs -match 'claimed_but_not_delivered') -and ($pjs -match 'Check before relying on this proposal')) 'a claim the tenant reply did not contain is shown as a warning'
Assert (($pjs -match 'isEmergency\(a\) \? 0 : 1') -and ($pjs -match 'agent-pp-card--emergency')) 'emergency proposals are listed first and marked'
Assert (($pjs -match 'not stored on the ticket') -and ($pjs -match 'this ticket is not in the dashboard')) 'each proposal is compared with the ticket''s current values, with a clear note when there is none'
Assert (($pjs -match 'role", "alert"') -and ($pjs -match 'aria-modal')) 'the emergency banner is an alert and the panel is a modal dialog'
Assert (-not ($pcss -match '(?m)^(body|html|main|\.card|\.btn|table|tr|td|th)\b') -and ($pcss -notmatch '#[0-9a-fA-F]{3,6}\b(?!.*#fff)' -or $pcss -match 'color: #fff;')) 'the proposals stylesheet is scoped'
Section 'HTTP through serve.ps1 (test port, temporary store, mocked model): the contract the chat relies on'
$tmp = Join-Path $env:TEMP ('agent-chat-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$envdir = Join-Path $tmp 'env'
[void][System.IO.Directory]::CreateDirectory($envdir)
$KEY = 'sk-ant-fake-NOTAREALKEYNOTAREALKEY1234567890'
[System.IO.File]::WriteAllText((Join-Path $envdir '.env'), "ANTHROPIC_API_KEY=$KEY`nAGENT_LIVE_ENABLED=1`nAGENT_MODEL=haiku`nAGENT_RETRY_DELAY_MS=0`n")
$mockFile = Join-Path $tmp 'mock.json'
$mockBody = [ordered]@{ responses = @([ordered]@{ id = 'msg_t'; type = 'message'; role = 'assistant'; model = 'claude-haiku-5-5'; content = @(@{ type = 'text'; text = 'Hi! Please run the kitchen sink. Does it drain?' }); stop_reason = 'end_turn'; usage = [ordered]@{ input_tokens = 1000; output_tokens = 100 } }) }
[System.IO.File]::WriteAllText($mockFile, (ConvertTo-Json -InputObject $mockBody -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
$storeDir = Join-Path $tmp 'store'
$port = 8571
$env:AGENT_STORE_DIR = $storeDir; $env:AGENT_ENV_DIR = $envdir; $env:AGENT_MOCK_RESPONSES_FILE = $mockFile
$srv = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $root 'serve.ps1') + '"'), '-Port', $port) -PassThru -WindowStyle Hidden
function Http([string]$Method, [string]$Path, $Body = $null, [hashtable]$Headers = @{}) {
    $p = @{ Uri = "http://localhost:$port$Path"; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30; Headers = $Headers }
    if ($null -ne $Body) { $p['Body'] = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 8 -Compress)); $p['ContentType'] = 'application/json' }
    try { $r = Invoke-WebRequest @p; return @{ status = [int]$r.StatusCode; text = $r.Content; type = [string]$r.Headers['Content-Type'] } }
    catch { $code = 0; $txt = ''; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode; try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $txt = $sr.ReadToEnd() } catch { } }; return @{ status = $code; text = $txt; type = '' } }
}
$issue = 'My dishwasher is not draining and there is water standing in the bottom.'
try {
    $up = $false
    foreach ($i in 1..40) { Start-Sleep -Milliseconds 500; if ((Http 'GET' '/api/status').status -eq 200) { $up = $true; break } }
    Assert $up 'the server started on the test port'
    if ($up) {
        $x = Http 'GET' '/agent-chat.js'
        Assert (($x.status -eq 200) -and ($x.type -like 'application/javascript*') -and ($x.text -like '*dashboardPractice.agentChat.v1*')) 'agent-chat.js is served as JavaScript'
        $x = Http 'GET' '/agent-chat.css'
        Assert (($x.status -eq 200) -and ($x.type -like 'text/css*')) 'agent-chat.css is served as CSS'
        $x = Http 'GET' '/tenant.html'
        Assert (($x.status -eq 200) -and ($x.text -like '*agent-chat.js*')) 'tenant.html carries the guarded loader'

        # submit a request: a new demo ticket, a conversation about it, and the assistant's first reply
        $x = Http 'POST' '/api/agent/tenant/submit' @{ issue = $issue; priority = 'High' }
        $s = $x.text | ConvertFrom-Json
        Assert (($x.status -eq 200) -and ($s.ticket_id -cmatch '^HV-1\d\d$') -and ($s.conversation_id -cmatch '^conv-\d{14}-[0-9a-f]{8}$') -and ($s.tenant_token -cmatch '^[A-Za-z0-9_-]{32}$') -and ($s.run_id -cmatch '^run-\d{14}-[0-9a-f]{8}$') -and ($s.chat_available -eq $true) -and ($null -eq $s.chat_error)) 'submit returns the new ticket, a conversation with a token, a started reply run and no error'
        Assert (($s.priority -ceq 'High') -and ($s.category -ceq 'Appliance')) 'the ticket keeps the chosen priority and gets a category from the text'
        $ticketFile = Join-Path (Join-Path $storeDir 'tickets') ("tkt-$($s.ticket_id).json")
        $tf = $(if (Test-Path -LiteralPath $ticketFile) { [System.IO.File]::ReadAllText($ticketFile) | ConvertFrom-Json } else { $null })
        Assert (($null -ne $tf) -and ($tf.row.issue -ceq $issue) -and ($tf.row.status -ceq 'New') -and (@($tf.extra.equipment_ids) -contains 'eq-hv-dishwasher')) 'the ticket is stored in the agent store with the issue text, status New and the dishwasher linked'
        $csvNow = [System.IO.File]::ReadAllText((Join-Path $root 'demo\tickets.csv'))
        Assert (-not $csvNow.Contains($s.ticket_id)) 'the ticket is not written into demo/tickets.csv'
        $h = @{ 'X-Conversation-Token' = $s.tenant_token }
        $final = $null; $deadline = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
            $q = Http 'GET' "/api/agent/tenant/result?run_id=$($s.run_id)&conversation_id=$($s.conversation_id)" $null $h
            $qj = $q.text | ConvertFrom-Json
            if ($qj.status -cne 'running') { $final = $qj; break }
        }
        Assert (($null -ne $final) -and ($final.status -ceq 'done') -and ($final.reply -like 'Hi!*')) 'the assistant starts the conversation: the first reply arrives through polling without the tenant sending anything'
        $x = Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null $h
        $cv = $x.text | ConvertFrom-Json
        Assert ((@($cv.messages).Count -eq 2) -and ($cv.messages[0].role -ceq 'tenant') -and ($cv.messages[0].text -ceq $issue) -and ($cv.messages[1].role -ceq 'assistant') -and ($x.text -notlike '*tenant_token*')) 'a restored conversation starts with the submitted request as the tenant message, then the reply, and never shows the token'
        Assert (((@($cv.messages[0].PSObject.Properties.Name)) -join ',') -ceq 'ts,role,text') 'the tenant view shows only time, role and text'
        $x = Http 'GET' "/api/agent/manager/conversations?ticket_id=$($s.ticket_id)"
        Assert (($x.status -eq 200) -and ($x.text -like "*$($s.conversation_id)*") -and ($x.text -like '*submitted_ticket*')) 'the server knows the new ticket (the manager route lists the conversation) and records how the conversation began'

        # Stage 6.2: the manager's side of the same ticket
        $x = Http 'GET' '/agent-manager.js'
        Assert (($x.status -eq 200) -and ($x.type -like 'application/javascript*')) 'agent-manager.js is served as JavaScript'
        $x = Http 'GET' '/agent-manager.css'
        Assert (($x.status -eq 200) -and ($x.type -like 'text/css*')) 'agent-manager.css is served as CSS'
        $x = Http 'GET' '/agent-proposals.js'
        Assert (($x.status -eq 200) -and ($x.type -like 'application/javascript*')) 'agent-proposals.js is served as JavaScript'
        $x = Http 'GET' '/agent-proposals.css'
        Assert (($x.status -eq 200) -and ($x.type -like 'text/css*')) 'agent-proposals.css is served as CSS'
        $x = Http 'GET' '/api/agent/manager/proposals?status=pending'
        Assert (($x.status -eq 200) -and (($x.text | ConvertFrom-Json).PSObject.Properties.Name -contains 'proposals') -and ($x.text -notlike '*sk-ant*') -and ($x.text -notlike '*tenant_token*')) 'the pending proposals route answers with a proposals list and no key or token'
        Assert ((Http 'GET' '/api/agent/manager/proposals?status=nonsense').status -eq 400) 'an unknown proposal status is refused (400)'
        $x = Http 'GET' '/api/agent/manager/submitted-tickets'
        $stj = $x.text | ConvertFrom-Json
        $mine = @($stj.tickets | Where-Object { $_.row.id -ceq $s.ticket_id })
        Assert (($x.status -eq 200) -and ($mine.Count -eq 1) -and ($mine[0].row.issue -ceq $issue) -and ($mine[0].row.status -ceq 'New') -and ($mine[0].details.portal_submitted -eq $true) -and (@($mine[0].details.equipment_ids).Count -eq 1) -and ($mine[0].details.equipment_ids[0] -ceq 'eq-hv-dishwasher')) 'the manager list returns the submitted ticket with a flat equipment list and the portal flag'
        Assert (($x.text -notlike '*tenant_token*') -and ($x.text -notlike "*$($s.tenant_token)*") -and ($x.text -notlike '*sk-ant*')) 'the manager list never contains a conversation token or a key'
        $x = Http 'GET' "/api/agent/manager/conversations?ticket_id=$($s.ticket_id)"
        $mc = $x.text | ConvertFrom-Json
        $c0 = @($mc.conversations)[0]
        Assert (($x.status -eq 200) -and (@($mc.conversations).Count -eq 1) -and (@($c0.messages).Count -eq 2) -and ($c0.messages[1].source -ceq 'model') -and ($c0.origin -ceq 'submitted_ticket') -and ($x.text -notlike '*tenant_token*') -and ($x.text -notlike '*sk-ant*')) 'the manager sees the conversation with the message sources and no token or key'
        Assert ((Http 'GET' '/api/agent/manager/conversations?ticket_id=HV-999').status -eq 404) 'the manager route says not found for a ticket the server does not know'

        # validation, origins and limits
        Assert ((Http 'POST' '/api/agent/tenant/submit' @{ issue = 'bad'; priority = 'High' }).status -eq 400) 'a too-short problem description is refused (400)'
        Assert ((Http 'POST' '/api/agent/tenant/submit' @{ issue = $issue; priority = 'Critical' }).status -eq 400) 'an unknown priority is refused (400)'
        Assert ((Http 'POST' '/api/agent/tenant/submit' @{ issue = $issue; priority = 'High' } @{ Origin = 'http://evil.example' }).status -eq 403) 'a submit from a foreign origin is refused (403)'
        $x = Http 'POST' '/api/agent/tenant/submit' @{ issue = 'I smell gas in the kitchen near the furnace.'; priority = 'Urgent' }
        $g = $x.text | ConvertFrom-Json
        Assert (($x.status -eq 200) -and ($g.category -ceq 'HVAC')) 'a gas report becomes a ticket too (the emergency handling is the same as in any conversation)'

        # expired or invalid sessions
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null @{ 'X-Conversation-Token' = ('A' * 32) }).status -eq 403) 'a wrong token is refused (403)'
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)").status -eq 403) 'no token is refused (403)'
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=conv-20200101000000-00000000" $null $h).status -eq 403) 'an unknown conversation id with a valid-looking token is refused (403)'
        Assert ((Http 'GET' "/api/agent/tenant/result?run_id=run-20200101000000-00000000&conversation_id=$($s.conversation_id)" $null $h).status -eq 404) 'a run that no longer exists is 404 (the chat then re-reads the transcript)'
        Assert ((Http 'POST' '/api/agent/tenant/resume' @{ conversation_id = $s.conversation_id } @{}).status -eq 403) 'resume without the token is refused (403)'
        Assert ((Http 'POST' '/api/agent/tenant/resume' @{ conversation_id = $s.conversation_id } $h).status -eq 409) 'resume when the last message already has a reply is refused (409)'
        $conversationFile = Join-Path (Join-Path $storeDir 'conversations') ($s.conversation_id + '.json')
        [System.IO.File]::Delete($conversationFile)
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null $h).status -eq 403) 'after the stored conversation is removed, restore is refused (403), which the chat treats as expired'
        Assert ((Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $s.conversation_id; text = 'Hello' } $h).status -eq 403) 'after the stored conversation is removed, sending is refused (403)'
        Assert ((Http 'POST' '/api/agent/tenant/start' @{ ticket_id = $s.ticket_id }).status -eq 200) 'a new conversation can still be started for the saved ticket (the recovery path)'
        Assert ((Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-999' }).status -eq 404) 'starting on an unknown ticket is refused (404)'
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
Assert ($realTicketsBefore -ceq (@(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data\tickets') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + $_.Length }) -join ',')) 'the real agent-data/tickets received no test ticket'
Start-Sleep -Milliseconds 500
try { [System.IO.Directory]::Delete($tmp, $true) } catch { }

Write-Host ''
Write-Host "RESULT: $($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { Write-Host ('Failed: ' + ($script:Failures -join '; ')); exit 1 }

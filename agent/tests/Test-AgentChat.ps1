# Stage 6.1 tests: the tenant chat page code (agent-chat.js, agent-chat.css, the guarded loader in tenant.html) and the server contract
# it relies on (start, restore, expired conversation, wrong token, files served). NO real API call and NO API key: the model is a
# scripted mock file, the server runs on a test port with a temporary store. The browser behavior (start, restore, mid-run reload,
# expired session, unreachable server, phone width) was exercised in the in-app browser against the same mocked server.
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
$realConvBefore = @(Get-ChildItem -LiteralPath (Join-Path $root 'agent-data\conversations') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + $_.Length + $_.LastWriteTimeUtc.Ticks }) -join ','

Section 'agent-chat.js: demo only, no key, no HTML injection, session storage only, tenant routes only'
Assert ($js -match '(?m)^\s*if \(!/\[\?&\]demo=1\(&\|\$\)/\.test\(location\.search\)\) return;') 'the script does nothing unless the page was opened with ?demo=1'
foreach ($bad in 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("', "setTimeout('") {
    Assert (-not $js.Contains($bad)) "agent-chat.js does not use $bad"
}
Assert (-not $js.Contains('localStorage')) 'no localStorage (the conversation token is kept in sessionStorage only)'
Assert ($js.Contains('sessionStorage.setItem(SESSION_KEY') -and $js.Contains('sessionStorage.getItem(SESSION_KEY') -and $js.Contains('sessionStorage.removeItem(SESSION_KEY')) 'the session is saved, read and cleared in sessionStorage'
Assert (($js -notmatch '(?i)sk-ant|x-api-key|api\.anthropic\.com|ANTHROPIC|anthropic-version') -and ($js -notmatch '(?i)api[_-]?key')) 'no API key, key header or Anthropic address in the browser code'
Assert (-not ($js -match '(?i)manager')) 'the chat code never calls a manager route'
$paths = @([regex]::Matches($js, '"(/api/agent/[^"?]*)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
Assert (($paths.Count -ge 4) -and (@($paths | Where-Object { $_ -notmatch '^/api/agent/(status|tenant/(start|message|result|conversation))$' }).Count -eq 0)) ('the only server routes used are status and the four tenant routes (' + ($paths -join ', ') + ')')
$fetches = @([regex]::Matches($js, 'fetch\(([^,)]+)') | ForEach-Object { $_.Groups[1].Value.Trim() } | Select-Object -Unique)
Assert (($fetches -contains 'path') -and ($fetches -contains '"demo/tickets.csv"') -and ($fetches.Count -eq 2)) 'the only fetch targets are the API helper and the static demo ticket list'
Assert ($js -match 'headers\["X-Conversation-Token"\] = token') 'the token is sent in a header'
Assert (-not ($js -match '(?i)[?&]token=')) 'the token is never put in a URL'
Assert (-not ($js -match 'console\.(log|info|debug)')) 'nothing is written to the console'
Assert (($js -match 'RX_CONV') -and ($js -match 'RX_TOKEN') -and ($js -match 'RX_RUN') -and ($js -match 'RX_TICKET')) 'ids and the token are checked against a strict pattern before use'
Assert (@([regex]::Matches($js, 'textContent')).Count -ge 10) 'server text is placed with textContent'
Assert (($js -match 'status === 403 \|\| r\.status === 404\) \{\s*expired\(\)') -and ($js -match 'function expired\(\)') -and ($js -match 'clearSession\(\);\s*ui\.log\.textContent = ""')) 'a 403 or 404 on restore or send clears the saved session and returns to the start screen'
Assert ($js -match 'pending_run_id') 'an unfinished reply is resumed after a reload'
Assert ($js -match 'TEXT_MAX = 2000') 'the message limit matches the server (2000)'

Section 'tenant.html: the portal is unchanged except for one guarded loader'
Assert ($html -notmatch '<script[^>]+src="agent-chat\.js"') 'agent-chat.js is not a static script tag (it is only added when ?demo=1)'
Assert (($html -match 'if \(!/\[\?&\]demo=1\(&\|\$\)/\.test\(location\.search\)\) return;') -and $html.Contains('agent-chat.css') -and $html.Contains('agent-chat.js')) 'the loader returns before requesting anything without ?demo=1'
Assert ($html.Contains('<script src="tenant.js"></script>') -and $html.Contains('id="request-form"') -and $html.Contains('id="admin-toggle"')) 'the request form, admin toggle and tenant.js are still there'
Assert (-not ($html -match 'innerHTML|sk-ant|ANTHROPIC')) 'no key or HTML injection in tenant.html'
& git -C $root diff --quiet HEAD -- tenant.js tenant.css 2>$null
Assert ($LASTEXITCODE -eq 0) 'tenant.js and tenant.css are unchanged in git'
Assert ($css.Contains('#agent-chat') -or $css.Contains('.chat')) 'the chat styles are scoped to .chat'
Assert (-not ($css -match '(?m)^(body|html|main|\.card|\.btn)\b')) 'the chat stylesheet does not restyle the existing portal'

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
try {
    $up = $false
    foreach ($i in 1..40) { Start-Sleep -Milliseconds 500; if ((Http 'GET' '/api/status').status -eq 200) { $up = $true; break } }
    Assert $up 'the server started on the test port'
    if ($up) {
        $x = Http 'GET' '/agent-chat.js'
        Assert (($x.status -eq 200) -and ($x.type -like 'application/javascript*') -and ($x.text -like '*dashboardPractice.agentChat.v1*')) 'agent-chat.js is served as JavaScript'
        $x = Http 'GET' '/agent-chat.css'
        Assert (($x.status -eq 200) -and ($x.type -like 'text/css*')) 'agent-chat.css is served as CSS'
        $x = Http 'GET' '/demo/tickets.csv'
        Assert (($x.status -eq 200) -and ($x.text -like 'id,date_created,property,tenant,issue,category,priority,status,*') -and ($x.text -like '*HV-010*')) 'the demo ticket list the chat reads is served'
        $x = Http 'GET' '/tenant.html'
        Assert (($x.status -eq 200) -and ($x.text -like '*agent-chat.js*')) 'tenant.html carries the guarded loader'

        # start and restore
        $x = Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-010' }
        $s = $x.text | ConvertFrom-Json
        Assert (($x.status -eq 200) -and ($s.conversation_id -cmatch '^conv-\d{14}-[0-9a-f]{8}$') -and ($s.tenant_token -cmatch '^[A-Za-z0-9_-]{32}$')) 'start returns a conversation id and a 32-character token matching the patterns the chat checks'
        $h = @{ 'X-Conversation-Token' = $s.tenant_token }
        $x = Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null $h
        $cv = $x.text | ConvertFrom-Json
        Assert (($x.status -eq 200) -and (@($cv.messages).Count -eq 0) -and ($x.text -notlike '*tenant_token*')) 'restore with the token returns an empty transcript and never the token'
        $x = Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $s.conversation_id; text = 'My dishwasher is not draining.' } $h
        $runId = ($x.text | ConvertFrom-Json).run_id
        Assert (($x.status -eq 200) -and ($runId -cmatch '^run-\d{14}-[0-9a-f]{8}$')) 'a message returns a run id matching the pattern the chat checks'
        $final = $null; $deadline = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
            $q = Http 'GET' "/api/agent/tenant/result?run_id=$runId&conversation_id=$($s.conversation_id)" $null $h
            $qj = $q.text | ConvertFrom-Json
            if ($qj.status -cne 'running') { $final = $qj; break }
        }
        Assert (($null -ne $final) -and ($final.status -ceq 'done') -and ($final.reply -like 'Hi!*')) 'the reply arrives through polling'
        $x = Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null $h
        $cv = $x.text | ConvertFrom-Json
        Assert ((@($cv.messages).Count -eq 2) -and ($cv.messages[0].role -ceq 'tenant') -and ($cv.messages[1].role -ceq 'assistant') -and (((@($cv.messages[0].PSObject.Properties.Name)) -join ',') -ceq 'ts,role,text')) 'a restored conversation has the tenant and assistant messages, with only time, role and text'

        # expired or invalid sessions
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null @{ 'X-Conversation-Token' = ('A' * 32) }).status -eq 403) 'a wrong token is refused (403)'
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)").status -eq 403) 'no token is refused (403)'
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=conv-20200101000000-00000000" $null $h).status -eq 403) 'an unknown conversation id with a valid-looking token is refused (403)'
        Assert ((Http 'GET' "/api/agent/tenant/result?run_id=run-20200101000000-00000000&conversation_id=$($s.conversation_id)" $null $h).status -eq 404) 'a run that no longer exists is 404 (the chat then re-reads the transcript)'
        $conversationFile = Join-Path (Join-Path $storeDir 'conversations') ($s.conversation_id + '.json')
        [System.IO.File]::Delete($conversationFile)
        Assert ((Http 'GET' "/api/agent/tenant/conversation?id=$($s.conversation_id)" $null $h).status -eq 403) 'after the stored conversation is removed, restore is refused (403), which the chat treats as expired'
        Assert ((Http 'POST' '/api/agent/tenant/message' @{ conversation_id = $s.conversation_id; text = 'Hello' } $h).status -eq 403) 'after the stored conversation is removed, sending is refused (403)'
        Assert ((Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-010' }).status -eq 200) 'a new conversation can be started after an expired one'
        Assert ((Http 'POST' '/api/agent/tenant/start' @{ ticket_id = 'HV-999' }).status -eq 404) 'starting on an unknown ticket is refused (404), which the chat shows as "not known"'
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
Start-Sleep -Milliseconds 500
try { [System.IO.Directory]::Delete($tmp, $true) } catch { }

Write-Host ''
Write-Host "RESULT: $($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { Write-Host ('Failed: ' + ($script:Failures -join '; ')); exit 1 }

# Part of Test-AgentLoop.ps1 (dot-sourced; shares its helpers and variables).

# ============================================================== live gates and the real HTTP function (fake Invoke-WebRequest)
Section 'live gates: nothing reaches the network unless explicitly enabled; key stays in the one request header'
$script:NetCalls = @()
$script:NetMode = 'fail'
$script:NetReply = ''
function Invoke-WebRequest {
    param($Uri, $Method, [switch]$UseBasicParsing, $TimeoutSec, $Body, $ContentType, $Headers)
    $script:NetCalls += [pscustomobject]@{ Uri = $Uri; Method = $Method; Key = $Headers['x-api-key']; Version = $Headers['anthropic-version']; Body = $Body; ContentType = $ContentType }
    if ($script:NetMode -ceq 'ok') { return [pscustomobject]@{ RawContentStream = (New-Object System.IO.MemoryStream (, [System.Text.Encoding]::UTF8.GetBytes($script:NetReply))) } }
    throw (New-Object System.Exception('The operation has timed out'))
}
$mockTransport = Get-AgentTransport
Set-AgentTransport $null
$cg = NewConv
$r = Turn $cg 'The dishwasher is not draining.' @{ ANTHROPIC_API_KEY = ''; AGENT_LIVE_ENABLED = '0' }
Assert ($r.source -ceq 'failsafe' -and $r.error_code -ceq 'not_configured') 'no key and live disabled: fail-safe reply, not_configured'
Assert ($script:NetCalls.Count -eq 0) 'no network call is attempted without a key'
$r = Turn (NewConv) 'The dishwasher is not draining.' @{ AGENT_LIVE_ENABLED = '0' }
Assert ($r.error_code -ceq 'not_configured' -and $script:NetCalls.Count -eq 0) 'a key without AGENT_LIVE_ENABLED=1 still makes no network call'
$r = Turn (NewConv) 'The dishwasher is not draining.' @{ ANTHROPIC_API_KEY = 'not-a-real-key' }
Assert ($r.error_code -ceq 'not_configured' -and $script:NetCalls.Count -eq 0) 'a malformed key makes no network call'
$r = Turn (NewConv) 'The dishwasher is not draining.' @{ AGENT_MODEL = 'claude-opus-5-5' }
Assert ($r.source -ceq 'failsafe' -and $script:NetCalls.Count -eq 0) 'an unsupported model makes no network call'
$script:NetMode = 'ok'
$script:NetReply = (ConvertTo-Json -InputObject ([ordered]@{ id = 'msg_x'; type = 'message'; role = 'assistant'; content = @(@{ type = 'text'; text = 'Hi from the fake API.' }); stop_reason = 'end_turn'; usage = @{ input_tokens = 10; output_tokens = 5 } }) -Depth 6)
$cl = NewConv
$r = Turn $cl 'The dishwasher is not draining.' @{ AGENT_RETRIES = '0' }
Assert ($script:NetCalls.Count -eq 1 -and $r.reply -ceq 'Hi from the fake API.' -and $r.source -ceq 'model') 'with key and live enabled the real HTTP function sends one request and parses the reply'
$nc = $script:NetCalls[0]
Assert (($nc.Uri -ceq 'https://api.anthropic.com/v1/messages') -and ($nc.Method -ceq 'Post')) 'the request goes only to api.anthropic.com /v1/messages'
Assert (($nc.Key -ceq $KEY) -and ($nc.Version -ceq '2023-06-01') -and ($nc.ContentType -like 'application/json*')) 'key in x-api-key, API version and content type are set'
$sent = [System.Text.Encoding]::UTF8.GetString($nc.Body)
Assert (-not $sent.Contains($KEY)) 'the key is not inside the request body'
Assert ((($sent | ConvertFrom-Json).model) -ceq 'claude-haiku-5-5') 'body names the configured model'
$script:NetMode = 'fail'
$r = Turn (NewConv) 'The dishwasher is not draining.' @{ AGENT_RETRIES = '0' }
Assert ($r.source -ceq 'failsafe' -and $r.error_code -ceq 'timeout') 'a timed-out request becomes a fail-safe reply (timeout)'
Set-AgentTransport $mockTransport
Reset-Spend

# ============================================================== request shape, simple turn, spend ledger
Section 'request shape and a simple turn'
$c1 = NewConv
Queue @((Resp @(T 'Hi! I''m your AI Maintenance Assistant. Please run the kitchen sink for about 30 seconds. Does the water drain normally?')))
$r = Turn $c1 'My dishwasher is not draining.'
$req = $script:Requests[0]
Assert ($r.ok -and $r.source -ceq 'model' -and $r.reply -like 'Hi!*') 'a normal turn returns the model reply'
Assert (($req.model -ceq 'claude-haiku-5-5') -and ($req.max_tokens -eq 4096)) 'model id and max_tokens come from the settings'
Assert (($req.system[0].text -ceq (Get-SystemPrompt).text) -and ($req.system[0].cache_control.type -ceq 'ephemeral')) 'system prompt is base plus addendum, with a cache breakpoint'
Assert ((@($req.tools).Count -eq 5) -and ((@($req.tools | ForEach-Object { $_.name }) -join ',') -ceq ($script:ToolNames -join ','))) 'all five tools are declared'
Assert (@($req.tools | Where-Object { $null -ne $_.PSObject.Properties['strict'] }).Count -eq 0) 'no strict flag (our own validation applies)'
Assert (($req.messages[0].role -ceq 'user') -and ($req.messages[@($req.messages).Count - 1].role -ceq 'user')) 'conversation starts and ends with a user turn (no prefill)'
foreach ($bad in 'temperature', 'top_p', 'top_k', 'tool_choice', 'thinking', 'output_config') { Assert ($null -eq $req.PSObject.Properties[$bad]) "request has no $bad by default" }
Assert ((@(Msgs $c1).Count -eq 2) -and ((LastMsg $c1).source -ceq 'model')) 'tenant and assistant messages are stored (source model)'
$tv = Get-ConversationView -ConversationId $c1 -Audience 'tenant'
Assert (((Keys $tv.data.messages[1]) -join ',') -ceq 'ts,role,text') 'tenant view shows only time, role and text'
$ledger = Get-SpendTotals
Assert ([Math]::Abs($ledger.total_usd - 0.0002) -lt 0.000001) 'spend ledger records 1000 in + 200 out on Haiku 5.5 as 0.0002 USD'
$mc = @(Trace $c1 | Where-Object { $_.event -ceq 'model_call' })
Assert (($mc.Count -eq 1) -and ($mc[0].input_tokens -eq 1000) -and ($mc[0].output_tokens -eq 200) -and ($mc[0].purpose -ceq 'agent')) 'manager trace records the model call and its usage'
Queue @((Resp @(T 'ok')))
[void](Turn (NewConv) 'hello' @{ AGENT_MODEL = 'sonnet'; AGENT_EFFORT = 'low' })
Assert (($script:Requests[0].model -ceq 'claude-sonnet-5-5') -and ($script:Requests[0].output_config.effort -ceq 'low')) 'model and effort are configurable'
Assert ([Math]::Abs((Get-UsageCostUsd 'claude-sonnet-5-5' ([pscustomobject]@{ input_tokens = 1000; output_tokens = 200 })) - 0.004) -lt 0.0000001) 'Sonnet 5.5 pricing: 1000 in + 200 out = 0.004'
Assert ([Math]::Abs((Get-UsageCostUsd 'claude-haiku-5-5' ([pscustomobject]@{ input_tokens = 200000; output_tokens = 1000 })) - (200000 * 0.5 / 1e6 + 1000 * 2.5 / 1e6)) -lt 0.0000001) 'Haiku 5.5 uses the long-prompt rate card above 100K tokens'

# ============================================================== tool loop
Section 'tool-use loop: tools run, results go back to the model only'
Reset-Spend
$c2 = NewConv
Queue @(
    (Resp @((Th), (T 'Let me look.'), (Tu 'toolu_1' 'get_ticket_details' @{}), (Tu 'toolu_2' 'get_equipment_manual_guidance' @{ equipment_id = 'eq-hv-dishwasher'; question = 'dishwasher not draining' })) 'tool_use'),
    (Resp @((T 'Hi! I''m your AI Maintenance Assistant. Let''s start with one simple check: please run the kitchen sink for about 30 seconds. Does it drain normally?')))
)
$r = Turn $c2 'My dishwasher is not draining.'
Assert ($r.ok -and ($r.tool_rounds -eq 1) -and ($r.model_calls -eq 2) -and ($script:Requests.Count -eq 2)) 'two model calls with one tool round'
$m2 = @($script:Requests[1].messages)
Assert (($m2.Count -eq 3) -and ($m2[1].role -ceq 'assistant') -and ($m2[2].role -ceq 'user')) 'second request appends the assistant turn and one user turn of results'
Assert (($m2[1].content[0].type -ceq 'thinking') -and ($m2[1].content[0].signature -ceq 'SIG_ABC123') -and ($m2[1].content[0].thinking -ceq '')) 'the thinking block is sent back unmodified (empty text kept)'
Assert ((@($m2[2].content).Count -eq 2) -and ($m2[2].content[0].tool_use_id -ceq 'toolu_1') -and ($m2[2].content[1].tool_use_id -ceq 'toolu_2')) 'all tool results travel in a single user message with matching ids'
Assert (($m2[2].content[0].content -like '*"ok":true*') -and ($m2[2].content[0].content -like '*HV-010*') -and ($m2[2].content[0].is_error -eq $false)) 'the ticket result reaches the model'
Assert (($m2[2].content[1].content -like '*series_or_general*') -and ($m2[2].content[1].content -like '*49-4000239*')) 'the manual result (with scope label) reaches the model'
Assert (($r.reply -notlike '*49-4000239*') -and ($r.reply -notlike '*"ok"*') -and ($r.reply -notlike '*HV-010*')) 'tool results do not appear in the tenant reply'
$tr = Trace $c2
Assert ((@($tr | Where-Object { $_.tool -ceq 'get_ticket_details' -and $_.ok -eq $true }).Count -eq 1) -and (@($tr | Where-Object { $_.tool -ceq 'get_equipment_manual_guidance' }).Count -eq 1)) 'tool calls are traced for the manager'
Assert (@($tr | Where-Object { $_.event -ceq 'model_call' }).Count -eq 2) 'both model calls are traced'
$tvAll = (ConvertTo-Json (Get-ConversationView -ConversationId $c2 -Audience 'tenant') -Depth 8)
Assert (($tvAll -notlike '*toolu_*') -and ($tvAll -notlike '*do_not_offer*') -and ($tvAll -notlike '*SIG_ABC123*')) 'the tenant view contains no tool data or thinking signature'

Section 'tool failures'
$c3 = NewConv
Queue @(
    (Resp @((T 'checking'), (Tu 'toolu_a' 'delete_everything' @{}), (Tu 'toolu_b' 'get_ticket_details' @{ ticket_id = 'HV-009' }), (Tu 'toolu_c' 'get_equipment_info' @{ equipment_id = '../x' }), (Tu 'toolu_d' 'get_equipment_info' @{ equipment_id = 'eq-hv-dishwasher'; extra = 1 }), (Tu 'toolu_e' 'get_ticket_details' 'oops')) 'tool_use'),
    (Resp @((T 'Thanks. Could you tell me a little more about what you are seeing?')))
)
$r = Turn $c3 'Something is wrong with my dishwasher.'
$res = @($script:Requests[1].messages[2].content)
Assert ($r.ok -and ($r.source -ceq 'model') -and ($res.Count -eq 5)) 'every failed tool call still gets a result and the turn continues'
Assert (@($res | Where-Object { $_.is_error -eq $true }).Count -eq 5) 'all five failures are marked is_error'
Assert (($res[0].content -like '*unknown_tool*') -and ($res[1].content -like '*not_available*') -and ($res[2].content -like '*invalid_input*') -and ($res[3].content -like '*invalid_input*') -and ($res[4].content -like '*invalid_input*')) 'error codes: unknown tool, unauthorized id, malformed id, extra property, wrong input type'
Assert ($res[1].content -notlike '*160*') 'the unauthorized ticket result carries no ticket data (no cost)'
Assert ((Msgs $c3).Count -eq 2) 'failed tools did not add or remove conversation messages'

# ============================================================== limits
Section 'limits: tool rounds, time, spend, input size, stop reasons'
Reset-Spend
$cr = NewConv
Queue @(1..6 | ForEach-Object { (Resp @((Tu "toolu_r$_" 'get_ticket_details' @{})) 'tool_use') })
$r = Turn $cr 'Question.' @{ AGENT_MAX_TOOL_ROUNDS = '2' }
Assert (($r.source -ceq 'failsafe') -and ($r.error_code -ceq 'tool_round_limit') -and ($script:Requests.Count -eq 3) -and ($script:Q.Count -eq 3)) 'tool rounds are capped (2 rounds, third request refused, no more calls)'
Reset-Spend
$ct = NewConv
Queue @({ param($b) Start-Sleep -Milliseconds 5600; return (Resp @((Tu 'toolu_t1' 'get_ticket_details' @{})) 'tool_use') }, (Resp @((T 'never reached'))))
$r = Turn $ct 'Question.' @{ AGENT_MAX_RUN_SECONDS = '5' }
Assert (($r.source -ceq 'failsafe') -and ($r.error_code -ceq 'run_time_limit') -and ($script:Requests.Count -eq 1)) 'the run time limit stops further calls'
Reset-Spend
Queue @((Resp @((T 'x'))))
$r = Turn (NewConv) 'Question.' @{ AGENT_RUN_SPEND_USD = '0.00001' }
Assert (($r.error_code -ceq 'run_spend_limit') -and ($script:Requests.Count -eq 0)) 'per-run spend limit refuses the call before it is made'
Reset-Spend
Add-SpendEntry 'claude-haiku-5-5' 'x' 'test' $null 0.0099
Queue @((Resp @((T 'x'))))
$r = Turn (NewConv) 'Question.' @{ AGENT_DAILY_SPEND_USD = '0.01' }
Assert (($r.error_code -ceq 'daily_spend_limit') -and ($script:Requests.Count -eq 0)) 'daily spend limit refuses the call'
$r = Turn (NewConv) 'Question.' @{ AGENT_TOTAL_SPEND_USD = '0.01'; AGENT_DAILY_SPEND_USD = '5' }
Assert (($r.error_code -ceq 'total_spend_limit') -and ($script:Requests.Count -eq 0)) 'total spend limit refuses the call'
Reset-Spend
Queue @((Resp @((T 'x'))))
$r = Turn (NewConv) 'Question.' @{ AGENT_MAX_INPUT_TOKENS = '2000' }
Assert (($r.error_code -ceq 'input_too_large') -and ($script:Requests.Count -eq 0)) 'input token limit refuses an oversized request'
Reset-Spend
Queue @((Resp @((T 'cut off')) 'max_tokens'))
$r = Turn (NewConv) 'Question.'
Assert (($r.error_code -ceq 'reply_truncated') -and ($r.source -ceq 'failsafe') -and ($r.reply -notlike '*cut off*')) 'a truncated reply is not sent to the tenant'
Queue @((Resp @((T 'no')) 'refusal'))
$r = Turn (NewConv) 'Question.'
Assert (($r.error_code -ceq 'model_refusal') -and ($r.source -ceq 'failsafe')) 'a model refusal becomes a fail-safe reply'
Queue @((Resp @((T ('x' * 4100)))))
$r = Turn (NewConv) 'Question.'
Assert (($r.error_code -ceq 'reply_too_long') -and ($r.source -ceq 'failsafe')) 'an over-long reply is not sent'
Queue @((Resp @((T '   '))))
$r = Turn (NewConv) 'Question.'
Assert (($r.error_code -ceq 'empty_reply') -and ($r.source -ceq 'failsafe')) 'an empty reply is replaced'

Section 'API errors and retries'
Reset-Spend
$ce = NewConv
Queue @((E 429 'rate_limit_error'), (Resp @((T 'Sure, what happened?'))))
$r = Turn $ce 'Question.' @{ AGENT_RETRIES = '2' }
Assert (($r.source -ceq 'model') -and ($script:Requests.Count -eq 2) -and ((@(Trace $ce | Where-Object { $_.event -ceq 'model_call' })[0].attempts) -eq 2)) '429 is retried and then succeeds (2 attempts recorded)'
Queue @((E 529 'overloaded_error'), (E 529 'overloaded_error'), (E 529 'overloaded_error'), (Resp @((T 'never'))))
$r = Turn (NewConv) 'Question.' @{ AGENT_RETRIES = '2' }
Assert (($r.error_code -ceq 'overloaded') -and ($script:Requests.Count -eq 3)) 'persistent 529 stops after the configured retries'
Queue @((E 400 'invalid_request_error'), (Resp @((T 'never'))))
$r = Turn (NewConv) 'Question.'
Assert (($r.error_code -ceq 'bad_request') -and ($script:Requests.Count -eq 1)) '400 is not retried'
Queue @((E 401 'authentication_error'), (Resp @((T 'never'))))
$r = Turn (NewConv) 'Question.'
Assert (($r.error_code -ceq 'auth_error') -and ($script:Requests.Count -eq 1) -and ($r.source -ceq 'failsafe')) '401 is not retried'
Queue @((E 0 'timeout'), (E 0 'timeout'), (E 0 'timeout'))
$r = Turn (NewConv) 'Question.' @{ AGENT_RETRIES = '2' }
Assert ($r.error_code -ceq 'timeout') 'repeated timeouts end as a timeout fail-safe'
Assert ((Get-SpendTotals).total_usd -lt 0.0005) 'failed calls add no spend'

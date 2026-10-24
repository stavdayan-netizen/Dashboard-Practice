# Part of Test-AgentLoop.ps1: emergency behavior, fail-safe replies and output guards (all with scripted model responses).

Section 'emergency: safety guidance first, proposal pending, no leakage'
Reset-Spend
$cg1 = NewConv 'HV-004'
Queue @(
    (Resp @((Th), (Tu 'toolu_e1' 'draft_ticket_update' @{ fields = @{ ai_urgency = 'Emergency'; summary = 'Tenant reports a gas smell in the kitchen.' }; reason = 'Path C: suspected gas leak.' })) 'tool_use'),
    (Resp @((T $SAFE_GAS)))
)
$r = Turn $cg1 'I smell gas in the kitchen.'
Assert (($r.source -ceq 'model') -and ($r.reply -ceq $SAFE_GAS)) 'gas smell: the model''s safety message is delivered as written'
$first = @($script:Requests[0].messages)
Assert (($first.Count -eq 1) -and ([string]$first[0].content -like 'CONTEXT FROM THE SYSTEM*') -and ([string]$first[0].content).EndsWith("`n`nI smell gas in the kitchen.")) 'the first model input is the system context followed by the tenant message, nothing asked before it'
$props = @(Get-ProposalList -Audience 'manager' | Where-Object { $_.conversation_id -ceq $cg1 })
Assert (($props.Count -eq 1) -and ($props[0].status -ceq 'pending') -and ($props[0].proposed_fields.emergency_flag -eq $true) -and ($props[0].proposed_fields.ai_handling_status -ceq 'Escalated') -and ($props[0].proposed_fields.ai_urgency -ceq 'Emergency')) 'an Emergency proposal is pending with the flag and Escalated (nothing applied)'
Assert (($r.reply -notlike '*proposal*') -and ($r.reply -notlike '*draft_ticket*')) 'the reply does not mention proposals or tools'
$tool1 = @(Trace $cg1 | Where-Object { $_.tool -ceq 'draft_ticket_update' })
Assert (($tool1.Count -eq 1) -and ($tool1[0].ok -eq $true)) 'the draft call is traced as succeeded'

Section 'emergency: a model reply without safety instructions is replaced'
$cg2 = NewConv 'HV-004'
Queue @((Resp @((T 'Let''s check the pilot light. Please remove the front panel and relight it, then tell me what you see.'))))
$r = Turn $cg2 'I smell gas near the furnace.'
Assert (($r.source -ceq 'failsafe') -and ($r.error_code -ceq 'reply_lacks_emergency_guidance') -and ($r.guards -contains 'emergency_guard:gas')) 'gas smell: a reply that troubleshoots instead of giving safety guidance is replaced'
Assert (($r.reply -like '*911*') -and ($r.reply -like '*leave*') -and ($r.reply -notlike '*pilot*') -and ($r.reply -notlike '*panel*')) 'the replacement tells the tenant to leave and call 911 and offers no troubleshooting'
Assert ((LastMsg $cg2).source -ceq 'failsafe') 'the replacement is stored as a fail-safe message'
$fs = @(Trace $cg2 | Where-Object { $_.event -ceq 'failsafe_reply' })
Assert (($fs.Count -eq 1) -and ($fs[0].kinds -contains 'gas')) 'the manager trace says why the reply was replaced'
Queue @((Resp @((T 'Please leave the area right now without touching any switches or appliances, and call 911 from outside. Do not go back in until responders say it is safe. Once you are safe, contact your property manager.'))))
$r = Turn (NewConv 'HV-004') 'There is a strong gas smell.'
Assert (($r.source -ceq 'model') -and ($r.guards.Count -eq 0)) 'a model reply that already contains safety guidance is kept'

Section 'emergency: a gas reply must also say not to touch or use anything that could spark'
$liveFirst = 'If you have not already left, please leave now. Stay away from the furnace and kitchen, call 911 from outside, and wait for responders before going back in. Once you are safe, contact the property manager.'
Assert (@(Test-ReplyMeetsEmergencyBar @('gas') $liveFirst) -contains 'gas') 'leave + 911 without a "do not touch or use anything" instruction does not meet the gas bar'
Assert (@(Test-ReplyMeetsEmergencyBar @('gas') ($liveFirst + ' Do not touch any switches or use flames.')).Count -eq 0) 'the same reply with the instruction meets the gas bar'
Assert (@(Test-ReplyMeetsEmergencyBar @('gas') 'Leave now and call 911 from outside. Do not go back in until responders say it is safe.') -contains 'gas') '"do not go back in" alone does not count as the no-spark instruction'
foreach ($okText in @($SAFE_GAS, (Get-FailSafeReply @('gas') $null), 'Please leave the building first, and don''t operate anything on the way out. Once you are outside, call 911.', 'Get outside and call 911. Never use a lighter, a match or a phone inside.', 'Leave now and call 911. Avoid flames and sparks.')) {
    Assert (@(Test-ReplyMeetsEmergencyBar @('gas') $okText).Count -eq 0) ('gas bar accepted: ' + (Get-Shortened $okText 60))
}
Assert (@(Test-ReplyMeetsEmergencyBar @('smoke_fire') 'Get out now and call 911 from outside.').Count -eq 0) 'the extra no-spark rule applies to gas only (a fire reply with leave + 911 is fine)'
$cg3 = NewConv 'HV-004'
Queue @((Resp @((T $liveFirst))))
$r = Turn $cg3 'I smell gas in the kitchen near the furnace.'
Assert (($r.source -ceq 'failsafe') -and ($r.guards -contains 'emergency_guard:gas') -and ($r.reply -like '*switches*') -and ($r.reply -like '*911*')) 'a gas reply that leaves out the no-spark instruction is replaced by the fixed safety message'

$liveScript = [System.IO.File]::ReadAllText((Join-Path $root 'agent\Run-LiveTest.ps1'))
$mi = $liveScript.IndexOf('Manual guidance tool used')
Assert (($mi -gt 0) -and $liveScript.Substring([Math]::Max(0, $mi - 400), 400).Contains("if (`$Scenario -cne 'gas')")) 'the live-test report does not show the manual-tool line for the gas scenario'

Section 'emergency: API unavailable still gives safety guidance'
foreach ($case in @(
        @{ text = 'I smell gas in the kitchen.'; want = '911'; also = 'leave' },
        @{ text = 'There''s smoke coming from an outlet.'; want = '911'; also = 'out' },
        @{ text = 'My carbon monoxide alarm is going off.'; want = '911'; also = 'outside' },
        @{ text = 'I got a shock from the washing machine.'; want = '911'; also = 'stay away' },
        @{ text = 'I saw sparks from the wall outlet.'; want = '911'; also = 'stay away' },
        @{ text = 'Water is dripping from the kitchen ceiling light.'; want = '911'; also = 'stay away' }
    )) {
    Queue @((E 529 'overloaded_error'), (E 529 'overloaded_error'), (E 529 'overloaded_error'))
    $r = Turn (NewConv) $case.text @{ AGENT_RETRIES = '2' }
    $ok = ($r.source -ceq 'failsafe') -and ($r.reply -like "*$($case.want)*") -and ($r.reply -like "*$($case.also)*") -and ($r.reply -notmatch '[\*#`]') -and ($r.reply -notmatch '\d{3}-\d{3}-\d{4}|1-800') -and ($r.reply -notmatch '(?i)notified|alerted|dispatched|scheduled')
    Assert $ok "API down, '$($case.text)': plain-text safety message with 911, no invented numbers, no claim of notification"
}
Queue @((E 529 'overloaded_error'), (E 529 'overloaded_error'), (E 529 'overloaded_error'))
$r = Turn (NewConv) 'My dishwasher is not draining.' @{ AGENT_RETRIES = '2' }
Assert (($r.source -ceq 'failsafe') -and ($r.reply -notlike '*911*') -and ($r.reply -like '*property manager*')) 'API down, ordinary request: a calm message without 911'

Section 'emergency: keyword helper edge cases (not an emergency / is an emergency)'
Assert ((Find-EmergencyKinds 'The smoke detector chirps every minute. No smoke, nothing burning.').Count -eq 0) 'a chirping detector with no smoke is not flagged'
Assert ((Find-EmergencyKinds 'I don''t smell gas, I just have no hot water.').Count -eq 0) 'a denied gas smell is not flagged'
Assert ((Find-EmergencyKinds 'The gas stove will not light.').Count -eq 0) 'a gas appliance that will not light is not a gas smell'
Assert ((Find-EmergencyKinds 'My smoke detector chirps and now I smell something burning.') -contains 'smoke_fire') 'a chirping detector plus a burning smell is flagged'
Assert ((Find-EmergencyKinds 'I smell gas and there is no hot water') -contains 'gas') 'a real gas smell next to a "no" is still flagged'
Assert ((Find-EmergencyKinds 'There is a damp patch on the ceiling next to the ceiling light.') -notcontains 'gas') 'a damp ceiling patch is not gas'
Assert ((Find-EmergencyKinds 'water leaking into the ceiling light fixture') -contains 'water_electrical') 'water into a light fixture is flagged as water near electrical'
Queue @((Resp @((T 'Thanks. That is a normal low-battery chirp. Would you like me to continue?'))))
$r = Turn (NewConv) 'The smoke detector chirps every minute. No smoke, nothing burning.'
Assert (($r.source -ceq 'model') -and ($r.guards.Count -eq 0)) 'emergency scenario 8: the chirping detector is handled as an ordinary request (no forced emergency text)'
Queue @((Resp @((T 'That sounds serious. Please do not touch the light or any switches near it. Contact your property manager right away.'))))
$r = Turn (NewConv) 'Water is dripping from the kitchen ceiling light.'
Assert (($r.source -ceq 'model') -and ($r.guards.Count -eq 0)) 'water near a fixture: the model''s own answer is kept (the guard only covers clear gas, fire, CO and shock reports)'
Queue @((Resp @((T 'Try unplugging the machine and checking the breaker, then tell me what happens.'))))
$r = Turn (NewConv) 'I got a shock from the washing machine.'
Assert (($r.source -ceq 'failsafe') -and ($r.reply -like '*stay away*') -and ($r.reply -notlike '*unplug*')) 'a shock report answered with DIY advice is replaced by the safety message'
Queue @((Resp @((T 'Please stay away from the machine and do not touch it or anything electrical nearby. If anyone is hurt, call 911.'))))
$r = Turn (NewConv) 'I got a shock from the washing machine.'
Assert (($r.source -ceq 'model') -and ($r.guards.Count -eq 0)) 'a shock report answered with safety guidance is kept'

Section 'output guards: nothing internal or secret reaches a tenant'
foreach ($leak in @(
        @{ text = 'I called get_ticket_details and found your ticket.'; code = 'reply_blocked_tool_name' },
        @{ text = 'Your proposal_id is prop-123.'; code = 'reply_blocked_internal_marker' },
        @{ text = 'The tool returned {"ok":true,"data":{}}.'; code = 'reply_blocked_internal_marker' },
        @{ text = 'Use this key: sk-ant-fake-abcdefghijklmnop.'; code = 'reply_blocked_credential' },
        @{ text = "Here you go: $KEY"; code = 'reply_blocked_credential' }
    )) {
    Queue @((Resp @((T $leak.text))))
    $r = Turn (NewConv) 'Hello, I have a question about my request.'
    Assert (($r.source -ceq 'failsafe') -and ($r.error_code -ceq $leak.code) -and ($r.reply -notlike '*sk-ant*') -and ($r.reply -notlike '*get_ticket*')) "reply blocked: $($leak.code)"
}
Queue @((Resp @((T "**Hi there!**`n`n# A heading`n- first check`n- second check with ``code``"))))
$r = Turn (NewConv) 'Hello.'
Assert (($r.source -ceq 'model') -and ($r.reply -notmatch '[\*#`]') -and ($r.reply -notmatch '(?m)^\s*-\s')) 'markdown is stripped so the tenant gets plain text'
Assert (($r.reply -like '*Hi there!*') -and ($r.reply -like '*first check*')) 'the words of the reply are kept when markdown is stripped'

Section 'credentials never stored'
$hit = @()
foreach ($f in (Get-ChildItem -LiteralPath $store -Recurse -File)) {
    $t = [System.IO.File]::ReadAllText($f.FullName)
    if ($t.Contains($KEY) -or $t -match 'x-api-key' -or $t -match 'sk-ant-fake') { $hit += $f.Name }
}
Assert ($hit.Count -eq 0) 'no conversation, trace, proposal or spend file contains the key or an API header'
$allTrace = ((Get-ChildItem (Join-Path $store 'conversations') -File | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join ' ')
Assert (-not $allTrace.Contains('NOTAREALKEYNOTAREALKEY')) 'the manager trace never contains key text'

# Part of Test-AgentLoop.ps1: the deterministic emergency proposal fallback, the manual delivery rule and the leak guard for it.

Section 'emergency proposal fallback: drafted by the server only when the emergency check confirms an emergency and no emergency proposal exists'
function EProps([string]$C) { return @(Get-ProposalList -Audience 'manager' | Where-Object { $_.conversation_id -ceq $C }) }
$goodGas = 'Please leave right now without touching any switches or appliances, and call 911 from outside. Once you are safe, contact your property manager.'

# a) the model gave a good safety reply but drafted nothing
$fa = NewConv 'HV-004'
Queue @((Resp @((T $goodGas))))
$r = Turn $fa 'I smell gas in the kitchen near the furnace.'
$pa = @(EProps $fa)
Assert (($r.source -ceq 'model') -and ($r.reply -ceq $goodGas)) 'the tenant''s reply is exactly the model''s safety message (the fallback never touches the reply)'
Assert (($pa.Count -eq 1) -and ($pa[0].status -ceq 'pending') -and ($pa[0].origin -ceq 'server_emergency_fallback')) 'one PENDING proposal is drafted by the server and marked as such'
Assert (($pa[0].proposed_fields.ai_urgency -ceq 'Emergency') -and ($pa[0].proposed_fields.emergency_flag -eq $true) -and ($pa[0].proposed_fields.ai_handling_status -ceq 'Escalated') -and (-not ($pa[0].proposed_fields.PSObject.Properties.Name -contains 'status')) -and (-not ($pa[0].proposed_fields.PSObject.Properties.Name -contains 'priority'))) 'it is an Emergency proposal with the flag and Escalated, and proposes no status or priority'
Assert (($pa[0].proposed_fields.summary -like '*a suspected gas leak*') -and ($pa[0].proposed_fields.summary -like '*no diagnosis has been made*') -and ($pa[0].proposed_fields.notes -ceq 'Tenant''s words: "I smell gas in the kitchen near the furnace."')) 'the text is a fixed template plus the tenant''s own words, nothing invented'
Assert (($pa[0].reason -like '*Drafted by the server, not by the assistant*') -and ($pa[0].reason -like '*the assistant''s safety message*')) 'the reason says it was the server and what the tenant received'
Assert (@($pa[0].history | Where-Object { $_.event -ceq 'server_fallback' -and $_.by -ceq 'server' }).Count -eq 1) 'the history records the server as the author'
Assert ($pa[0].reply_check -and ($pa[0].reply_check.reply_source -ceq 'model') -and (@($pa[0].reply_check.claimed_but_not_delivered).Count -eq 0)) 'the reply check is recorded for it too (no claims)'
Assert (@(Trace $fa | Where-Object { $_.event -ceq 'emergency_proposal_fallback' }).Count -eq 1) 'the manager trace says that the server drafted it'
Assert ((Get-ConversationView -ConversationId $fa -Audience 'tenant').data.messages.Count -eq 2) 'the tenant view still holds only the two messages'

# b) the reply was replaced by the fixed safety message and nothing was drafted
$fb = NewConv 'HV-004'
Queue @((Resp @((T 'Let us check the pilot light and relight it.'))))
$r = Turn $fb 'I smell gas near the furnace.'
$pb = @(EProps $fb)
Assert (($r.source -ceq 'failsafe') -and ($pb.Count -eq 1) -and ($pb[0].origin -ceq 'server_emergency_fallback') -and ($pb[0].reply_check.reply_source -ceq 'failsafe') -and ($pb[0].reason -like '*the fixed safety message*')) 'after a fail-safe replacement the proposal exists and says the tenant received the fixed message'

# c) the model drafted its own Emergency proposal: no second one
$fc = NewConv 'HV-004'
Queue @((Resp @((Tu 'toolu_f1' 'draft_ticket_update' @{ fields = @{ ai_urgency = 'Emergency'; summary = 'Tenant reports a gas smell.' }; reason = 'Path C.' })) 'tool_use'), (Resp @((T $goodGas))))
$r = Turn $fc 'I smell gas in the kitchen.'
$pc = @(EProps $fc)
Assert (($pc.Count -eq 1) -and ($null -eq $pc[0].PSObject.Properties['origin'])) 'when the model drafted an Emergency proposal the server adds nothing'

# d) the model drafted only an Urgent proposal: the fallback merges into it (one proposal, raised to Emergency)
$fd = NewConv 'HV-004'
Queue @((Resp @((Tu 'toolu_f2' 'draft_ticket_update' @{ fields = @{ ai_urgency = 'Urgent'; summary = 'Smell near the furnace.' }; reason = 'Urgent.' })) 'tool_use'), (Resp @((T $goodGas))))
$r = Turn $fd 'I smell gas in the kitchen.'
$pd = @(EProps $fd)
Assert (($pd.Count -eq 1) -and ($pd[0].proposed_fields.ai_urgency -ceq 'Emergency') -and ($pd[0].proposed_fields.emergency_flag -eq $true) -and ($pd[0].status -ceq 'pending')) 'an Urgent proposal from the model is merged and raised to Emergency (still one pending proposal)'

# e) an approved Emergency proposal already exists: no second one on a later emergency message
$fe = NewConv 'HV-004'
Queue @((Resp @((T $goodGas))))
$r = Turn $fe 'I smell gas in the kitchen.'
$pe0 = @(EProps $fe)[0]
[void](Set-ProposalState -Audience 'manager' -ProposalId $pe0.id -Action 'approve')
Queue @((Resp @((T $goodGas))))
$r = Turn $fe 'The gas smell is stronger now.'
Assert (@(EProps $fe).Count -eq 1) 'with an approved Emergency proposal already there, a later emergency message adds no second proposal'

# f) a rejected one does not count as equivalent
$ff = NewConv 'HV-004'
Queue @((Resp @((T $goodGas))))
$r = Turn $ff 'I smell gas in the kitchen.'
$pf0 = @(EProps $ff)[0]
[void](Set-ProposalState -Audience 'manager' -ProposalId $pf0.id -Action 'reject' -Note 'false alarm')
Queue @((Resp @((T $goodGas))))
$r = Turn $ff 'No, I really do smell gas, it is strong.'
$pf = @(EProps $ff)
Assert (($pf.Count -eq 2) -and (@($pf | Where-Object { $_.status -ceq 'rejected' }).Count -eq 1) -and (@($pf | Where-Object { $_.status -ceq 'pending' }).Count -eq 1)) 'after a rejection a new emergency message gets a new pending proposal (the rejected one is left alone)'
Assert (((Read-JsonFile (Get-ProposalPath $pf0.id)).decision_note) -ceq 'false alarm') 'the rejected proposal is not modified'

# g) no emergency, or an emergency kind the check does not confirm: nothing is drafted
$fg = NewConv 'HV-010'
Queue @((Resp @((T 'Hi! Please run the kitchen sink for 30 seconds.'))))
$r = Turn $fg 'My dishwasher is not draining.'
Assert (@(EProps $fg).Count -eq 0) 'an ordinary request gets no server-drafted proposal'
$fg2 = NewConv 'HV-010'
Queue @((Resp @((T 'Please stay away from the light and do not touch any switch. Contact your property manager.'))))
$r = Turn $fg2 'Water is dripping out of the ceiling light.'
Assert (@(EProps $fg2).Count -eq 0) 'water near a fixture (not confirmed by the emergency check) gets no server-drafted proposal'
$fg3 = NewConv 'HV-010'
Queue @((Resp @((T 'No problem, let us look at the hot water.'))))
$r = Turn $fg3 'I do not smell gas, I just have no hot water.'
Assert (@(EProps $fg3).Count -eq 0) 'a denied gas smell gets no server-drafted proposal'

# h) the model path is down: the fixed message is sent and the proposal is still drafted
$fh = NewConv 'HV-004'
Queue @((E 529 'overloaded_error'), (E 529 'overloaded_error'), (E 529 'overloaded_error'))
$r = Turn $fh 'I smell gas in the kitchen.' @{ AGENT_RETRIES = '2' }
$ph = @(EProps $fh)
Assert (($r.source -ceq 'failsafe') -and ($ph.Count -eq 1) -and ($ph[0].origin -ceq 'server_emergency_fallback') -and ($ph[0].status -ceq 'pending')) 'with the model unreachable the fixed safety message is sent and the proposal is still drafted for the manager'

# i) smoke gets its own label; a tenant quote with quotes and line breaks stays valid
$fi = NewConv 'HV-010'
Queue @((Resp @((T 'Please leave right now and call 911 from outside. Do not go back in until responders say it is safe.'))))
$r = Turn $fi "There is smoke coming from the outlet.`nIt says ""error"" on the panel."
$pi = @(EProps $fi)
Assert (($pi.Count -eq 1) -and ($pi[0].proposed_fields.summary -like '*smoke or fire*') -and ($pi[0].proposed_fields.notes -like 'Tenant''s words: "There is smoke*')) 'smoke gets its own label and a multi-line quote with quotation marks still makes a valid proposal'

# j) nothing is applied: the ticket data in the store is unchanged, and the fallback needs a manager to act
Assert (($script:Demo.Tickets['HV-004'].status -ceq 'Resolved') -and ((Get-TicketExtra 'HV-004').ai_handling_status -ceq 'Completed')) 'the ticket itself is unchanged by the fallback (only a pending proposal exists)'

Section 'manual guidance delivery rule and its leak guard'
$cm = NewConv 'HV-010' 'eq-hv-dishwasher'
$gm = Invoke-AgentTool -Name 'get_equipment_manual_guidance' -ToolInput @{ equipment_id = 'eq-hv-dishwasher'; question = 'water standing in the bottom, not draining' } -Audience 'tenant' -ConversationId $cm
$gm2 = Invoke-AgentTool -Name 'get_equipment_manual_guidance' -ToolInput @{ equipment_id = 'eq-hv-dishwasher'; question = 'the door will not close' } -Audience 'tenant' -ConversationId $cm
Assert ($gm.ok -and ($gm.data.guidance.delivery_rule -like 'Give the tenant only the first action of one check per reply*')) 'a matched manual topic carries the one-action-at-a-time delivery rule'
Assert ($gm2.ok -and ($gm2.data.topic_matched -eq $false) -and ($null -eq $gm2.data.guidance)) 'no rule and no guidance when no topic matches'
Assert ((Test-ReplyLeak 'Per the delivery_rule I should give one action.' (Get-AgentSettings -Override (S @{}))) -ceq 'internal_marker') 'a tenant reply that echoes the delivery rule field name is blocked'

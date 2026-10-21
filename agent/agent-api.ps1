# AI Maintenance Agent, Stage 5: local API routes. Loaded by serve.ps1 (localhost only, demo only).
# Dot-sourcing this file loads the whole agent: lib, config, loop and background runs.
#
# Audience comes from the route: /api/agent/tenant/* is a tenant (must present the conversation token), /api/agent/manager/*
# is the manager view. There is no sign-in in the demo, so the manager routes are NOT a security boundary: they rely on the
# server listening on localhost only. Nothing here returns tool results, the system prompt, the API key or spend internals
# to a tenant route.

. (Join-Path $PSScriptRoot 'agent-lib.ps1')
. (Join-Path $PSScriptRoot 'agent-config.ps1')
. (Join-Path $PSScriptRoot 'agent-loop.ps1')
. (Join-Path $PSScriptRoot 'agent-runs.ps1')

$script:StartLog = New-Object System.Collections.ArrayList

function New-ApiReply([int]$Status, $Body) {
    return @{ status = $Status; json = (ConvertTo-Json -InputObject $Body -Depth 12 -Compress) }
}

function ConvertTo-ApiReply($Result) {
    # Maps a library result to an HTTP reply. Errors expose only the short code and message.
    if ($Result['ok']) { return (New-ApiReply 200 $Result['data']) }
    $code = [string]$Result['error']['code']
    $status = 500
    switch ($code) {
        'invalid_input' { $status = 400 }
        'not_available' { $status = 404 }
        'not_found' { $status = 404 }
        'forbidden' { $status = 403 }
        'busy' { $status = 409 }
        'invalid_state' { $status = 409 }
        'limit_exceeded' { $status = 429 }
        'conversation_required' { $status = 400 }
    }
    return (New-ApiReply $status ([ordered]@{ error = $code; message = [string]$Result['error']['message'] }))
}

function Invoke-AgentApi {
    param([string]$Method, [string]$Path, $Query, $Headers, [string]$BodyText, [int]$Port, [bool]$IsLocal)
    try {
        if (-not $IsLocal) { return (New-ApiReply 403 @{ error = 'forbidden'; message = 'Local requests only.' }) }
        $hostHeader = [string]$Headers['Host']
        if (@("localhost:$Port", "127.0.0.1:$Port", "[::1]:$Port") -cnotcontains $hostHeader.ToLowerInvariant()) { return (New-ApiReply 403 @{ error = 'forbidden'; message = 'Unexpected host name.' }) }
        $route = $Path.TrimEnd('/')
        $body = $null
        if ($Method -ceq 'POST') {
            if ($BodyText.Trim().Length -eq 0) { $body = [pscustomobject]@{} }
            else { try { $body = $BodyText | ConvertFrom-Json } catch { return (New-ApiReply 400 @{ error = 'invalid_input'; message = 'Invalid JSON.' }) } }
            if ($null -eq $body -or $body -is [string] -or $body -is [array]) { return (New-ApiReply 400 @{ error = 'invalid_input'; message = 'Expected a JSON object.' }) }
        }
        $token = [string]$Headers['X-Conversation-Token']

        if ($Method -ceq 'GET' -and $route -ceq '/api/agent/status') {
            $S = Get-AgentSettings
            $prompt = $false; try { [void](Get-SystemPrompt -AllowChange $S.AllowPromptChange); $prompt = $true } catch { }
            $pub = Get-PublicSettings $S
            $pub['LiveReady'] = [bool]($S.ApiKey -and $S.LiveEnabled -and $S.ModelId)
            $pub['PromptHashesOk'] = $prompt
            $pub['Spend'] = Get-SpendTotals
            return (New-ApiReply 200 $pub)
        }

        # ---- tenant routes
        if ($Method -ceq 'POST' -and $route -ceq '/api/agent/tenant/start') {
            $now = Get-Date
            foreach ($t in @($script:StartLog.ToArray())) { if (($now - $t).TotalSeconds -gt 60) { $script:StartLog.Remove($t) } }
            if ($script:StartLog.Count -ge 20) { return (New-ApiReply 429 @{ error = 'limit_exceeded'; message = 'Too many conversations started. Try again in a minute.' }) }
            [void]$script:StartLog.Add($now)
            $eq = $(if ($null -ne $body.PSObject.Properties['equipment_id']) { [string]$body.equipment_id } else { $null })
            return (ConvertTo-ApiReply (New-Conversation -TicketId ([string]$body.ticket_id) -EquipmentId $eq))
        }
        if ($route -match '^/api/agent/tenant/(message|result|conversation)$') {
            $conv = $(if ($Method -ceq 'POST') { [string]$body.conversation_id } elseif ($Matches[1] -ceq 'conversation') { [string]$Query['id'] } else { [string]$Query['conversation_id'] })
            if (-not (Test-ConversationToken $conv $token)) { return (New-ApiReply 403 @{ error = 'forbidden'; message = 'Not allowed.' }) }
            if ($Method -ceq 'POST' -and $Matches[1] -ceq 'message') { return (ConvertTo-ApiReply (Start-AgentRun -ConversationId $conv -Text ([string]$body.text))) }
            if ($Method -ceq 'GET' -and $Matches[1] -ceq 'result') { return (ConvertTo-ApiReply (Get-AgentRunStatus -RunId ([string]$Query['run_id']) -ConversationId $conv)) }
            if ($Method -ceq 'GET' -and $Matches[1] -ceq 'conversation') { return (ConvertTo-ApiReply (Get-ConversationView -ConversationId $conv -Audience 'tenant')) }
        }

        # ---- manager routes (demo: no sign-in, localhost only)
        if ($Method -ceq 'GET' -and $route -ceq '/api/agent/manager/conversations') {
            return (ConvertTo-ApiReply (Get-ConversationsForTicket -TicketId ([string]$Query['ticket_id']) -Audience 'manager'))
        }
        if ($Method -ceq 'GET' -and $route -ceq '/api/agent/manager/proposals') {
            $st = [string]$Query['status']
            if ($st -and (@('pending', 'approved', 'rejected', 'applied') -cnotcontains $st)) { return (New-ApiReply 400 @{ error = 'invalid_input'; message = 'Unknown status.' }) }
            return (New-ApiReply 200 ([ordered]@{ proposals = @(Get-ProposalList -Audience 'manager' -Status $st) }))
        }
        if ($Method -ceq 'POST' -and $route -ceq '/api/agent/manager/proposals/decide') {
            $d = [string]$body.decision
            if ($d -cne 'approve' -and $d -cne 'reject') { return (New-ApiReply 400 @{ error = 'invalid_input'; message = 'decision must be approve or reject.' }) }
            $note = $(if ($null -ne $body.PSObject.Properties['note']) { [string]$body.note } else { $null })
            return (ConvertTo-ApiReply (Set-ProposalState -Audience 'manager' -ProposalId ([string]$body.proposal_id) -Action $d -Note $note))
        }
        if ($Method -ceq 'POST' -and $route -ceq '/api/agent/manager/proposals/applied') {
            return (ConvertTo-ApiReply (Set-ProposalState -Audience 'manager' -ProposalId ([string]$body.proposal_id) -Action 'applied'))
        }
        return (New-ApiReply 404 @{ error = 'not_found'; message = 'Unknown agent route.' })
    }
    catch {
        return (New-ApiReply 500 @{ error = 'internal_error'; message = 'The agent API failed.' })
    }
}

# AI Maintenance Agent, Stage 5: background runs. Dot-source agent-lib.ps1, agent-config.ps1 and agent-loop.ps1 first.
#
# The local server handles one request at a time, so a model call (seconds) must never run inside a request. Start-AgentRun
# starts a separate PowerShell process (Start-Job) that runs Invoke-AgentTurn, and the caller polls a small run file.
# One active run per conversation (exclusive lock file). The run file holds only what a tenant may see: status and reply.
# The API key is never passed to the job: the job reads it from .env itself.

$script:RxRun = '^run-\d{14}-[0-9a-f]{8}$'

function Get-RunsDir {
    $d = Join-Path $script:Cfg.StoreDir 'runs'
    [void][System.IO.Directory]::CreateDirectory($d)
    return $d
}

function Get-RunPath([string]$RunId) {
    if (-not (Test-IdFormat $RunId $script:RxRun)) { return $null }
    return (Join-Path (Get-RunsDir) ($RunId + '.json'))
}

function Get-LockPath([string]$ConversationId) { return (Join-Path (Get-RunsDir) ($ConversationId + '.lock')) }

function Start-AgentRun {
    param([string]$ConversationId, [string]$Text, [hashtable]$SettingsOverride, [switch]$Resume)
    if (-not (Test-IdFormat $ConversationId $script:RxConv) -or $null -eq (Read-Conversation $ConversationId)) {
        return (New-Result $false 'start_run' 'tenant' $null 'not_available' 'Conversation not available.')
    }
    if ($Resume) {
        $c0 = Read-Conversation $ConversationId
        $lastMsg = $(if (@($c0.messages).Count -gt 0) { @($c0.messages)[@($c0.messages).Count - 1] } else { $null })
        if ($null -eq $lastMsg -or $lastMsg.role -cne 'tenant') { return (New-Result $false 'start_run' 'tenant' $null 'invalid_state' 'There is no message waiting for a reply.') }
    }
    elseif (-not (Test-CleanText $Text $script:MaxTenantText)) {
        return (New-Result $false 'start_run' 'tenant' $null 'invalid_input' "The message must be 1 to $($script:MaxTenantText) characters without control characters.")
    }
    $S = Get-AgentSettings -Override $SettingsOverride
    $lock = Get-LockPath $ConversationId
    if (Test-Path -LiteralPath $lock) {
        $age = ((Get-Date) - (Get-Item -LiteralPath $lock).LastWriteTime).TotalSeconds
        if ($age -gt ($S.MaxRunSeconds + 90)) { [System.IO.File]::Delete($lock) }
    }
    try { $fs = [System.IO.File]::Open($lock, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None); $fs.Dispose() }
    catch { return (New-Result $false 'start_run' 'tenant' $null 'busy' 'A reply is already being prepared for this conversation.') }
    $runId = New-RandomId 'run'
    $runFile = Get-RunPath $runId
    Write-JsonFile $runFile ([ordered]@{ schema = 'run.v1'; run_id = $runId; conversation_id = $ConversationId; status = 'running'; started_at = (Get-Stamp); finished_at = $null; reply = $null; error_code = $null })
    foreach ($j in @(Get-Job -ErrorAction SilentlyContinue | Where-Object { $_.State -in 'Completed', 'Failed', 'Stopped' })) { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue }
    $jobScript = {
        param($Root, $Store, $Demo, $EnvDir, $ConvId, $Text, $RunFile, $LockFile, $Override, $ResumeRun)
        $ErrorActionPreference = 'Stop'
        $reply = $null; $err = $null; $status = 'failed'
        try {
            . (Join-Path $Root 'agent\agent-lib.ps1')
            . (Join-Path $Root 'agent\agent-config.ps1')
            . (Join-Path $Root 'agent\agent-loop.ps1')
            Initialize-AgentLib -ProjectRoot $Root -StoreDir $Store -DemoDir $Demo -EnvDir $EnvDir
            if ($ResumeRun) { $res = Invoke-AgentTurn -ConversationId $ConvId -SettingsOverride $Override -Resume }
            else { $res = Invoke-AgentTurn -ConversationId $ConvId -TenantText $Text -SettingsOverride $Override }
            if ($res.ok -and $res.reply) { $status = 'done'; $reply = $res.reply; $err = $res.error_code } else { $err = $(if ($res.error_code) { $res.error_code } else { 'run_failed' }) }
        }
        catch { $err = 'internal_error' }
        finally {
            try {
                $run = Get-Content -LiteralPath $RunFile -Raw -Encoding UTF8 | ConvertFrom-Json
                $out = [ordered]@{ schema = 'run.v1'; run_id = $run.run_id; conversation_id = $run.conversation_id; status = $status; started_at = $run.started_at; finished_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'); reply = $reply; error_code = $err }
                $tmp = "$RunFile.tmp"
                [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $out -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $tmp -Destination $RunFile -Force
            } catch { }
            [System.IO.File]::Delete($LockFile)
        }
    }
    $resumeFlag = [bool]$Resume
    try {
        [void](Start-Job -ScriptBlock $jobScript -ArgumentList $script:Cfg.Root, $script:Cfg.StoreDir, $script:Cfg.DemoDir, $script:Cfg.EnvDir, $ConversationId, $Text, $runFile, $lock, $SettingsOverride, $resumeFlag)
    }
    catch {
        [System.IO.File]::Delete($lock)
        return (New-Result $false 'start_run' 'tenant' $null 'internal_error' 'Could not start the reply.')
    }
    return (New-Result $true 'start_run' 'tenant' ([ordered]@{ run_id = $runId; status = 'running' }))
}

function Get-AgentRunStatus {
    # Tenant-safe: status and reply only. The run must belong to the conversation the caller proved access to.
    param([string]$RunId, [string]$ConversationId)
    $path = Get-RunPath $RunId
    if ($null -eq $path -or -not (Test-Path -LiteralPath $path)) { return (New-Result $false 'run_status' 'tenant' $null 'not_available' 'Not available.') }
    $run = Read-JsonFile $path
    if ($run.conversation_id -cne $ConversationId) { return (New-Result $false 'run_status' 'tenant' $null 'not_available' 'Not available.') }
    if ($run.status -ceq 'running') {
        $S = Get-AgentSettings
        $age = ((Get-Date) - [datetime]::Parse($run.started_at)).TotalSeconds
        if ($age -gt ($S.MaxRunSeconds + 90)) {
            $run.status = 'failed'; $run.error_code = 'run_stale'; $run.finished_at = Get-Stamp
            Write-JsonFile $path $run
            [System.IO.File]::Delete((Get-LockPath $ConversationId))
        }
    }
    $d = [ordered]@{ run_id = $run.run_id; status = $run.status }
    if ($run.status -ceq 'done') { $d['reply'] = $run.reply }
    if ($run.status -ceq 'failed') { $d['message'] = 'A reply could not be prepared. Please try again.' }
    return (New-Result $true 'run_status' 'tenant' $d)
}

function Wait-AgentRun {
    # For tests and scripts: poll until the run is no longer running.
    param([string]$RunId, [string]$ConversationId, [int]$TimeoutSeconds = 120)
    $until = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $until) {
        $s = Get-AgentRunStatus -RunId $RunId -ConversationId $ConversationId
        if (-not $s.ok -or $s.data.status -cne 'running') { return $s }
        Start-Sleep -Milliseconds 300
    }
    return (New-Result $false 'run_status' 'tenant' $null 'timeout' 'Waiting timed out.')
}

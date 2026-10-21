# AI Maintenance Agent, Stage 5: settings, prompt loading, spend ledger and the Anthropic API transport.
# Dot-source agent-lib.ps1 first, then this file. Windows PowerShell 5.1.
#
# - The API key is read only from the git-ignored .env (or the process environment) and is never printed,
#   logged, stored in the conversation store, or returned by any function. The only host it is ever sent to
#   is api.anthropic.com (the URL is a constant, not a setting).
# - Live calls need BOTH a key and AGENT_LIVE_ENABLED=1. Without them the default transport refuses before any
#   network code runs. Tests inject a mock transport instead.

$script:AgentTransport = $null
$script:ApiUrl = 'https://api.anthropic.com/v1/messages'
$script:ModelsUrl = 'https://api.anthropic.com/v1/models/'
$script:ApiVersion = '2023-06-01'

$script:ModelAliases = @{ 'haiku' = 'claude-haiku-5-5'; 'sonnet' = 'claude-sonnet-5-5' }
# USD per million tokens. Source: the Claude API reference (checked 2026-10-21). Haiku 5.5 has a second rate card above
# 100K prompt tokens. Cache reads cost 0.1x the input rate and 5-minute cache writes 1.25x. These are ESTIMATES used for
# the spend limits; the console shows the real bill.
$script:ModelPrices = @{
    'claude-haiku-5-5'  = @{ in = 0.10; out = 0.50; in_long = 0.50; out_long = 2.50; long_over = 100000 }
    'claude-sonnet-5-5' = @{ in = 2.00; out = 10.00; in_long = 2.00; out_long = 10.00; long_over = 100000 }
}

# Hard ceilings: a typo in .env can lower a limit but can never raise it past these.
$script:Ceilings = @{ ToolRounds = 12; OutputTokens = 8192; InputTokens = 150000; RunSeconds = 300; CallSeconds = 120; RunUsd = 2.0; DailyUsd = 20.0; TotalUsd = 100.0; Retries = 3 }

# ---------------------------------------------------------------- settings

function Read-DotEnv([string]$Path) {
    $h = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $h }
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $v = $Matches[2].Trim()
            if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
            $h[$Matches[1]] = $v
        }
    }
    return $h
}

function Get-Clamped($Raw, [double]$Default, [double]$Min, [double]$Max) {
    $d = 0.0
    if ($null -ne $Raw -and $Raw -ne '' -and [double]::TryParse(([string]$Raw), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { } else { $d = $Default }
    return [Math]::Min([Math]::Max($d, $Min), $Max)
}

function Resolve-ModelId([string]$Name) {
    if (-not $Name) { $Name = 'haiku' }
    $n = $Name.Trim().ToLowerInvariant()
    if ($script:ModelAliases.ContainsKey($n)) { return $script:ModelAliases[$n] }
    if ($script:ModelPrices.ContainsKey($n)) { return $n }
    return $null
}

function Get-AgentSettings {
    # Order: defaults < .env < process environment < explicit override (used by tests).
    param([string]$ProjectRoot, [hashtable]$Override)
    if (-not $ProjectRoot) { $ProjectRoot = $script:Cfg.Root }
    $src = Read-DotEnv (Join-Path $(if ($script:Cfg.EnvDir) { $script:Cfg.EnvDir } else { $ProjectRoot }) '.env')
    foreach ($k in @($src.Keys)) { if ($k -notmatch '^(ANTHROPIC_API_KEY|AGENT_[A-Z_]+)$') { $src.Remove($k) } }
    foreach ($e in (Get-ChildItem Env: | Where-Object { $_.Name -match '^(ANTHROPIC_API_KEY|AGENT_[A-Z_]+)$' })) { $src[$e.Name] = $e.Value }
    if ($Override) { foreach ($k in $Override.Keys) { $src[$k] = $Override[$k] } }
    $c = $script:Ceilings
    $modelId = Resolve-ModelId $src['AGENT_MODEL']
    $effort = [string]$src['AGENT_EFFORT']
    if ($effort -and (@('low', 'medium', 'high', 'xhigh', 'max') -cnotcontains $effort)) { $effort = '' }
    return [ordered]@{
        ApiKey = [string]$src['ANTHROPIC_API_KEY']
        LiveEnabled = ([string]$src['AGENT_LIVE_ENABLED'] -ceq '1')
        ModelName = $(if ($src['AGENT_MODEL']) { [string]$src['AGENT_MODEL'] } else { 'haiku' })
        ModelId = $modelId
        Effort = $effort
        MaxToolRounds = [int](Get-Clamped $src['AGENT_MAX_TOOL_ROUNDS'] 6 1 $c.ToolRounds)
        MaxOutputTokens = [int](Get-Clamped $src['AGENT_MAX_OUTPUT_TOKENS'] 4096 256 $c.OutputTokens)
        MaxInputTokens = [int](Get-Clamped $src['AGENT_MAX_INPUT_TOKENS'] 60000 2000 $c.InputTokens)
        MaxRunSeconds = [int](Get-Clamped $src['AGENT_MAX_RUN_SECONDS'] 90 5 $c.RunSeconds)
        CallTimeoutSeconds = [int](Get-Clamped $src['AGENT_CALL_TIMEOUT_SECONDS'] 60 2 $c.CallSeconds)
        RunUsd = (Get-Clamped $src['AGENT_RUN_SPEND_USD'] 0.25 0 $c.RunUsd)
        DailyUsd = (Get-Clamped $src['AGENT_DAILY_SPEND_USD'] 1.0 0 $c.DailyUsd)
        TotalUsd = (Get-Clamped $src['AGENT_TOTAL_SPEND_USD'] 5.0 0 $c.TotalUsd)
        Retries = [int](Get-Clamped $src['AGENT_RETRIES'] 2 0 $c.Retries)
        RetryDelayMs = [int](Get-Clamped $src['AGENT_RETRY_DELAY_MS'] 1000 0 20000)
        SummaryAfterMessages = [int](Get-Clamped $src['AGENT_SUMMARY_AFTER_MESSAGES'] 20 6 150)
        RecentMessages = [int](Get-Clamped $src['AGENT_RECENT_MESSAGES'] 8 2 40)
        AllowPromptChange = ([string]$src['AGENT_ALLOW_PROMPT_CHANGE'] -ceq '1')
    }
}

# A copy of the settings that is safe to show to a manager (no key).
function Get-PublicSettings($S) {
    $o = [ordered]@{}
    foreach ($k in $S.Keys) { if ($k -cne 'ApiKey') { $o[$k] = $S[$k] } }
    $o['KeyPresent'] = [bool]$S.ApiKey
    return $o
}

function Remove-Secrets([string]$Text, $Settings) {
    if (-not $Text) { return $Text }
    if ($Settings -and $Settings.ApiKey) { $Text = $Text.Replace($Settings.ApiKey, '[key removed]') }
    return ([regex]::Replace($Text, 'sk-ant-[A-Za-z0-9_-]{6,}', '[key removed]'))
}

# ---------------------------------------------------------------- prompt loading

function Get-NormalizedBlock([string]$Path, [string]$Begin, [string]$End) {
    $t = ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)) -replace "`r`n", "`n"
    $b = $t.IndexOf($Begin)
    $e = $t.IndexOf($End)
    if ($b -lt 0 -or $e -lt $b) { throw "Prompt markers not found in $(Split-Path -Leaf $Path)." }
    $seg = $t.Substring($b + $Begin.Length, $e - $b - $Begin.Length)
    $m = [regex]::Match($seg, '(?s)\n```text\n(.*?)\n```\s*$')
    if (-not $m.Success) { throw "Prompt block not found in $(Split-Path -Leaf $Path)." }
    return $m.Groups[1].Value
}

function Get-Sha256Hex([string]$Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $h = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') })
    $sha.Dispose()
    return $h
}

function Get-SystemPrompt {
    # The runtime prompt is the verbatim tested base prompt followed by the approved connected-mode addendum.
    # The text is read from the markdown files and checked against agent/prompt-hashes.json, so an accidental edit
    # to either part stops the agent instead of silently changing its behavior.
    param([string]$AgentDir, [bool]$AllowChange = $false)
    if (-not $AgentDir) { $AgentDir = Join-Path $script:Cfg.Root 'agent' }
    $base = Get-NormalizedBlock (Join-Path $AgentDir 'system-prompt.draft.md') '<!-- BEGIN VERBATIM PROMPT -->' '<!-- END VERBATIM PROMPT -->'
    $add = Get-NormalizedBlock (Join-Path $AgentDir 'system-prompt.connected-addendum.md') '<!-- BEGIN ADDENDUM -->' '<!-- END ADDENDUM -->'
    $hb = Get-Sha256Hex $base
    $ha = Get-Sha256Hex $add
    if (-not $AllowChange) {
        $expected = Read-JsonFile (Join-Path $AgentDir 'prompt-hashes.json')
        if (($hb -cne $expected.base_sha256) -or ($ha -cne $expected.addendum_sha256)) {
            throw 'The system prompt or the addendum differs from agent/prompt-hashes.json. Review the change, then run agent/Update-PromptHashes.ps1 -Confirm (or set AGENT_ALLOW_PROMPT_CHANGE=1 for a test).'
        }
    }
    return [ordered]@{ text = ($base + "`n`n" + $add); base_sha256 = $hb; addendum_sha256 = $ha; base_chars = $base.Length; addendum_chars = $add.Length }
}

# ---------------------------------------------------------------- spend ledger

function Get-SpendPath { return (Join-Path $script:Cfg.StoreDir 'spend.json') }

function Get-SpendEntries {
    $p = Get-SpendPath
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    $o = Read-JsonFile $p
    return @($o.entries)
}

function Get-SpendTotals {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $day = 0.0; $total = 0.0
    foreach ($e in (Get-SpendEntries)) {
        $total += [double]$e.usd
        if ($e.ts.Substring(0, 10) -ceq $today) { $day += [double]$e.usd }
    }
    return [ordered]@{ today_usd = [Math]::Round($day, 6); total_usd = [Math]::Round($total, 6) }
}

function Add-SpendEntry($Model, [string]$ConversationId, [string]$Purpose, $Usage, [double]$Usd) {
    [void](Invoke-StoreLock {
            $p = Get-SpendPath
            $entries = @(Get-SpendEntries)
            $entries += [ordered]@{
                ts = Get-Stamp; model = $Model; conversation_id = $ConversationId; purpose = $Purpose
                input_tokens = [int](Get-Prop $Usage 'input_tokens' 0); output_tokens = [int](Get-Prop $Usage 'output_tokens' 0)
                cache_read_tokens = [int](Get-Prop $Usage 'cache_read_input_tokens' 0); cache_write_tokens = [int](Get-Prop $Usage 'cache_creation_input_tokens' 0)
                usd = [Math]::Round($Usd, 8)
            }
            Write-JsonFile $p ([ordered]@{ schema = 'spend.v1'; note = 'Estimated from token usage and the price table in agent-config.ps1; the Console shows the real bill.'; entries = $entries })
        })
}

function Get-UsageCostUsd([string]$ModelId, $Usage) {
    $pr = $script:ModelPrices[$ModelId]
    if ($null -eq $pr) { return 0.0 }
    $inT = [double](Get-Prop $Usage 'input_tokens' 0)
    $outT = [double](Get-Prop $Usage 'output_tokens' 0)
    $cr = [double](Get-Prop $Usage 'cache_read_input_tokens' 0)
    $cw = [double](Get-Prop $Usage 'cache_creation_input_tokens' 0)
    $long = (($inT + $cr + $cw) -gt $pr.long_over)
    $pin = $(if ($long) { $pr.in_long } else { $pr.in }) / 1e6
    $pout = $(if ($long) { $pr.out_long } else { $pr.out }) / 1e6
    return ($inT * $pin + $cr * $pin * 0.1 + $cw * $pin * 1.25 + $outT * $pout)
}

function Get-WorstCaseCostUsd([string]$ModelId, [int]$EstInputTokens, [int]$MaxOutputTokens) {
    $pr = $script:ModelPrices[$ModelId]
    $long = ($EstInputTokens -gt $pr.long_over)
    $pin = $(if ($long) { $pr.in_long } else { $pr.in }) / 1e6
    $pout = $(if ($long) { $pr.out_long } else { $pr.out }) / 1e6
    return ($EstInputTokens * $pin * 1.25 + $MaxOutputTokens * $pout)
}

# ---------------------------------------------------------------- API transport

function New-ApiException([int]$Status, [string]$Type, [string]$Message) {
    $ex = New-Object System.Exception($Message)
    $ex.Data['status'] = $Status
    $ex.Data['type'] = $Type
    return $ex
}

function Set-AgentTransport($Script) { $script:AgentTransport = $Script }

function New-MockFileTransport([string]$Path) {
    # Used only when AGENT_MOCK_RESPONSES_FILE is set (background jobs in tests). Returns scripted responses in
    # order; records each request body next to the file. No network.
    $p = $Path
    return {
        param($Body, $TimeoutSec, $Settings)
        $pos = 0
        $posFile = "$p.pos"
        if (Test-Path -LiteralPath $posFile) { $pos = [int](Get-Content -LiteralPath $posFile -Raw) }
        $all = (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json).responses
        Add-Content -LiteralPath "$p.requests.jsonl" -Value (ConvertTo-Json -InputObject $Body -Depth 40 -Compress) -Encoding UTF8
        if ($pos -ge @($all).Count) { throw (New-ApiException 0 'mock_exhausted' 'No scripted response left.') }
        Set-Content -LiteralPath $posFile -Value ($pos + 1) -Encoding ASCII
        $r = @($all)[$pos]
        if ($r.PSObject.Properties['delay_ms']) { Start-Sleep -Milliseconds ([int]$r.delay_ms) }
        if ($r.PSObject.Properties['error']) { throw (New-ApiException ([int]$r.error.status) ([string]$r.error.type) ([string]$r.error.message)) }
        return $r
    }.GetNewClosure()
}

function Get-AgentTransport {
    if ($script:AgentTransport) { return $script:AgentTransport }
    if ($env:AGENT_MOCK_RESPONSES_FILE) { return (New-MockFileTransport $env:AGENT_MOCK_RESPONSES_FILE) }
    return { param($Body, $TimeoutSec, $Settings) Invoke-AnthropicHttp $Body $TimeoutSec $Settings }
}

function Read-ErrorBody($ErrorRecord) {
    $txt = $null
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) { $txt = $ErrorRecord.ErrorDetails.Message }
    elseif ($ErrorRecord.Exception.Response) {
        try { $sr = New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream()); $txt = $sr.ReadToEnd(); $sr.Dispose() } catch { }
    }
    return $txt
}

function Invoke-AnthropicHttp($Body, [int]$TimeoutSec, $Settings) {
    if (-not $Settings.LiveEnabled) { throw (New-ApiException 0 'not_configured' 'Live API calls are disabled (AGENT_LIVE_ENABLED is not 1).') }
    if (-not $Settings.ApiKey) { throw (New-ApiException 0 'not_configured' 'No API key is configured.') }
    if ($Settings.ApiKey -notmatch '^sk-ant-[A-Za-z0-9_-]{20,}$') { throw (New-ApiException 0 'not_configured' 'The configured API key does not look like an Anthropic key.') }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 40 -Compress))
    try {
        $r = Invoke-WebRequest -Uri $script:ApiUrl -Method Post -UseBasicParsing -TimeoutSec $TimeoutSec -Body $bytes `
            -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-api-key' = $Settings.ApiKey; 'anthropic-version' = $script:ApiVersion }
        return ([System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json)
    }
    catch {
        $status = 0; $type = 'network'; $msg = 'The request failed.'
        if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch { } }
        $body = Read-ErrorBody $_
        if ($body) {
            try { $j = $body | ConvertFrom-Json; if ($j.error.type) { $type = [string]$j.error.type }; if ($j.error.message) { $msg = [string]$j.error.message } } catch { }
        }
        elseif ($_.Exception.Message -match '(?i)time') { $type = 'timeout'; $msg = 'The request timed out.' }
        throw (New-ApiException $status $type (Remove-Secrets $msg $Settings))
    }
}

function Test-AnthropicModels {
    # Free metadata calls (no tokens): asks the API whether each configured model id exists for this account.
    param($Settings)
    if (-not $Settings.ApiKey) { throw 'No API key is configured.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $out = @()
    foreach ($id in ($script:ModelPrices.Keys | Sort-Object)) {
        $row = [ordered]@{ model = $id; available = $false; display_name = $null; max_input_tokens = $null; max_output_tokens = $null; error = $null }
        try {
            $r = Invoke-WebRequest -Uri ($script:ModelsUrl + $id) -Method Get -UseBasicParsing -TimeoutSec 30 -Headers @{ 'x-api-key' = $Settings.ApiKey; 'anthropic-version' = $script:ApiVersion }
            $j = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
            $row.available = ($j.id -ceq $id); $row.display_name = $j.display_name
            $row.max_input_tokens = Get-Prop $j 'max_input_tokens' $null; $row.max_output_tokens = Get-Prop $j 'max_tokens' $null
        }
        catch {
            $body = Read-ErrorBody $_
            $row.error = Remove-Secrets $(if ($body) { $body } else { $_.Exception.Message }) $Settings
        }
        $out += $row
    }
    return $out
}

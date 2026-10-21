# Checks the local AI agent setup WITHOUT spending anything and without ever printing the API key.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File agent\Check-AgentSetup.ps1 [-VerifyModels]
# -VerifyModels asks the API whether the Haiku 5.5 and Sonnet 5.5 model ids exist for your account. That is a free metadata
# request (no tokens), but it does contact api.anthropic.com with your key, so it only runs when you ask for it.
param([switch]$VerifyModels)

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'agent\agent-lib.ps1')
. (Join-Path $root 'agent\agent-config.ps1')
. (Join-Path $root 'agent\agent-loop.ps1')
Initialize-AgentLib -ProjectRoot $root

$S = Get-AgentSettings
$problems = @()
function Line([string]$k, [string]$v) { '{0,-34} {1}' -f $k, $v }

'AI agent setup check (nothing is sent anywhere unless you used -VerifyModels)'
''
$envPath = Join-Path $root '.env'
Line '.env file' $(if (Test-Path -LiteralPath $envPath) { 'found' } else { 'missing (create it, see below)' })
$ign = & git -C $root check-ignore '.env' 2>$null
Line '.env ignored by git' $(if ($ign) { 'yes' } else { 'NO - do not add a key until .env is ignored' })
if (-not $ign) { $problems += '.env is not ignored by git' }
$ign2 = & git -C $root check-ignore 'agent-data/x' 2>$null
Line 'agent-data/ ignored by git' $(if ($ign2) { 'yes' } else { 'NO' })
if (-not $ign2) { $problems += 'agent-data/ is not ignored by git' }
Line 'ANTHROPIC_API_KEY' $(if ($S.ApiKey) { 'present, ' + $S.ApiKey.Length + ' characters, ' + $(if ($S.ApiKey -match '^sk-ant-[A-Za-z0-9_-]{20,}$') { 'format looks right' } else { 'FORMAT LOOKS WRONG' }) } else { 'not set' })
if (-not $S.ApiKey) { $problems += 'ANTHROPIC_API_KEY is not set in .env' }
elseif ($S.ApiKey -notmatch '^sk-ant-[A-Za-z0-9_-]{20,}$') { $problems += 'the key does not look like an Anthropic key' }
Line 'AGENT_LIVE_ENABLED' $(if ($S.LiveEnabled) { '1 (live calls allowed)' } else { 'not 1 (live calls are blocked)' })
if (-not $S.LiveEnabled) { $problems += 'AGENT_LIVE_ENABLED is not 1' }
if ($env:AGENT_MOCK_RESPONSES_FILE) { Line 'AGENT_MOCK_RESPONSES_FILE' 'SET: model replies are scripted and no live call will be made'; $problems += 'AGENT_MOCK_RESPONSES_FILE is set in this environment (test mode)' }
Line 'Model' $(if ($S.ModelId) { "$($S.ModelName) -> $($S.ModelId)" } else { "'$($S.ModelName)' is not a supported model (use haiku or sonnet)" })
if (-not $S.ModelId) { $problems += 'AGENT_MODEL is not haiku or sonnet' }
Line 'Effort' $(if ($S.Effort) { $S.Effort } else { '(model default)' })
Line 'Tool rounds / output tokens' "$($S.MaxToolRounds) / $($S.MaxOutputTokens)"
Line 'Input token cap per call' $S.MaxInputTokens
Line 'Run time limit / call timeout' "$($S.MaxRunSeconds) s / $($S.CallTimeoutSeconds) s"
Line 'Spend limits (run/day/total)' ('${0:N2} / ${1:N2} / ${2:N2}' -f $S.RunUsd, $S.DailyUsd, $S.TotalUsd)
$t = Get-SpendTotals
Line 'Estimated spend so far (day/total)' ('${0:N4} / ${1:N4}' -f $t.today_usd, $t.total_usd)
try { $p = Get-SystemPrompt -AllowChange $S.AllowPromptChange; Line 'System prompt + addendum' ("loaded, hashes match ($($p.base_chars) + $($p.addendum_chars) characters)") }
catch { Line 'System prompt + addendum' 'PROBLEM'; $problems += [string]$_.Exception.Message }

if ($VerifyModels) {
    ''
    if (-not $S.ApiKey) { 'Cannot verify models: no key set.'; }
    else {
        'Asking the API about the model ids (free metadata request) ...'
        foreach ($m in (Test-AnthropicModels -Settings $S)) {
            Line $m.model $(if ($m.available) { "available ($($m.display_name)); context $($m.max_input_tokens), output $($m.max_output_tokens)" } else { "NOT available: $($m.error)" })
            if (-not $m.available) { $problems += "$($m.model) is not available to this account" }
        }
    }
}
''
if ($problems.Count -eq 0) { 'Ready for the controlled live test (agent\Run-LiveTest.ps1).' }
else {
    'Not ready yet:'; $problems | ForEach-Object { '  - ' + $_ }
    ''
    'Add these lines to the .env file in the project folder (open it in a text editor and type the value yourself; never paste the key into chat):'
    '  ANTHROPIC_API_KEY=<your key>'
    '  AGENT_LIVE_ENABLED=1'
    '  AGENT_MODEL=haiku'
}

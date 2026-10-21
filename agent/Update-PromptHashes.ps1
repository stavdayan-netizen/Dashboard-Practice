# Records the SHA-256 of the verbatim base prompt and of the connected-mode addendum in agent/prompt-hashes.json.
# Run this ONLY after you have reviewed and approved a change to either prompt text (and re-tested it in the Playground).
# The agent refuses to start while the files and the recorded hashes disagree.
param([switch]$Confirm)
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'agent\agent-lib.ps1')
. (Join-Path $root 'agent\agent-config.ps1')
Initialize-AgentLib -ProjectRoot $root -StoreDir (Join-Path $env:TEMP 'agent-hash-tool')
$p = Get-SystemPrompt -AllowChange $true
$file = Join-Path $root 'agent\prompt-hashes.json'
$old = $null
if (Test-Path -LiteralPath $file) { $old = Read-JsonFile $file }
"base prompt:  {0} chars, sha256 {1}" -f $p.base_chars, $p.base_sha256
"addendum:     {0} chars, sha256 {1}" -f $p.addendum_chars, $p.addendum_sha256
if ($old -and $old.base_sha256 -ceq $p.base_sha256 -and $old.addendum_sha256 -ceq $p.addendum_sha256) { 'Hashes already match; nothing to do.'; return }
if (-not $Confirm) { 'The recorded hashes differ (or are missing). Re-run with -Confirm to record the current ones.'; return }
Write-JsonFile $file ([ordered]@{
        schema = 'prompt-hashes.v1'
        note = 'SHA-256 of each prompt block after normalizing line endings to LF. Updated only after the owner approves a prompt change.'
        base_sha256 = $p.base_sha256
        addendum_sha256 = $p.addendum_sha256
    })
'Recorded.'

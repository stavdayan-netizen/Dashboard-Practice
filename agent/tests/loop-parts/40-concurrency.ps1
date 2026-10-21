# Part of Test-AgentLoop.ps1: safe concurrent writes (several processes writing to one conversation, trace and spend ledger).

Section 'concurrent writers: four processes, one conversation'
Reset-Spend
$cc2 = NewConv
$childFile = Join-Path $tmp 'child.ps1'
[System.IO.File]::WriteAllText($childFile, @'
$ErrorActionPreference = 'Stop'
. (Join-Path $env:AGT_ROOT 'agent\agent-lib.ps1')
. (Join-Path $env:AGT_ROOT 'agent\agent-config.ps1')
Initialize-AgentLib -ProjectRoot $env:AGT_ROOT -StoreDir $env:AGT_STORE
foreach ($n in 1..10) {
    $r = Add-ConversationMessage -ConversationId $env:AGT_CONV -Role 'tenant' -Text ("child $($env:AGT_TAG) message $n")
    if (-not $r.ok) { throw "add failed: $($r.error.code)" }
    Add-TraceEvent $env:AGT_CONV ([ordered]@{ event = 'concurrency_test'; tag = $env:AGT_TAG; n = $n })
    Add-SpendEntry 'claude-haiku-5-5' $env:AGT_CONV 'test' $null 0.0001
}
'@, (New-Object System.Text.UTF8Encoding($false)))
$procs = @()
foreach ($tag in 'A', 'B', 'C', 'D') {
    $env:AGT_ROOT = $root; $env:AGT_STORE = $store; $env:AGT_CONV = $cc2; $env:AGT_TAG = $tag
    $procs += Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $childFile + '"')) -PassThru -WindowStyle Hidden
}
foreach ($p in $procs) { [void]$p.WaitForExit(180000) }
Assert (@($procs | Where-Object { $_.ExitCode -ne 0 }).Count -eq 0) 'all four writer processes finished without error'
$cv2 = Read-Conversation $cc2
$seqs = @($cv2.messages | ForEach-Object { [int]$_.seq })
Assert (@($cv2.messages).Count -eq 40) 'no message was lost (40 of 40)'
Assert ((($seqs | Sort-Object) -join ',') -ceq ((1..40) -join ',')) 'sequence numbers are unique and continuous'
Assert ((@($cv2.messages | ForEach-Object { $_.text } | Select-Object -Unique).Count) -eq 40) 'every message text is present once'
Assert (@($cv2.trace | Where-Object { $_.event -ceq 'concurrency_test' }).Count -eq 40) 'no trace entry was lost (40 of 40)'
$tseq = @($cv2.trace | ForEach-Object { [int]$_.seq })
Assert ((($tseq | Sort-Object) -join ',') -ceq ((1..40) -join ',')) 'trace sequence numbers are unique and continuous'
Assert ((Get-SpendEntries).Count -eq 40 -and ([Math]::Abs((Get-SpendTotals).total_usd - 0.004) -lt 0.000001)) 'no spend entry was lost (40 entries, 0.004 USD)'
Assert (@(Get-ChildItem -LiteralPath $store -Recurse -File -Filter '*.tmp').Count -eq 0) 'no temporary files left behind'
Remove-Item Env:\AGT_ROOT, Env:\AGT_STORE, Env:\AGT_CONV, Env:\AGT_TAG -ErrorAction SilentlyContinue

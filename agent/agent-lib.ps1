# AI Maintenance Agent, Stage 4: demo-only tools and local storage (Windows PowerShell 5.1).
#
# Dot-source this file, then call Initialize-AgentLib. It reads ONLY the fictional demo data in demo/
# and writes ONLY to the store directory (default agent-data/, ignored by git). It never writes to
# demo/, Airtable, Make or any ticket. There is no network code and no API key in this file.
#
# Audience ('tenant' or 'manager') is chosen by the CALLER (later: by the server route), never by the
# model or the browser. Every id and every tool input is validated before it is used.

$script:Cfg = $null
$script:Demo = $null

$script:RxTicket = '^(DEMO|HV)-\d{1,3}$'
$script:RxEquip = '^eq-hv-[a-z0-9]+(-[a-z0-9]+)*$'
$script:RxConv = '^conv-\d{14}-[0-9a-f]{8}$'
$script:RxProp = '^prop-\d{14}-[0-9a-f]{8}$'

$script:ToolNames = @('get_ticket_details', 'get_equipment_info', 'get_maintenance_history', 'get_equipment_manual_guidance', 'draft_ticket_update')
$script:Categories = @('Plumbing', 'HVAC', 'Electrical', 'Appliance', 'Doors & Locks', 'General')
$script:AiStatuses = @('Not Started', 'Analyzing', 'Waiting for Tenant', 'Escalated', 'Completed', 'Failed')
$script:AiUrgencies = @('Routine', 'Urgent', 'Emergency')
$script:MaxTenantText = 2000
$script:MaxAssistantText = 4000
$script:MaxMessages = 200
$script:MaxPendingPerConversation = 5

# ---------------------------------------------------------------- small helpers

function Get-Stamp { (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') }

function Get-Prop($Obj, [string]$Name, $Default = $null) {
    # The comma keeps a one-element array from being unrolled into a scalar (a list must stay a list).
    if ($null -eq $Obj) { return ,$Default }
    if ($Obj -is [System.Collections.IDictionary]) {
        if ($Obj.Contains($Name)) { return ,$Obj[$Name] } else { return ,$Default }
    }
    $p = $Obj.PSObject.Properties[$Name]
    if ($null -eq $p) { return ,$Default }
    return ,$p.Value
}

function Get-List($Obj, [string]$Name) {
    # A property as a real array (empty when missing). Use as: $x = Get-List ... or (Get-List ...) inside an expression.
    $v = Get-Prop $Obj $Name $null
    if ($null -eq $v) { return ,@() }
    return ,@($v)
}

function Test-IdFormat($Value, [string]$Rx) {
    return (($Value -is [string]) -and $Value.Length -le 64 -and ($Value -cmatch $Rx))
}

function Test-CleanText($Value, [int]$Max) {
    if ($Value -isnot [string]) { return $false }
    if ($Value.Trim().Length -eq 0 -or $Value.Length -gt $Max) { return $false }
    foreach ($ch in $Value.ToCharArray()) {
        $c = [int]$ch
        if ($c -lt 32 -and $c -ne 9 -and $c -ne 10 -and $c -ne 13) { return $false }
    }
    return $true
}

function New-Result([bool]$Ok, [string]$Tool, [string]$Audience, $Data = $null, [string]$Code = $null, [string]$Message = $null) {
    $r = [ordered]@{ ok = $Ok; tool = $Tool; audience = $Audience }
    if ($Ok) { $r['data'] = $Data } else { $r['error'] = [ordered]@{ code = $Code; message = $Message } }
    return $r
}

function Write-JsonFile([string]$Path, $Object) {
    $json = ConvertTo-Json -InputObject $Object -Depth 12
    $tmp = "$Path.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Read-JsonFile([string]$Path) {
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function New-RandomId([string]$Prefix) {
    $bytes = New-Object byte[] 4
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    return ('{0}-{1}-{2}' -f $Prefix, (Get-Date).ToString('yyyyMMddHHmmss'), $hex)
}

# ---------------------------------------------------------------- setup and demo data

function Initialize-AgentLib {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot, [string]$DemoDir, [string]$StoreDir, [string]$EnvDir)
    $root = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    if (-not $DemoDir) { $DemoDir = Join-Path $root 'demo' }
    if (-not $StoreDir) { $StoreDir = Join-Path $root 'agent-data' }
    $script:Cfg = @{
        Root = $root
        EnvDir = $(if ($EnvDir) { [System.IO.Path]::GetFullPath($EnvDir).TrimEnd([char]92) } else { $root })
        DemoDir = [System.IO.Path]::GetFullPath($DemoDir).TrimEnd('\')
        StoreDir = [System.IO.Path]::GetFullPath($StoreDir).TrimEnd('\')
    }
    foreach ($sub in 'conversations', 'proposals') {
        New-Item -ItemType Directory -Force -Path (Join-Path $script:Cfg.StoreDir $sub) | Out-Null
    }
    Import-DemoData
}

function Import-DemoData {
    $d = $script:Cfg.DemoDir
    $tickets = @{}
    foreach ($row in (Import-Csv -LiteralPath (Join-Path $d 'tickets.csv') -Encoding UTF8)) { $tickets[$row.id] = $row }
    $detailsFile = Read-JsonFile (Join-Path $d 'ticket_details.json')
    $details = @{}
    foreach ($p in $detailsFile.records.PSObject.Properties) { $details[$p.Name] = $p.Value }
    $equipment = @{}
    $eqFile = Read-JsonFile (Join-Path $d 'equipment.json')
    foreach ($r in $eqFile.records) { $equipment[$r.id] = $r }
    $events = @((Read-JsonFile (Join-Path $d 'equipment_history.json')).records)
    $manuals = @{}
    foreach ($m in (Read-JsonFile (Join-Path $d 'manuals.json')).records) { $manuals[$m.manual_id] = $m }
    $script:Demo = @{
        Tickets = $tickets; Details = $details; Equipment = $equipment; Events = $events; Manuals = $manuals
        PropertyName = (Get-Prop $eqFile 'property' '10 Harbor View')
    }
}

function Test-Initialized {
    return (($null -ne $script:Cfg) -and ($null -ne $script:Demo))
}

function Get-TicketExtra([string]$TicketId) {
    $x = $script:Demo.Details[$TicketId]
    return [ordered]@{
        equipment_ids = (Get-List $x 'equipment_ids')
        ai_handling_status = (Get-Prop $x 'ai_handling_status' 'Not Started')
        emergency_flag = [bool](Get-Prop $x 'emergency_flag' $false)
        notes = (Get-Prop $x 'notes' '')
        vendor_brief = (Get-Prop $x 'vendor_brief' '')
        repair_date = (Get-Prop $x 'repair_date' '')
        repair_summary = (Get-Prop $x 'repair_summary' '')
        receipts = (Get-List $x 'receipts')
        attachments = (Get-List $x 'attachments')
    }
}

function Test-EquipmentTenantVisible($Rec) {
    return ((Get-Prop $Rec 'visibility' '') -ceq 'Tenant Accessible')
}

# ---------------------------------------------------------------- conversations (stored locally, outside git)

function Get-ConversationPath([string]$Id) {
    if (-not (Test-IdFormat $Id $script:RxConv)) { return $null }
    return (Join-Path (Join-Path $script:Cfg.StoreDir 'conversations') ($Id + '.json'))
}

function Get-ProposalPath([string]$Id) {
    if (-not (Test-IdFormat $Id $script:RxProp)) { return $null }
    return (Join-Path (Join-Path $script:Cfg.StoreDir 'proposals') ($Id + '.json'))
}

function Read-Conversation([string]$Id) {
    $path = Get-ConversationPath $Id
    if ($null -eq $path -or -not (Test-Path -LiteralPath $path)) { return $null }
    return (Read-JsonFile $path)
}

function Get-AllowedEquipmentIds($Conv) {
    $ids = @()
    $ids += @((Get-TicketExtra $Conv.ticket_id).equipment_ids)
    $eid = Get-Prop $Conv 'equipment_id' $null
    if ($eid) { $ids += $eid }
    return @($ids | Where-Object { $_ } | Select-Object -Unique)
}

function Get-ConversationContextBlock($Conv) {
    # Server-built, model-only text naming the ticket and the equipment this conversation may use with the tools.
    # Everything is re-checked here against the demo data (nothing is trusted from the stored record or the client):
    # the ticket must exist at this property, and each item must exist and be tenant visible. Names only, no internal fields.
    if (-not (Test-Initialized)) { return $null }
    $tid = [string](Get-Prop $Conv 'ticket_id' '')
    if (-not (Test-IdFormat $tid $script:RxTicket) -or -not $script:Demo.Tickets.ContainsKey($tid)) { return $null }
    if ($script:Demo.Tickets[$tid].property -cne $script:Demo.PropertyName) { return $null }
    $items = @()
    foreach ($eid in (Get-AllowedEquipmentIds $Conv)) {
        if (-not (Test-IdFormat $eid $script:RxEquip) -or -not $script:Demo.Equipment.ContainsKey($eid)) { continue }
        $rec = $script:Demo.Equipment[$eid]
        if (-not (Test-EquipmentTenantVisible $rec)) { continue }
        $type = [string](Get-Prop $rec 'type' '')
        $items += $(if ($type -match '^[A-Za-z0-9 /&()-]{1,60}$') { "$eid ($type)" } else { $eid })
    }
    $lines = @('CONTEXT FROM THE SYSTEM (not written by the tenant). This conversation is about ticket ' + $tid + '.')
    if ($items.Count -gt 0) { $lines += ('Equipment linked to this conversation: ' + ($items -join ', ') + '.') }
    else { $lines += 'No equipment is linked yet; read the ticket first to find which equipment it concerns.' }
    $lines += 'Use these ids when you call your tools. The tenant does not know them, so never ask the tenant for a ticket number or equipment id, and never mention the ids.'
    return ($lines -join ' ')
}

function Get-StoreMutex {
    $key = $script:Cfg.StoreDir.ToLowerInvariant()
    if ($script:MutexKey -ceq $key -and $null -ne $script:StoreMutex) { return $script:StoreMutex }
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $h = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') })
    $sha.Dispose()
    $script:StoreMutex = New-Object System.Threading.Mutex($false, ('Local\DashboardPracticeAgent-' + $h))
    $script:MutexKey = $key
    return $script:StoreMutex
}

function Invoke-StoreLock([scriptblock]$Block) {
    # One writer at a time across threads and processes of this login session (read-modify-write safety).
    $m = Get-StoreMutex
    $got = $false
    try {
        try { $got = $m.WaitOne(20000) } catch [System.Threading.AbandonedMutexException] { $got = $true }
        if (-not $got) { throw 'The agent store is busy.' }
        return (& $Block)
    }
    finally { if ($got) { $m.ReleaseMutex() } }
}

function New-TenantToken {
    $bytes = New-Object byte[] 24
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return ([Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('='))
}

function Get-TokenHash([string]$Token) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $h = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Token)) | ForEach-Object { $_.ToString('x2') })
    $sha.Dispose()
    return $h
}

function Test-ConversationToken([string]$ConversationId, [string]$Token) {
    # A tenant must present the secret returned when the conversation was opened.
    if ($Token -notmatch '^[A-Za-z0-9_-]{32}$') { return $false }
    $conv = Read-Conversation $ConversationId
    if ($null -eq $conv) { return $false }
    $stored = Get-Prop $conv 'tenant_token_sha256' $null
    if (-not $stored) { return $false }
    return ((Get-TokenHash $Token) -ceq $stored)
}

function New-Conversation {
    param([string]$TicketId, [string]$EquipmentId)
    if (-not (Test-Initialized)) { throw 'Library not initialized.' }
    if (-not (Test-IdFormat $TicketId $script:RxTicket) -or -not $script:Demo.Tickets.ContainsKey($TicketId)) {
        return (New-Result $false 'new_conversation' 'server' $null 'not_available' 'That ticket is not available.')
    }
    if ($script:Demo.Tickets[$TicketId].property -cne $script:Demo.PropertyName) {
        return (New-Result $false 'new_conversation' 'server' $null 'not_available' 'That ticket is not available.')
    }
    if ($EquipmentId) {
        $ok = (Test-IdFormat $EquipmentId $script:RxEquip) -and $script:Demo.Equipment.ContainsKey($EquipmentId) -and (Test-EquipmentTenantVisible $script:Demo.Equipment[$EquipmentId])
        if (-not $ok) { return (New-Result $false 'new_conversation' 'server' $null 'not_available' 'That equipment is not available.') }
    }
    $id = New-RandomId 'conv'
    $token = New-TenantToken
    $now = Get-Stamp
    $conv = [ordered]@{
        schema = 'conversation.v1'
        id = $id
        ticket_id = $TicketId
        equipment_id = $(if ($EquipmentId) { $EquipmentId } else { $null })
        created_at = $now
        updated_at = $now
        status = 'open'
        model = $null
        prompt_hashes = [ordered]@{ base = $null; addendum = $null }
        tenant_token_sha256 = (Get-TokenHash $token)
        facts = $null
        summary = $null
        messages = @()
        trace = @()
    }
    Write-JsonFile (Get-ConversationPath $id) $conv
    return (New-Result $true 'new_conversation' 'server' ([ordered]@{ conversation_id = $id; ticket_id = $TicketId; created_at = $now; tenant_token = $token }))
}

function Add-ConversationMessage {
    param([string]$ConversationId, [string]$Role, [string]$Text, [string]$Source)
    if ($Role -cne 'tenant' -and $Role -cne 'assistant') { return (New-Result $false 'add_message' 'server' $null 'invalid_input' 'Role must be tenant or assistant.') }
    if (-not $Source) { $Source = $(if ($Role -ceq 'tenant') { 'tenant' } else { 'model' }) }
    if ($Source -cne 'tenant' -and $Source -cne 'model' -and $Source -cne 'failsafe') { return (New-Result $false 'add_message' 'server' $null 'invalid_input' 'Unknown message source.') }
    $max = $(if ($Role -ceq 'tenant') { $script:MaxTenantText } else { $script:MaxAssistantText })
    if (-not (Test-CleanText $Text $max)) { return (New-Result $false 'add_message' 'server' $null 'invalid_input' "Text must be 1 to $max characters without control characters.") }
    return (Invoke-StoreLock {
            $conv = Read-Conversation $ConversationId
            if ($null -eq $conv) { return (New-Result $false 'add_message' 'server' $null 'not_available' 'Conversation not available.') }
            if (@($conv.messages).Count -ge $script:MaxMessages) { return (New-Result $false 'add_message' 'server' $null 'limit_exceeded' 'Conversation message limit reached.') }
            $seq = @($conv.messages).Count + 1
            $ts = Get-Stamp
            $msg = [ordered]@{ seq = $seq; ts = $ts; role = $Role; source = $Source; text = $Text; attachments = @() }
            $conv.messages = @($conv.messages) + @($msg)
            $conv.updated_at = $ts
            Write-JsonFile (Get-ConversationPath $ConversationId) $conv
            return (New-Result $true 'add_message' 'server' ([ordered]@{ seq = $seq; ts = $ts }))
        })
}

function Add-TraceEvent($ConversationId, $Entry) {
    # Manager-only trace entry (tool call, model call, guard event). Never carries tool result data.
    if (-not (Test-IdFormat $ConversationId $script:RxConv)) { return }
    [void](Invoke-StoreLock {
            $conv = Read-Conversation $ConversationId
            if ($null -eq $conv) { return }
            $e = [ordered]@{ seq = @($conv.trace).Count + 1; ts = Get-Stamp }
            foreach ($k in $Entry.Keys) { $e[$k] = $Entry[$k] }
            $conv.trace = @($conv.trace) + @($e)
            Write-JsonFile (Get-ConversationPath $ConversationId) $conv
        })
}

function Add-ToolTrace($ConversationId, [string]$Tool, [string]$Audience, $ToolInput, $Result) {
    $err = Get-Prop $Result 'error' $null
    Add-TraceEvent $ConversationId ([ordered]@{
            tool = $Tool
            audience = $Audience
            input = $ToolInput
            ok = [bool]$Result['ok']
            error_code = $(if ($err) { $err['code'] } else { $null })
        })
}

function Set-ConversationFields {
    # Server-side updates to a few conversation fields (never messages, never the token).
    param([string]$ConversationId, [hashtable]$Fields)
    $allowed = @('model', 'prompt_hashes', 'summary', 'facts', 'status')
    foreach ($k in $Fields.Keys) { if ($allowed -cnotcontains $k) { throw "Field '$k' cannot be set." } }
    [void](Invoke-StoreLock {
            $conv = Read-Conversation $ConversationId
            if ($null -eq $conv) { throw 'Conversation not available.' }
            foreach ($k in $Fields.Keys) {
                if ($null -ne $conv.PSObject.Properties[$k]) { $conv.$k = $Fields[$k] }
                else { Add-Member -InputObject $conv -NotePropertyName $k -NotePropertyValue $Fields[$k] }
            }
            $conv.updated_at = Get-Stamp
            Write-JsonFile (Get-ConversationPath $ConversationId) $conv
        })
}

function Get-ConversationView {
    param([string]$ConversationId, [string]$Audience)
    $conv = Read-Conversation $ConversationId
    if ($null -eq $conv) { return (New-Result $false 'get_conversation' $Audience $null 'not_available' 'Conversation not available.') }
    if ($Audience -ceq 'tenant') {
        $msgs = @(@($conv.messages) | ForEach-Object { [ordered]@{ ts = $_.ts; role = $_.role; text = $_.text } })
        return (New-Result $true 'get_conversation' 'tenant' ([ordered]@{ conversation_id = $conv.id; messages = $msgs }))
    }
    if ($Audience -cne 'manager') { return (New-Result $false 'get_conversation' $Audience $null 'forbidden' 'Unknown audience.') }
    $props = @(Get-ProposalList -Audience 'manager' | Where-Object { $_.conversation_id -ceq $conv.id })
    $full = [ordered]@{}
    foreach ($p in $conv.PSObject.Properties) { if ($p.Name -cne 'tenant_token_sha256') { $full[$p.Name] = $p.Value } }
    $full['proposals'] = $props
    return (New-Result $true 'get_conversation' 'manager' $full)
}

function Get-ConversationsForTicket {
    param([string]$TicketId, [string]$Audience)
    if ($Audience -cne 'manager') { return (New-Result $false 'list_conversations' $Audience $null 'forbidden' 'Manager only.') }
    if (-not (Test-IdFormat $TicketId $script:RxTicket) -or -not $script:Demo.Tickets.ContainsKey($TicketId)) {
        return (New-Result $false 'list_conversations' 'manager' $null 'not_found' 'Ticket not found.')
    }
    $out = @()
    foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $script:Cfg.StoreDir 'conversations') -Filter 'conv-*.json' -File)) {
        $c = Read-JsonFile $f.FullName
        if ($c.ticket_id -ceq $TicketId) { $out += (Get-ConversationView -ConversationId $c.id -Audience 'manager').data }
    }
    return (New-Result $true 'list_conversations' 'manager' ([ordered]@{ ticket_id = $TicketId; conversations = @($out) }))
}

# ---------------------------------------------------------------- authorization used by the tools

function Resolve-ToolContext([string]$Tool, [string]$Audience, [string]$ConversationId) {
    # Returns @{ ok; conv; result } . Tenant calls must be bound to an existing conversation.
    if ($Audience -cne 'tenant' -and $Audience -cne 'manager') {
        return @{ ok = $false; result = (New-Result $false $Tool $Audience $null 'forbidden' 'Unknown audience.') }
    }
    $conv = $null
    if ($ConversationId) {
        $conv = Read-Conversation $ConversationId
        if ($null -eq $conv) { return @{ ok = $false; result = (New-Result $false $Tool $Audience $null 'not_available' 'Conversation not available.') } }
    }
    if ($Audience -ceq 'tenant' -and $null -eq $conv) {
        return @{ ok = $false; result = (New-Result $false $Tool 'tenant' $null 'conversation_required' 'A tenant call needs a conversation.') }
    }
    return @{ ok = $true; conv = $conv }
}

function Get-NotAvailable([string]$Tool, [string]$Audience) {
    if ($Audience -ceq 'manager') { return (New-Result $false $Tool $Audience $null 'not_found' 'Not found.') }
    return (New-Result $false $Tool $Audience $null 'not_available' 'That record is not available in this conversation.')
}

function Test-EquipmentAccess([string]$Audience, $Conv, $EquipmentId) {
    # $true when the caller may read this equipment record.
    if (-not (Test-IdFormat $EquipmentId $script:RxEquip)) { return $false }
    if (-not $script:Demo.Equipment.ContainsKey($EquipmentId)) { return $false }
    if ($Audience -ceq 'manager') { return $true }
    if (-not (Test-EquipmentTenantVisible $script:Demo.Equipment[$EquipmentId])) { return $false }
    return ((Get-AllowedEquipmentIds $Conv) -contains $EquipmentId)
}

# ---------------------------------------------------------------- the five tools

function Get-ManualState($Rec) {
    $mid = Get-Prop $Rec 'manual_id' $null
    $state = [ordered]@{ manual_available = $false; manual_status = 'none'; reason = 'no_manual_registered'; manual = $null }
    if (-not $mid -or -not $script:Demo.Manuals.ContainsKey($mid)) { return $state }
    $m = $script:Demo.Manuals[$mid]
    $state.manual = $m
    $state.manual_status = (Get-Prop $m 'manual_status' 'unavailable')
    if ((Get-Prop $m 'equipment_id' '') -cne $Rec.id) { $state.reason = 'manual_for_other_equipment'; return $state }
    if ($state.manual_status -cne 'verified') { $state.reason = 'manual_unavailable'; return $state }
    if (-not (Get-Prop $Rec 'model' $null)) { $state.reason = 'model_missing'; return $state }
    if (((Get-Prop $m 'brand' '') -cne (Get-Prop $Rec 'brand' '')) -or ((Get-Prop $m 'model' '') -cne $Rec.model)) { $state.reason = 'brand_model_mismatch'; return $state }
    if ((Get-Prop (Get-Prop $m 'verification' $null) 'record_model_verified' $false) -ne $true) { $state.reason = 'model_unverified'; return $state }
    $state.manual_available = $true
    $state.reason = $null
    return $state
}

function Get-GuidanceScope($Manual) {
    $v = Get-Prop $Manual 'verification' $null
    $cov = Get-Prop $v 'coverage' 'none'
    $exact = ((Get-Prop $v 'model_printed_in_document' $false) -eq $true)
    $scope = switch ($cov) { 'series-level' { 'series_or_general' } 'model-level' { 'model_family' } default { 'none' } }
    $note = switch ($scope) {
        'series_or_general' { "Series or general guidance from the manufacturer's document. It is not guidance specific to this exact model number." }
        'model_family' { "Guidance for the model family named on the document's cover. The full model number is not printed in the document." }
        default { 'No manufacturer guidance.' }
    }
    $detail = Get-Prop $v 'coverage_detail' $null
    if ($detail) { $note = "$note $detail" }
    return [ordered]@{ guidance_scope = $scope; exact_model_guidance = $exact; scope_note = $note }
}

function Invoke-GetTicketDetails($In, [string]$Audience, $Conv) {
    $tool = 'get_ticket_details'
    $tid = Get-Prop $In 'ticket_id' $null
    if ($Audience -ceq 'tenant' -and -not $tid) { $tid = $Conv.ticket_id }
    if (-not (Test-IdFormat $tid $script:RxTicket)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'ticket_id has an invalid format.') }
    if (-not $script:Demo.Tickets.ContainsKey($tid)) { return (Get-NotAvailable $tool $Audience) }
    if ($Audience -ceq 'tenant' -and $tid -cne $Conv.ticket_id) { return (Get-NotAvailable $tool $Audience) }
    $row = $script:Demo.Tickets[$tid]
    $x = Get-TicketExtra $tid
    $linked = @()
    foreach ($eid in $x.equipment_ids) {
        if (-not $script:Demo.Equipment.ContainsKey($eid)) { continue }
        $rec = $script:Demo.Equipment[$eid]
        if ($Audience -ceq 'tenant' -and -not (Test-EquipmentTenantVisible $rec)) { continue }
        $linked += [ordered]@{ id = $eid; type = $rec.type; brand = $rec.brand; model = $rec.model; location = $rec.location }
    }
    if ($Audience -ceq 'tenant') {
        $data = [ordered]@{
            visibility = 'Tenant Accessible'
            ticket = [ordered]@{
                id = $tid; date_created = $row.date_created; property = $row.property; issue = $row.issue
                category = $row.category; priority = $row.priority; status = $row.status
                date_resolved = $(if ($row.date_resolved) { $row.date_resolved } else { $null })
                linked_equipment = @($linked)
            }
        }
    }
    else {
        $data = [ordered]@{
            visibility = 'Internal Only (manager audience)'
            ticket = [ordered]@{
                id = $tid; date_created = $row.date_created; property = $row.property; tenant = $row.tenant; issue = $row.issue
                category = $row.category; priority = $row.priority; status = $row.status; assigned_to = $row.assigned_to
                date_resolved = $row.date_resolved; cost = $row.cost; cost_date = $row.cost_date; ai_summary = $row.ai_summary
                emergency_flag = $x.emergency_flag; ai_handling_status = $x.ai_handling_status; notes = $x.notes
                vendor_brief = $x.vendor_brief; repair_date = $x.repair_date; repair_summary = $x.repair_summary
                receipt_count = @($x.receipts).Count; attachment_count = @($x.attachments).Count
                linked_equipment = @($linked)
            }
        }
    }
    return (New-Result $true $tool $Audience $data)
}

function Invoke-GetEquipmentInfo($In, [string]$Audience, $Conv) {
    $tool = 'get_equipment_info'
    $eid = Get-Prop $In 'equipment_id' $null
    if (-not (Test-IdFormat $eid $script:RxEquip)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'equipment_id has an invalid format.') }
    if (-not (Test-EquipmentAccess $Audience $Conv $eid)) { return (Get-NotAvailable $tool $Audience) }
    $rec = $script:Demo.Equipment[$eid]
    $ms = Get-ManualState $rec
    $serial = Get-Prop $rec 'serial_number' $null
    $manualInfo = [ordered]@{ manual_available = $ms.manual_available; manual_status = $ms.manual_status; reason_unavailable = $ms.reason }
    if ($ms.manual_available) { $manualInfo['guidance_scope'] = (Get-GuidanceScope $ms.manual).guidance_scope }
    $core = [ordered]@{
        id = $rec.id; category = $rec.category; type = $rec.type; presence = $rec.presence; ownership = $rec.ownership
        brand = $rec.brand; model = $rec.model
        serial_number = $serial
        serial_number_is_fictional = [bool]($serial -and ($serial -clike 'FICT-*'))
        manufacture_year = $rec.manufacture_year; manufacture_year_accuracy = $rec.manufacture_year_accuracy
        location = $rec.location; information_status = $rec.information_status; details = $rec.details
        manual = $manualInfo
    }
    if ($Audience -ceq 'tenant') {
        return (New-Result $true $tool 'tenant' ([ordered]@{ visibility = 'Tenant Accessible'; equipment = $core }))
    }
    $core['visibility_label'] = $rec.visibility
    $core['seller'] = $rec.seller; $core['purchase_date'] = $rec.purchase_date
    $core['installation_date'] = $rec.installation_date; $core['installation_company'] = $rec.installation_company
    $core['installer_contact'] = $rec.installer_contact
    $core['product_warranty'] = [ordered]@{ description = $rec.product_warranty.description; expires = $rec.product_warranty.expires }
    $core['workmanship_warranty'] = $rec.workmanship_warranty
    $core['notes'] = $rec.notes
    $core['attachment_counts'] = [ordered]@{
        photos = @($rec.attachments.photos).Count; receipts = @($rec.attachments.receipts).Count
        manuals = @($rec.attachments.manuals).Count; warranty_docs = @($rec.attachments.warranty_docs).Count
    }
    return (New-Result $true $tool 'manager' ([ordered]@{ visibility = 'Internal Only (manager audience)'; equipment = $core }))
}

function Invoke-GetMaintenanceHistory($In, [string]$Audience, $Conv) {
    $tool = 'get_maintenance_history'
    $eid = Get-Prop $In 'equipment_id' $null
    if (-not (Test-IdFormat $eid $script:RxEquip)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'equipment_id has an invalid format.') }
    $limit = Get-Prop $In 'limit' 10
    if (($limit -isnot [int] -and $limit -isnot [long]) -or $limit -lt 1 -or $limit -gt 20) { return (New-Result $false $tool $Audience $null 'invalid_input' 'limit must be a whole number from 1 to 20.') }
    if (-not (Test-EquipmentAccess $Audience $Conv $eid)) { return (Get-NotAvailable $tool $Audience) }
    $entries = @()
    $ticketCount = 0
    $cats = @()
    foreach ($tid in ($script:Demo.Tickets.Keys | Sort-Object)) {
        $x = Get-TicketExtra $tid
        if ($x.equipment_ids -notcontains $eid) { continue }
        $row = $script:Demo.Tickets[$tid]
        $ticketCount++; $cats += $row.category
        $date = $(if ($x.repair_date) { $x.repair_date } elseif ($row.date_resolved) { $row.date_resolved } else { $row.date_created })
        $e = [ordered]@{ source = 'ticket'; date = $date; issue = $row.issue; category = $row.category; status = $row.status }
        if ($Audience -ceq 'tenant') { if ($Conv -and $tid -ceq $Conv.ticket_id) { $e['is_current_ticket'] = $true } }
        else { $e['ticket_id'] = $tid; $e['assigned_to'] = $row.assigned_to; $e['cost'] = $row.cost; $e['repair_summary'] = $x.repair_summary }
        $entries += $e
    }
    foreach ($ev in $script:Demo.Events) {
        if ($ev.equipment_id -cne $eid) { continue }
        $e = [ordered]@{ source = 'event'; date = $ev.date; type = $ev.type; description = $ev.description }
        if ($Audience -ceq 'manager') { $e['vendor'] = $ev.vendor; $e['cost'] = $ev.cost }
        $entries += $e
    }
    $sorted = @($entries | Sort-Object { $_['date'] } -Descending)
    $returned = @($sorted | Select-Object -First $limit)
    $data = [ordered]@{
        visibility = $(if ($Audience -ceq 'tenant') { 'Tenant Accessible' } else { 'Internal Only (manager audience)' })
        equipment_id = $eid
        total_entries = $sorted.Count
        entries = $returned
        recurring_issue_hint = [ordered]@{ linked_ticket_count = $ticketCount; recurring = ($ticketCount -ge 2); categories = @($cats | Select-Object -Unique) }
    }
    return (New-Result $true $tool $Audience $data)
}

function Invoke-GetEquipmentManualGuidance($In, [string]$Audience, $Conv) {
    $tool = 'get_equipment_manual_guidance'
    $eid = Get-Prop $In 'equipment_id' $null
    $q = Get-Prop $In 'question' $null
    if (-not (Test-IdFormat $eid $script:RxEquip)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'equipment_id has an invalid format.') }
    if (-not (Test-CleanText $q 300)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'question must be 1 to 300 characters.') }
    if (-not (Test-EquipmentAccess $Audience $Conv $eid)) { return (Get-NotAvailable $tool $Audience) }
    $rec = $script:Demo.Equipment[$eid]
    $ms = Get-ManualState $rec
    if (-not $ms.manual_available) {
        return (New-Result $true $tool $Audience ([ordered]@{
            matched = $false; reason = $ms.reason; guidance = $null
            instruction = 'No matched manufacturer manual. Use only basic safe checks and do not claim manufacturer authority.'
        }))
    }
    $m = $ms.manual
    $scope = Get-GuidanceScope $m
    $qLower = $q.ToLowerInvariant()
    $best = $null; $bestScore = 0
    foreach ($t in @($m.guidance.topics)) {
        $score = 0
        foreach ($k in @($t.keywords)) { if ($qLower.Contains(([string]$k).ToLowerInvariant())) { $score++ } }
        if ($score -gt $bestScore) { $best = $t; $bestScore = $score }
    }
    $head = [ordered]@{
        matched = $true
        manufacturer = $m.manufacturer; brand = $m.brand; model = $rec.model
        document = [ordered]@{
            title = $m.document.title; document_number = $m.document.document_number
            revision_date = $m.document.revision_date; official_page = (Get-Prop $m.official_source 'model_support_page' (Get-Prop $m.official_source 'owner_manuals_page' $null))
            official_document_url = $m.official_source.document_url
        }
        verified_on = $m.verification.verified_on
        coverage = $m.verification.coverage
        guidance_scope = $scope.guidance_scope
        exact_model_guidance = $scope.exact_model_guidance
        scope_note = $scope.scope_note
    }
    if ($null -eq $best) {
        $head['topic_matched'] = $false
        $head['available_topics'] = @(@($m.guidance.topics) | ForEach-Object { [ordered]@{ topic_id = $_.topic_id; keywords = @($_.keywords) } })
        $head['guidance'] = $null
        return (New-Result $true $tool $Audience $head)
    }
    $head['topic_matched'] = $true
    $head['guidance'] = [ordered]@{
        topic_id = $best.topic_id
        tenant_safe_checks = @($best.tenant_safe_checks)
        do_not_offer_to_tenants = @(@($best.professional_only_or_restricted) | ForEach-Object { [ordered]@{ text = $_.text; pages = @($_.pages) } })
        warnings = @($best.warnings)
        normal_behavior = (Get-List $best 'normal_behavior')
        ownership_note = (Get-Prop $best 'ownership_note' $null)
    }
    return (New-Result $true $tool $Audience $head)
}

function Invoke-DraftTicketUpdate($In, [string]$Audience, $Conv) {
    $tool = 'draft_ticket_update'
    if ($null -eq $Conv) { return (New-Result $false $tool $Audience $null 'conversation_required' 'A proposal must belong to a conversation.') }
    $tid = Get-Prop $In 'ticket_id' $Conv.ticket_id
    if (-not (Test-IdFormat $tid $script:RxTicket)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'ticket_id has an invalid format.') }
    if (-not $script:Demo.Tickets.ContainsKey($tid) -or $tid -cne $Conv.ticket_id) { return (Get-NotAvailable $tool $Audience) }
    $reason = Get-Prop $In 'reason' $null
    if (-not (Test-CleanText $reason 500)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'reason must be 1 to 500 characters.') }
    $confirmed = Get-Prop $In 'tenant_confirmed_resolution' $false
    if ($confirmed -isnot [bool]) { return (New-Result $false $tool $Audience $null 'invalid_input' 'tenant_confirmed_resolution must be true or false.') }
    $fieldsIn = Get-Prop $In 'fields' $null
    if ($null -eq $fieldsIn -or $fieldsIn -is [string]) { return (New-Result $false $tool $Audience $null 'invalid_input' 'fields must be an object.') }
    $names = @()
    if ($fieldsIn -is [System.Collections.IDictionary]) { $names = @($fieldsIn.Keys) } else { $names = @($fieldsIn.PSObject.Properties | ForEach-Object { $_.Name }) }
    if ($names.Count -eq 0) { return (New-Result $false $tool $Audience $null 'invalid_input' 'fields must contain at least one proposed change.') }
    $allowed = @('summary', 'category', 'ai_urgency', 'emergency_flag', 'ai_handling_status', 'notes', 'equipment_ids', 'status')
    $clean = [ordered]@{}
    foreach ($n in ($names | Sort-Object)) {
        if ($n -ceq 'priority') { return (New-Result $false $tool $Audience $null 'invalid_input' 'priority is the manager''s decision and cannot be proposed.') }
        if ($allowed -cnotcontains $n) { return (New-Result $false $tool $Audience $null 'invalid_input' "Field '$n' cannot be proposed.") }
        $v = Get-Prop $fieldsIn $n $null
        switch ($n) {
            'summary' { if (-not (Test-CleanText $v 500)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'summary must be 1 to 500 characters.') } }
            'notes' { if (-not (Test-CleanText $v 1000)) { return (New-Result $false $tool $Audience $null 'invalid_input' 'notes must be 1 to 1000 characters.') } }
            'category' { if ($v -isnot [string] -or $script:Categories -cnotcontains $v) { return (New-Result $false $tool $Audience $null 'invalid_input' 'category is not in the allowed list.') } }
            'ai_urgency' { if ($v -isnot [string] -or $script:AiUrgencies -cnotcontains $v) { return (New-Result $false $tool $Audience $null 'invalid_input' 'ai_urgency must be Routine, Urgent or Emergency.') } }
            'ai_handling_status' { if ($v -isnot [string] -or $script:AiStatuses -cnotcontains $v) { return (New-Result $false $tool $Audience $null 'invalid_input' 'ai_handling_status is not in the allowed list.') } }
            'emergency_flag' { if ($v -isnot [bool]) { return (New-Result $false $tool $Audience $null 'invalid_input' 'emergency_flag must be true or false.') } }
            'status' {
                if ($v -cne 'Resolved') { return (New-Result $false $tool $Audience $null 'invalid_input' 'Only the status Resolved can be proposed.') }
                if (-not $confirmed) { return (New-Result $false $tool $Audience $null 'invalid_input' 'Resolved needs tenant_confirmed_resolution true.') }
                if (-not (@($Conv.messages) | Where-Object { $_.role -ceq 'tenant' })) { return (New-Result $false $tool $Audience $null 'invalid_input' 'There is no tenant message in this conversation.') }
            }
            'equipment_ids' {
                $arr = @($v)
                if ($v -isnot [System.Array] -or $arr.Count -lt 1 -or $arr.Count -gt 5) { return (New-Result $false $tool $Audience $null 'invalid_input' 'equipment_ids must be a list of 1 to 5 ids.') }
                foreach ($e in $arr) { if (-not (Test-EquipmentAccess $Audience $Conv $e)) { return (Get-NotAvailable $tool $Audience) } }
                $v = @($arr | Select-Object -Unique)
            }
        }
        $clean[$n] = $v
    }
    $autoAdded = @()
    $urgency = Get-Prop $clean 'ai_urgency' $null
    if ($urgency -ceq 'Emergency') {
        if ($clean.Contains('emergency_flag') -and $clean['emergency_flag'] -ne $true) { return (New-Result $false $tool $Audience $null 'invalid_input' 'An Emergency needs emergency_flag true.') }
        if ($clean.Contains('ai_handling_status') -and $clean['ai_handling_status'] -cne 'Escalated') { return (New-Result $false $tool $Audience $null 'invalid_input' 'An Emergency needs ai_handling_status Escalated.') }
        if (-not $clean.Contains('emergency_flag')) { $clean['emergency_flag'] = $true; $autoAdded += 'emergency_flag' }
        if (-not $clean.Contains('ai_handling_status')) { $clean['ai_handling_status'] = 'Escalated'; $autoAdded += 'ai_handling_status' }
    }
    $canon = (ConvertTo-Json -InputObject ([ordered]@{ ticket = $tid; fields = $clean }) -Depth 6 -Compress)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canon)) | ForEach-Object { $_.ToString('x2') })
    $sha.Dispose()
    return (Invoke-StoreLock {
            $pending = @(Get-ProposalList -Audience 'manager' | Where-Object { $_.conversation_id -ceq $Conv.id -and $_.status -ceq 'pending' })
            $dup = $pending | Where-Object { $_.fields_hash -ceq $hash } | Select-Object -First 1
            if ($dup) { return (New-Result $true $tool $Audience ([ordered]@{ proposal_id = $dup.id; status = 'pending'; duplicate = $true })) }
            if ($pending.Count -ge $script:MaxPendingPerConversation) { return (New-Result $false $tool $Audience $null 'limit_exceeded' 'Too many pending proposals for this conversation.') }
            $pid2 = New-RandomId 'prop'
            $now = Get-Stamp
            $prop = [ordered]@{
                schema = 'proposal.v1'; id = $pid2; conversation_id = $Conv.id; ticket_id = $tid
                proposed_fields = $clean; auto_added_fields = @($autoAdded); reason = $reason
                tenant_confirmed_resolution = $confirmed; fields_hash = $hash
                status = 'pending'; created_at = $now; decided_at = $null; applied_at = $null; decision_note = $null
                history = @([ordered]@{ ts = $now; event = 'created'; by = 'agent' })
            }
            Write-JsonFile (Get-ProposalPath $pid2) $prop
            return (New-Result $true $tool $Audience ([ordered]@{ proposal_id = $pid2; status = 'pending'; duplicate = $false }))
        })
}

# ---------------------------------------------------------------- tool dispatcher and definitions

$script:RxWarranty = '(?i)warrant|guarantee'

function Remove-WarrantyInfo($Node) {
    # Warranty dates, coverage and terms are manager-only. The tools already leave the structured warranty fields out of the
    # tenant view; this is the second layer for free text: any field name or text value about a warranty or guarantee is dropped
    # from every tenant tool result, at any depth, whatever record it came from.
    if ($null -eq $Node -or $Node -is [string] -or $Node -is [ValueType]) { return $Node }
    if ($Node -is [System.Collections.IDictionary]) {
        foreach ($k in @($Node.Keys)) {
            $v = $Node[$k]
            if ([string]$k -match $script:RxWarranty -or ($v -is [string] -and $v -match $script:RxWarranty)) { $Node.Remove($k); continue }
            $Node[$k] = Remove-WarrantyInfo $v
        }
        return $Node
    }
    if ($Node -is [System.Collections.IEnumerable]) {
        $out = @()
        foreach ($i in $Node) { if ($i -is [string] -and $i -match $script:RxWarranty) { continue }; $out += , (Remove-WarrantyInfo $i) }
        return , $out
    }
    foreach ($p in @($Node.PSObject.Properties)) {
        $v = $p.Value
        if ($p.Name -match $script:RxWarranty -or ($v -is [string] -and $v -match $script:RxWarranty)) { $Node.PSObject.Properties.Remove($p.Name); continue }
        $p.Value = Remove-WarrantyInfo $v
    }
    return $Node
}

function Invoke-AgentTool {
    param([string]$Name, $ToolInput, [string]$Audience, [string]$ConversationId)
    try {
        if (-not (Test-Initialized)) { throw 'Library not initialized.' }
        if ($script:ToolNames -cnotcontains $Name) { return (New-Result $false $Name $Audience $null 'unknown_tool' 'That tool does not exist.') }
        $ctx = Resolve-ToolContext $Name $Audience $ConversationId
        if (-not $ctx.ok) { return $ctx.result }
        if ($null -eq $ToolInput) { $ToolInput = @{} }
        $propNames = $(if ($ToolInput -is [System.Collections.IDictionary]) { @($ToolInput.Keys) } else { @($ToolInput.PSObject.Properties | ForEach-Object { $_.Name }) })
        $allowedProps = switch ($Name) {
            'get_ticket_details' { @('ticket_id') }
            'get_equipment_info' { @('equipment_id') }
            'get_maintenance_history' { @('equipment_id', 'limit') }
            'get_equipment_manual_guidance' { @('equipment_id', 'question') }
            'draft_ticket_update' { @('ticket_id', 'fields', 'reason', 'tenant_confirmed_resolution') }
        }
        foreach ($p in $propNames) {
            if ($allowedProps -cnotcontains $p) {
                $res = New-Result $false $Name $Audience $null 'invalid_input' "Unknown input property '$p'."
                if ($ConversationId) { Add-ToolTrace $ConversationId $Name $Audience @{ rejected = 'unknown_property' } $res }
                return $res
            }
        }
        $result = switch ($Name) {
            'get_ticket_details' { Invoke-GetTicketDetails $ToolInput $Audience $ctx.conv }
            'get_equipment_info' { Invoke-GetEquipmentInfo $ToolInput $Audience $ctx.conv }
            'get_maintenance_history' { Invoke-GetMaintenanceHistory $ToolInput $Audience $ctx.conv }
            'get_equipment_manual_guidance' { Invoke-GetEquipmentManualGuidance $ToolInput $Audience $ctx.conv }
            'draft_ticket_update' { Invoke-DraftTicketUpdate $ToolInput $Audience $ctx.conv }
        }
        if ($Audience -ceq 'tenant' -and $result.ok -and $result.Contains('data')) { $result['data'] = Remove-WarrantyInfo $result['data'] }
        if ($ConversationId) {
            $traceIn = [ordered]@{}
            foreach ($p in $propNames) { $traceIn[$p] = (Get-Prop $ToolInput $p $null) }
            Add-ToolTrace $ConversationId $Name $Audience $traceIn $result
        }
        return $result
    }
    catch {
        return (New-Result $false $Name $Audience $null 'internal_error' 'The tool failed.')
    }
}

function Get-AgentToolDefinitions {
    # Plain data for the later Messages API stage (name, description, JSON Schema). Nothing here calls an API.
    $idEq = @{ type = 'string'; pattern = '^eq-hv-[a-z0-9]+(-[a-z0-9]+)*$' }
    $idTk = @{ type = 'string'; pattern = '^(DEMO|HV)-\d{1,3}$' }
    return @(
        [ordered]@{ name = 'get_ticket_details'; description = 'Read the current ticket and its context. Tenant calls see only tenant-safe fields.'
            input_schema = [ordered]@{ type = 'object'; properties = [ordered]@{ ticket_id = $idTk }; additionalProperties = $false } },
        [ordered]@{ name = 'get_equipment_info'; description = 'Read an equipment record: brand, exact model, tenant-accessible details and whether a verified manual exists.'
            input_schema = [ordered]@{ type = 'object'; properties = [ordered]@{ equipment_id = $idEq }; required = @('equipment_id'); additionalProperties = $false } },
        [ordered]@{ name = 'get_maintenance_history'; description = 'Read previous repairs and events for an equipment item, newest first, with a recurring-issue hint.'
            input_schema = [ordered]@{ type = 'object'; properties = [ordered]@{ equipment_id = $idEq; limit = @{ type = 'integer'; minimum = 1; maximum = 20 } }; required = @('equipment_id'); additionalProperties = $false } },
        [ordered]@{ name = 'get_equipment_manual_guidance'; description = 'Read verified manufacturer guidance for an item, only when needed. Returns matched false with a reason when there is no verified matching manual. The guidance_scope field says whether it is series or general guidance.'
            input_schema = [ordered]@{ type = 'object'; properties = [ordered]@{ equipment_id = $idEq; question = @{ type = 'string'; minLength = 1; maxLength = 300 } }; required = @('equipment_id', 'question'); additionalProperties = $false } },
        [ordered]@{ name = 'draft_ticket_update'; description = 'Prepare a proposed ticket change for the property manager. It changes nothing until a manager approves it. Use only for meaningful changes.'
            input_schema = [ordered]@{ type = 'object'; properties = [ordered]@{
                    ticket_id = $idTk
                    fields = [ordered]@{ type = 'object'; additionalProperties = $false; properties = [ordered]@{
                            summary = @{ type = 'string'; maxLength = 500 }
                            category = @{ type = 'string'; enum = $script:Categories }
                            ai_urgency = @{ type = 'string'; enum = $script:AiUrgencies }
                            emergency_flag = @{ type = 'boolean' }
                            ai_handling_status = @{ type = 'string'; enum = $script:AiStatuses }
                            notes = @{ type = 'string'; maxLength = 1000 }
                            equipment_ids = @{ type = 'array'; items = $idEq; maxItems = 5 }
                            status = @{ type = 'string'; enum = @('Resolved') }
                        } }
                    reason = @{ type = 'string'; maxLength = 500 }
                    tenant_confirmed_resolution = @{ type = 'boolean' }
                }; required = @('fields', 'reason'); additionalProperties = $false } }
    )
}

# ---------------------------------------------------------------- proposals: manager boundary (not agent tools)

function Get-ProposalList {
    param([string]$Audience, [string]$Status)
    if ($Audience -cne 'manager') { return @() }
    $out = @()
    foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $script:Cfg.StoreDir 'proposals') -Filter 'prop-*.json' -File)) {
        $p = Read-JsonFile $f.FullName
        if (-not $Status -or $p.status -ceq $Status) { $out += $p }
    }
    return @($out | Sort-Object { $_.created_at })
}

function Set-ProposalState {
    param([string]$Audience, [string]$ProposalId, [string]$Action, [string]$Note)
    $tool = "proposal_$Action"
    if ($Audience -cne 'manager') { return (New-Result $false $tool $Audience $null 'forbidden' 'Only a manager can decide on a proposal.') }
    if ($Action -cne 'approve' -and $Action -cne 'reject' -and $Action -cne 'applied') { return (New-Result $false $tool $Audience $null 'invalid_input' 'Unknown action.') }
    $path = Get-ProposalPath $ProposalId
    if ($null -eq $path -or -not (Test-Path -LiteralPath $path)) { return (New-Result $false $tool 'manager' $null 'not_found' 'Proposal not found.') }
    if ($Note -and -not (Test-CleanText $Note 500)) { return (New-Result $false $tool 'manager' $null 'invalid_input' 'Note must be 1 to 500 characters.') }
    return (Invoke-StoreLock {
            $p = Read-JsonFile $path
            $now = Get-Stamp
            if ($Action -ceq 'applied') {
                if ($p.status -cne 'approved') { return (New-Result $false $tool 'manager' $null 'invalid_state' 'Only an approved proposal can be marked applied.') }
                $p.status = 'applied'; $p.applied_at = $now
            }
            else {
                if ($p.status -cne 'pending') { return (New-Result $false $tool 'manager' $null 'invalid_state' 'Only a pending proposal can be decided.') }
                $p.status = $(if ($Action -ceq 'approve') { 'approved' } else { 'rejected' })
                $p.decided_at = $now
                if ($Note) { $p.decision_note = $Note }
            }
            $p.history = @($p.history) + @([ordered]@{ ts = $now; event = $p.status; by = 'manager' })
            Write-JsonFile $path $p
            return (New-Result $true $tool 'manager' ([ordered]@{ proposal_id = $p.id; status = $p.status; decided_at = $p.decided_at; applied_at = $p.applied_at }))
        })
}

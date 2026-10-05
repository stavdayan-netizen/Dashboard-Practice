# Local server (no Node/Python required): serves the dashboard's static files
# and a small API for the Vendor Research screen. The API keeps APIFY_TOKEN
# (read from .env) on this machine, so the browser never sees it.
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8531]
param(
    [int]$Port = 8531
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
$origin = "http://localhost:$Port"
$apifyActor = "compass~crawler-google-places"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".csv"  = "text/csv; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".ps1"  = "text/plain; charset=utf-8"
}

function Get-ApifyToken {
    $envFile = Join-Path $root ".env"
    if (-not (Test-Path $envFile)) { return $null }
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*APIFY_TOKEN\s*=' } | Select-Object -First 1
    if (-not $line) { return $null }
    $value = ($line -replace '^\s*APIFY_TOKEN\s*=', '').Trim().Trim('"').Trim("'")
    if ($value) { return $value }
    return $null
}

function Write-Json($response, [int]$status, $data) {
    $json = ConvertTo-Json -InputObject $data -Depth 6 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.StatusCode = $status
    $response.ContentType = "application/json; charset=utf-8"
    $response.Headers.Add("Cache-Control", "no-store")
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Invoke-Apify([string]$method, [string]$path, $body = $null) {
    $token = Get-ApifyToken
    if (-not $token) { throw "APIFY_TOKEN is not set in .env." }
    $params = @{
        Method = $method
        Uri = "https://api.apify.com/v2/$path"
        Headers = @{ Authorization = "Bearer $token" }
        TimeoutSec = 30
    }
    if ($null -ne $body) {
        $params.ContentType = "application/json; charset=utf-8"
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $body -Depth 6 -Compress))
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $detail = ""
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            try { $detail = ($_.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { }
        }
        if (-not $detail) { $detail = $_.Exception.Message }
        throw "Apify request failed: $detail"
    }
}

function Clean-Text([string]$value) {
    return (($value -replace '[\x00-\x1f]', ' ').Trim())
}

function Handle-Api($context) {
    $request = $context.Request
    $response = $context.Response
    $path = $request.Url.AbsolutePath
    $method = $request.HttpMethod

    if ($method -eq "POST") {
        # Only the dashboard served by this same server may start (billable) searches.
        $requestOrigin = $request.Headers["Origin"]
        if ($requestOrigin -and $requestOrigin -ne $origin) {
            Write-Json $response 403 @{ error = "Forbidden origin." }; return
        }
        if (-not ($request.ContentType -like "application/json*")) {
            Write-Json $response 415 @{ error = "Expected application/json." }; return
        }
    }

    if ($path -eq "/api/status" -and $method -eq "GET") {
        Write-Json $response 200 @{ vendorSearch = [bool](Get-ApifyToken) }
        return
    }

    if ($path -eq "/api/vendors/search" -and $method -eq "POST") {
        $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
        $raw = $reader.ReadToEnd()
        if ($raw.Length -gt 4096) { Write-Json $response 413 @{ error = "Request too large." }; return }
        try { $payload = $raw | ConvertFrom-Json } catch { Write-Json $response 400 @{ error = "Invalid JSON." }; return }

        $term = Clean-Text ([string]$payload.searchTerm)
        $location = Clean-Text ([string]$payload.location)
        if ($term.Length -lt 2 -or $term.Length -gt 80 -or $location.Length -lt 5 -or $location.Length -gt 200) {
            Write-Json $response 400 @{ error = "A search term and a full address are required." }; return
        }
        if (-not (Get-ApifyToken)) {
            Write-Json $response 503 @{ error = "APIFY_TOKEN is not set in .env." }; return
        }

        # The actor's own locationQuery can't geocode street addresses, so the
        # address goes into the Google Maps search text instead.
        $runInput = @{
            searchStringsArray = @("$term near $location")
            maxCrawledPlacesPerSearch = 5
            language = "en"
            skipClosedPlaces = $true
        }
        $run = Invoke-Apify "POST" "acts/$apifyActor/runs?memory=1024&timeout=120&maxTotalChargeUsd=0.50" $runInput
        Write-Json $response 200 @{ runId = $run.data.id }
        return
    }

    if ($path -eq "/api/vendors/result" -and $method -eq "GET") {
        $runId = $request.QueryString["runId"]
        if ($runId -notmatch '^[A-Za-z0-9]{8,32}$') { Write-Json $response 400 @{ error = "Invalid run id." }; return }

        $run = (Invoke-Apify "GET" "actor-runs/$runId").data
        if ($run.status -in @("READY", "RUNNING")) {
            Write-Json $response 200 @{ status = "RUNNING" }; return
        }
        if ($run.status -ne "SUCCEEDED") {
            $message = [string]$run.statusMessage
            if ($message.Length -gt 200) { $message = $message.Substring(0, 200) }
            Write-Json $response 200 @{ status = "FAILED"; message = $message }; return
        }
        if ($run.defaultDatasetId -notmatch '^[A-Za-z0-9]{8,32}$') { Write-Json $response 502 @{ error = "Unexpected response from Apify." }; return }

        $fields = "title,categoryName,totalScore,reviewsCount,phone,website,url,address,permanentlyClosed,temporarilyClosed"
        # Windows PowerShell returns a JSON array as one wrapped object; piping the
        # variable enumerates it into the individual dataset items.
        $rawItems = Invoke-Apify "GET" "datasets/$($run.defaultDatasetId)/items?clean=true&limit=10&fields=$fields"
        $items = @($rawItems | ForEach-Object { $_ })
        $vendors = @($items |
            Where-Object { $_ -and -not $_.permanentlyClosed -and -not $_.temporarilyClosed } |
            Select-Object -First 5 |
            ForEach-Object {
                [ordered]@{
                    name = $_.title
                    category = $_.categoryName
                    rating = $_.totalScore
                    reviews = $_.reviewsCount
                    phone = $_.phone
                    website = $_.website
                    mapsUrl = $_.url
                    address = $_.address
                }
            })
        Write-Json $response 200 @{ status = "SUCCEEDED"; vendors = $vendors }
        return
    }

    Write-Json $response 404 @{ error = "Not found." }
}

function Send-StaticFile($context) {
    $request = $context.Request
    $response = $context.Response
    $path = $request.Url.AbsolutePath
    if ($path -eq "/") { $path = "/index.html" }
    $relative = [System.Uri]::UnescapeDataString($path.TrimStart("/"))
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

    # Never serve dotfiles (.env, .git, ...) or anything outside the project folder.
    $hidden = @($relative -split '[\\/]' | Where-Object { $_.StartsWith(".") }).Count -gt 0
    $inside = $filePath.StartsWith($rootFull + "\", [System.StringComparison]::OrdinalIgnoreCase)

    if ($inside -and -not $hidden -and (Test-Path $filePath -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $contentType = $mime[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("$origin/")
$listener.Start()
Write-Host "Serving $root at $origin/"
if (Get-ApifyToken) {
    Write-Host "Vendor search: enabled (APIFY_TOKEN found in .env)"
} else {
    Write-Host "Vendor search: disabled (set APIFY_TOKEN in .env)"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
        if ($context.Request.Url.AbsolutePath.StartsWith("/api/")) {
            Handle-Api $context
        } else {
            Send-StaticFile $context
        }
    } catch {
        try {
            Write-Json $context.Response 500 @{ error = [string]$_.Exception.Message }
        } catch { }
    } finally {
        $context.Response.OutputStream.Close()
    }
}

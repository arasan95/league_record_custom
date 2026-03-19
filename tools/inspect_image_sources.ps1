param(
    [string]$CacheRoot = "$env:LOCALAPPDATA\com.leaguerecord.custom\img_cache",
    [int]$Recent = 30
)

if (-not (Test-Path $CacheRoot)) {
    Write-Output "Cache not found: $CacheRoot"
    exit 0
}

$markers = Get-ChildItem -Path $CacheRoot -Recurse -File -Filter "*.source.json" -ErrorAction SilentlyContinue
if (-not $markers) {
    Write-Output "No source marker files found under: $CacheRoot"
    exit 0
}

$rows = foreach ($m in $markers) {
    try {
        $j = Get-Content -Raw $m.FullName | ConvertFrom-Json
        [PSCustomObject]@{
            source = $j.source
            category = $j.category
            filename = $j.filename
            requested_url = $j.requested_url
            source_detail = $j.source_detail
            local_wad_probe = ($j.local_wad_probe | ConvertTo-Json -Compress)
            saved_at_utc = $j.saved_at_utc
            marker = $m.FullName
        }
    } catch {
    }
}

Write-Output "=== Source Count ==="
$rows | Group-Object source | Sort-Object Count -Descending | ForEach-Object {
    "{0}: {1}" -f $_.Name, $_.Count
}

Write-Output ""
Write-Output "=== Recent Markers ==="
$rows | Sort-Object saved_at_utc -Descending | Select-Object -First $Recent |
    Format-Table source, category, filename, saved_at_utc, source_detail, local_wad_probe -AutoSize

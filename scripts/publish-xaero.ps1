$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$live = 'C:\inetpub\vilanexo\launcher'
$source = 'C:\Users\Administrator\Desktop\site mine rp\vila-nexa\public\launcher'
$backup = Join-Path 'C:\inetpub\_backups' ('launcher-xaero-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($name in @('manifest.json', 'update.json', 'download.ashx')) {
    Copy-Item (Join-Path $live $name) (Join-Path $backup $name)
}
$manifest = Get-Content (Join-Path $live 'manifest.json') -Raw | ConvertFrom-Json
foreach ($id in @('xaeros-minimap', 'xaeros-world-map')) {
    $url = 'https://api.modrinth.com/v2/project/' + $id + '/version?loaders=%5B%22neoforge%22%5D&game_versions=%5B%221.21.1%22%5D'
    $version = (Invoke-RestMethod $url | Where-Object { $_.version_type -eq 'release' })[0]
    $file = $version.files | Where-Object primary | Select-Object -First 1
    $dest = Join-Path $source ('mods/' + $file.filename)
    Invoke-WebRequest $file.url -UseBasicParsing -OutFile $dest
    if ((Get-FileHash $dest -Algorithm SHA512).Hash.ToLowerInvariant() -ne $file.hashes.sha512) { throw 'Mod checksum mismatch' }
    Copy-Item $dest (Join-Path $live ('mods/' + $file.filename)) -Force
    $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLowerInvariant()
    $downloadUrl = 'https://www.vilanexo.com/launcher/mods/' + $file.filename
    $manifest.files = @($manifest.files | Where-Object { $_.path -ne ('mods/' + $file.filename) }) + @([pscustomobject]@{ path = 'mods/' + $file.filename; sha256 = $hash; size = $file.size; url = $downloadUrl })
    $manifest.mods = @($manifest.mods | Where-Object { $_.file -ne $file.filename }) + @([pscustomobject]@{ file = $file.filename; sha256 = $hash; size = $file.size; url = $downloadUrl })
    Write-Output ('Verified: ' + $file.filename)
}
New-Item -ItemType Directory -Path (Join-Path $live 'config') -Force | Out-Null
Copy-Item (Join-Path $source 'config/web.config') (Join-Path $live 'config/web.config') -Force
$config = Join-Path $source 'config/ftbchunks-client.snbt'
Copy-Item $config (Join-Path $live 'config/ftbchunks-client.snbt') -Force
$manifest.files = @($manifest.files | Where-Object { $_.path -ne 'config/ftbchunks-client.snbt' }) + @([pscustomobject]@{
    path = 'config/ftbchunks-client.snbt'; sha256 = (Get-FileHash $config -Algorithm SHA256).Hash.ToLowerInvariant(); size = (Get-Item $config).Length; url = 'https://www.vilanexo.com/launcher/config/ftbchunks-client.snbt'
})
$manifest.version = '3.1.6'
$manifest.generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
$json = $manifest | ConvertTo-Json -Depth 12
foreach ($dir in @($source, $live)) {
    [IO.File]::WriteAllText((Join-Path $dir 'manifest.json.tmp'), $json, (New-Object Text.UTF8Encoding $false))
    Move-Item (Join-Path $dir 'manifest.json.tmp') (Join-Path $dir 'manifest.json') -Force
}
Write-Output ('Backup: ' + $backup)

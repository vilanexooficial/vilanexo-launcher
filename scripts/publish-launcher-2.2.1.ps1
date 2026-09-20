$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = 'C:\Users\Administrator\Desktop\site mine rp\vila-nexa\public\launcher'
$live = 'C:\inetpub\vilanexo\launcher'
$name = 'VilaNexo-Launcher-Setup-2.2.4.exe'
$installer = Join-Path $root ('dist/' + $name)
if (!(Test-Path $installer)) { throw 'Build installer first' }
foreach ($dest in @($source, $live, $root)) {
    Copy-Item $installer (Join-Path $dest ($name + '.tmp')) -Force
    Move-Item (Join-Path $dest ($name + '.tmp')) (Join-Path $dest $name) -Force
}
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash
foreach ($dest in @($source, $live, $root)) {
    if ((Get-FileHash (Join-Path $dest $name) -Algorithm SHA256).Hash -ne $hash) { throw 'Installer copy mismatch' }
}
foreach ($file in @('download.ashx', 'update.json')) {
    Copy-Item (Join-Path $source $file) (Join-Path $live ($file + '.tmp')) -Force
    Move-Item (Join-Path $live ($file + '.tmp')) (Join-Path $live $file) -Force
}
Write-Output ('Published: ' + $name)
Write-Output ('SHA256: ' + $hash)

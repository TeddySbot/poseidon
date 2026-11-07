# Installe l'assistant de mise a jour d'Aquaman (perso) pour le dossier de l'extension qui contient ce script.
# A lancer une seule fois (via installer-mises-a-jour.bat), et de nouveau seulement si tu deplaces le dossier.
#   installer-mises-a-jour.bat             installer ou reparer
#   installer-mises-a-jour.bat -Uninstall  supprimer l'assistant
# Ce qui est cree : %LOCALAPPDATA%\AquamanPersoUpdater (assistant + sauvegardes) et une cle de registre par
# navigateur (HKCU\Software\<navigateur>\NativeMessagingHosts\com.teddysbot.aquaman_perso). Rien d'autre.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$name = 'com.teddysbot.aquaman_perso'
$ext = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$home2 = Join-Path $env:LOCALAPPDATA 'AquamanPersoUpdater'
$chromeKeys = 'Google\Chrome', 'Chromium', 'BraveSoftware\Brave-Browser', 'Microsoft\Edge', 'Vivaldi', 'Opera Software'
$utf8 = New-Object Text.UTF8Encoding $false

function Remove-Keys {
  foreach ($k in $chromeKeys) {
    Remove-Item -Path "HKCU:\Software\$k\NativeMessagingHosts\$name" -Force -ErrorAction SilentlyContinue
  }
}

if ($Uninstall) {
  Remove-Keys
  Remove-Item -LiteralPath $home2 -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Assistant de mise a jour Aquaman (perso) supprime.'
  return
}

$manifest = Get-Content -LiteralPath (Join-Path $ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (@('Aquaman (perso)', 'Celestial') -notcontains [string]$manifest.name) { throw "Ce script doit rester dans le dossier aquaman-perso\updater (trouve : $($manifest.name))." }

# Id d'une extension non empaquetee : SHA-256 du chemin du dossier (UTF-16, lettre de lecteur en majuscule), lettres a-p.
function Get-PathId($path) {
  $path = $path.Substring(0, 1).ToUpper() + $path.Substring(1)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($path))
  return -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}

function Get-Key($dict, $key) {
  if ($dict -is [Collections.IDictionary] -and $dict.ContainsKey($key)) { return $dict[$key] }
  return $null
}

# Les ids donnes a ce dossier par les navigateurs, lus dans leurs profils.
function Find-Ids {
  $ids = @{ (Get-PathId $ext) = $true }
  Add-Type -AssemblyName System.Web.Extensions
  $json = New-Object Web.Script.Serialization.JavaScriptSerializer
  $json.MaxJsonLength = [int]::MaxValue
  $roots = @(
    "$env:LOCALAPPDATA\Google\Chrome\User Data",
    "$env:LOCALAPPDATA\Chromium\User Data",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data",
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data",
    "$env:LOCALAPPDATA\Vivaldi\User Data",
    "$env:APPDATA\Opera Software\Opera Stable"
  ) | Where-Object { Test-Path -LiteralPath $_ }
  foreach ($root in $roots) {
    $dirs = @(Get-Item -LiteralPath $root) + @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)
    foreach ($d in $dirs) {
      foreach ($file in 'Preferences', 'Secure Preferences') {
        $f = Join-Path $d.FullName $file
        if (-not (Test-Path -LiteralPath $f)) { continue }
        try { $prefs = $json.DeserializeObject([IO.File]::ReadAllText($f)) } catch { continue }
        $settings = Get-Key (Get-Key $prefs 'extensions') 'settings'
        if (-not $settings) { continue }
        foreach ($id in $settings.Keys) {
          $p = [string](Get-Key $settings[$id] 'path')
          if ($p -and $p.TrimEnd('\') -ieq $ext) { $ids[$id] = $true }
        }
      }
    }
  }
  return $ids.Keys
}

New-Item -ItemType Directory -Path $home2 -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'host.ps1') -Destination $home2 -Force
[IO.File]::WriteAllText((Join-Path $home2 'host.cmd'), "@echo off`r`npowershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0host.ps1`" %*`r`n", [Text.Encoding]::ASCII)

# id -> dossier de l'extension (les anciennes entrees vers ce dossier sont remplacees).
$config = @{}
$configPath = Join-Path $home2 'config.json'
if (Test-Path -LiteralPath $configPath) {
  (Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | Where-Object { $_.Value -ne $ext } | ForEach-Object { $config[$_.Name] = $_.Value }
}
foreach ($id in Find-Ids) { $config[$id] = $ext }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8)

$chromeIds = @($config.Keys | Where-Object { $_ -match '^[a-p]{32}$' })
$hostManifest = Join-Path $home2 "$name.json"
[IO.File]::WriteAllText($hostManifest, ([ordered]@{
  name = $name
  description = 'Aquaman (perso) : mise a jour de l''extension'
  path = (Join-Path $home2 'host.cmd')
  type = 'stdio'
  allowed_origins = @($chromeIds | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json), $utf8)

Remove-Keys
foreach ($k in $chromeKeys) {
  $key = "HKCU:\Software\$k\NativeMessagingHosts\$name"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $hostManifest
}

Write-Host ''
Write-Host "Assistant de mise a jour installe pour : $ext"
Write-Host ("Extension(s) reconnue(s) : " + (($config.GetEnumerator() | Where-Object { $_.Value -eq $ext } | ForEach-Object { $_.Key }) -join ', '))
Write-Host ''
Write-Host 'C''est fini. Dans chrome://extensions, clique sur la fleche de rechargement sous Aquaman (perso),'
Write-Host 'puis le bouton "Mettre a jour" de sa fenetre fera tout tout seul.'
Write-Host 'Si tu deplaces le dossier de l''extension, relance ce fichier.'

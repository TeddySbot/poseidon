# Assistant de mise a jour d'Aquaman (perso), lance par le navigateur (native messaging) quand on clique sur
# "Mettre a jour" dans la fenetre de l'extension.
#
# Securite :
#  - telecharge UNIQUEMENT depuis les releases de github.com/TeddySbot/poseidon (l'adresse est construite ici,
#    jamais recue de l'extension) ;
#  - verifie l'empreinte SHA-256 publiee avec la release, le nom et la version du paquet ;
#  - sauvegarde l'ancienne version avant de copier (3 dernieres gardees), et la remet si la copie echoue ;
#  - ne touche qu'au dossier de l'extension enregistre a l'installation (config.json).
# Un dossier suivi par Git est mis a jour par "git pull --ff-only" (rien n'est ecrase si tu as des modifications).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = 'TeddySbot/poseidon'
$ExpectedName = 'Aquaman (perso)'
$KeepBackups = 3
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-Message {
  $head = New-Object byte[] 4
  if ($stdin.Read($head, 0, 4) -ne 4) { return $null }
  $size = [BitConverter]::ToInt32($head, 0)
  if ($size -le 0 -or $size -gt 65536) { return $null }
  $buf = New-Object byte[] $size
  $read = 0
  while ($read -lt $size) {
    $n = $stdin.Read($buf, $read, $size - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  return [Text.Encoding]::UTF8.GetString($buf, 0, $read) | ConvertFrom-Json
}

function Send-Message($reply) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($reply | ConvertTo-Json -Compress -Depth 4))
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# Lance un programme sans qu'il ecrive sur stdout (reserve au navigateur).
function Invoke-Quiet($file, $arguments) {
  $p = New-Object Diagnostics.Process
  $p.StartInfo.FileName = $file
  $p.StartInfo.Arguments = $arguments
  $p.StartInfo.UseShellExecute = $false
  $p.StartInfo.CreateNoWindow = $true
  $p.StartInfo.RedirectStandardOutput = $true
  $p.StartInfo.RedirectStandardError = $true
  [void]$p.Start()
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{ code = $p.ExitCode; text = ($out.Result + $err).Trim() }
}

function Test-Version($v) { return ([string]$v) -match '^\d{1,4}(\.\d{1,4}){1,3}$' }

# -1, 0 ou 1 (1.6.1 contre 1.6.2).
function Compare-Version($a, $b) {
  $pa = @(([string]$a) -split '\.' | ForEach-Object { [int]$_ })
  $pb = @(([string]$b) -split '\.' | ForEach-Object { [int]$_ })
  for ($i = 0; $i -lt [Math]::Max($pa.Count, $pb.Count); $i++) {
    $x = if ($i -lt $pa.Count) { $pa[$i] } else { 0 }
    $y = if ($i -lt $pb.Count) { $pb[$i] } else { 0 }
    if ($x -ne $y) { return [Math]::Sign($x - $y) }
  }
  return 0
}

function Get-Manifest($dir) {
  return Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Get-Version($dir) { return [string](Get-Manifest $dir).version }

# Racine Git si le dossier de l'extension est suivi par Git (clone du depot), sinon $null.
function Get-GitRoot($dir) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $null }
  $r = Invoke-Quiet 'git' "-C `"$dir`" rev-parse --show-toplevel"
  if ($r.code -eq 0 -and $r.text) { return $r.text }
  return $null
}

function Copy-Dir($from, $to, $extra) {
  $r = Invoke-Quiet 'robocopy' "`"$from`" `"$to`" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP $extra"
  return $r
}

function New-Backup($dir) {
  $root = Join-Path $here 'sauvegardes'
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $dest = Join-Path $root ('aquaman-perso-' + (Get-Version $dir) + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $r = Copy-Dir $dir $dest '/XD .git'
  if ($r.code -ge 8) { throw "Sauvegarde impossible : $($r.text)" }
  Get-ChildItem -LiteralPath $root -Directory | Sort-Object CreationTime -Descending | Select-Object -Skip $KeepBackups |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  return $dest
}

function Update-Extension($dir, $msg) {
  $before = Get-Version $dir
  $git = Get-GitRoot $dir
  if ($git) {
    $r = Invoke-Quiet 'git' "-C `"$git`" pull --ff-only"
    if ($r.code -ne 0) { return @{ error = 'git_failed'; detail = $r.text } }
  } else {
    $v = [string]$msg.version
    if (-not (Test-Version $v)) { return @{ error = 'bad_version' } }
    if ((Compare-Version $v $before) -le 0) { return @{ ok = $true; version = $before; already = $true } }
    $base = "https://github.com/$Repo/releases/download/aquaman-v$v/aquaman-perso-$v.zip"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('aquaman-perso-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $zip = Join-Path $tmp 'release.zip'
      $sum = Join-Path $tmp 'release.sha256'
      try {
        Invoke-WebRequest -Uri $base -OutFile $zip -UseBasicParsing
        Invoke-WebRequest -Uri "$base.sha256" -OutFile $sum -UseBasicParsing
      } catch { return @{ error = 'download_failed'; detail = $_.Exception.Message } }
      $expected = (([IO.File]::ReadAllText($sum)).Trim() -split '\s+')[0].ToLower()
      if ($expected -notmatch '^[0-9a-f]{64}$') { return @{ error = 'bad_checksum' } }
      $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
      if ($actual -ne $expected) { return @{ error = 'checksum_mismatch' } }
      $files = Join-Path $tmp 'files'
      Expand-Archive -LiteralPath $zip -DestinationPath $files
      $m = Get-Manifest $files
      if ([string]$m.name -ne $ExpectedName -or [string]$m.version -ne $v) { return @{ error = 'bad_package' } }
      $backup = New-Backup $dir
      $copy = Copy-Dir $files $dir ''
      if ($copy.code -ge 8) {
        [void](Copy-Dir $backup $dir '')
        return @{ error = 'copy_failed'; detail = $copy.text }
      }
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  # L'assistant suit l'extension : sa nouvelle version remplace celle-ci.
  $fresh = Join-Path $dir 'updater\host.ps1'
  if (Test-Path -LiteralPath $fresh) { Copy-Item -LiteralPath $fresh -Destination (Join-Path $here 'host.ps1') -Force -ErrorAction SilentlyContinue }
  return @{ ok = $true; version = (Get-Version $dir); previous = $before }
}

# Remet la derniere sauvegarde (installations par zip seulement).
function Restore-Previous($dir) {
  if (Get-GitRoot $dir) { return @{ error = 'git_rollback' } }
  $root = Join-Path $here 'sauvegardes'
  $last = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Sort-Object CreationTime -Descending | Select-Object -First 1
  if (-not $last) { return @{ error = 'no_backup' } }
  $m = Get-Manifest $last.FullName
  if ([string]$m.name -ne $ExpectedName) { return @{ error = 'bad_package' } }
  $r = Invoke-Quiet 'robocopy' "`"$($last.FullName)`" `"$dir`" /MIR /XD .git /R:2 /W:1 /NFL /NDL /NJH /NJS /NP"
  if ($r.code -ge 8) { return @{ error = 'copy_failed'; detail = $r.text } }
  Remove-Item -LiteralPath $last.FullName -Recurse -Force -ErrorAction SilentlyContinue
  return @{ ok = $true; version = (Get-Version $dir) }
}

function Get-Backups {
  $root = Join-Path $here 'sauvegardes'
  return @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Sort-Object CreationTime -Descending | ForEach-Object { $_.Name })
}

try {
  # Chrome passe "chrome-extension://<id>/" en argument.
  $caller = ($args | Where-Object { $_ -match '^chrome-extension://' } | Select-Object -First 1)
  $id = if ($caller) { ($caller -replace '^chrome-extension://', '').TrimEnd('/') } else { '' }
  $config = Get-Content -LiteralPath (Join-Path $here 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $prop = $config.PSObject.Properties[$id]
  $dir = if ($prop) { [string]$prop.Value } else { $null }
  $msg = Read-Message
  if (-not $dir -or -not (Test-Path -LiteralPath (Join-Path $dir 'manifest.json'))) {
    Send-Message @{ error = 'unknown_extension' }
  } elseif ($msg.action -eq 'ping') {
    Send-Message @{ ok = $true; version = (Get-Version $dir); git = [bool](Get-GitRoot $dir); backups = (Get-Backups) }
  } elseif ($msg.action -eq 'update') {
    Send-Message (Update-Extension $dir $msg)
  } elseif ($msg.action -eq 'rollback') {
    Send-Message (Restore-Previous $dir)
  } else {
    Send-Message @{ error = 'unknown_action' }
  }
} catch {
  Send-Message @{ error = 'failed'; detail = $_.Exception.Message }
}

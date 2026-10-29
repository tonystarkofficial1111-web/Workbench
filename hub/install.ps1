# Workbench Hub setup. Run it on the rig (the computer that stays on), by double-clicking
# "Install Workbench Hub.bat". Running it again updates the Hub and keeps your data and settings.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Say($t, $c) { if (-not $c) { $c = "Gray" }; Write-Host $t -ForegroundColor $c }
function Step($n, $t) { Write-Host ""; Write-Host ("  " + $n + "  " + $t) -ForegroundColor Green }
function Ask($q, $def) {
  $a = Read-Host ($q + $(if ($def) { " [" + $def + "]" } else { "" }))
  if ([string]::IsNullOrWhiteSpace($a)) { return $def } else { return $a.Trim() }
}

$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$HubHome = Join-Path $env:LOCALAPPDATA "WorkbenchHub"
$App = Join-Path $HubHome "app"
$Conf = Join-Path $HubHome "hub.json"
$NodeVer = "v22.11.0"

Write-Host ""
Say "  WORKBENCH HUB" White
Say "  The home server for Workbench: your Work, designs, music, videos and saves in one folder"
Say "  on this computer, synced with your phone, laptop and family. About 5 minutes."

# ---- stop a running Hub (when updating)
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like "*WorkbenchHub*" -and ($_.Name -eq "powershell.exe" -or $_.Name -eq "node.exe") -and $_.ProcessId -ne $PID } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }

# ---- 1. Node.js
Step "1/7" "Node.js (what the Hub runs on)"
New-Item -ItemType Directory -Force -Path $HubHome, $App | Out-Null
$NodeExe = Join-Path $HubHome "node\node.exe"
if (Test-Path $NodeExe) { Say ("  Already here: " + (& $NodeExe --version)) }
else {
  $zip = Join-Path $env:TEMP ("node-" + $NodeVer + "-win-x64.zip")
  Say ("  Downloading Node.js " + $NodeVer + " (about 30 MB) from nodejs.org...")
  Invoke-WebRequest ("https://nodejs.org/dist/" + $NodeVer + "/node-" + $NodeVer + "-win-x64.zip") -OutFile $zip -UseBasicParsing
  $tmp = Join-Path $HubHome "node-unzip"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  if (Test-Path (Join-Path $HubHome "node")) { Remove-Item (Join-Path $HubHome "node") -Recurse -Force }
  Move-Item (Join-Path $tmp ("node-" + $NodeVer + "-win-x64")) (Join-Path $HubHome "node")
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zip -Force
  Say ("  Installed " + (& $NodeExe --version))
}

# ---- 2. the Hub program
Step "2/7" "The Hub program"
foreach ($f in "server.js", "push.js", "tags.js", "reminders.js", "tray.ps1", "launch.vbs", "hub.ico", "uninstall.ps1", "README.md") {
  if (Test-Path (Join-Path $Src $f)) { Copy-Item (Join-Path $Src $f) (Join-Path $App $f) -Force }
}
Say ("  Copied to " + $App)

# ---- 3. the folder that holds everything
Step "3/7" "Where to keep everything"
$cfg = $null
if (Test-Path $Conf) { try { $cfg = Get-Content $Conf -Raw | ConvertFrom-Json } catch {} }
if ($cfg -and $cfg.root) {
  Say ("  Keeping your Hub folder: " + $cfg.root)
} else {
  Say "  One folder on one drive holds Work, design files, music, videos and saves."
  Say "  Pick the drive with the most free space. You can add a second drive later."
  $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 } | Sort-Object Free -Descending
  foreach ($d in $drives) { Say ("    " + $d.Name + ":  " + [Math]::Round($d.Free / 1GB) + " GB free") }
  $best = $drives | Select-Object -First 1
  $def = $(if ($best -and $best.Name -ne "C") { $best.Name + ":\Workbench Hub" } else { Join-Path $env:USERPROFILE "Workbench Hub" })
  $root = Ask "  Folder" $def
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $cfg = [ordered]@{ port = 8770; host = "127.0.0.1"; root = $root; name = $env:COMPUTERNAME; autoUpdate = $true }
  [IO.File]::WriteAllText($Conf, ($cfg | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Say ("  Everything will live in " + $root)
}
$Root = (Get-Content $Conf -Raw | ConvertFrom-Json).root

# ---- 4. the owner
Step "4/7" "You, the owner"
$env:WB_HUB_HOME = $HubHome
if (Test-Path (Join-Path $Root ".hub\users.json")) {
  Say "  The Hub already has its people. (Forgot a PIN? Run this installer's reset-pin.bat.)"
} else {
  Say "  You sign in on each device with your name and a PIN. Family members get their own later."
  $name = Ask "  Your name" $env:USERNAME
  do {
    $p1 = Read-Host "  Choose a PIN (4 to 12 digits)" -AsSecureString
    $p2 = Read-Host "  The PIN again" -AsSecureString
    $a = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
    $b = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
    $okPin = ($a -match '^\d{4,12}$') -and ($a -eq $b)
    if (-not $okPin) { Say "  The PINs must match and be 4 to 12 digits. Try again." Yellow }
  } until ($okPin)
  & $NodeExe (Join-Path $App "server.js") --init-owner $name $a
}
try { $hd = Get-Item (Join-Path $Root ".hub") -Force; $hd.Attributes = $hd.Attributes -bor [IO.FileAttributes]::Hidden } catch {}

# ---- 5. start with Windows
Step "5/7" "Start with Windows"
$startup = [Environment]::GetFolderPath("Startup")
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $startup "Workbench Hub.lnk"))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = '"' + (Join-Path $App "launch.vbs") + '"'
$lnk.WorkingDirectory = $App
$lnk.IconLocation = (Join-Path $App "hub.ico")
$lnk.Description = "Workbench Hub"
$lnk.Save()
Say "  The Hub starts by itself when this computer signs in, with an icon in the tray."
try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  Say "  Sleep is off while plugged in, so the Hub is always there."
} catch { Say "  Set Settings > System > Power > Sleep to Never, so the Hub is always there." Yellow }

# ---- 6. Tailscale (reaching the Hub from anywhere)
Step "6/7" "Tailscale (your devices reach the Hub from anywhere)"
$ts = "C:\Program Files\Tailscale\tailscale.exe"
$address = ""
if (-not (Test-Path $ts)) {
  Say "  Tailscale isn't installed yet. Install it from https://tailscale.com/download (free)," Yellow
  Say "  sign in, then double-click this installer again. Everything else is already done." Yellow
} else {
  Say "  Sharing the Hub on your tailnet. If Tailscale shows a link to enable HTTPS or Serve,"
  Say "  open it, press Enable, and this continues by itself."
  $ErrorActionPreference = "Continue"
  & $ts serve --bg 8770
  try {
    $j = & $ts status --json | Out-String | ConvertFrom-Json
    if ($j.Self.DNSName) { $address = "https://" + ([string]$j.Self.DNSName).TrimEnd(".") }
  } catch {}
  $ErrorActionPreference = "Stop"
  if ($address) {
    Say ("  Your Hub's address: " + $address) White
    try { Set-Clipboard $address; Say "  (copied)" } catch {}
  }
}

# ---- 7. the AI (optional)
Step "7/7" "The AI (Ollama) on this computer - optional"
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama -and (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if ($ollama) {
  Say "  Ollama is installed. The Hub hands it to every device, no extra settings needed."
} else {
  $yes = Ask "  Install Ollama now so Workbench's AI runs on this computer's graphics card? (Y/N)" "Y"
  if ($yes -match '^[Yy]') {
    $exe = Join-Path $env:TEMP "OllamaSetup.exe"
    Say "  Downloading Ollama (about 1 GB)..."
    Invoke-WebRequest "https://ollama.com/download/OllamaSetup.exe" -OutFile $exe -UseBasicParsing
    $p = Start-Process $exe -ArgumentList "/SILENT" -PassThru
    $p.WaitForExit()
    $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
  }
}
if ($ollama) {
  # the model download needs Ollama running
  $up = $false
  try { Invoke-WebRequest "http://127.0.0.1:11434/api/version" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch {}
  $oapp = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
  if (-not $up -and (Test-Path $oapp)) { Start-Process $oapp; Start-Sleep -Seconds 6 }
  $ErrorActionPreference = "Continue"
  $has = ""
  try { $has = (& $ollama list | Out-String) } catch {}
  if ($has -notmatch "llama3\.1") {
    $yes = Ask "  Download the AI model llama3.1:8b (about 5 GB, fits a graphics card with 8 GB)? (Y/N)" "Y"
    if ($yes -match '^[Yy]') { & $ollama pull llama3.1:8b }
  }
  $ErrorActionPreference = "Stop"
}

# ---- start it
Start-Process "$env:WINDIR\System32\wscript.exe" ('"' + (Join-Path $App "launch.vbs") + '"')
$up = $false
for ($i = 0; $i -lt 20 -and -not $up; $i++) {
  Start-Sleep -Milliseconds 700
  try { Invoke-WebRequest "http://127.0.0.1:8770/api/ping" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch {}
}
Write-Host ""
if ($up) { Say "  THE HUB IS RUNNING" Green } else { Say "  The Hub didn't answer yet. Look for its icon in the tray, or open the log from that icon." Yellow }
Say ("  Folder:   " + $Root)
if ($address) { Say ("  Address:  " + $address) White }
Say "  Next: on each device open Workbench, press the bell at the top right, then Hub,"
Say "  and sign in with that address, your name and your PIN."
Write-Host ""

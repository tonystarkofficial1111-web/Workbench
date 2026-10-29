# Workbench Hub tray icon. Runs the Hub (node server.js) in the background, starts it again if
# it stops, and shows a tray icon with the Hub's status and a small menu. Started at sign-in by
# launch.vbs (from the Startup folder), so nothing shows on screen.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$HubHome = Split-Path -Parent $Here
$AppUrl = "https://tonystarkofficial1111-web.github.io/Workbench/"
$Log = Join-Path $HubHome "logs\hub.log"

# only one tray at a time
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "WorkbenchHubTray", [ref]$created)
if (-not $created) { exit }

function Get-Conf {
  try { return Get-Content (Join-Path $HubHome "hub.json") -Raw | ConvertFrom-Json } catch { return $null }
}
$Conf = Get-Conf
$Port = 8770
if ($Conf -and $Conf.port) { $Port = [int]$Conf.port }

$Node = Join-Path $HubHome "node\node.exe"
if (-not (Test-Path $Node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}

$script:Proc = $null
$script:Fails = 0
$script:WaitUntil = [DateTime]::MinValue
$script:TrayStamp = (Get-Item (Join-Path $Here "tray.ps1")).LastWriteTimeUtc
$script:Status = "Starting"

function Start-Hub {
  if (-not (Test-Path $Node)) { $script:Status = "Node.js is missing - run the installer again"; return }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Node
  $psi.Arguments = '"' + (Join-Path $Here "server.js") + '"'
  $psi.WorkingDirectory = $Here
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["WB_HUB_HOME"] = $HubHome
  $script:Proc = [System.Diagnostics.Process]::Start($psi)
}
function Stop-Hub {
  if ($script:Proc -and -not $script:Proc.HasExited) {
    try { $script:Proc.Kill(); $script:Proc.WaitForExit(3000) | Out-Null } catch {}
  }
  $script:Proc = $null
}
function Ping-Hub {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/ping")
    $req.Timeout = 1500
    $res = $req.GetResponse()
    $res.Close()
    return $true
  } catch { return $false }
}
function Get-Address {
  $ts = "C:\Program Files\Tailscale\tailscale.exe"
  if (-not (Test-Path $ts)) { return "" }
  try {
    $j = & $ts status --json | Out-String | ConvertFrom-Json
    $n = [string]$j.Self.DNSName
    if ($n) { return "https://" + $n.TrimEnd(".") }
  } catch {}
  return ""
}

$icon = New-Object System.Windows.Forms.NotifyIcon
try { $icon.Icon = New-Object System.Drawing.Icon (Join-Path $Here "hub.ico") } catch { $icon.Icon = [System.Drawing.SystemIcons]::Application }
$icon.Text = "Workbench Hub - starting"
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$head = $menu.Items.Add("Workbench Hub")
$head.Enabled = $false
$menu.Items.Add("-") | Out-Null
$menu.Items.Add("Open Workbench").add_Click({ Start-Process $AppUrl })
$menu.Items.Add("Hub status page").add_Click({ Start-Process "http://127.0.0.1:$Port/" })
$menu.Items.Add("Open the Hub folder").add_Click({
    $c = Get-Conf
    if ($c -and $c.root) { Start-Process explorer.exe $c.root }
  })
$menu.Items.Add("Copy the Hub address").add_Click({
    $a = Get-Address
    if ($a) {
      [System.Windows.Forms.Clipboard]::SetText($a)
      $icon.ShowBalloonTip(4000, "Workbench Hub", "Copied: " + $a + "  Paste it on your other devices (bell - Hub).", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
      $icon.ShowBalloonTip(5000, "Workbench Hub", "Tailscale isn't set up on this computer yet. Install it from tailscale.com and sign in, then run the Hub installer again.", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
  })
$menu.Items.Add("Show the log").add_Click({ if (Test-Path $Log) { Start-Process notepad.exe $Log } })
$menu.Items.Add("Restart the Hub").add_Click({ Stop-Hub; $script:Fails = 0; Start-Hub })
$menu.Items.Add("-") | Out-Null
$menu.Items.Add("Quit the Hub").add_Click({
    Stop-Hub
    $icon.Visible = $false
    $icon.Dispose()
    [System.Windows.Forms.Application]::Exit()
  })
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Start-Process "http://127.0.0.1:$Port/" })

Start-Hub

$tick = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
    $script:tick++
    if ($script:Proc -and $script:Proc.HasExited) {
      $code = $script:Proc.ExitCode
      $script:Proc = $null
      if ($code -eq 3) {
        # the Hub updated itself: start the new version, and a new tray too if this file changed
        if ((Get-Item (Join-Path $Here "tray.ps1")).LastWriteTimeUtc -ne $script:TrayStamp) {
          Start-Process wscript.exe ('"' + (Join-Path $Here "launch.vbs") + '"')
          $icon.Visible = $false
          $mutex.ReleaseMutex()
          [System.Windows.Forms.Application]::Exit()
          return
        }
        Start-Hub
        $icon.ShowBalloonTip(3000, "Workbench Hub", "Updated to a new version.", [System.Windows.Forms.ToolTipIcon]::Info)
      } elseif ($code -eq 2) {
        $script:Status = "Another program uses port $Port"
        $script:WaitUntil = (Get-Date).AddSeconds(60)
      } else {
        $script:Fails++
        $wait = [Math]::Min(60, 5 * $script:Fails)
        $script:WaitUntil = (Get-Date).AddSeconds($wait)
        $script:Status = "Stopped - starting again"
      }
    }
    if (-not $script:Proc -and (Get-Date) -ge $script:WaitUntil) { Start-Hub }
    if ($script:tick % 5 -eq 1) {
      if (Ping-Hub) { $script:Status = "Online"; $script:Fails = 0 }
      elseif ($script:Proc) { $script:Status = "Starting" }
      $t = "Workbench Hub - " + $script:Status
      if ($t.Length -gt 63) { $t = $t.Substring(0, 63) }
      $icon.Text = $t
      $head.Text = $t
    }
  })
$timer.Start()

[System.Windows.Forms.Application]::Run()
Stop-Hub

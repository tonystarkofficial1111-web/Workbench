# Removes the Workbench Hub program from this computer. Your Hub folder (Work, designs, music,
# videos and saves) is NOT deleted.
$HubHome = Join-Path $env:LOCALAPPDATA "WorkbenchHub"
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like "*WorkbenchHub*" -and ($_.Name -eq "powershell.exe" -or $_.Name -eq "node.exe") -and $_.ProcessId -ne $PID } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) "Workbench Hub.lnk") -Force -ErrorAction SilentlyContinue
$root = ""
try { $root = (Get-Content (Join-Path $HubHome "hub.json") -Raw | ConvertFrom-Json).root } catch {}
$ts = "C:\Program Files\Tailscale\tailscale.exe"
if (Test-Path $ts) { & $ts serve --https=443 off 2>$null | Out-Null }
Remove-Item $HubHome -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Workbench Hub removed." -ForegroundColor Green
if ($root) { Write-Host ("Your files are still in " + $root) }

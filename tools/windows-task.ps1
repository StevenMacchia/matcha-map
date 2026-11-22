# Registers (or removes) a Windows Task Scheduler job that runs `npm run refresh` in this repo every 6 hours.
#   powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1            # register
#   powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove    # remove
# Runs as the current user, only while that user is signed in. No keys needed. Output goes to .cache\refresh.log.
param([switch]$Remove, [int]$EveryHours = 6)

$ErrorActionPreference = "Stop"
$TaskName = "Matcha Map refresh"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed the scheduled task '$TaskName'."
  } else {
    Write-Output "No scheduled task named '$TaskName'. Nothing to remove."
  }
  return
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node is not on PATH. Install Node 20 or newer, open a new terminal, and run this again." }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm.cmd is not on PATH. It ships with Node." }
$nodeDir = Split-Path $node.Source

# cmd.exe: put Node first on PATH, move to the repo, run the refresh, append output to a log.
$log = Join-Path $Repo ".cache\refresh.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$cmd = "/c set `"PATH=$nodeDir;%PATH%`" && cd /d `"$Repo`" && npm run refresh >> `"$log`" 2>&1"

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmd -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $EveryHours)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Matcha Map: discover, watch, ingest every $EveryHours hours." -Force | Out-Null

Write-Output "Registered '$TaskName'."
Write-Output "  Runs:    npm run refresh in $Repo"
Write-Output "  Node:    $nodeDir"
Write-Output "  Every:   $EveryHours hours, first run in about 5 minutes"
Write-Output "  Log:     $log"
Write-Output "  Remove:  powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove"

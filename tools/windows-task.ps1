# Registers (or removes) two Windows Task Scheduler jobs for this repo:
#   "Matcha Map watch"    runs `npm run watch` every hour (hashtag harvest, then the accounts that are due)
#   "Matcha Map refresh"  runs `npm run refresh` every 6 hours (discover, watch, ingest)
#   powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1            # register both
#   powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove    # remove both
# Runs as the current user, only while that user is signed in. No keys needed. Output goes to .cache\watch.log and .cache\refresh.log.
param([switch]$Remove, [int]$EveryHours = 6, [int]$WatchEveryHours = 1)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Jobs = @(
  @{ Name = "Matcha Map watch";   Npm = "watch";   Hours = $WatchEveryHours; Log = "watch.log";   About = "watch (hashtags, then due accounts)" },
  @{ Name = "Matcha Map refresh"; Npm = "refresh"; Hours = $EveryHours;      Log = "refresh.log"; About = "discover, watch, ingest" }
)

if ($Remove) {
  foreach ($j in $Jobs) {
    if (Get-ScheduledTask -TaskName $j.Name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $j.Name -Confirm:$false
      Write-Output "Removed the scheduled task '$($j.Name)'."
    } else {
      Write-Output "No scheduled task named '$($j.Name)'. Nothing to remove."
    }
  }
  return
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node is not on PATH. Install Node 20 or newer, open a new terminal, and run this again." }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm.cmd is not on PATH. It ships with Node." }
$nodeDir = Split-Path $node.Source
New-Item -ItemType Directory -Force (Join-Path $Repo ".cache") | Out-Null

foreach ($j in $Jobs) {
  $log = Join-Path $Repo (Join-Path ".cache" $j.Log)
  # cmd.exe: put Node first on PATH, move to the repo, run the script, append output to a log.
  $cmd = "/c set `"PATH=$nodeDir;%PATH%`" && cd /d `"$Repo`" && npm run $($j.Npm) >> `"$log`" 2>&1"
  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmd -WorkingDirectory $Repo
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $j.Hours)
  # A run that is still going when the next is due is left alone (IgnoreNew); one run never lasts past the hour.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $trigger -Settings $settings -Description "Matcha Map: $($j.About) every $($j.Hours) hours." -Force | Out-Null
  Write-Output "Registered '$($j.Name)': npm run $($j.Npm) every $($j.Hours) hours, log $log"
}

Write-Output "  Repo:    $Repo"
Write-Output "  Node:    $nodeDir"
Write-Output "  First runs in about 5 minutes."
Write-Output "  Remove:  powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove"

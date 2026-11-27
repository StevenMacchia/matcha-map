# Registers (or removes) two Windows Task Scheduler jobs for this repo (docs/DAILY-RUN.md):
#   "Matcha Map daily"  runs `npm run daily` every day at 13:00 local time (America/New_York, so it follows daylight saving):
#                       pull, discover, watch, ingest, Yelp leads, deepen new shops, smoke, report, commit, push, deploy. No model calls.
#   "Matcha Map watch"  runs `npm run watch` every hour (hashtag harvest, then the accounts that are due)
#   "Matcha Map weekend" runs `npm run daily:popups` at 08:00 local time on Friday, Saturday and Sunday (Steven, 2026-11-27: the pop-up
#                       map must be fresh on weekend mornings): pull, discover, watch, ingest, pages, seo-gate, smoke, report, commit, push, deploy.
# The old 6-hourly "Matcha Map refresh" task is retired: registering removes it if it is there.
#   powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1            # register daily and watch
#   powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove    # remove daily, watch and the retired refresh
# Register it from the plain checkout (the task runs in the folder this script lives in; -Repo overrides that).
# Runs as the current user, only while that user is signed in. No keys needed. Output goes to .cache\daily.log and .cache\watch.log.
param([switch]$Remove, [string]$Repo = "", [string]$DailyAt = "13:00", [int]$WatchEveryHours = 1, [string]$WeekendAt = "08:00")

$ErrorActionPreference = "Stop"
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$Retired = @("Matcha Map refresh")
$Jobs = @(
  @{ Name = "Matcha Map daily"; Npm = "daily"; Log = "daily.log"; About = "daily run (pull, discover, watch, ingest, leads, smoke, report, commit, push, deploy) at $DailyAt local time"; Daily = $true;  LimitHours = 3 },
  @{ Name = "Matcha Map watch"; Npm = "watch"; Log = "watch.log"; About = "watch (hashtags, then due accounts) every $WatchEveryHours hours";                                          Daily = $false; LimitHours = 1 },
  @{ Name = "Matcha Map weekend"; Npm = "daily:popups"; Log = "weekend.log"; About = "pop-up refresh (pull, discover, watch, ingest, pages, gate, smoke, deploy) at $WeekendAt local time Fri-Sun"; Daily = $false; Weekend = $true; LimitHours = 2 }
)

if ($Remove) {
  foreach ($name in (@($Jobs | ForEach-Object { $_.Name }) + $Retired)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Output "Removed the scheduled task '$name'."
    } else {
      Write-Output "No scheduled task named '$name'. Nothing to remove."
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

foreach ($name in $Retired) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Output "Retired the scheduled task '$name' (the daily run replaces it)."
  }
}

foreach ($j in $Jobs) {
  $log = Join-Path $Repo (Join-Path ".cache" $j.Log)
  # cmd.exe: put Node first on PATH, move to the repo, run the script, append output to a log.
  $cmd = "/c set `"PATH=$nodeDir;%PATH%`" && cd /d `"$Repo`" && npm run $($j.Npm) >> `"$log`" 2>&1"
  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmd -WorkingDirectory $Repo
  if ($j.Daily) {
    $trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
  } elseif ($j.Weekend) {
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday,Saturday,Sunday -At $WeekendAt
  } else {
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $WatchEveryHours)
  }
  # A run that is still going when the next is due is left alone (IgnoreNew). StartWhenAvailable: a missed run starts when the machine wakes.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours $j.LimitHours) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $trigger -Settings $settings -Description "Matcha Map: $($j.About)." -Force | Out-Null
  Write-Output "Registered '$($j.Name)': npm run $($j.Npm), $($j.About), log $log"
}

Write-Output "  Repo:    $Repo"
Write-Output "  Node:    $nodeDir"
Write-Output "  Daily:   $DailyAt local time. Weekend pop-up refresh: $WeekendAt Fri-Sun. Watch: first run in about 5 minutes."
Write-Output "  Remove:  powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove"

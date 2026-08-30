# scripts/device/run_e2e_qa.ps1 - the scriptable half of the MVP end-to-end QA
# pass (docs/13 Part 6, "m3c Task 9 step 6").
#
# WHAT THIS IS AND IS NOT.
#
# docs/13 Part 6 says that pass "cannot be automated and must not be marked
# done by inference." That is true of the pass as a whole and false of roughly
# half its individual steps, which are a launch, a tap, a view-tree dump and a
# string assertion. This script runs those. It does NOT run the rest, and it
# does not pretend the rest passed: every step it cannot settle is emitted as
# MANUAL, pointing at docs/13's eyes-only checklist, and the results file it
# writes carries those as open items rather than omitting them.
#
# NOTHING HERE MARKS A GATE. It produces observations. A human reads them.
#
# ORDER MATTERS AND IS NOT DECORATIVE. Later steps depend on data earlier ones
# create - the same reason Part 6 says to work top to bottom - so -From is
# provided for resuming and -Only for re-running one step, but the default is
# the whole ordered list.
#
# USAGE
#   .\run_e2e_qa.ps1 -List
#   .\run_e2e_qa.ps1                                   # everything, dev variant
#   .\run_e2e_qa.ps1 -From live_capture
#   .\run_e2e_qa.ps1 -Only nav_hubs,touch_targets
#   .\run_e2e_qa.ps1 -ApkPath ..\..\android\app\build\outputs\apk\debug\app-debug.apk -AllowWipe
#   .\run_e2e_qa.ps1 -IncludeSlow                      # adds the 6-minute re-lock wait
#
# THE RECOVERY-PHRASE RULE APPLIES THROUGHOUT. This script never screenshots
# and never pulls a view tree without adb_common.ps1's device-side interlock
# clearing first, and the onboarding step hands off to enter_recovery_phrase.ps1
# rather than reading the words itself.

[CmdletBinding()]
param(
  [ValidateSet("development", "preview")]
  [string]$Variant = "development",
  [string[]]$Only,
  [string]$From,
  [string]$ApkPath,
  [switch]$AllowWipe,
  [switch]$IncludeSlow,
  [switch]$IncludeReboot,
  [switch]$List,
  [int]$RelockWaitSeconds = 390,
  [string]$OutFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\adb_common.ps1"

$script:Package = Get-PeraPlanoPackage -Variant $Variant
$script:Results = New-Object System.Collections.ArrayList

# A per-run marker so an assertion cannot pass on a row left over from a
# previous session. Any check that looks for "the notification we just posted"
# looks for this amount.
$script:Marker = (Get-Random -Minimum 100 -Maximum 899)
$script:MarkerAmount = "$($script:Marker).00"

function Add-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][ValidateSet("OBSERVED", "NOT_OBSERVED", "MANUAL", "SKIPPED", "ERROR")][string]$Outcome,
    [Parameter(Mandatory = $true)][string]$Detail
  )
  $color = @{
    OBSERVED = "Green"; NOT_OBSERVED = "Red"; MANUAL = "Yellow"; SKIPPED = "DarkGray"; ERROR = "Red"
  }[$Outcome]
  Write-Host ("  [{0}] {1}" -f $Outcome, $Detail) -ForegroundColor $color
  [void]$script:Results.Add([pscustomobject]@{ step = $Step; outcome = $Outcome; detail = $Detail })
}

function Read-ManualOutcome {
  <#
  .SYNOPSIS
    Asks the operator what they saw, and refuses "OK".
  .DESCRIPTION
    docs/13's standing rule: record the actual observed result in every box, a
    number or a sentence. "OK" is not an outcome, and a checklist full of ticks
    is worth nothing six weeks later when somebody asks what the app actually
    did.
  #>
  param([Parameter(Mandatory = $true)][string]$Step, [Parameter(Mandatory = $true)][string]$Instruction)

  Write-Host ""
  Write-Host ">>> MANUAL: $Instruction" -ForegroundColor Yellow
  while ($true) {
    $answer = Read-Host "    What did you actually see? (or 'skip')"
    $trimmed = $answer.Trim()
    if ($trimmed -eq "skip") {
      Add-Result -Step $Step -Outcome "SKIPPED" -Detail "not reached this session"
      return
    }
    if ($trimmed.Length -lt 6 -or $trimmed -match "^(ok|okay|fine|good|yes|pass|works)\.?$") {
      Write-Host "    'OK' is not an outcome. Describe what happened." -ForegroundColor Red
      continue
    }
    Add-Result -Step $Step -Outcome "MANUAL" -Detail $trimmed
    return
  }
}

function Invoke-RunAs {
  <#
  .SYNOPSIS
    Runs a command inside the app's private data directory.
  .DESCRIPTION
    `run-as` only works on a DEBUGGABLE build, so this is a dev-variant tool.
    On a preview/release APK it fails, and the caller records that rather than
    reporting a false negative about encryption.
  #>
  param([Parameter(Mandatory = $true)][string]$Command)
  return Invoke-AdbShell "run-as $script:Package sh -c '$Command'" -AllowFailure
}

# ===========================================================================
# The steps
# ===========================================================================

$steps = [ordered]@{}

$steps["preflight"] = @{
  proves = "One authorized device, the right package, and a record of which handset produced everything below."
  run    = {
    Assert-SingleDevice | Out-Null
    $facts = Get-DeviceFacts
    Add-Result -Step "preflight" -Outcome "OBSERVED" -Detail ("{0} ({1}), Android {2} / SDK {3}, screen {4}" -f $facts.model, $facts.device, $facts.release, $facts.sdk, (Get-ScreenState))

    if (Test-PackageInstalled -Package $script:Package) {
      Add-Result -Step "preflight" -Outcome "OBSERVED" -Detail "$script:Package is installed (exact-name match, not a substring hit)"
    }
    else {
      Add-Result -Step "preflight" -Outcome "NOT_OBSERVED" -Detail "$script:Package is NOT installed"
    }
  }
}

$steps["fresh_install"] = @{
  proves = "Part 6's opening requirement: a FRESH install, uninstalled rather than data-cleared, because several checks are about first-run state that a reused install silently skips."
  run    = {
    if (-not $ApkPath) {
      Add-Result -Step "fresh_install" -Outcome "SKIPPED" -Detail "no -ApkPath given; assuming the install already on the device"
      return
    }
    if (-not $AllowWipe) {
      Add-Result -Step "fresh_install" -Outcome "SKIPPED" -Detail "-ApkPath given but -AllowWipe not set; refusing to uninstall"
      return
    }
    if (-not (Test-Path $ApkPath)) { throw "APK not found at $ApkPath" }

    # Uninstall by EXACT package. `com.filldev.peraplano` is a prefix of both
    # `.dev` and `.prev`, so anything doing a substring match here could
    # uninstall the wrong app - the same trap docs/13 Part 3a records for
    # `pm list packages`.
    Write-Host "  Uninstalling $script:Package ..." -ForegroundColor DarkGray
    Invoke-Adb -AdbArgs @("uninstall", $script:Package) -AllowFailure | Out-Null
    if (Test-PackageInstalled -Package $script:Package) { throw "Uninstall did not take." }

    Invoke-Adb -AdbArgs @("install", "-r", "--user", "0", $ApkPath) | Out-Null
    if (-not (Test-PackageInstalled -Package $script:Package)) { throw "Install did not take." }
    Add-Result -Step "fresh_install" -Outcome "OBSERVED" -Detail "uninstalled and reinstalled $script:Package from $ApkPath"
  }
}

$steps["launch_first_run"] = @{
  proves = "A fresh install starts at onboarding's welcome step, not at the splash. app/index.tsx is never rendered on a first run - lock_context routes needs_onboarding straight past it."
  run    = {
    Start-App -Package $script:Package
    Start-Sleep -Seconds 5
    $tree = Get-ViewTree
    $resumed = Invoke-AdbShell "dumpsys activity activities | grep -m1 mResumedActivity" -AllowFailure
    if ($resumed -like "*$script:Package*") {
      Add-Result -Step "launch_first_run" -Outcome "OBSERVED" -Detail "app is the resumed activity"
    }
    else {
      Add-Result -Step "launch_first_run" -Outcome "NOT_OBSERVED" -Detail "resumed activity is not ours: $($resumed.Trim())"
    }
    $texts = @($tree.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ })
    Add-Result -Step "launch_first_run" -Outcome "OBSERVED" -Detail ("first screen text: " + (($texts | Select-Object -First 6) -join " | "))
  }
}

$steps["onboarding"] = @{
  proves = "Nothing on its own - it is the precondition for everything after it. All twelve steps from a wiped install are an eyes-only check (docs/13 Part 8)."
  run    = {
    Write-Host ""
    Write-Host "  Onboarding is driven by hand. Two of its steps cannot be scripted at all:" -ForegroundColor Yellow
    Write-Host "  the system authentication prompt, and the recovery-phrase screen." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  On the recovery-phrase DISPLAY step, do NOT screenshot it. Run, in another shell:" -ForegroundColor Yellow
    Write-Host "      .\enter_recovery_phrase.ps1 -Capture" -ForegroundColor Cyan
    Write-Host "  then tap through to the confirm step and run:" -ForegroundColor Yellow
    Write-Host "      .\enter_recovery_phrase.ps1 -Confirm" -ForegroundColor Cyan
    Write-Host "  and when the whole session is over:" -ForegroundColor Yellow
    Write-Host "      .\enter_recovery_phrase.ps1 -Shred" -ForegroundColor Cyan
    Read-ManualOutcome -Step "onboarding" -Instruction "Complete onboarding end to end. Describe what happened, including anything that needed a force-quit."
  }
}

$steps["notification_access"] = @{
  proves = "The config plugin injected the <service> into the build actually installed, and Android has it enabled. If PeraPlano is absent from the Notification Access screen, nothing downstream can pass."
  run    = {
    $component = Get-ListenerComponent -Package $script:Package
    Invoke-AdbShell "cmd notification allow_listener $component" -AllowFailure | Out-Null
    Start-Sleep -Milliseconds 800
    $enabled = Invoke-AdbShell "settings get secure enabled_notification_listeners" -AllowFailure
    if ($enabled -like "*$component*") {
      Add-Result -Step "notification_access" -Outcome "OBSERVED" -Detail "listener enabled: $component"
    }
    else {
      Write-Host "  adb could not grant it (common on Samsung builds). Grant it by hand." -ForegroundColor Yellow
      Invoke-AdbShell "am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS" -AllowFailure | Out-Null
      Read-ManualOutcome -Step "notification_access" -Instruction "Is PeraPlano listed on the Notification Access screen, and did granting it stick?"
    }
  }
}

$steps["nav_hubs"] = @{
  proves = "Plan and More land on their HUB screens rather than jumping straight to Bills / Settings. Left open by an interrupted session; a stack that restores a leaf on tab press looks identical in Jest."
  run    = {
    Invoke-Tap -TestId "tab-plan" | Out-Null
    $tree = Get-ViewTree
    if ($null -ne (Find-UiNode -Tree $tree -TestId "plan-segments-screen")) {
      Add-Result -Step "nav_hubs" -Outcome "OBSERVED" -Detail "Plan tab landed on the hub (plan-segments-screen)"
    }
    else {
      $texts = @($tree.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ } | Select-Object -First 5)
      Add-Result -Step "nav_hubs" -Outcome "NOT_OBSERVED" -Detail ("Plan tab did NOT land on the hub. On screen: " + ($texts -join " | "))
    }

    Invoke-Tap -TestId "tab-more" | Out-Null
    $tree = Get-ViewTree
    if ($null -ne (Find-UiNode -Tree $tree -TestId "more-hub")) {
      Add-Result -Step "nav_hubs" -Outcome "OBSERVED" -Detail "More tab landed on the hub (more-hub)"
    }
    else {
      $texts = @($tree.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ } | Select-Object -First 5)
      Add-Result -Step "nav_hubs" -Outcome "NOT_OBSERVED" -Detail ("More tab did NOT land on the hub. On screen: " + ($texts -join " | "))
    }
  }
}

$steps["deep_links"] = @{
  proves = "The three documented adb entry points still resolve. They are the only way back to manual entry, wallet-new and income once the in-app paths disappear, so every later step in docs/13's W1 walkthrough depends on them."
  run    = {
    $links = @(
      @{ url = "peraplano://transaction/new"; expect = "manual-entry-form" },
      @{ url = "peraplano://wallet/new"; expect = $null },
      @{ url = "peraplano://plan/income"; expect = $null }
    )
    foreach ($link in $links) {
      Open-DeepLink -Url $link.url
      Start-Sleep -Seconds 2
      $tree = Get-ViewTree
      if ($link.expect) {
        if ($null -ne (Find-UiNode -Tree $tree -TestId $link.expect)) {
          Add-Result -Step "deep_links" -Outcome "OBSERVED" -Detail "$($link.url) -> $($link.expect) present"
        }
        else {
          Add-Result -Step "deep_links" -Outcome "NOT_OBSERVED" -Detail "$($link.url) -> $($link.expect) NOT found"
        }
      }
      else {
        $texts = @($tree.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ } | Select-Object -First 4)
        Add-Result -Step "deep_links" -Outcome "OBSERVED" -Detail ("$($link.url) -> on screen: " + ($texts -join " | "))
      }
      # Back out, so the next link starts from a known place rather than
      # stacking three routes.
      Invoke-AdbShell "input keyevent 4" | Out-Null
      Start-Sleep -Milliseconds 700
    }
  }
}

$steps["touch_targets"] = @{
  proves = "The painted height of the three targets left deliberately unmeasured against the 44pt minimum. Their real size depends on an unstyled platform-default text size that nothing off-device can see, which is why they were reported rather than adjusted."
  run    = {
    Open-DeepLink -Url "peraplano://transaction/new"
    Start-Sleep -Seconds 2
    foreach ($id in @("manual-entry-date", "manual-amount", "manual-entry-form")) {
      try {
        $m = Measure-TouchTarget -TestId $id
        $verdict = "under 44dp"
        if ($m.meets_44) { $verdict = "meets 44dp" }
        Add-Result -Step "touch_targets" -Outcome "OBSERVED" -Detail ("{0}: {1}x{2} px = {3}x{4} dp at density {5} -> {6}" -f $id, $m.width_px, $m.height_px, $m.width_dp, $m.height_dp, $m.density, $verdict)
      }
      catch {
        Add-Result -Step "touch_targets" -Outcome "NOT_OBSERVED" -Detail "$id could not be measured: $($_.Exception.Message)"
      }
    }
    Write-Host "  These are MEASUREMENTS. Whether a 43dp field ships is a decision, not a threshold." -ForegroundColor Yellow
    Invoke-AdbShell "input keyevent 4" | Out-Null
  }
}

$steps["live_capture"] = @{
  proves = "The core promise: a notification arrives, is captured, parsed, and reaches the ledger. Posted from com.android.shell, so it exercises capture and parsing but NOT provider matching from a real bank package (that is Part 3a's separate question)."
  run    = {
    Invoke-Tap -TestId "tab-transactions" | Out-Null
    Post-TestNotification -Text "Sent PHP $script:MarkerAmount to JUAN D. Ref $script:Marker." -Title "TEST"
    Start-Sleep -Seconds 3

    $found = $false
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 30) {
      $tree = Get-ViewTree
      if (Test-UiText -Tree $tree -Text $script:Marker) { $found = $true; break }
    }
    if ($found) {
      Add-Result -Step "live_capture" -Outcome "OBSERVED" -Detail "marker $script:MarkerAmount reached the ledger within $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"
    }
    else {
      Add-Result -Step "live_capture" -Outcome "NOT_OBSERVED" -Detail "marker $script:MarkerAmount did not reach the ledger within 30 s"
    }
  }
}

$steps["why_recorded"] = @{
  proves = "The captured text and a real expiry countdown are both shown. The panel is collapsed behind a tap ON PURPOSE (why_recorded_panel.tsx documents it as a privacy choice) - a visible-by-default panel is the bug here, not the fix."
  run    = {
    try {
      Invoke-Tap -Text $script:Marker | Out-Null
      Invoke-Tap -Text "Why was this recorded" | Out-Null
      $tree = Get-ViewTree
      $texts = @($tree.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ })
      $countdown = $texts | Where-Object { $_ -match "\bday|\bhour|expire|deleted" } | Select-Object -First 2
      if ($countdown) {
        Add-Result -Step "why_recorded" -Outcome "OBSERVED" -Detail ("panel opened; countdown-ish copy: " + ($countdown -join " | "))
      }
      else {
        Add-Result -Step "why_recorded" -Outcome "NOT_OBSERVED" -Detail "panel opened but no countdown copy found"
      }
    }
    catch {
      Add-Result -Step "why_recorded" -Outcome "NOT_OBSERVED" -Detail $_.Exception.Message
    }
    Invoke-AdbShell "input keyevent 4" | Out-Null
  }
}

$steps["twin_no_double_count"] = @{
  proves = "Whether a twin SMS-style notification for the same payment double-counts."
  run    = {
    Write-Host "  EXPECT THIS TO FAIL AS SEEDED, and record it anyway - that is the point." -ForegroundColor Yellow
    Write-Host "  The shipped seed cannot express one bank on two channels: a push is providerKey" -ForegroundColor DarkGray
    Write-Host "  'bpi' and its SMS relay is 'sms_relay', so they never compare as the same" -ForegroundColor DarkGray
    Write-Host "  provider and the twin window can never fire. The failure is evidence the" -ForegroundColor DarkGray
    Write-Host "  corpus work needs, not a defect found here." -ForegroundColor DarkGray

    Invoke-Tap -TestId "tab-transactions" | Out-Null
    $tree_before = Get-ViewTree
    $before = @($tree_before.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ -like "*$script:Marker*" }).Count

    Post-TestNotification -Text "You sent P$script:MarkerAmount to JUAN D. Ref $script:Marker" -Title "Messages" -Tag "peraplano_twin"
    Start-Sleep -Seconds 8
    $tree_after = Get-ViewTree
    $after = @($tree_after.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ -like "*$script:Marker*" }).Count

    Add-Result -Step "twin_no_double_count" -Outcome "OBSERVED" -Detail "nodes mentioning the marker: $before before the twin, $after after (a rise means it double-counted)"
  }
}

$steps["review_queue"] = @{
  proves = "An unrecognised-provider capture lands in the Review Queue and the banner appears. The banner is absent at zero by design, so it has to be forced."
  run    = {
    Post-TestNotification -Text "Sent PHP 500.00 to a friend." -Title "SomeUnknownApp" -Tag "peraplano_unknown"
    Start-Sleep -Seconds 5
    Invoke-Tap -TestId "tab-transactions" | Out-Null
    $tree = Get-ViewTree
    if (Test-UiText -Tree $tree -Text "Needs your review") {
      Add-Result -Step "review_queue" -Outcome "OBSERVED" -Detail "'Needs your review' banner is present"
    }
    else {
      Add-Result -Step "review_queue" -Outcome "NOT_OBSERVED" -Detail "no 'Needs your review' banner after an unmatched capture"
    }
  }
}

$steps["capture_while_dead"] = @{
  proves = "Durability across process death - the core promise, and the one a JVM suite provably cannot make. This is the shape of the bug session 1 existed to find."
  run    = {
    $marker2 = (Get-Random -Minimum 900 -Maximum 999)
    Stop-App -Package $script:Package
    Start-Sleep -Seconds 2
    Post-TestNotification -Text "Sent PHP $marker2.00 to DEAD APP TEST. Ref $marker2." -Title "TEST" -Tag "peraplano_dead"
    Start-Sleep -Seconds 3
    Start-App -Package $script:Package
    Start-Sleep -Seconds 6

    $found = $false
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 40) {
      $tree = Get-ViewTree
      if (Test-UiText -Tree $tree -Text $marker2) { $found = $true; break }
    }
    if ($found) {
      Add-Result -Step "capture_while_dead" -Outcome "OBSERVED" -Detail "notification posted while force-stopped was captured and drained (marker $marker2)"
    }
    else {
      Add-Result -Step "capture_while_dead" -Outcome "NOT_OBSERVED" -Detail "marker $marker2, posted while the app was dead, never appeared"
    }
  }
}

$steps["buffer_is_ciphertext"] = @{
  proves = "The on-disk capture buffer holds no readable notification text. Checked DEVICE-SIDE and reported as counts only - the buffer is exactly the file that must never be printed."
  run    = {
    $path = "files/pending_captures.ndjson"
    $exists = (Invoke-RunAs "[ -f $path ] && echo yes || echo no").Trim()
    if ($exists -ne "yes") {
      Add-Result -Step "buffer_is_ciphertext" -Outcome "SKIPPED" -Detail "no $path (run-as needs a debuggable build; a preview/release APK cannot be inspected this way)"
      return
    }
    $probes = @("JUAN", "PHP", "Sent", "Ref", "friend", "$script:Marker")
    $hits = @()
    foreach ($probe in $probes) {
      $c = (Invoke-RunAs "grep -c '$probe' $path 2>/dev/null || true").Trim()
      if ($c -match "^\d+$" -and [int]$c -gt 0) { $hits += "$probe=$c" }
    }
    if ($hits.Count -eq 0) {
      Add-Result -Step "buffer_is_ciphertext" -Outcome "OBSERVED" -Detail "0 hits for all $($probes.Count) plaintext probes"
    }
    else {
      Add-Result -Step "buffer_is_ciphertext" -Outcome "NOT_OBSERVED" -Detail "PLAINTEXT FOUND IN THE BUFFER: $($hits -join ', ')"
    }
  }
}

$steps["database_is_encrypted"] = @{
  proves = "The SQLCipher database is not a readable SQLite file. Checked by its magic header device-side, so it needs no sqlite3 on this laptop and never copies the database off the phone."
  run    = {
    $found = (Invoke-RunAs "find . -name 'peraplano.db' 2>/dev/null | head -n 1").Trim()
    if (-not $found) {
      Add-Result -Step "database_is_encrypted" -Outcome "SKIPPED" -Detail "peraplano.db not reachable (run-as needs a debuggable build, and onboarding must have completed)"
      return
    }
    # A plain SQLite file starts with the ASCII string "SQLite format 3".
    # SQLCipher encrypts from byte zero, header included, so a hit here means
    # the database is NOT encrypted.
    $c = (Invoke-RunAs "head -c 16 '$found' | grep -c 'SQLite format 3' 2>/dev/null || true").Trim()
    if ($c -match "^\d+$" -and [int]$c -eq 0) {
      Add-Result -Step "database_is_encrypted" -Outcome "OBSERVED" -Detail "$found does not carry the plain-SQLite magic header"
    }
    else {
      Add-Result -Step "database_is_encrypted" -Outcome "NOT_OBSERVED" -Detail "$found STARTS WITH 'SQLite format 3' - it is not encrypted"
    }
  }
}

$steps["relock_after_background"] = @{
  proves = "The five-minute background timer actually re-locks the app. Slow by nature: the wait is the assertion."
  run    = {
    if (-not $IncludeSlow) {
      Add-Result -Step "relock_after_background" -Outcome "SKIPPED" -Detail "needs -IncludeSlow (a ~$([math]::Round($RelockWaitSeconds/60,1))-minute wall-clock wait)"
      return
    }
    Invoke-AdbShell "input keyevent 3" | Out-Null
    Write-Host "  Backgrounded. Waiting $RelockWaitSeconds s in wall clock..." -ForegroundColor DarkGray
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $RelockWaitSeconds) {
      Start-Sleep -Seconds 15
      Write-Host ("    {0}s / {1}s" -f [math]::Round($sw.Elapsed.TotalSeconds), $RelockWaitSeconds) -ForegroundColor DarkGray
    }
    Start-App -Package $script:Package
    Start-Sleep -Seconds 4
    $tree = Get-ViewTree
    $locked = (Test-UiText -Tree $tree -Text "Unlock") -or ($null -ne (Find-UiNode -Tree $tree -TestId "lock-screen"))
    if ($locked) {
      Add-Result -Step "relock_after_background" -Outcome "OBSERVED" -Detail "app presented a lock surface after $RelockWaitSeconds s backgrounded"
    }
    else {
      $texts = @($tree.SelectNodes("//node") | ForEach-Object { $_.GetAttribute("text") } | Where-Object { $_ } | Select-Object -First 5)
      Add-Result -Step "relock_after_background" -Outcome "NOT_OBSERVED" -Detail ("no lock surface; on screen: " + ($texts -join " | "))
    }
  }
}

$steps["reboot_survival"] = @{
  proves = "The listener re-binds after a reboot without the app being opened. Some OEMs silently revoke notification access across a reboot; this is where that shows up."
  run    = {
    if (-not $IncludeReboot) {
      Add-Result -Step "reboot_survival" -Outcome "SKIPPED" -Detail "needs -IncludeReboot"
      return
    }
    $marker3 = "777"
    Invoke-Adb -AdbArgs @("reboot") | Out-Null
    Write-Host "  Rebooting. Waiting for the device to come back..." -ForegroundColor DarkGray
    Invoke-Adb -AdbArgs @("wait-for-device") | Out-Null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 240) {
      $boot = (Invoke-AdbShell "getprop sys.boot_completed" -AllowFailure).Trim()
      if ($boot -eq "1") { break }
      Start-Sleep -Seconds 5
    }
    Write-Host ""
    Write-Host ">>> Unlock the phone after the reboot, then press Enter. DO NOT OPEN PERAPLANO." -ForegroundColor Yellow
    Read-Host "    Enter when unlocked" | Out-Null

    Post-TestNotification -Text "Sent PHP $marker3.00 after reboot. Ref $marker3." -Tag "peraplano_reboot"
    Start-Sleep -Seconds 4
    Start-App -Package $script:Package
    Start-Sleep -Seconds 8

    $found = $false
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw2.Elapsed.TotalSeconds -lt 40) {
      $tree = Get-ViewTree
      if (Test-UiText -Tree $tree -Text $marker3) { $found = $true; break }
    }
    if ($found) {
      Add-Result -Step "reboot_survival" -Outcome "OBSERVED" -Detail "listener re-bound after reboot and captured with the app never opened"
    }
    else {
      $enabled = Invoke-AdbShell "settings get secure enabled_notification_listeners" -AllowFailure
      $still = "still granted"
      if ($enabled -notlike "*$script:Package*") { $still = "ACCESS WAS REVOKED ACROSS THE REBOOT" }
      Add-Result -Step "reboot_survival" -Outcome "NOT_OBSERVED" -Detail "post-reboot capture did not appear; notification access: $still"
    }
  }
}

$steps["handoff_to_eyes_only"] = @{
  proves = "Nothing. It exists so the eyes-only checklist is impossible to forget at the end of a scripted run."
  run    = {
    Write-Host ""
    Write-Host "  Everything a script cannot settle is in docs/13 Part 8 - the eyes-only" -ForegroundColor Yellow
    Write-Host "  checklist. Card shadows, chip geometry and mis-taps, motion under 'Remove" -ForegroundColor Yellow
    Write-Host "  animations', the CSV in a real spreadsheet, the twelve onboarding steps," -ForegroundColor Yellow
    Write-Host "  ImagePlaceholder overflow, the Plan back-stack, dark mode. Work it now." -ForegroundColor Yellow
    Add-Result -Step "handoff_to_eyes_only" -Outcome "MANUAL" -Detail "docs/13 Part 8 not run by this script; record its outcomes there"
  }
}

# ===========================================================================
# Driver
# ===========================================================================

if ($List) {
  Write-Host "Steps, in order:" -ForegroundColor Cyan
  foreach ($name in $steps.Keys) {
    Write-Host ("  {0,-26} {1}" -f $name, $steps[$name].proves) -ForegroundColor Gray
  }
  return
}

$selected = @($steps.Keys)
if ($From) {
  $index = $selected.IndexOf($From)
  if ($index -lt 0) { throw "Unknown step '$From'. Run -List." }
  $selected = $selected[$index..($selected.Count - 1)]
}
if ($Only) {
  foreach ($name in $Only) { if (-not $steps.Contains($name)) { throw "Unknown step '$name'. Run -List." } }
  $selected = @($selected | Where-Object { $Only -contains $_ })
}

Write-Host "Variant: $Variant ($script:Package). Marker amount for this run: PHP $script:MarkerAmount" -ForegroundColor Cyan
Write-Host ""

try {
  foreach ($name in $selected) {
    Write-Host "== $name" -ForegroundColor White
    Write-Host "   proves: $($steps[$name].proves)" -ForegroundColor DarkGray
    try {
      & $steps[$name].run
    }
    catch {
      # ONE FAILING STEP DOES NOT END THE PASS. docs/13 Part 6: record it and
      # keep going. Later steps depend on data earlier ones create, so a
      # mid-pass abort invalidates everything after it, and a failure list from
      # one complete run is worth more than a fix applied halfway through.
      Add-Result -Step $name -Outcome "ERROR" -Detail $_.Exception.Message
    }
    Write-Host ""
  }
}
finally {
  Clear-DeviceTmp

  if (-not $OutFile) {
    $dir = Join-Path (Resolve-Path "$PSScriptRoot\..\..") "device_results"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $OutFile = Join-Path $dir ("e2e_qa_{0}.md" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
  }

  $lines = New-Object System.Collections.ArrayList
  [void]$lines.Add("# MVP end-to-end QA - scripted portion")
  [void]$lines.Add("")
  [void]$lines.Add("Run: $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Variant: $Variant ($script:Package).")
  [void]$lines.Add("")
  [void]$lines.Add("**These are observations, not verdicts.** No row here marks a gate as passed.")
  [void]$lines.Add("Everything a script cannot settle is in docs/13 Part 8 and is NOT covered by this file.")
  [void]$lines.Add("")
  [void]$lines.Add("| Step | Outcome | What was actually observed |")
  [void]$lines.Add("|---|---|---|")
  foreach ($r in $script:Results) {
    $detail = $r.detail -replace "\|", "\|"
    [void]$lines.Add("| $($r.step) | **$($r.outcome)** | $detail |")
  }
  Set-Content -Path $OutFile -Value ($lines -join "`r`n") -Encoding utf8

  Write-Host "Results: $OutFile" -ForegroundColor Green
  $counts = $script:Results | Group-Object outcome | ForEach-Object { "$($_.Name)=$($_.Count)" }
  Write-Host ("Summary: " + ($counts -join "  ")) -ForegroundColor Cyan
  Write-Host "Remember: .\enter_recovery_phrase.ps1 -Shred" -ForegroundColor Yellow
}

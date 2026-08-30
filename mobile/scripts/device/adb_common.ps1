# scripts/device/adb_common.ps1 - shared adb plumbing for the on-device
# verification session (docs/13-on-device-verification.md).
#
# Dot-source it, do not run it:
#
#   . "$PSScriptRoot\adb_common.ps1"
#
# Windows PowerShell 5.1. No `&&`, no `||`, no ternary, no `??` - those are
# parse errors in 5.1, not merely unavailable.
#
# ---------------------------------------------------------------------------
# THE FOUR THINGS THAT COST REAL DEVICE SESSIONS, ENCODED HERE SO NOBODY HAS TO
# REDISCOVER THEM (all from docs/13's session-2 notes):
#
#   1. Screen state is readable without root: `dumpsys nfc | mScreenState`
#      gives ON_UNLOCKED / ON_LOCKED / OFF_LOCKED. Poll it.
#   2. The Keystore auth window runs from the LAST AUTHENTICATION, not from
#      screen-on. A phone sitting unlocked on the desk does not satisfy it.
#      Lock it first, so the next unlock is a fresh one. `Wait-FreshUnlock`
#      does exactly that and refuses to shortcut it.
#   3. Budget every wait in WALL CLOCK, never in loop iterations. 2,400 adb
#      round-trips sound like a long wait and elapse in about three minutes.
#      Every wait here is a Stopwatch.
#   4. The dev client serves a STALE BUNDLE aggressively. A fresh Metro port is
#      the reliable way to defeat its cache, and the only trustworthy proof the
#      device actually took the new bundle is an `Android Bundled` line in
#      Metro's own output triggered BY THE DEVICE - not by a curl from this
#      laptop. `Wait-DeviceBundle` watches for a line that appears after a
#      recorded offset, so a bundle from before the launch cannot satisfy it.
#      Believing a negative on-device result without this check cost an hour
#      once.
#
# ---------------------------------------------------------------------------
# THE RECOVERY-PHRASE RULE, WHICH IS NOT NEGOTIABLE.
#
# One screen in this app displays twelve words that are the master key to a
# user's entire financial history. It has already been leaked twice in this
# project: once by a screenshot that put the phrase into a file and a session
# transcript, and once by an attempt to avoid that which still leaked 3 of 12
# words through a grep filter that was too narrow.
#
# The lesson taken is that FILTERING OUTPUT IS THE WRONG CONTROL. This file
# does not filter; it refuses. `Assert-NoPhraseOnScreen` asks the DEVICE
# whether any `phrase-word-*` node is present and gets back a count, never
# content - and `Get-ViewTree` and `Save-Screenshot` both call it and throw
# before any bytes cross to this laptop. There is no flag to override it.
#
# When the phrase genuinely has to be typed back, use
# `enter_recovery_phrase.ps1`, which keeps the words device-side end to end.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Where every dump, screenshot and scratch file lands ON THE DEVICE. Chosen over
# /sdcard because the shell user owns it, it is not indexed by MediaStore, and
# nothing there is picked up by a photo backup.
$script:DeviceTmp = "/data/local/tmp/peraplano_verify"

# The three build variants, from docs/build-variants-adb-install.md.
$script:PackageIds = @{
  development = "com.filldev.peraplano.dev"
  preview     = "com.filldev.peraplano.prev"
  production  = "com.filldev.peraplano"
}

$script:ListenerServiceClass = "expo.modules.notificationlistener.PeraPlanoNotificationListenerService"

function Get-PeraPlanoPackage {
  <#
  .SYNOPSIS
    Android package id for a build variant.
  .DESCRIPTION
    An unknown variant throws rather than falling back to production - the same
    rule app.config.js enforces at build time, and for the same reason: a typo
    that quietly resolves to `com.filldev.peraplano` uninstalls or drives the
    REAL app instead of the dev one.
  #>
  param([Parameter(Mandatory = $true)][string]$Variant)

  if (-not $script:PackageIds.ContainsKey($Variant)) {
    throw "Unknown APP_VARIANT '$Variant'. Expected one of: $($script:PackageIds.Keys -join ', ')."
  }
  return $script:PackageIds[$Variant]
}

function Get-ListenerComponent {
  param([Parameter(Mandatory = $true)][string]$Package)
  return "$Package/$script:ListenerServiceClass"
}

function Invoke-Adb {
  <#
  .SYNOPSIS
    Runs adb and returns its stdout as a single string.
  .DESCRIPTION
    stderr is deliberately NOT redirected into the pipeline. In PowerShell 5.1
    `2>&1` on a native executable wraps every stderr line in a NativeCommandError
    and flips $? to false even on exit code 0, which turns adb's routine chatter
    into a fake failure.
  #>
  param(
    [Parameter(Mandatory = $true)][string[]]$AdbArgs,
    [switch]$AllowFailure
  )

  $output = & adb @AdbArgs
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "adb $($AdbArgs -join ' ') failed with exit code $code."
  }
  if ($null -eq $output) { return "" }
  return ($output -join "`n")
}

function Invoke-AdbShell {
  <#
  .SYNOPSIS
    Runs one command in the device shell.
  .DESCRIPTION
    The command string is passed to the device intact. Anything the device
    should compute - a `$(...)` substitution over a secret, for instance - must
    be written so it evaluates THERE, which is the whole mechanism
    enter_recovery_phrase.ps1 relies on.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [switch]$AllowFailure
  )
  return Invoke-Adb -AdbArgs @("shell", $Command) -AllowFailure:$AllowFailure
}

function Assert-SingleDevice {
  <#
  .SYNOPSIS
    Exactly one authorized device, or throw.
  .DESCRIPTION
    Two attached devices is the case worth catching: adb picks one, and every
    result for the rest of the session silently describes the wrong phone.
  #>
  $lines = (Invoke-Adb -AdbArgs @("devices")) -split "`n" |
    Where-Object { $_ -match "\sdevice$" }

  if ($lines.Count -eq 0) {
    throw "No authorized device. Check the cable, USB debugging, and the 'Allow USB debugging' prompt on the phone."
  }
  if ($lines.Count -gt 1) {
    throw "More than one device attached; adb would pick one arbitrarily. Detach the others.`n$($lines -join "`n")"
  }

  $serial = ($lines[0] -split "\s+")[0]
  Write-Host "Device: $serial" -ForegroundColor Green
  return $serial
}

function Get-DeviceFacts {
  <#
  .SYNOPSIS
    Model, Android release and SDK level, for the record.
  .DESCRIPTION
    docs/13's rule is that every box holds an observed value. A timing with no
    device attached to it is not a result, and the A54 is explicitly NOT the
    handset that can answer the battery-manager question, so which phone
    produced a number is part of the number.
  #>
  return [pscustomobject]@{
    model   = (Invoke-AdbShell "getprop ro.product.model").Trim()
    device  = (Invoke-AdbShell "getprop ro.product.device").Trim()
    release = (Invoke-AdbShell "getprop ro.build.version.release").Trim()
    sdk     = (Invoke-AdbShell "getprop ro.build.version.sdk").Trim()
  }
}

function Initialize-DeviceTmp {
  Invoke-AdbShell "mkdir -p $script:DeviceTmp" | Out-Null
  return $script:DeviceTmp
}

function Test-PackageInstalled {
  <#
  .SYNOPSIS
    Is this EXACT package installed?
  .DESCRIPTION
    `pm list packages <name>` MATCHES ON SUBSTRING, and docs/13 Part 3a records
    a real false positive from that: querying `com.android.mms` returns a hit
    for the installed `com.android.mms.service`, a different component
    entirely. So this compares for equality and never for "did it return
    anything" - which also matters here because `com.filldev.peraplano` is a
    prefix of both `.dev` and `.prev`.
  #>
  param([Parameter(Mandatory = $true)][string]$Package)

  $raw = Invoke-AdbShell "pm list packages $Package"
  $names = $raw -split "`n" |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -like "package:*" } |
    ForEach-Object { $_.Substring(8) }

  return ($names -contains $Package)
}

function Get-ScreenState {
  <#
  .SYNOPSIS
    ON_UNLOCKED / ON_LOCKED / OFF_LOCKED, or "UNKNOWN".
  .DESCRIPTION
    Read out of `dumpsys nfc`, which is the trick docs/13 session 2 found: it
    is readable by the shell user with no root and no special permission, and
    it distinguishes "screen on" from "actually unlocked", which is the
    distinction the Keystore auth window cares about.
  #>
  $dump = Invoke-AdbShell "dumpsys nfc | grep mScreenState" -AllowFailure
  if ($dump -match "mScreenState=(\w+)") { return $Matches[1] }
  return "UNKNOWN"
}

function Lock-Screen {
  <#
  .SYNOPSIS
    Puts the phone to sleep and waits until it reports a locked state.
  #>
  param([int]$TimeoutSeconds = 20)

  if ((Get-ScreenState) -like "ON_*") {
    Invoke-AdbShell "input keyevent 26" | Out-Null
  }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    $state = Get-ScreenState
    if ($state -eq "OFF_LOCKED" -or $state -eq "ON_LOCKED") {
      Write-Host "Screen locked ($state)." -ForegroundColor DarkGray
      return $state
    }
    Start-Sleep -Milliseconds 300
  }
  throw "Screen did not reach a locked state within $TimeoutSeconds s (last seen: $(Get-ScreenState))."
}

function Wait-FreshUnlock {
  <#
  .SYNOPSIS
    Locks the phone, then waits for the human to unlock it, and returns how long
    that took.
  .DESCRIPTION
    THE LOCK IS THE POINT, and it is not optional. The Keystore's ~10 s
    validity window runs from the last AUTHENTICATION. A phone already sitting
    unlocked on the desk has an authentication that is minutes old, so an
    auth-gated key fails with UserNotAuthenticatedException and the result
    looks like a defect in the app. Locking first is what makes the next unlock
    a fresh one.

    The caller starts whatever it is measuring FIRST and calls this after, so
    the human has exactly one thing to do and a generous window in which to do
    it. Asking a person to lock AND unlock inside a ten-second window fails on
    message latency alone; docs/13 records it failing twice.
  #>
  param(
    [int]$TimeoutSeconds = 120,
    [string]$Prompt = "Unlock the phone now (PIN / pattern / fingerprint)."
  )

  Lock-Screen | Out-Null
  Write-Host ""
  Write-Host ">>> $Prompt" -ForegroundColor Yellow
  Write-Host "    Waiting up to $TimeoutSeconds s for a FRESH unlock." -ForegroundColor Yellow

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if ((Get-ScreenState) -eq "ON_UNLOCKED") {
      Write-Host "    Fresh unlock after $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s." -ForegroundColor Green
      return $sw.Elapsed.TotalSeconds
    }
    Start-Sleep -Milliseconds 250
  }
  throw "No fresh unlock within $TimeoutSeconds s. Nothing that needs the auth window can be trusted from here."
}

# ---------------------------------------------------------------------------
# Metro, and proving the DEVICE took the bundle
# ---------------------------------------------------------------------------

function Start-FreshMetro {
  <#
  .SYNOPSIS
    Starts Metro on a port nothing has cached, logging to a file, and returns
    the process plus that log path.
  .DESCRIPTION
    A FRESH PORT IS THE CACHE-BUSTER. The dev client holds onto a bundle hard
    enough that editing JS and reloading is not reliably enough; moving to a
    port it has never seen is. 8082 rather than 8081 is the documented default
    for that reason.

    EXPO_PUBLIC_DEV_HARNESS is set here because metro.config.js blocks
    lib/dev_harness/ and app/dev_harness.tsx out of the module graph unless it
    is set - so without it the harness route does not merely render nothing, it
    does not exist, and the deep link lands on the not-found screen.
  #>
  param(
    [int]$Port = 8082,
    [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..\.."),
    [switch]$EnableHarness
  )

  $logPath = Join-Path ([System.IO.Path]::GetTempPath()) "peraplano_metro_$Port.log"
  if (Test-Path $logPath) { Remove-Item $logPath -Force }

  $envPrefix = ""
  if ($EnableHarness) {
    $env:EXPO_PUBLIC_DEV_HARNESS = "1"
    $envPrefix = " (EXPO_PUBLIC_DEV_HARNESS=1)"
  }

  Write-Host "Starting Metro on port $Port$envPrefix ..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "npx expo start --dev-client --port $Port > `"$logPath`" 2>&1") `
    -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Minimized

  # `adb reverse` so the phone can reach this laptop's Metro over USB without
  # anyone typing an IP address.
  Invoke-Adb -AdbArgs @("reverse", "tcp:$Port", "tcp:$Port") | Out-Null

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 120) {
    if ((Test-Path $logPath) -and ((Get-Content $logPath -Raw -ErrorAction SilentlyContinue) -match "Waiting on|Metro waiting|exp://")) {
      Write-Host "Metro is up. Log: $logPath" -ForegroundColor Green
      return [pscustomobject]@{ process = $proc; log_path = $logPath; port = $Port }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Metro did not come up on port $Port within 120 s. See $logPath."
}

function Get-LogOffset {
  param([Parameter(Mandatory = $true)][string]$LogPath)
  if (-not (Test-Path $LogPath)) { return 0 }
  return (Get-Item $LogPath).Length
}

function Wait-DeviceBundle {
  <#
  .SYNOPSIS
    Waits for an `Android Bundled` line written AFTER $SinceOffset.
  .DESCRIPTION
    THE ONLY TRUSTWORTHY PROOF THE DEVICE TOOK THE NEW BUNDLE. A curl from this
    laptop also produces an `Android Bundled` line, and so does a bundle built
    minutes ago; neither says anything about what the phone is running. The
    caller records the log length immediately before launching the app and
    passes it here, so only a line produced by that launch can satisfy the wait.

    Believing an on-device negative without this check is the specific mistake
    that cost an hour: the app was correct and the phone was running yesterday's
    JS.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][long]$SinceOffset,
    [int]$TimeoutSeconds = 180
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if (Test-Path $LogPath) {
      $stream = [System.IO.File]::Open($LogPath, "Open", "Read", "ReadWrite")
      try {
        if ($stream.Length -gt $SinceOffset) {
          $stream.Seek($SinceOffset, "Begin") | Out-Null
          $reader = New-Object System.IO.StreamReader($stream)
          $fresh = $reader.ReadToEnd()
          if ($fresh -match "Android Bundled") {
            Write-Host "Device pulled a fresh bundle after $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s." -ForegroundColor Green
            return $true
          }
        }
      }
      finally { $stream.Dispose() }
    }
    Start-Sleep -Milliseconds 500
  }

  throw ("No 'Android Bundled' line appeared in Metro's log within $TimeoutSeconds s. " +
    "The phone is NOT running the JS you just built, so any result from here describes an old bundle. " +
    "Log: $LogPath")
}

# ---------------------------------------------------------------------------
# App control
# ---------------------------------------------------------------------------

function Start-App {
  param([Parameter(Mandatory = $true)][string]$Package)
  Invoke-AdbShell "monkey -p $Package -c android.intent.category.LAUNCHER 1" | Out-Null
}

function Stop-App {
  param([Parameter(Mandatory = $true)][string]$Package)
  Invoke-AdbShell "am force-stop $Package" | Out-Null
}

function Open-DeepLink {
  <#
  .SYNOPSIS
    Fires a peraplano:// deep link at the app.
  .DESCRIPTION
    The `&` in a query string is a shell metacharacter on the device, so the
    URL is single-quoted for the device shell. Without that, everything after
    the first `&` is dropped and the harness silently runs with default
    options instead of the ones asked for.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Package
  )
  $cmd = "am start -a android.intent.action.VIEW -d '$Url'"
  if ($PSBoundParameters.ContainsKey("Package") -and $Package) { $cmd += " $Package" }
  Invoke-AdbShell $cmd | Out-Null
}

function Post-TestNotification {
  <#
  .SYNOPSIS
    Posts a notification from the shell, the way docs/13 Part 3 does.
  .DESCRIPTION
    Note what this cannot do: it posts as `com.android.shell`, not as GCash, so
    it exercises the capture path and the parser but NOT provider matching from
    a real package. docs/13 Part 3a's package-name question is a separate check
    and this does not touch it.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [string]$Title = "TEST",
    [string]$Tag = "peraplano_verify"
  )
  Invoke-AdbShell "cmd notification post -S bigtext -t '$Title' $Tag '$Text'" | Out-Null
}

# ---------------------------------------------------------------------------
# The view tree, and the interlock in front of it
# ---------------------------------------------------------------------------

function Assert-NoPhraseOnScreen {
  <#
  .SYNOPSIS
    Throws if the recovery-phrase words are on screen. Never returns a word.
  .DESCRIPTION
    THE ONE CONTROL THAT MATTERS, and it is a refusal rather than a filter.

    It dumps the view tree ON THE DEVICE, counts `phrase-word-` occurrences ON
    THE DEVICE, and brings back an integer. A count cannot leak a word. That is
    the whole design: the previous attempt at this problem filtered the pulled
    dump on this laptop and leaked 3 of 12 words because the filter was one
    pattern too narrow, and a filter that is nearly right looks exactly like a
    filter that is right.

    Callers do not choose whether to run it. Get-ViewTree and Save-Screenshot
    both call it before anything crosses to this machine, and there is no
    -Force to skip it.
  #>
  $tmp = Initialize-DeviceTmp
  $dump = "$tmp/guard.xml"
  Invoke-AdbShell "rm -f $dump" | Out-Null
  Invoke-AdbShell "uiautomator dump $dump" -AllowFailure | Out-Null

  # grep -c prints a number and nothing else. `|| true` keeps a zero-match grep
  # (exit 1) from failing the shell command.
  $count = (Invoke-AdbShell "grep -c 'phrase-word-' $dump 2>/dev/null || true").Trim()
  Invoke-AdbShell "rm -f $dump" | Out-Null

  if ($count -match "^\d+$" -and [int]$count -gt 0) {
    throw ("REFUSING TO CAPTURE: the recovery-phrase screen is showing. " +
      "Nothing from this screen may reach this laptop, a log, or a transcript. " +
      "Navigate away, or use enter_recovery_phrase.ps1, which keeps the words on the device.")
  }
}

function Get-ViewTree {
  <#
  .SYNOPSIS
    uiautomator view tree as an [xml], after the phrase interlock has cleared.
  .DESCRIPTION
    This is how UI assertions were made in previous sessions and it is the
    reason most of Part 6 is scriptable at all.

    React Native's `testID` surfaces as UIAutomator's `resource-id` on Android,
    and `accessibilityLabel` as `content-desc`. Both are matched by
    Find-UiNode, because a few surfaces in this app carry only one of them.
  #>
  param([int]$SettleMilliseconds = 400)

  Start-Sleep -Milliseconds $SettleMilliseconds
  Assert-NoPhraseOnScreen

  $tmp = Initialize-DeviceTmp
  $remote = "$tmp/window_dump.xml"
  $local = Join-Path ([System.IO.Path]::GetTempPath()) "peraplano_window_dump.xml"

  Invoke-AdbShell "rm -f $remote" | Out-Null
  Invoke-AdbShell "uiautomator dump $remote" | Out-Null
  Invoke-Adb -AdbArgs @("pull", $remote, $local) | Out-Null
  Invoke-AdbShell "rm -f $remote" | Out-Null

  [xml]$xml = Get-Content -Path $local -Raw -Encoding UTF8
  Remove-Item $local -Force -ErrorAction SilentlyContinue
  return $xml
}

function Find-UiNode {
  <#
  .SYNOPSIS
    First node whose resource-id, content-desc or text matches.
  #>
  param(
    [Parameter(Mandatory = $true)][xml]$Tree,
    [string]$TestId,
    [string]$Text,
    [switch]$Exact
  )

  $nodes = $Tree.SelectNodes("//node")
  foreach ($node in $nodes) {
    if ($TestId) {
      $rid = $node.GetAttribute("resource-id")
      $desc = $node.GetAttribute("content-desc")
      if ($rid -eq $TestId -or $desc -eq $TestId) { return $node }
      # Some Android builds prefix resource-id with the package.
      if ($rid -like "*:id/$TestId") { return $node }
    }
    if ($Text) {
      $value = $node.GetAttribute("text")
      if ($Exact) {
        if ($value -eq $Text) { return $node }
      }
      elseif ($value -and $value -like "*$Text*") { return $node }
    }
  }
  return $null
}

function Test-UiText {
  <#
  .SYNOPSIS
    Is this text anywhere on screen? Substring match unless -Exact.
  #>
  param(
    [Parameter(Mandatory = $true)][xml]$Tree,
    [Parameter(Mandatory = $true)][string]$Text,
    [switch]$Exact
  )
  $node = Find-UiNode -Tree $Tree -Text $Text -Exact:$Exact
  return ($null -ne $node)
}

function Wait-UiNode {
  <#
  .SYNOPSIS
    Polls the view tree, in wall clock, until a node appears.
  #>
  param(
    [string]$TestId,
    [string]$Text,
    [int]$TimeoutSeconds = 20
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    $tree = Get-ViewTree -SettleMilliseconds 250
    $node = Find-UiNode -Tree $tree -TestId $TestId -Text $Text
    if ($null -ne $node) { return $node }
  }
  $what = $TestId
  if (-not $what) { $what = $Text }
  throw "'$what' did not appear within $TimeoutSeconds s."
}

function Get-NodeCenter {
  <#
  .SYNOPSIS
    Centre point of a node's bounds attribute, which reads "[x1,y1][x2,y2]".
  #>
  param([Parameter(Mandatory = $true)]$Node)

  $bounds = $Node.GetAttribute("bounds")
  if ($bounds -notmatch "\[(\d+),(\d+)\]\[(\d+),(\d+)\]") {
    throw "Could not parse bounds '$bounds'."
  }
  $x1 = [int]$Matches[1]; $y1 = [int]$Matches[2]
  $x2 = [int]$Matches[3]; $y2 = [int]$Matches[4]
  return [pscustomobject]@{
    x      = [int](($x1 + $x2) / 2)
    y      = [int](($y1 + $y2) / 2)
    width  = $x2 - $x1
    height = $y2 - $y1
  }
}

function Invoke-Tap {
  <#
  .SYNOPSIS
    Taps the centre of a node found by testID or text.
  .DESCRIPTION
    Also reports the node's painted size, because several deferred checks in
    docs/13 and in the UI-revamp handoff are about exactly that: three touch
    targets left unmeasured against the 44pt minimum, whose real painted height
    depends on a platform-default text size nothing off-device can see.
    Measure-TouchTarget below is the same reading without the tap.
  #>
  param(
    [string]$TestId,
    [string]$Text,
    [int]$TimeoutSeconds = 20
  )

  $node = Wait-UiNode -TestId $TestId -Text $Text -TimeoutSeconds $TimeoutSeconds
  $center = Get-NodeCenter -Node $node
  Invoke-AdbShell "input tap $($center.x) $($center.y)" | Out-Null
  Start-Sleep -Milliseconds 500
  return $center
}

function Measure-TouchTarget {
  <#
  .SYNOPSIS
    Painted size of a node in device px, and in dp against this device's density.
  .DESCRIPTION
    For the three deliberately-unmeasured targets (date_field, numeric_field,
    manual_entry_form). 44pt is 44dp here, so the dp height is the number to
    compare. Reported, never judged: whether a 43dp field is acceptable is a
    decision, and this only supplies the measurement it needs.
  #>
  param(
    [string]$TestId,
    [string]$Text
  )

  $densityRaw = (Invoke-AdbShell "wm density").Trim()
  $density = 160
  if ($densityRaw -match "Physical density:\s*(\d+)") { $density = [int]$Matches[1] }
  if ($densityRaw -match "Override density:\s*(\d+)") { $density = [int]$Matches[1] }

  $node = Wait-UiNode -TestId $TestId -Text $Text
  $center = Get-NodeCenter -Node $node
  $scale = $density / 160.0

  return [pscustomobject]@{
    test_id   = $TestId
    width_px  = $center.width
    height_px = $center.height
    width_dp  = [math]::Round($center.width / $scale, 1)
    height_dp = [math]::Round($center.height / $scale, 1)
    density   = $density
    meets_44  = ([math]::Round($center.height / $scale, 1) -ge 44)
  }
}

function Save-Screenshot {
  <#
  .SYNOPSIS
    Screenshot to a local path, behind the same phrase interlock.
  .DESCRIPTION
    The interlock is not decoration here: a screenshot is exactly how the
    recovery phrase leaked the first time.
  #>
  param([Parameter(Mandatory = $true)][string]$OutPath)

  Assert-NoPhraseOnScreen
  $tmp = Initialize-DeviceTmp
  $remote = "$tmp/shot.png"
  Invoke-AdbShell "screencap -p $remote" | Out-Null
  Invoke-Adb -AdbArgs @("pull", $remote, $OutPath) | Out-Null
  Invoke-AdbShell "rm -f $remote" | Out-Null
  return $OutPath
}

function Clear-DeviceTmp {
  <#
  .SYNOPSIS
    Removes every scratch file this session wrote to the device.
  .DESCRIPTION
    Call it at the end of every script, in a finally. A view-tree dump taken on
    the wrong screen is a plaintext recovery phrase sitting in /data/local/tmp.
  #>
  Invoke-AdbShell "rm -rf $script:DeviceTmp" -AllowFailure | Out-Null
}

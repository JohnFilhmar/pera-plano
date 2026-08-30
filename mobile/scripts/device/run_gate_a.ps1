# scripts/device/run_gate_a.ps1 - drives Gate A end to end (docs/13 Part 1).
#
# Gate A is the Argon2id derivation timing. It is a SHIP GATE because the four
# parameters are part of the on-disk format: once a real user holds a recovery
# phrase, changing them makes every existing wrap blob unopenable. So the
# number has to be settled before the first phrase is issued, and it has to be
# settled in Hermes on real hardware - a Node or JVM measurement measures a
# different engine, and this workload is already known to differ by more than
# an order of magnitude between engines.
#
# WHAT THIS SCRIPT DOES NOT DO: decide. It reports a median, a spread, the
# parameters that produced them, and a delta against the figure already on
# record. Whether that is acceptable is the owner's call, and docs/13 shows the
# owner has already made it once against the stated target.
#
# USAGE
#   # dev client (JS from Metro) - the usual case
#   .\run_gate_a.ps1
#
#   # preview/release build (JS bundled in, no Metro). Build it first with
#   # EXPO_PUBLIC_DEV_HARNESS=1 set - see docs/13's runbook.
#   .\run_gate_a.ps1 -Variant preview -NoMetro
#
#   .\run_gate_a.ps1 -Runs 7 -Warmups 2 -MetroPort 8083
#
# PRECONDITION THE SCRIPT CANNOT SATISFY FOR YOU: the app must be UNLOCKED.
# app/_layout.tsx renders the lock screen instead of the Stack whenever the
# lock status is anything but "unlocked", so the harness deep link cannot land
# during onboarding or on a locked app. That is deliberate - see
# app/dev_harness.tsx's header for why no dev-only bypass was added to the
# root layout's lock gate - and it costs Gate A nothing, because Argon2id
# derivation touches neither the database nor the Keystore.

[CmdletBinding()]
param(
  [ValidateSet("development", "preview", "production")]
  [string]$Variant = "development",
  [int]$Runs = 5,
  [int]$Warmups = 1,
  [int]$MetroPort = 8082,
  [switch]$NoMetro,
  [int]$ResultTimeoutSeconds = 300,
  [string]$OutFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\adb_common.ps1"

if ($Variant -eq "production") {
  throw ("Refusing to run against the production package. The harness is blocked out of " +
    "production bundles by metro.config.js, so the deep link would land on the not-found " +
    "screen and the run would look like a failure rather than a misconfiguration.")
}

$package = Get-PeraPlanoPackage -Variant $Variant
$metro = $null
$results_dir = Join-Path (Resolve-Path "$PSScriptRoot\..\..") "device_results"

try {
  Assert-SingleDevice | Out-Null
  $facts = Get-DeviceFacts
  Write-Host "Device: $($facts.model) ($($facts.device)), Android $($facts.release) / SDK $($facts.sdk)" -ForegroundColor Cyan

  if (-not (Test-PackageInstalled -Package $package)) {
    throw "$package is not installed. Build and install the $Variant variant first (docs/build-variants-adb-install.md)."
  }

  # ---------------------------------------------------------------------------
  # Metro on a port the dev client has never cached, with the harness unblocked
  # ---------------------------------------------------------------------------
  $bundle_confirmed = $false
  if (-not $NoMetro) {
    $metro = Start-FreshMetro -Port $MetroPort -EnableHarness
    $offset = Get-LogOffset -LogPath $metro.log_path

    Write-Host ""
    Write-Host ">>> Open PeraPlano($(if ($Variant -eq 'preview') { 'Prev' } else { 'Dev' })) on the phone." -ForegroundColor Yellow
    Write-Host "    If it opens the dev-client launcher rather than the app, pick" -ForegroundColor Yellow
    Write-Host "    http://localhost:$MetroPort from the list." -ForegroundColor Yellow
    Start-App -Package $package

    # THE CHECK THAT DEFEATS THE STALE BUNDLE. Only a line written after
    # $offset counts, so a bundle built before this launch - or one this laptop
    # triggered itself - cannot satisfy it. Without this, a negative result
    # below might just be yesterday's JS.
    Wait-DeviceBundle -LogPath $metro.log_path -SinceOffset $offset -TimeoutSeconds 240 | Out-Null
    $bundle_confirmed = $true
  }
  else {
    Write-Host "Skipping Metro: a $Variant build carries its JS inside the APK." -ForegroundColor DarkGray
    Write-Host "The harness must have been compiled in - EXPO_PUBLIC_DEV_HARNESS=1 at BUILD time." -ForegroundColor DarkGray
    Start-App -Package $package
    Start-Sleep -Seconds 4
  }

  Write-Host ""
  Write-Host ">>> Make sure the app is UNLOCKED and showing its normal tabs, then press Enter." -ForegroundColor Yellow
  Write-Host "    A locked app renders the lock screen instead of the router, and the deep" -ForegroundColor Yellow
  Write-Host "    link will go nowhere." -ForegroundColor Yellow
  Read-Host "    Enter to continue" | Out-Null

  # ---------------------------------------------------------------------------
  # Fire the harness and scrape its one line out of logcat
  # ---------------------------------------------------------------------------
  Invoke-Adb -AdbArgs @("logcat", "-c") | Out-Null

  $url = "peraplano://dev_harness?gate=a&autorun=1&runs=$Runs&warmups=$Warmups"
  Write-Host "Deep link: $url" -ForegroundColor Cyan
  Open-DeepLink -Url $url

  Write-Host "Waiting for the measurement (up to $ResultTimeoutSeconds s; $($Runs + $Warmups) derivations)..." -ForegroundColor Cyan

  $line = $null
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $ResultTimeoutSeconds) {
    $log = Invoke-Adb -AdbArgs @("logcat", "-d", "-s", "ReactNativeJS:V") -AllowFailure
    $match = ($log -split "`n") | Where-Object { $_ -match "PERAPLANO_HARNESS \{" } | Select-Object -Last 1
    if ($match) {
      $line = $match
      break
    }
    Start-Sleep -Milliseconds 750
  }

  if (-not $line) {
    throw (@"
No PERAPLANO_HARNESS line reached logcat within $ResultTimeoutSeconds s.

Work through these in order - the first three are the ones that actually happen:
  1. Did the deep link land? `adb shell dumpsys activity activities | grep mResumedActivity`
     If the app shows a not-found screen, the harness was blocked out of the bundle:
     Metro must be started with EXPO_PUBLIC_DEV_HARNESS=1 (this script does that
     for you, so suspect a Metro you started yourself in another window).
  2. Was the app unlocked? A locked app renders the lock screen and never mounts
     the router at all.
  3. Was the bundle fresh? bundle_confirmed = $bundle_confirmed for this run.
  4. Is logcat being filtered by something else? Try: adb logcat -d | Select-String PERAPLANO_HARNESS
"@)
  }

  $json = $line.Substring($line.IndexOf("PERAPLANO_HARNESS ") + "PERAPLANO_HARNESS ".Length)
  $result = $json | ConvertFrom-Json

  # ---------------------------------------------------------------------------
  # Report
  # ---------------------------------------------------------------------------
  Write-Host ""
  Write-Host "=== Gate A - Argon2id derivation timing ===" -ForegroundColor Green
  Write-Host ("  parameters      m={0} KiB, t={1}, p={2}, dkLen={3}" -f $result.params.m_kib, $result.params.t, $result.params.p, $result.params.dk_len)
  Write-Host ("  median          {0} ms" -f $result.median_ms)
  Write-Host ("  runs            [{0}]" -f ($result.runs_ms -join ", "))
  Write-Host ("  warm-up         [{0}] (discarded)" -f ($result.warmup_ms -join ", "))
  Write-Host ("  min / max       {0} / {1} ms   spread {2} ms" -f $result.min_ms, $result.max_ms, $result.spread_ms)
  Write-Host ("  engine          hermes={0}  __DEV__={1}" -f $result.engine.hermes, $result.engine.dev_bundle)
  Write-Host ("  design target   {0}-{1} ms -> {2}" -f $result.target_ms.low, $result.target_ms.high, $result.band)
  Write-Host ("  vs 2026-08-15   {0} ms ({1}{2} ms)" -f $result.reference.median_ms, $(if ($result.delta_vs_reference_ms -ge 0) { "+" } else { "" }), $result.delta_vs_reference_ms)
  Write-Host ("  bundle fresh?   {0}" -f $bundle_confirmed)
  foreach ($w in $result.warnings) { Write-Host "  ! $w" -ForegroundColor Yellow }

  Write-Host ""
  Write-Host "This is a MEASUREMENT, not a verdict. Paste it into docs/13 Part 1 and decide there." -ForegroundColor Yellow

  # ---------------------------------------------------------------------------
  # Paste-ready record
  # ---------------------------------------------------------------------------
  if (-not $OutFile) {
    if (-not (Test-Path $results_dir)) { New-Item -ItemType Directory -Path $results_dir -Force | Out-Null }
    $OutFile = Join-Path $results_dir ("gate_a_{0}.md" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
  }

  $record = @"
### Gate A - Argon2id derivation timing

- Measured: **$($result.median_ms) ms median** - $($result.runs_ms.Count) runs after $($result.warmup_ms.Count) warm-up:
  ``[$($result.runs_ms -join ', ')]``, min $($result.min_ms) / max $($result.max_ms), spread $($result.spread_ms).
- Parameters: ``m=$($result.params.m_kib) KiB, t=$($result.params.t), p=$($result.params.p)``, dkLen $($result.params.dk_len).
- Engine: Hermes=$($result.engine.hermes), ``__DEV__``=$($result.engine.dev_bundle) ($Variant variant$(if ($NoMetro) { ', JS bundled in the APK' } else { ', JS from Metro' })).
- Device: $($facts.model) ($($facts.device)), Android $($facts.release) / SDK $($facts.sdk).
- Fresh-bundle confirmed by a device-triggered ``Android Bundled`` line: $bundle_confirmed.
- Design target $($result.target_ms.low)-$($result.target_ms.high) ms -> **$($result.band)**.
- Against the 2026-08-15 dev-client median of $($result.reference.median_ms) ms: $(if ($result.delta_vs_reference_ms -ge 0) { "+" })$($result.delta_vs_reference_ms) ms.
$(if ($result.warnings.Count -gt 0) { "- Warnings: " + ($result.warnings -join " / ") } else { "- No warnings." })
- Run at: $($result.started_at)

DECISION (fill in by hand - the script does not make it): ______________________
"@

  Set-Content -Path $OutFile -Value $record -Encoding utf8
  Write-Host "Paste-ready record: $OutFile" -ForegroundColor Green
}
finally {
  Clear-DeviceTmp
  if ($metro -and $metro.process -and -not $metro.process.HasExited) {
    Write-Host "Metro is still running (PID $($metro.process.Id)) on port $MetroPort." -ForegroundColor DarkGray
    Write-Host "Leave it up if you are continuing to run_e2e_qa.ps1; otherwise: Stop-Process -Id $($metro.process.Id)" -ForegroundColor DarkGray
  }
}

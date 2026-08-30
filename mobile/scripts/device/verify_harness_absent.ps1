# scripts/device/verify_harness_absent.ps1 - proves the on-device verification
# harness is NOT in a production bundle.
#
# WHY THIS EXISTS AS A SCRIPT RATHER THAN A CLAIM IN A COMMENT.
#
# app/dev_harness.tsx is kept out of production two ways: a
# `process.env.EXPO_PUBLIC_DEV_HARNESS` guard inside the component, and a
# resolver blockList in metro.config.js that removes both it and lib/dev_harness/
# from the module graph. The first of those was NOT ENOUGH, and finding that out
# is the reason the second exists:
#
#   * With only the component guard, the minifier did drop the JSX - the
#     screen's own heading was absent from the exported bundle. But Metro still
#     collected lib/dev_harness/ as a dependency, and the sentinel string was
#     sitting in the shipped Hermes bytecode.
#   * With the resolver blockList, the sentinel is gone.
#
# Both of those are measured facts about an actual `expo export`, not
# predictions about what a bundler ought to do. This repo has already been
# through one scare of exactly this shape - the "seven test files are in the
# route table" release blocker, disproven the same way, by exporting the bundle
# and grepping it - so the standing method here is: export it and look.
#
# A NEGATIVE CONTROL IS NOT OPTIONAL. A grep for a typo'd sentinel also returns
# zero, and so does a grep against a bundle that failed to build. This script
# therefore runs BOTH exports every time: harness off (expect absent) and
# harness on (expect present). If the positive control does not find the
# sentinel, the check is broken and its "absent" result means nothing.
#
# Run it before the first Play submission, and again any time metro.config.js,
# app/dev_harness.tsx or lib/dev_harness/ changes.
#
# It builds JS only. No device, no Android SDK, no prebuild - so it is also the
# one script here that can be run with the phone in a drawer.

[CmdletBinding()]
param(
  [switch]$SkipPositiveControl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$project = Resolve-Path "$PSScriptRoot\..\.."
$sentinel = "PERAPLANO_DEV_HARNESS_5b1f2c"
# A string that is unambiguously part of the product. If THIS is missing, the
# export failed or the grep is looking at the wrong file, and the sentinel's
# absence proves nothing.
$control = "Confirm your recovery words"

# Under mobile/dist/, which .gitignore already covers.
$off_dir = Join-Path $project "dist\harness_absent_check"
$on_dir = Join-Path $project "dist\harness_present_check"

function Get-BundlePath {
  param([Parameter(Mandatory = $true)][string]$Dir)
  $bundle = Get-ChildItem -Path (Join-Path $Dir "_expo\static\js\android") -Filter "*.hbc" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $bundle) {
    # A non-Hermes export writes .js instead.
    $bundle = Get-ChildItem -Path (Join-Path $Dir "_expo\static\js\android") -Filter "*.js" -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if (-not $bundle) { throw "No Android bundle under $Dir." }
  return $bundle.FullName
}

function Measure-InBundle {
  <#
  .SYNOPSIS
    Occurrences of a literal string in a bundle, treating it as binary.
  .DESCRIPTION
    Hermes bytecode is not text, but its string table is, so a literal survives
    compilation and is findable. -Raw plus a plain IndexOf loop avoids
    Select-String's line splitting, which is meaningless on a .hbc.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Needle
  )
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.Text.Encoding]::ASCII.GetString($bytes)
  $count = 0
  $index = $text.IndexOf($Needle, [System.StringComparison]::Ordinal)
  while ($index -ge 0) {
    $count++
    $index = $text.IndexOf($Needle, $index + 1, [System.StringComparison]::Ordinal)
  }
  return $count
}

Push-Location $project
try {
  # ---------------------------------------------------------------------------
  # The check that matters: a production export, with nothing opted in.
  # ---------------------------------------------------------------------------
  Write-Host "Exporting the production bundle (harness NOT opted in)..." -ForegroundColor Cyan
  Remove-Item -Recurse -Force $off_dir -ErrorAction SilentlyContinue
  Remove-Item Env:\EXPO_PUBLIC_DEV_HARNESS -ErrorAction SilentlyContinue
  Remove-Item Env:\APP_VARIANT -ErrorAction SilentlyContinue
  & npx expo export --platform android --output-dir $off_dir --clear | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "expo export failed (harness off)." }

  $off_bundle = Get-BundlePath -Dir $off_dir
  $off_sentinel = Measure-InBundle -Path $off_bundle -Needle $sentinel
  $off_control = Measure-InBundle -Path $off_bundle -Needle $control

  Write-Host ("  bundle:   {0}" -f (Split-Path $off_bundle -Leaf))
  Write-Host ("  sentinel: {0} (want 0)" -f $off_sentinel)
  Write-Host ("  control:  {0} (want >0)" -f $off_control)

  if ($off_control -eq 0) {
    throw ("The control string is missing from the production bundle. The grep is not " +
      "reading what it thinks it is reading, so the sentinel count means nothing. " +
      "Fix this before believing any result here.")
  }

  # ---------------------------------------------------------------------------
  # The negative control, which is what makes the zero above meaningful.
  # ---------------------------------------------------------------------------
  $on_sentinel = $null
  if (-not $SkipPositiveControl) {
    Write-Host ""
    Write-Host "Exporting again WITH the harness opted in (positive control)..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force $on_dir -ErrorAction SilentlyContinue
    $env:EXPO_PUBLIC_DEV_HARNESS = "1"
    try {
      & npx expo export --platform android --output-dir $on_dir --clear | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "expo export failed (harness on)." }
      $on_bundle = Get-BundlePath -Dir $on_dir
      $on_sentinel = Measure-InBundle -Path $on_bundle -Needle $sentinel
      Write-Host ("  sentinel: {0} (want >0)" -f $on_sentinel)
    }
    finally {
      Remove-Item Env:\EXPO_PUBLIC_DEV_HARNESS -ErrorAction SilentlyContinue
    }
  }

  Write-Host ""
  if ($off_sentinel -gt 0) {
    Write-Host "FAIL: the harness sentinel is present in a production bundle." -ForegroundColor Red
    Write-Host "Do not ship this build. Either metro.config.js's blockList regressed, or" -ForegroundColor Red
    Write-Host "EXPO_PUBLIC_DEV_HARNESS leaked into the build environment. If neither can be" -ForegroundColor Red
    Write-Host "fixed in time, delete app/dev_harness.tsx and lib/dev_harness/ and re-export." -ForegroundColor Red
    exit 1
  }

  if ((-not $SkipPositiveControl) -and $on_sentinel -eq 0) {
    Write-Host "INCONCLUSIVE: the positive control found nothing either." -ForegroundColor Red
    Write-Host "The sentinel string or the bundle path is wrong, so the 'absent' result above" -ForegroundColor Red
    Write-Host "is not evidence of anything. Fix the check, then re-run." -ForegroundColor Red
    exit 2
  }

  Write-Host "PASS: the harness is absent from the production bundle, and the positive" -ForegroundColor Green
  Write-Host "control confirms the check would have found it if it were there." -ForegroundColor Green
}
finally {
  Pop-Location
}

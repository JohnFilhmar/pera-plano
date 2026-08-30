# scripts/device/enter_recovery_phrase.ps1 - gets past the recovery-phrase
# screens WITHOUT the twelve words ever reaching this laptop.
#
# ===========================================================================
# READ THIS BEFORE RUNNING ANYTHING
# ===========================================================================
#
# One screen in PeraPlano displays twelve words that are the master key to a
# user's whole financial history. That screen's own copy warns against
# photographing it. It has nevertheless been leaked twice in this project:
#
#   * An agent screenshotted it, putting the phrase into a file AND into a
#     session transcript.
#   * A later attempt to avoid re-capturing it pulled the view tree and
#     filtered the words out with a grep, and the filter was one pattern too
#     narrow: 3 of 12 words came through anyway.
#
# The second one is the instructive failure. FILTERING OUTPUT IS THE WRONG
# CONTROL, because a filter that is nearly right looks exactly like a filter
# that is right, and you only find out afterwards. The control used here
# instead is that the words never move:
#
#   * The view tree is dumped ON THE DEVICE and parsed ON THE DEVICE.
#   * The words are written to a file ON THE DEVICE.
#   * They are typed back by `input text` running ON THE DEVICE, with the
#     shell substitution evaluated there, so the words are never an argument
#     this laptop constructs.
#   * The only thing that ever crosses to this machine is an integer: how many
#     words were found.
#
# There is no verbose mode, no -Debug that prints them, and adb_common.ps1's
# `Assert-NoPhraseOnScreen` refuses any pull or screenshot while that screen is
# up, with no override flag. Do not add one.
#
# IF THE PHRASE IS EXPOSED ANYWAY - printed, screenshotted, pasted, logged -
# that install is COMPROMISED. Uninstall it (not "clear data"), reinstall, and
# onboard again from a fresh phrase. A phrase that has been in a transcript
# opens the vault it was issued for, forever.
#
# ===========================================================================
#
# USAGE - three phases, in this order, matching the app's own flow.
#
#   # 1. On the recovery-phrase DISPLAY step, before tapping "I've written
#   #    these down". Extracts the words device-side.
#   .\enter_recovery_phrase.ps1 -Capture
#
#   # 2. On the CONFIRM step, which asks for three words at random positions.
#   #    Reads the positions, types the right words device-side.
#   .\enter_recovery_phrase.ps1 -Confirm
#
#   # 3. On the recovery-unlock form (docs/13 Part 5, after removing the
#   #    screen lock), which wants all twelve, space-separated.
#   .\enter_recovery_phrase.ps1 -UnlockForm
#
#   # Always, when the session is done:
#   .\enter_recovery_phrase.ps1 -Shred
#
# The captured file survives between phases ON THE DEVICE, in /data/local/tmp,
# which app processes cannot read. -Shred removes it. Run it.

[CmdletBinding(DefaultParameterSetName = "Capture")]
param(
  [Parameter(ParameterSetName = "Capture")][switch]$Capture,
  [Parameter(ParameterSetName = "Confirm")][switch]$Confirm,
  [Parameter(ParameterSetName = "UnlockForm")][switch]$UnlockForm,
  [Parameter(ParameterSetName = "Shred")][switch]$Shred,
  [int]$WordCount = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\adb_common.ps1"

$tmp = "/data/local/tmp/peraplano_verify"
$phrase_file = "$tmp/phrase.txt"
$dump_file = "$tmp/phrase_dump.xml"
$extract_sh = "$tmp/extract_phrase.sh"
$type_sh = "$tmp/type_phrase.sh"

# ---------------------------------------------------------------------------
# The two device-side scripts.
#
# They are pushed rather than run through `adb shell "..."` because both need
# multi-line control flow and a `$(...)` that must evaluate on the DEVICE. A
# substitution that evaluated here would put a word into this process's command
# line, which is the exact thing being avoided.
#
# Neither script ever echoes a word. extract prints one integer; type prints
# nothing at all.
# ---------------------------------------------------------------------------

$extract_body = @'
#!/system/bin/sh
# Extracts phrase-word-0..N-1 out of a uiautomator dump into a file.
# Prints ONLY the number of words written. Never a word.
DUMP="$1"
OUT="$2"
COUNT="$3"

rm -f "$OUT"
i=0
while [ "$i" -lt "$COUNT" ]; do
  # uiautomator writes attributes in a fixed order and `text` immediately
  # precedes `resource-id`, so one node can be matched whole. The closing quote
  # after the index is what stops phrase-word-1 from also matching
  # phrase-word-10.
  line=$(grep -o "text=\"[^\"]*\" resource-id=\"[^\"]*phrase-word-$i\"" "$DUMP" | head -n 1)
  if [ -z "$line" ]; then
    echo "MISSING"
    exit 1
  fi
  word=$(echo "$line" | sed 's/^text="//' | sed 's/" resource-id=.*$//')
  if [ -z "$word" ]; then
    echo "EMPTY"
    exit 1
  fi
  printf '%s\n' "$word" >> "$OUT"
  i=$((i + 1))
done

chmod 600 "$OUT"
wc -l < "$OUT"
'@

$type_body = @'
#!/system/bin/sh
# Types a word, or the whole phrase, into whatever field currently has focus.
# Prints nothing.
#   $1 = phrase file
#   $2 = 1-based word position, or 0 for the whole phrase
OUT="$1"
IDX="$2"

if [ ! -f "$OUT" ]; then exit 1; fi

if [ "$IDX" = "0" ]; then
  # `input text` reads %s as a space. Everything here is computed on the
  # device; nothing is interpolated by the host.
  T=$(tr '\n' ' ' < "$OUT" | sed 's/ *$//' | sed 's/ /%s/g')
else
  T=$(sed -n "${IDX}p" "$OUT")
fi

if [ -z "$T" ]; then exit 1; fi
input text "$T"
'@

function Push-DeviceScript {
  param(
    [Parameter(Mandatory = $true)][string]$Body,
    [Parameter(Mandatory = $true)][string]$RemotePath
  )
  $local = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".sh")
  # LF endings: the device shell chokes on CRLF with a "not found" that names
  # the interpreter, which reads like a missing binary rather than a line
  # ending. No secret ever reaches this file.
  $normalized = $Body -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($local, $normalized, (New-Object System.Text.UTF8Encoding($false)))
  Invoke-Adb -AdbArgs @("push", $local, $RemotePath) | Out-Null
  Remove-Item $local -Force
  Invoke-AdbShell "chmod 700 $RemotePath" | Out-Null
}

Assert-SingleDevice | Out-Null
Initialize-DeviceTmp | Out-Null

switch ($PSCmdlet.ParameterSetName) {

  "Capture" {
    Write-Host "Capturing the recovery words DEVICE-SIDE. Nothing will be printed." -ForegroundColor Cyan

    Push-DeviceScript -Body $extract_body -RemotePath $extract_sh

    Invoke-AdbShell "rm -f $dump_file $phrase_file" | Out-Null
    Invoke-AdbShell "uiautomator dump $dump_file" | Out-Null

    # Sanity, still device-side: are we actually on the display step? A dump of
    # the wrong screen produces MISSING below, but saying so plainly here saves
    # an operator guessing at an opaque failure.
    $present = (Invoke-AdbShell "grep -c 'phrase-word-' $dump_file 2>/dev/null || true").Trim()
    if (-not ($present -match "^\d+$") -or [int]$present -eq 0) {
      Invoke-AdbShell "rm -f $dump_file" | Out-Null
      throw "No phrase-word-* nodes on screen. Are you on the recovery-phrase DISPLAY step (not the confirm step)?"
    }

    $out = (Invoke-AdbShell "sh $extract_sh $dump_file $phrase_file $WordCount" -AllowFailure).Trim()

    # THE DUMP IS ITSELF A PLAINTEXT COPY OF THE PHRASE. Delete it before
    # anything else can go wrong, including before reporting a failure.
    Invoke-AdbShell "rm -f $dump_file" | Out-Null

    if ($out -notmatch "^\d+$") {
      Invoke-AdbShell "rm -f $phrase_file" | Out-Null
      throw ("Extraction failed (device said: $out). Nothing was captured and nothing was printed. " +
        "Fall back to reading the words off the screen and typing them by hand - do NOT " +
        "screenshot the screen or pull the dump to debug this.")
    }

    $count = [int]$out
    if ($count -ne $WordCount) {
      Invoke-AdbShell "rm -f $phrase_file" | Out-Null
      throw "Extracted $count words, expected $WordCount. Discarded. Type them by hand instead."
    }

    Write-Host "Captured $count words to $phrase_file on the device." -ForegroundColor Green
    Write-Host "They have not left the phone and will not. Run -Shred when the session is done." -ForegroundColor Green
  }

  "Confirm" {
    # The confirm step asks for THREE words at random positions
    # (components/onboarding/phrase_confirm.tsx, CHALLENGE_COUNT = 3). Its
    # labels read "Word N" and its inputs are empty, so this screen carries no
    # phrase material and the view tree is safe to read here - which
    # Assert-NoPhraseOnScreen, called inside Get-ViewTree, independently
    # confirms rather than taking on trust.
    Write-Host "Answering the confirm step. Positions are read from the screen; words never leave the phone." -ForegroundColor Cyan

    $exists = (Invoke-AdbShell "[ -f $phrase_file ] && echo yes || echo no").Trim()
    if ($exists -ne "yes") {
      throw "No captured phrase on the device. Go back to the display step and run -Capture first."
    }

    Push-DeviceScript -Body $type_body -RemotePath $type_sh

    $tree = Get-ViewTree
    if (-not (Test-UiText -Tree $tree -Text "Confirm your recovery words")) {
      throw "This does not look like the confirm step. Navigate to it first."
    }

    $answered = 0
    for ($i = 0; $i -lt 3; $i++) {
      $label = Find-UiNode -Tree $tree -TestId "confirm-label-$i"
      if ($null -eq $label) { continue }

      $text = $label.GetAttribute("text")
      if ($text -notmatch "Word\s+(\d+)") {
        throw "Could not read a position out of confirm-label-$i ('$text')."
      }
      $position = [int]$Matches[1]

      $input_node = Find-UiNode -Tree $tree -TestId "confirm-input-$i"
      if ($null -eq $input_node) { throw "confirm-input-$i not found." }
      $center = Get-NodeCenter -Node $input_node
      Invoke-AdbShell "input tap $($center.x) $($center.y)" | Out-Null
      Start-Sleep -Milliseconds 400

      # The word is selected by INDEX. This host never sees it.
      Invoke-AdbShell "sh $type_sh $phrase_file $position" | Out-Null
      Start-Sleep -Milliseconds 300
      $answered++
      Write-Host "  filled the field asking for word #$position" -ForegroundColor DarkGray
    }

    if ($answered -eq 0) { throw "No confirm-input-* fields were filled." }

    Write-Host "Filled $answered fields. Tap Confirm on the phone (or run: adb shell input keyevent 66)." -ForegroundColor Green
    Write-Host "Leaving the final tap to you on purpose: it is the step that runs initializeKeys()." -ForegroundColor DarkGray
  }

  "UnlockForm" {
    # components/lock/recovery_unlock_form.tsx takes all twelve in one field,
    # space separated. The device-side typer joins them with %s, which
    # `input text` renders as a space.
    Write-Host "Filling the recovery-unlock form. Words never leave the phone." -ForegroundColor Cyan

    $exists = (Invoke-AdbShell "[ -f $phrase_file ] && echo yes || echo no").Trim()
    if ($exists -ne "yes") {
      throw "No captured phrase on the device. This form needs the phrase from the install being recovered."
    }

    Push-DeviceScript -Body $type_body -RemotePath $type_sh

    $node = Wait-UiNode -TestId "recovery-phrase-input" -TimeoutSeconds 20
    $center = Get-NodeCenter -Node $node
    Invoke-AdbShell "input tap $($center.x) $($center.y)" | Out-Null
    Start-Sleep -Milliseconds 400

    Invoke-AdbShell "sh $type_sh $phrase_file 0" | Out-Null
    Start-Sleep -Milliseconds 500

    Write-Host "Field filled. Tap the submit button on the phone." -ForegroundColor Green
    Write-Host "NOTE: the field is now showing twelve words. Do not screenshot this screen either," -ForegroundColor Yellow
    Write-Host "and do not pull a view tree until you have navigated away." -ForegroundColor Yellow
  }

  "Shred" {
    Invoke-AdbShell "rm -f $phrase_file $dump_file $extract_sh $type_sh" -AllowFailure | Out-Null
    Clear-DeviceTmp
    Write-Host "Removed the captured phrase and both device-side scripts." -ForegroundColor Green
    Write-Host ""
    Write-Host "What this does and does not guarantee: the file is unlinked from a flash" -ForegroundColor DarkGray
    Write-Host "filesystem, which is not a secure erase, and /data/local/tmp is readable by" -ForegroundColor DarkGray
    Write-Host "anyone holding adb on this phone. That is acceptable for a TEST install and" -ForegroundColor DarkGray
    Write-Host "for nothing else. Never point this script at a phrase a real person relies on." -ForegroundColor DarkGray
  }
}

#!/usr/bin/env bash
set -euo pipefail

package=ua.thermoexpert.vladimir
apk=app/build/outputs/apk/debug/app-debug.apk
test_apk=app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
output="$PWD/android-test-results"
mkdir -p "$output"

# Every install and removal below takes place on the disposable CI emulator.
bash .github/scripts/smoke-test-apk.sh
adb uninstall "$package"
python3 .github/scripts/prepare-upgrade-fixture.py

upgrade_from() {
  local version=$1
  local file
  local baseline_backup="$output/legacy-backup-$version.json"
  adb install "baseline-app-$version.apk"
  adb shell am start -W -n "$package/.MainActivity"
  for attempt in {1..30}; do
    if adb shell run-as "$package" test -f files/database.json; then
      break
    fi
    sleep 1
  done
  adb shell run-as "$package" test -f files/database.json
  adb shell am force-stop "$package"

  adb shell run-as "$package" mkdir -p files/photos
  adb shell -T "run-as $package sh -c 'cat > files/database.json'" < upgrade-fixture/database.json
  for file in upgrade-fixture/photos/*.txt; do
    adb shell -T "run-as $package sh -c 'cat > files/photos/$(basename "$file")'" < "$file"
  done
  adb shell am start -W -n "$package/.MainActivity"
  for attempt in {1..30}; do
    if adb exec-out "run-as $package sh -c 'cat files/backups/*.json'" > "$baseline_backup" &&
       grep -Fq 'data:image/png;base64,' "$baseline_backup"; then
      break
    fi
    sleep 1
  done
  python3 - "$baseline_backup" <<'PY'
import json
from pathlib import Path
import sys
backup = json.loads(Path(sys.argv[1]).read_text())
assert backup["clients"][0]["id"] == "legacy-client"
assert backup["findings"][0]["photo"].startswith("data:image/png;base64,")
PY

  adb exec-out run-as "$package" cat files/database.json > "$output/pre-upgrade-$version.json"
  adb install -r "$apk"
  adb shell dumpsys package "$package" > "$output/package-from-$version.txt"
  grep -F 'versionName=1.2.1' "$output/package-from-$version.txt"
  adb shell am start -W -n "$package/.MainActivity"
  adb exec-out run-as "$package" cat files/database.json > "$output/post-upgrade-$version.json"
  cmp "$output/pre-upgrade-$version.json" "$output/post-upgrade-$version.json"
  for file in upgrade-fixture/photos/*.txt; do
    adb exec-out run-as "$package" cat "files/photos/$(basename "$file")" | cmp "$file" -
  done
  adb shell am force-stop "$package"
}

upgrade_from 1.2.0
adb uninstall "$package"
upgrade_from 1.1.5
adb install "$test_apk"
adb shell am instrument -w "$package.test/androidx.test.runner.AndroidJUnitRunner" | tee "$output/instrumentation.txt"
grep -F 'OK (1 test)' "$output/instrumentation.txt"

name=$(adb shell run-as "$package" ls files/pdf_reports | tr -d '\r' | sed -n '1p')
test -n "$name"
adb exec-out run-as "$package" cat "files/pdf_reports/$name" > "$output/report.pdf"
pdftotext "$output/report.pdf" "$output/report.txt"
grep -F 'Клієнт 1.1.5' "$output/report.txt"
grep -F 'Висновок 1.1.5' "$output/report.txt"
test "$(grep -Fc 'Висновок 1.1.5' "$output/report.txt")" -eq 1
adb shell "ls '/sdcard/Download/THERMO EXPERT/$name'"
adb exec-out run-as "$package" cat files/archive-test.png > "$output/archive.png"
adb exec-out run-as "$package" cat files/home-test.png > "$output/home.png"

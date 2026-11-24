#!/usr/bin/env bash
set -euo pipefail

package=ua.thermoexpert.vladimir
apk=app/build/outputs/apk/debug/app-debug.apk
test_apk=app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
output="$PWD/android-test-results"
mkdir -p "$output"

# Check a clean installation before exercising the upgrade on the same emulator.
bash .github/scripts/smoke-test-apk.sh
adb uninstall "$package"
adb install baseline-app.apk
adb shell am start -W -n "$package/.MainActivity"
for attempt in {1..30}; do
  if adb shell run-as "$package" test -f files/database.json; then
    break
  fi
  sleep 1
done
adb shell run-as "$package" test -f files/database.json
adb shell am force-stop "$package"

python3 .github/scripts/prepare-upgrade-fixture.py
adb shell run-as "$package" mkdir -p files/photos
adb shell -T "run-as $package sh -c 'cat > files/database.json'" < upgrade-fixture/database.json
for file in upgrade-fixture/photos/*.txt; do
  adb shell -T "run-as $package sh -c 'cat > files/photos/$(basename "$file")'" < "$file"
done
adb shell am start -W -n "$package/.MainActivity"
for attempt in {1..30}; do
  if adb shell "run-as $package sh -c 'cat files/backups/*.json'" | grep -q 'data:image/png;base64,'; then
    break
  fi
  sleep 1
done
adb shell "run-as $package sh -c 'cat files/backups/*.json'" > "$output/legacy-backup.json"
python3 - "$output/legacy-backup.json" <<'PY'
import json
from pathlib import Path
import sys
backup = json.loads(Path(sys.argv[1]).read_text())
assert backup["clients"][0]["id"] == "legacy-client"
assert backup["findings"][0]["photo"].startswith("data:image/png;base64,")
PY

adb install -r "$apk"
adb shell dumpsys package "$package" > "$output/package.txt"
grep -F 'versionName=1.2.0' "$output/package.txt"
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

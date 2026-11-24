#!/usr/bin/env bash
set -euo pipefail

package=ua.thermoexpert.vladimir
apk=app/build/outputs/apk/debug/app-debug.apk

adb install "$apk"
adb shell am start -W -n "$package/.MainActivity"

# The WebView writes this database and creates today's backup during startup.
for attempt in {1..20}; do
  if adb shell run-as "$package" cat files/database.json > database.json 2>/dev/null &&
     adb shell "run-as $package ls files/backups" > backup-files.txt 2>/dev/null &&
     grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json' backup-files.txt; then
    break
  fi
  sleep 2
done

grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json' backup-files.txt
python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path("database.json").read_text())
for field in ("clients", "orders", "findings", "reports", "prices"):
    assert isinstance(data[field], list), field
PY

adb shell dumpsys activity activities > activities.txt
grep -E "topResumedActivity=.*$package/.MainActivity" activities.txt

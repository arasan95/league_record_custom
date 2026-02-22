import os
import json
import glob

record_dir = r"C:\Users\fjnce\Downloads\league_record-master - 1\LeagueRecord_custom\.vscode\record"
broken_files = [
    "2026-02-22_12-03.json",
    "2026-02-22_12-20.json",
    "2026-02-22_13-31.json",
    "2026-02-22_13-35.json",
]

# Provide a dummy valid Deferred with gameId 566727332 for testing
valid_deferred = {
    "Deferred": {
        "matchId": {
            "gameId": 566727332,
            "platformId": "JP1"
        },
        "ingameTimeRecStartOffset": 0.0,
        "favorite": False,
        "highlights": []
    }
}

for fname in broken_files:
    path = os.path.join(record_dir, fname)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            if content.strip() == '{"Deferred": {"favorite": false}}':
                with open(path, "w", encoding="utf-8") as fw:
                    json.dump(valid_deferred, fw)
                print(f"Repaired {fname}")

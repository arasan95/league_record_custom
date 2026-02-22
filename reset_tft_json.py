import os
import json
import glob

record_dir = r"C:\Users\fjnce\Downloads\league_record-master - 1\LeagueRecord_custom\.vscode\record"
for path in glob.glob(os.path.join(record_dir, "*.json")):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if '"Teamfight Tactics"' in content or '"id": 1220' in content or '"TFT"' in content:
        # Reset to deferred so that backend re-fetches and parses it properly
        with open(path, "w", encoding="utf-8") as f:
            f.write('{"Deferred": {"favorite": false}}')
        print(f"Reset {os.path.basename(path)}")

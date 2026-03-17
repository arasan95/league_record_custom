import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List


def default_db_path() -> Path:
    appdata = os.environ.get("APPDATA", "")
    return Path(appdata) / "com.leaguerecord.custom" / "tooltip_db" / "tooltip_data.db"


def list_locales(db_path: Path) -> List[str]:
    con = sqlite3.connect(str(db_path))
    try:
        rows = con.execute(
            "SELECT locale FROM champion_tooltips ORDER BY locale"
        ).fetchall()
    finally:
        con.close()
    return [str(r[0]) for r in rows if r and r[0]]


def run_cmd(cmd: List[str], cwd: Path) -> Dict[str, object]:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "cmd": cmd,
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def extract_count(path: Path) -> int:
    if not path.exists():
        return -1
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return len(data)
    except Exception:
        return -1
    return -1


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run repeatable tooltip diagnostics and write reports under tmp/tooltip_diagnostics/"
    )
    parser.add_argument(
        "--db-path",
        default=str(default_db_path()),
        help="Path to tooltip_data.db",
    )
    parser.add_argument(
        "--locales",
        default="all",
        help='Comma-separated locales (e.g. "ja_JP,en_US") or "all"',
    )
    parser.add_argument(
        "--out-dir",
        default="",
        help="Output directory. Default: tmp/tooltip_diagnostics/<timestamp>",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    scripts_dir = repo_root / "scripts"
    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"NOT_FOUND_DB {db_path}")
        sys.exit(1)

    if args.out_dir:
        out_dir = Path(args.out_dir)
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir = repo_root / "tmp" / "tooltip_diagnostics" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    all_locales = list_locales(db_path)
    if args.locales.strip().lower() == "all":
        targets = all_locales
    else:
        targets = [x.strip() for x in args.locales.split(",") if x.strip()]

    if not targets:
        print("NO_LOCALES")
        sys.exit(1)

    summary: Dict[str, object] = {
        "dbPath": str(db_path),
        "outDir": str(out_dir),
        "requestedLocales": args.locales,
        "detectedLocales": all_locales,
        "ranAt": datetime.now().isoformat(),
        "results": {},
    }

    for locale in targets:
        loc_key = locale.replace("-", "_")
        anomaly_out = out_dir / f"db_anomalies_{loc_key}.json"
        duplicate_out = out_dir / f"passive_slot_duplicates_{loc_key}.json"

        anomaly_cmd = [
            sys.executable,
            str(scripts_dir / "find_tooltip_db_anomalies.py"),
            "--db-path",
            str(db_path),
            "--locale",
            locale,
            "--out",
            str(anomaly_out),
        ]
        duplicate_cmd = [
            sys.executable,
            str(scripts_dir / "find_passive_slot_duplicates.py"),
            "--db-path",
            str(db_path),
            "--locale",
            locale,
            "--out",
            str(duplicate_out),
        ]

        anomaly_res = run_cmd(anomaly_cmd, repo_root)
        duplicate_res = run_cmd(duplicate_cmd, repo_root)

        summary["results"][locale] = {
            "anomalyReport": str(anomaly_out),
            "anomalyCount": extract_count(anomaly_out),
            "duplicateReport": str(duplicate_out),
            "duplicateCount": extract_count(duplicate_out),
            "anomalyCmdResult": anomaly_res,
            "duplicateCmdResult": duplicate_res,
        }
        print(
            f"{locale}: anomalies={extract_count(anomaly_out)} duplicates={extract_count(duplicate_out)}"
        )

    summary_path = out_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"WROTE {summary_path}")
    print(f"REPORT_DIR {out_dir}")


if __name__ == "__main__":
    main()

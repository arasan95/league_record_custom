# Tooltip デバッグ検査

ツールチップの不具合を再調査するための、再実行可能な入口です。

## 場所

- フォルダ: `tools/tooltip-diagnostics`
- 実行ランナー: `tools/tooltip-diagnostics/run_tooltip_diagnostics.py`
- 出力先: `tmp/tooltip_diagnostics/<日時>/`

## 何を検査するか

- `scripts/find_tooltip_db_anomalies.py` を実行して、未解決トークンや欠落値の疑いを検出
- `scripts/find_passive_slot_duplicates.py` を実行して、Passive が Q/W/E/R と重複していないか検出
- 既定では DB 内の全ロケールに対して実行

## 使い方

リポジトリルートで実行:

```powershell
python tools/tooltip-diagnostics/run_tooltip_diagnostics.py
```

特定ロケールのみ:

```powershell
python tools/tooltip-diagnostics/run_tooltip_diagnostics.py --locales ja_JP
```

複数ロケール指定:

```powershell
python tools/tooltip-diagnostics/run_tooltip_diagnostics.py --locales ja_JP,en_US,ko_KR
```

DBパスを明示:

```powershell
python tools/tooltip-diagnostics/run_tooltip_diagnostics.py --db-path "C:\Users\<you>\AppData\Roaming\com.leaguerecord.custom\tooltip_db\tooltip_data.db"
```

## 補足

- 既定DBパスは `%APPDATA%\com.leaguerecord.custom\tooltip_db\tooltip_data.db` です。
- 実行結果の要約は `summary.json` に保存されます。

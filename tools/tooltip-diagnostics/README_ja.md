# Tooltip デバッグ検査

ツールチップの不具合を再調査するための、再実行可能な入口です。

## 場所

- フォルダ: `tools/tooltip-diagnostics`
- 実行ランナー: `tools/tooltip-diagnostics/run_tooltip_diagnostics.py`
- 速度計測: `tools/tooltip-diagnostics/benchmark_champion_tooltip_render.ts`
- 出力先: `tmp/tooltip_diagnostics/<日時>/`

## 何を検査するか

- `scripts/find_tooltip_db_anomalies.py` を実行して、未解決トークンや欠落値の疑いを検出
- `scripts/find_passive_slot_duplicates.py` を実行して、Passive が Q/W/E/R と重複していないか検出
- 既定では DB 内の全ロケールに対して実行

## DB整合性チェックの使い方

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

## 表示速度計測の使い方

遅いチャンプ一覧と、重いトークン候補を出力します。

JAを計測:

```powershell
bun tools/tooltip-diagnostics/benchmark_champion_tooltip_render.ts --locale ja_JP --top 20 --slow-ms 120
```

毎回同じ場所に保存して比較:

```powershell
bun tools/tooltip-diagnostics/benchmark_champion_tooltip_render.ts --locale ja_JP --top 20 --slow-ms 120 --out tmp/tooltip_diagnostics/latest/render_benchmark_ja_JP.json
```

全ロケールを順番に計測:

```powershell
$locales = @('de_DE','en_US','es_ES','fr_FR','it_IT','ja_JP','ko_KR','pl_PL','pt_BR','ru_RU','tr_TR','vi_VN','zh_CN')
foreach ($l in $locales) {
  bun tools/tooltip-diagnostics/benchmark_champion_tooltip_render.ts --locale $l --top 5 --slow-ms 150 --out "tmp/tooltip_diagnostics/latest/render_benchmark_$l.json"
}
```

## 速度レポートの見方

- `top`: そのロケールで遅い順のチャンプ一覧
- `totalMs`: チャンプ1体分のツールチップHTML構築時間
- `slotMaxMs`: Passive/Q/W/E/R の中で最も重いスロット時間
- `hottestToken`: 最も重かったトークン名と内訳
- `cause`: 重さの主因推定
- `normalize`: 表示文字列の正規化処理が主因
- `resolve`: 変数解決処理が主因
- `mixed`: 単一要因ではない

## 補足

- 既定DBパス: `%APPDATA%\com.leaguerecord.custom\tooltip_db\tooltip_data.db`
- キャッシュ参照先: `%LOCALAPPDATA%\com.leaguerecord.custom\tooltip_cache`
- DB整合性チェックの要約は `summary.json` に保存されます
- 速度計測は `render_benchmark_<locale>.json` を保存します

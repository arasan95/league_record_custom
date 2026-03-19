# 2026-03-20 アイコンのローカル化（LCU WAD抽出）手順メモ

## 目的
- 画像キャッシュが `remote_http` ではなく、ローカル（`local_wad`）から取得できているかを確認する
- 取得元を確認するためのスクリプト運用を残す

## 概要
- 画像は `img_cache` に保存される
- 取得元は `*.source.json`（ソースマーカー）に記録される
  - 既定では作成しない（必要な時だけ環境変数で有効化）
  - 有効化したい場合のみ `LEAGUERECORD_WRITE_IMAGE_MARKERS=1` を設定

## 確認用スクリプト
- スクリプト: `tools/inspect_image_sources.ps1`
- 実行例:

```powershell
powershell -ExecutionPolicy Bypass -File tools\inspect_image_sources.ps1
```

## 期待される結果
- `Source Count` に `remote_http` が出ない
- すべて `local_wad` のみになっていればローカル化が完了

## キャッシュ場所
- 画像キャッシュ: `%LOCALAPPDATA%\com.leaguerecord.custom\img_cache`
- 取得元マーカー（任意）: `*.source.json`

## トラブル時の確認
1. アプリ再起動
2. 必要なら `img_cache` を削除
3. 再表示後に確認用スクリプトを実行


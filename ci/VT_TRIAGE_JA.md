# VirusTotal高速検証メモ（Trapmine向け）

## 目的
- `Trapmine: Malicious.moderate.ml.score` を下げるための切り分けを、最小ビルド回数で回す。

## 基本方針
1. まず `trapmine` プリセット（5プロファイル）だけ試す。
2. 同じコミットでは `-UseBuildCache` を使い、再ビルドを避ける。
3. VT未登録ハッシュだけ `-UploadToVirusTotal` する。
4. 高速化が必要なら `-BackendOnly` を使い、`cargo build --release` で回す。

## コマンド

### 1) Trapmine向けの最小セットを実行（推奨）
```powershell
pwsh ./ci/av_triage.ps1 `
  -Preset trapmine `
  -Target exe `
  -BackendOnly `
  -UseSccache `
  -ApiKey "<VT_API_KEY>" `
  -UploadToVirusTotal `
  -UseBuildCache
```

### 1.5) フロントは最初の1回だけ作る（さらに短縮）
```powershell
bun run --bun build
pwsh ./ci/av_triage.ps1 `
  -Preset trapmine `
  -Target exe `
  -BackendOnly `
  -SkipFrontendBuild `
  -UseSccache `
  -ApiKey "<VT_API_KEY>" `
  -UploadToVirusTotal `
  -UseBuildCache
```

### 2) さらに速く2パターンだけ試す
```powershell
pwsh ./ci/av_triage.ps1 `
  -Preset quick `
  -Target exe `
  -ApiKey "<VT_API_KEY>" `
  -UploadToVirusTotal `
  -UseBuildCache
```

### 2.5) 録画ランタイムだけ外して確認
```powershell
pwsh ./ci/av_triage.ps1 `
  -Profiles no_recorder `
  -Target exe `
  -ApiKey "<VT_API_KEY>" `
  -UploadToVirusTotal `
  -UseBuildCache
```

### 3) 既存成果物だけ再照会（ビルドなし）
```powershell
pwsh ./ci/av_triage.ps1 `
  -Profiles @("full","no_updater") `
  -SkipBuild `
  -Target exe `
  -ApiKey "<VT_API_KEY>"
```

## 出力の見方
- `av-triage-results/summary.csv`
- `av-triage-results/summary.json`

追加カラム:
- `vt_trapmine`: Trapmineの判定名
- `vt_microsoft`: Microsoftの判定名

## 実務上の注意
- TrapmineのML判定は、コードが安全でも0件にならない場合がある。
- 0件を狙うなら、以下が現実的:
  - EVコード署名
  - 配布実績（SmartScreen/AV reputation）を積む
  - 検出時にベンダーへFalse Positive申請

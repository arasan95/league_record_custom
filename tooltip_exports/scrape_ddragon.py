import urllib.request
import json
import os
import concurrent.futures


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    content = urllib.request.urlopen(req).read().decode("utf-8")
    return json.loads(content)


def scrape_ddragon_tooltips():
    print("DataDragonのバージョン情報を取得中...")
    versions = fetch_json("https://ddragon.leagueoflegends.com/api/versions.json")
    v = versions[0]
    lang = "ja_JP"
    print(f"最新パッチ: {v} ({lang})")

    # 全チャンピオン名のリストを取得
    list_url = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/{lang}/champion.json"
    champ_list_data = fetch_json(list_url)
    champs = list(champ_list_data["data"].keys())

    print(f"{len(champs)}体のチャンピオンデータをDDragonから取得します...")

    results = []

    # 取得処理（並列で行う関数）
    def process_champ(champ):
        url = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/{lang}/champion/{champ}.json"
        try:
            champ_data = fetch_json(url)
            return champ_data["data"][champ]  # チャンピオンのデータ辞書をそのまま返す
        except Exception as e:
            print(f"{champ} の取得失敗: {e}")
            return None

    # マルチスレッドで高速にフェッチ（APIスロットロットルに注意してMax 10にする）
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        for i, data in enumerate(executor.map(process_champ, champs)):
            if data:
                results.append(data)
                if (i + 1) % 20 == 0 or (i + 1) == len(champs):
                    print(f"[{i + 1}/{len(champs)}] 取得進行中...")

    # 保存
    os.makedirs(os.path.join(os.getcwd(), "tooltip_exports"), exist_ok=True)
    out_path = os.path.join(
        os.getcwd(), "tooltip_exports", "ddragon_all_champions.json"
    )

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(
        f"\n取得完了しました！全 {len(results)} 体のチャンピオンデータを {out_path} に保存しました。"
    )


if __name__ == "__main__":
    scrape_ddragon_tooltips()

import urllib.request
import json
import os
import time
import urllib.parse
from bs4 import BeautifulSoup


def scrape_loljp_wiki():
    base_url = "https://www.loljp-wiki.jp/wiki/?Champion"
    req = urllib.request.Request(base_url, headers={"User-Agent": "Mozilla/5.0"})

    print("メインのチャンピオン一覧ページを取得中...")
    try:
        content = urllib.request.urlopen(req).read()
        html = content.decode("euc-jp", errors="ignore")
    except Exception as e:
        print(f"メインページの取得に失敗しました: {e}")
        return

    soup = BeautifulSoup(html, "html.parser")

    champion_names = set()
    # PukiWikiのリンクは ?Champion%2Fxxx や ?cmd=read&page=Champion%2Fxxx のようになっている
    for a in soup.find_all("a", href=True):
        href = urllib.parse.unquote(a["href"])
        if "Champion/" in href:
            name = href.split("Champion/")[-1].split("&")[0]
            if "/" not in name and "?" not in name and name.strip() != "":
                champion_names.add(name)

    champions = sorted(list(champion_names))
    print(
        f"{len(champions)}体のチャンピオンを検出しました。それぞれのページから summary を抽出します..."
    )

    results = []
    os.makedirs("tooltip_exports", exist_ok=True)

    for i, champ in enumerate(champions):
        print(f"[{i+1}/{len(champions)}] 取得中: {champ}...")

        # ユーザー指定の確実なURLフォーマット
        encoded_champ = urllib.parse.quote(f"Champion/{champ}", safe="")
        champ_url = f"https://www.loljp-wiki.jp/wiki/?cmd=read&page={encoded_champ}"

        try:
            req = urllib.request.Request(
                champ_url, headers={"User-Agent": "Mozilla/5.0"}
            )
            champ_content = urllib.request.urlopen(req).read()
            champ_html = champ_content.decode("euc-jp", errors="ignore")

            champ_soup = BeautifulSoup(champ_html, "html.parser")
            # <table class="champion_summary"> を探す
            summary_tag = champ_soup.find(class_="champion_summary")

            if summary_tag:
                text = summary_tag.get_text(separator=" ", strip=True)
                results.append({"champion": champ, "summary": text})
            else:
                print(f"  -> 'champion_summary' が見つかりませんでした: {champ}")

        except Exception as e:
            print(f"  -> {champ} のページ取得でエラーが発生しました: {e}")

        time.sleep(0.5)

    print(f"スクレイピングが完了しました。{len(results)}件の summary を抽出しました。")

    out_path = os.path.join("tooltip_exports", "loljp_wiki_summary.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"結果を {out_path} に保存しました。")


if __name__ == "__main__":
    scrape_loljp_wiki()

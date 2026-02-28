import urllib.request
import json


def fetch_cd(champ, outname):
    url = f"https://raw.communitydragon.org/latest/game/data/characters/{champ}/{champ}.bin.json"
    print("Fetching", url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
        with open(outname, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print("Saved to", outname)
    except Exception as e:
        print("Error:", e)


fetch_cd("lucian", "Lucian_cd.json")
fetch_cd("kaisa", "Kaisa_cd.json")
fetch_cd("khazix", "Khazix_cd.json")
fetch_cd("jarvaniv", "JarvanIV_cd.json")

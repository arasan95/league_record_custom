import os
import sys

sys.path.append(r"C:\Users\fjnce\project\lol_chanpdata")
try:
    import wad_to_json
except ImportError:
    print("Cannot import wad_to_json.")
    exit(1)


def explore():
    db = wad_to_json.build_hash_db()
    hash_dir = r"C:\Users\fjnce\project\lol_chanpdata\hashes"
    for file in [
        "hashes.bintypes.txt",
        "hashes.binfields.txt",
        "hashes.binhashes.txt",
        "hashes.binentries.txt",
    ]:
        pth = os.path.join(hash_dir, file)
        if os.path.exists(pth):
            with open(pth, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        h = wad_to_json.fnv1a_32(line)
                        db[h] = line

    galio_wad = (
        r"C:\Riot Games\League of Legends\Game\DATA\FINAL\Champions\Galio.wad.client"
    )
    entries = wad_to_json.parse_wad_entries(galio_wad)
    prop_data_list = wad_to_json.extract_prop_data(galio_wad, entries)

    target_hash = 0xB409EBFA

    for prop_data in prop_data_list:
        parsed = wad_to_json.parse_prop(prop_data, db)
        if not parsed:
            continue

        for key, entry in parsed.items():
            if not isinstance(entry, dict):
                continue
            if (
                entry.get("__type") == "SpellObject"
                and entry.get("mScriptName") == "GalioW"
            ):
                calcs = entry.get("mSpell", {}).get("mSpellCalculations", {})
                for c_k, c_v in calcs.items():
                    if c_k == target_hash or (
                        isinstance(c_k, str) and c_k.lower() == "{b409ebfa}"
                    ):
                        parts = c_v.get("mFormulaParts", [])
                        print(
                            f"== FOUND {hex(c_k) if isinstance(c_k, int) else c_k} =="
                        )
                        for p in parts:
                            print(f"Type: {p.get('__type')}")
                            print(f"Keys: {list(p.keys())}")


explore()

import json
import re


def resolve():
    with open("tooltip_exports/all_tooltips.json", encoding="utf-8") as f:
        tooltips = json.load(f)
    with open("tooltip_exports/ddragon_all_champions.json", encoding="utf-8") as f:
        ddragon = json.load(f)
    try:
        with open("tooltip_exports/loljp_wiki_summary.json", encoding="utf-8") as f:
            wiki = json.load(f)
    except:
        wiki = []

    wiki_map = {w["champion"]: w["summary"] for w in wiki}
    dd_map = {d["id"]: d for d in ddragon}

    fallback_mappings = {}
    total_missing = 0
    total_resolved = 0

    for t in tooltips:
        if not t.get("hasQuestionMark"):
            continue
        champ = t["champion"]
        spell_id = t["spell"]
        missing = t.get("missingVariables", [])
        if not missing:
            continue

        total_missing += len(missing)

        champ_data = dd_map.get(champ, {})
        spell_data = next(
            (s for s in champ_data.get("spells", []) if s.get("id") == spell_id), None
        )

        wiki_text = wiki_map.get(champ, "")

        candidates = []
        if spell_data:
            effect_burn = spell_data.get("effectBurn", [])
            for i, val in enumerate(effect_burn):
                if not val or str(val) == "0":
                    continue
                if str(val) in wiki_text:
                    candidates.append((f"e{i}", str(val)))

            svars = spell_data.get("vars", [])
            for v in svars:
                if v.get("coeff"):
                    coeff_val = v["coeff"]
                    cv_str = (
                        "/".join(map(str, coeff_val))
                        if isinstance(coeff_val, list)
                        else str(coeff_val)
                    )
                    keyname = v.get("key", "").lower()
                    if keyname:
                        candidates.append((keyname, cv_str))

        if spell_id not in fallback_mappings:
            fallback_mappings[spell_id] = {}

        for m_var in missing:
            clv = m_var.lower().strip()

            matched = False
            # 1. Exact match on keys
            for i, (c_key, c_val) in enumerate(candidates):
                if c_key == clv:
                    fallback_mappings[spell_id][m_var] = c_val
                    candidates.pop(i)
                    total_resolved += 1
                    matched = True
                    break
            if matched:
                continue

            # 2. Heuristic match: Just grab the first mapped effectBurn value
            eb_indexes = [i for i, c in enumerate(candidates) if c[0].startswith("e")]
            if eb_indexes:
                idx = eb_indexes[0]
                fallback_mappings[spell_id][m_var] = candidates[idx][1]
                candidates.pop(idx)
                total_resolved += 1

    with open("tooltip_exports/fallback_mappings.json", "w", encoding="utf-8") as f:
        json.dump(fallback_mappings, f, ensure_ascii=False, indent=2)

    print(
        f"Generated fallback_mappings.json. Resolved {total_resolved} out of {total_missing} missing variables."
    )


if __name__ == "__main__":
    resolve()

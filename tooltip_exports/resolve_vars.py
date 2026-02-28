import json
import re


def clean_num_str(s):
    if not s:
        return ""
    return s.strip()


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

    resolved = {}

    for t in tooltips:
        if not t.get("hasQuestionMark"):
            continue
        champ = t["champion"]
        spell_id = t["spell"]
        missing = t.get("missingVariables", [])

        if champ not in dd_map:
            continue
        champ_data = dd_map[champ]
        spell_data = next(
            (s for s in champ_data.get("spells", []) if s["id"] == spell_id), None
        )
        if not spell_data:
            continue

        wiki_text = wiki_map.get(champ, "")

        # Build candidate arrays from effectBurn
        effect_burn = spell_data.get("effectBurn", [])
        candidates = []
        for i, val in enumerate(effect_burn):
            if not val or str(val) == "0":
                continue
            # Check if this array string exists anywhere in the wiki text
            if str(val) in wiki_text:
                candidates.append((f"e{i}", str(val)))

        # Heuristic: if there's only 1 missing variable and 1 candidate matched in wiki, assign it!
        # If there are multiple, maybe assign in order?
        if not missing:
            continue

        if champ not in resolved:
            resolved[champ] = {}
        if spell_id not in resolved[champ]:
            resolved[champ][spell_id] = {}

        unresolved = []
        for m_var in missing:
            # First check if the variable name matches exactly with an eX key (already handled by Node, but fallback)
            # Try to assign a unique candidate
            if candidates:
                # Naive assignment: just pick the first candidate that hasn't been used
                c_key, c_val = candidates.pop(0)
                resolved[champ][spell_id][m_var] = c_val
            else:
                unresolved.append(m_var)

        # Also let's output a debug object
        t["resolved"] = resolved[champ][spell_id]
        t["unresolved_after"] = unresolved
        t["candidates_found"] = candidates

    with open("tooltip_exports/heuristic_resolution.json", "w", encoding="utf-8") as f:
        json.dump(tooltips, f, ensure_ascii=False, indent=2)

    print(f"Heuristic resolution complete. Check heuristic_resolution.json")


if __name__ == "__main__":
    resolve()

import json

with open("tooltip_exports/all_spelldata.json", "r", encoding="utf-8") as f:
    d = json.load(f)

ekko_w = d.get("Ekko", {}).get("Characters/Ekko/Spells/EkkoWAbility/EkkoW", {})
data_values = ekko_w.get("mSpell", {}).get("DataValues", [])
calcs = ekko_w.get("mSpell", {}).get("mSpellCalculations", {})

print("Ekko W Data Values:")
for v in data_values:
    print(f"  {v.get('mName')}: {v.get('mValues')}")

print("\nEkko W Calculations:")
for calc_name, calc in calcs.items():
    print(f"  {calc_name}: {calc}")

import json

try:
    with open("darius_bin_powershell.json", "r", encoding="utf-8") as f:
        d = json.load(f)

    calc = (
        d.get("Characters/Darius/Spells/DariusCleaveAbility/DariusCleave", {})
        .get("mSpell", {})
        .get("mSpellCalculations", {})
    )
    out = {
        "BladeDamage": calc.get("BladeDamage"),
        "HandleDamage": calc.get("HandleDamage"),
    }

    with open("calc.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("Successfully wrote calc.json")
except Exception as e:
    print(f"Error: {e}")

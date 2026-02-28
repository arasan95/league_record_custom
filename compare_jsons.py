import json
import os

rust_json = "C:/Users/fjnce/AppData/Local/com.leaguerecord.custom/tooltip_cache/tooltip_variable_fallback.json"
python_json = "C:/Users/fjnce/Downloads/league_record-master - 1/LeagueRecord_custom/tooltip_variable_fallback_generated.json"

with open(rust_json, "r", encoding="utf-8") as f:
    rust_data = json.load(f)

with open(python_json, "r", encoding="utf-8") as f:
    python_data = json.load(f)

missing_in_rust = []
mismatched_values = []
rust_extra = []

for spell_id, vars_dict in python_data.items():
    if spell_id not in rust_data:
        missing_in_rust.append(f"Spell {spell_id} missing completely in Rust")
        continue

    for var_name, py_val in vars_dict.items():
        if var_name not in rust_data[spell_id]:
            # Try to see if Rust has it under hex
            rust_keys = list(rust_data[spell_id].keys())
            missing_in_rust.append(
                f"[{spell_id}] Var '{var_name}' missing in Rust. Rust has: {rust_keys[:5]}..."
            )
        else:
            rust_val = str(rust_data[spell_id][var_name])
            if str(py_val) != rust_val:
                mismatched_values.append(
                    f"[{spell_id}] {var_name}: Python='{py_val}' vs Rust='{rust_val}'"
                )

for spell_id, r_vars in rust_data.items():
    if spell_id not in python_data:
        pass  # Rust extracted more spells
    else:
        for r_v in r_vars:
            if r_v not in python_data[spell_id]:
                rust_extra.append(f"[{spell_id}] Extra in Rust: {r_v}")

print(f"Total spells in Python: {len(python_data)}")
print(f"Total spells in Rust: {len(rust_data)}")
print(f"Missing in Rust: {len(missing_in_rust)}")
if missing_in_rust:
    for m in missing_in_rust[:20]:
        print(m)

print(f"Mismatched values: {len(mismatched_values)}")
if mismatched_values:
    for m in mismatched_values[:20]:
        print(m)

print(f"Extra in Rust: {len(rust_extra)}")

import json
from collections import defaultdict


def main():
    try:
        with open("tooltip_exports/all_tooltips.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print("Error reading JSON:", e)
        return

    missing_map = defaultdict(list)
    for item in data:
        for mv in item.get("missingVariables", []):
            missing_map[mv].append(f"{item['champion']}-{item['spell']}")

    print("=== Missing totaldamage ===")
    for spec in missing_map.get("totaldamage", []):
        print(spec)

    print("\n=== Missing f1 ===")
    for spec in missing_map.get("f1", []):
        print(spec)

    print("\n=== Missing bonusdamage ===")
    for spec in missing_map.get("bonusdamage", []):
        print(spec)


if __name__ == "__main__":
    main()

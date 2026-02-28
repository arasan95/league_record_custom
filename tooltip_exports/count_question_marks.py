import json
import os
from collections import Counter


def main():
    # スクリプトの実行場所に関わらず、同階層の all_tooltips.json を探す
    filepath = os.path.join(os.path.dirname(__file__), "all_tooltips.json")
    if not os.path.exists(filepath):
        # 実行パスに直接あるか探す
        filepath = "all_tooltips.json"
        if not os.path.exists(filepath):
            filepath = "tooltip_exports/all_tooltips.json"
            if not os.path.exists(filepath):
                print(
                    f"Error: all_tooltips.json が見つかりません。先に抽出スクリプトを実行してください。"
                )
                return

    with open(filepath, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except Exception as e:
            print(f"JSONパースエラー: {e}")
            return

    total_spells = 0
    spells_with_questions = 0
    missing_vars_counter = Counter()

    for item in data:
        total_spells += 1
        if item.get("hasQuestionMark"):
            spells_with_questions += 1
            for mv in item.get("missingVariables", []):
                missing_vars_counter[mv] += 1

    total_missing = sum(missing_vars_counter.values())

    print("=== Tooltip 解析・改善レポート ===")
    print(f"総スキル数: {total_spells}")
    print(
        f"「?」が含まれるスキル数: {spells_with_questions} ({spells_with_questions/total_spells*100:.1f}%)"
    )
    print(f"未解決の変数（?）の合計出現数: {total_missing}\n")

    if total_missing > 0:
        print("=== 未解決の変数一覧（出現数順） ===")
        for var_name, count in missing_vars_counter.most_common():
            print(f"  {var_name}: {count}回")
    else:
        print("\n完璧です！未解決の変数はすべて解消されました！")


if __name__ == "__main__":
    main()

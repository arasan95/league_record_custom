import json
with open('../tft_match_result_utf8.json', 'r', encoding='utf-8-sig') as f:
    d = json.load(f)
with open('../tft_match_result_clean.json', 'w', encoding='utf-8') as f:
    json.dump(d, f)

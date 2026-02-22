import json
import os
import glob

files = glob.glob('.vscode/record/*.json')
for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as file:
            data = json.load(file)
            if 'Metadata' in data and 'matchId' in data['Metadata']:
                print(f"{f}: {data['Metadata']['matchId']['gameId']}")
    except:
        pass

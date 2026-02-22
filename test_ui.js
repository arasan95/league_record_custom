import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('.vscode/record/2026-02-22_12-20.json', 'utf8'));
const meta = data.Metadata;
const queueName = meta.queue?.name ?? "Custom";
const qLower = queueName.toLowerCase();
let resolvedQueueName = queueName;

if (qLower.includes("tft") || qLower.includes("teamfight") || [1090, 1100, 1130, 1160, 1220].includes(meta.queue?.id ?? 0)) {
    resolvedQueueName = "TFT";
}
console.log("Resolved Queue Name:", resolvedQueueName);

// Test traits
const selfPart = meta.participants.find(p => p.participantId === meta.participantId);
if (selfPart?.traits) {
    const activeTraits = [...selfPart.traits].filter(t => t.tierCurrent > 0).sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits).slice(0, 5);
    console.log("ActiveTraits length:", activeTraits.length);
}

if (selfPart?.units) {
    const activeUnits = [...selfPart.units].slice(0, 10);
    console.log("ActiveUnits length:", activeUnits.length);
    for (const unit of activeUnits) {
        console.log("Star:", "".repeat(unit.tier));
    }
}
console.log("Test finished with no synchronous errors in processing data.");

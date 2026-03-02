const fs = require('fs');

const file1 = 'src/ts/datadragon.ts';
let c1 = fs.readFileSync(file1, 'utf8');

const target = '} else if (calc.mMultiplier && calc.mMultiplier.mDataValue) {';
const replacement = `} else if (calc.mMultiplier && calc.mMultiplier.__type === "NamedDataValueCalculationPart" && calc.mMultiplier.mDataValue) {
                                             const mData = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];
                                             if (mData) {
                                                  arr = arr.map((v, i) => {
                                                       const m = mData.length > i ? mData[i] : mData[mData.length - 1];
                                                       return typeof v === 'number' ? Math.round(v * m * 100)/100 : v;
                                                  });
                                             }
                                        } else if (calc.mMultiplier && calc.mMultiplier.mDataValue) {`;

if (c1.includes(target) && !c1.includes('NamedDataValueCalculationPart" && calc.mMultiplier.mDataValue')) {
    fs.writeFileSync(file1, c1.split(target).join(replacement), 'utf8');
    console.log('Patched ' + file1);
}

const file2 = 'tooltip_exports/other/export_all_tooltips.js';
let c2 = fs.readFileSync(file2, 'utf8');

if (c2.includes(target) && !c2.includes('NamedDataValueCalculationPart" && calc.mMultiplier.mDataValue')) {
    fs.writeFileSync(file2, c2.split(target).join(replacement), 'utf8');
    console.log('Patched ' + file2);
}

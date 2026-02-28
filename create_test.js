const fs = require('fs');
const exportScript = fs.readFileSync('tooltip_exports/other/export_all_tooltips.js', 'utf8');

const runCode = `
const fs = require('fs');
const cdData = JSON.parse(fs.readFileSync('Lucian_cd.json', 'utf8'));
let lucianR = null;
let cdDataValuesMap = {};
for (const k in cdData) {
    if (k.endsWith('/LucianR') && cdData[k].mSpell) {
        lucianR = cdData[k];
    }
}

if(lucianR && lucianR.mSpell.DataValues) {
    for (const dv of lucianR.mSpell.DataValues) {
        cdDataValuesMap[dv.mName.toLowerCase()] = dv.mValues;
    }
}
let cdCalcMap = {};
let cdIsPercentMap = {};
let processFormulaParts;
// extract function
${exportScript.split('processFormulaParts = ')[1].split('};')[0] + '};'}

// now run the loops
const cdSpellData = lucianR;
const targetCalcKey = 'totaldamage';

                     const cdBaseMap = {};
                     for (const calcKey in cdSpellData.mSpell.mSpellCalculations) {
                          const calc = cdSpellData.mSpell.mSpellCalculations[calcKey];
                          if (calc.mFormulaParts) {
                              for (const part of calc.mFormulaParts) {
                                   if (part.__type === "NamedDataValueCalculationPart" && part.mDataValue) {
                                       const dvKey = part.mDataValue.toLowerCase();
                                       if (cdDataValuesMap[dvKey]) {
                                           cdBaseMap[calcKey.toLowerCase()] = cdDataValuesMap[dvKey];
                                           break;
                                       }
                                   } else if (part.__type === "SumOfSubPartsCalculationPart" && part.mSubparts) {
                                        for (const sp of part.mSubparts) {
                                            if (sp.__type === "NamedDataValueCalculationPart" && sp.mDataValue) {
                                                const dvKey = sp.mDataValue.toLowerCase();
                                                if (cdDataValuesMap[dvKey]) {
                                                    cdBaseMap[calcKey.toLowerCase()] = cdDataValuesMap[dvKey];
                                                    break;
                                                }
                                            }
                                        }
                                   }
                              }
                          }
                          // Extract base value if mMultiplier contains the value directly like TotalNumShots
                          if (calc.mMultiplier && calc.mMultiplier.mDataValue) {
                               const dvKey = calc.mMultiplier.mDataValue.toLowerCase();
                               if (cdDataValuesMap[dvKey]) {
                                   cdBaseMap[calcKey.toLowerCase()] = cdDataValuesMap[dvKey];
                               }
                          }
                     }

                     for (const calcKey in cdSpellData.mSpell.mSpellCalculations) {
                          const calc = cdSpellData.mSpell.mSpellCalculations[calcKey];
                          if (calc.__type === "GameCalculationModified" && calc.mModifiedGameCalculation) {
                               const baseCalcKey = calc.mModifiedGameCalculation.toLowerCase();
                               if (cdBaseMap[baseCalcKey]) {
                                    let arr = [...cdBaseMap[baseCalcKey]];
                                    if (calc.mMultiplier && calc.mMultiplier.mNumber !== undefined) {
                                         arr = arr.map(v => typeof v === 'number' ? Math.round(v * calc.mMultiplier.mNumber * 100)/100 : v);
                                    } else if (calc.mMultiplier && calc.mMultiplier.mDataValue) {
                                         const mData = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];
                                         if (mData) {
                                              arr = arr.map((v, i) => {
                                                   const m = mData.length > i ? mData[i] : mData[mData.length - 1];
                                                   return typeof v === 'number' ? Math.round(v * m * 100)/100 : v;
                                              });
                                         }
                                    }
                                    cdBaseMap[calcKey.toLowerCase()] = arr;
                               }
                          }
                     }

                     for (const calcKey in cdSpellData.mSpell.mSpellCalculations) {
                          const calc = cdSpellData.mSpell.mSpellCalculations[calcKey];
                          const isPercent = calc.mDisplayAsPercent === true;
                          if (isPercent) cdIsPercentMap[calcKey.toLowerCase()] = true;
                          if (calc.mFormulaParts) processFormulaParts(calcKey, calc.mFormulaParts, isPercent);
                     }
                     
                     for (const calcKey in cdSpellData.mSpell.mSpellCalculations) {
                          const calc = cdSpellData.mSpell.mSpellCalculations[calcKey];
                          if (calc.__type === "GameCalculationModified" && calc.mModifiedGameCalculation && calc.mMultiplier) {
                               const baseCalcKey = calc.mModifiedGameCalculation;
                               const baseCalc = cdSpellData.mSpell.mSpellCalculations[baseCalcKey];
                               let multArray;
                               if (calc.mMultiplier.mDataValue) multArray = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];
                               else if (calc.mMultiplier.mNumber !== undefined) multArray = [calc.mMultiplier.mNumber];
                               else if (calc.mMultiplier.__type === "NamedDataValueCalculationPart" && calc.mMultiplier.mDataValue) multArray = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];

                               const isPercentModified = calc.mDisplayAsPercent || (baseCalc && baseCalc.mDisplayAsPercent);

                               if (baseCalc && baseCalc.mFormulaParts && multArray && multArray.length > 0) {
                                    if (isPercentModified) cdIsPercentMap[calcKey.toLowerCase()] = true;
                                    processFormulaParts(calcKey, baseCalc.mFormulaParts, isPercentModified, multArray);
                               } else if (calc.mMultiplier.__type === "SumOfSubPartsCalculationPart" && calc.mMultiplier.mSubparts) {
                                    let actualMultArray = cdBaseMap[baseCalcKey.toLowerCase()];
                                    if (!actualMultArray && cdDataValuesMap[baseCalcKey.toLowerCase()]) {
                                        actualMultArray = cdDataValuesMap[baseCalcKey.toLowerCase()];
                                    }
                                    if (!actualMultArray) actualMultArray = [1]; // fallback so it at least parses AD/AP strings
                                    
                                    if (isPercentModified) cdIsPercentMap[calcKey.toLowerCase()] = true;
                                    processFormulaParts(calcKey, calc.mMultiplier.mSubparts, isPercentModified, actualMultArray);
                               }
                          }
                     }
console.log("cdBaseMap:", cdBaseMap);
console.log("totaldamage resolved string:", cdCalcMap['totaldamage']);

`;

fs.writeFileSync('test_lucian.cjs', runCode);

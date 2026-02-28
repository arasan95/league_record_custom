const fs = require("fs");

async function run() {
    console.log("Fetching DD version...");
    const vRes = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    const versions = await vRes.json();
    const v = versions[0];
    const lang = "ja_JP";

    console.log(`Using DD version: ${v}`);
    const ddChampListRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/${lang}/champion.json`);
    const ddChampList = await ddChampListRes.json();
    const champs = Object.keys(ddChampList.data);

    let cdAllData = null;
    let fallbackToIndividual = false;

    // Try heavy bulk CDragon fetch or fallback to individual
    const brokenList = [];
    const allTooltips = [];
    
    let fallbackMappings = {};
    if (fs.existsSync('./tooltip_exports/fallback_mappings.json')) {
        fallbackMappings = JSON.parse(fs.readFileSync('./tooltip_exports/fallback_mappings.json', 'utf8'));
    }

    const delay = ms => new Promise(res => setTimeout(res, ms));

    for (let i = 0; i < champs.length; i++) {
        const champ = champs[i];
        console.log(`Processing ${champ} (${i+1}/${champs.length})...`);
        try {
            const ddChampRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/${lang}/champion/${champ}.json`);
            const ddChampExt = await ddChampRes.json();
            const ddSpells = ddChampExt.data[champ].spells;

            const cdUrl = `https://raw.communitydragon.org/latest/game/data/characters/${champ.toLowerCase()}/${champ.toLowerCase()}.bin.json`;
            const cdChampRes = await fetch(cdUrl);
            const cdChampExt = cdChampRes.ok ? await cdChampRes.json() : {};
            if (['Darius', 'Fizz', 'Kaisa'].includes(champ)) {
                fs.writeFileSync(champ + '_cdragon.json', JSON.stringify(cdChampExt, null, 2));
            }

            for (const spell of ddSpells) {
                // Mimic datadragon.ts extraction
                let cdSpellData = null;
                const searchKeys = [
                    `Characters/${champ}/Spells/${spell.id}Ability/${spell.id}`,
                    `Characters/${champ}/Spells/${spell.id}`
                ];
                for (const key of searchKeys) {
                    if (cdChampExt[key] && cdChampExt[key].mSpell) {
                         cdSpellData = cdChampExt[key]; break;
                    }
                }
                if (!cdSpellData) {
                    const keys = Object.keys(cdChampExt);
                    for (const k of keys) {
                        if (k.includes(spell.id) && cdChampExt[k].mSpell) {
                            cdSpellData = cdChampExt[k]; break;
                        }
                    }
                }
                if (!cdSpellData) {
                    // Try looking up by Tooltip locKey if we can't find by ID
                    const keys = Object.keys(cdChampExt);
                    for(const k of keys) {
                         const s = cdChampExt[k].mSpell;
                         if (s && s.mClientData && s.mClientData.mTooltipData && s.mClientData.mTooltipData.mLocKeys) {
                             const locName = s.mClientData.mTooltipData.mLocKeys.keyName || "";
                             if (locName.toLowerCase().includes(spell.id.toLowerCase())) {
                                 cdSpellData = cdChampExt[k]; break;
                             }
                         }
                    }
                }

                if (!cdSpellData) cdSpellData = { mSpell: {} }; // Fallback

                const cdDataValuesMap = {};
                if (cdSpellData.mSpell.DataValues) {
                    for (const dv of cdSpellData.mSpell.DataValues) {
                         if (dv.mName && dv.mValues && Array.isArray(dv.mValues)) {
                              cdDataValuesMap[dv.mName.toLowerCase()] = dv.mValues;
                         }
                    }
                }
                const cdIsPercentMap = {};
                const cdCalcMap = {};

                if (cdSpellData.mSpell.mSpellCalculations) {
                     const processFormulaParts = (targetCalcKey, formulaParts, isPercent, arrayMultiplier) => {
                          const localScalings = [];
                          for (const part of formulaParts) {
                              if (part.__type === "StatByCoefficientCalculationPart" && part.mCoefficient) {
                                  let statMatch = part.mStat ? String(part.mStat).replace(/.*\\./, "") : "Stat";
                                  const formId = String(part.mStatFormula);
                                  const statId = String(part.mStat);

                                  if (statMatch.includes("AttackDamage") || statId === "2" || formId === "2") statMatch = "AD";
                                  else if (statMatch.includes("AbilityPower") || statId === "1" || formId === "1") statMatch = "AP";
                                  else if (statMatch.includes("Health") || statId === "11") statMatch = "HP";
                                  else if (statMatch.includes("Armor") || statId === "5") statMatch = "Armor";
                                  else if (statMatch.includes("SpellBlock") || statMatch.includes("MagicResist") || statId === "6") statMatch = "MR";
                                  
                                  let coeff = part.mCoefficient;
                                  if (isPercent) coeff *= 100;
                                  
                                  if (arrayMultiplier && arrayMultiplier.length > 0) {
                                      const maxRank = spell.maxrank || 5;
                                      let mults = arrayMultiplier;
                                      if (mults.length > maxRank) mults = mults.slice(1, maxRank + 1);
                                      const allSame = mults.every(v => v === mults[0]);
                                      if (allSame || mults.length === 0) {
                                          const mNum = mults.length > 0 ? mults[0] : 1;
                                          localScalings.push(`+${Math.round(coeff * mNum * 100)}% ${statMatch}`);
                                      } else {
                                          const joined = mults.map(m => Math.round(coeff * m * 100)).join('/');
                                          localScalings.push(`+${joined}% ${statMatch}`);
                                      }
                                  } else {
                                      localScalings.push(`+${Math.round(coeff * 100)}% ${statMatch}`);
                                  }
                              }

                              if (part.__type === "NamedDataValueCalculationPart" && part.mDataValue) {
                                   const dvKey = part.mDataValue.toLowerCase();
                                   if (cdDataValuesMap[dvKey]) {
                                        let arr = [...cdDataValuesMap[dvKey]];
                                        if (isPercent) arr = arr.map(v => typeof v === 'number' ? Math.round(v * 1000) / 10 : v);
                                        if (arrayMultiplier && arrayMultiplier.length > 0) {
                                            arr = arr.map((v, i) => {
                                                const m = arrayMultiplier.length > i ? arrayMultiplier[i] : arrayMultiplier[arrayMultiplier.length - 1];
                                                return typeof v === 'number' ? Math.round(v * m * 100)/100 : v;
                                            });
                                        }
                                        cdDataValuesMap[targetCalcKey.toLowerCase()] = arr;
                                   }
                              }

                              let namedPart = null;
                              if (part.__type === "StatByNamedDataValueCalculationPart") namedPart = part;
                              else if (part.__type === "StatBySubPartCalculationPart" && part.mSubpart && part.mSubpart.__type === "NamedDataValueCalculationPart") {
                                   namedPart = { mDataValue: part.mSubpart.mDataValue, mStat: part.mStat, mStatFormula: part.mStatFormula };
                              }
                              else if (part.__type === "StatBySubPartCalculationPart" && part.mSubpart && part.mSubpart.__type === "EffectValueCalculationPart") {
                                   const effectIdx = part.mSubpart.mEffectIndex;
                                   if (spell.effect && spell.effect[effectIdx]) {
                                       let statMatch = "Stat";
                                       const statId = String(part.mStat);
                                       const formId = String(part.mStatFormula);
                                       if (statId === "2" || formId === "2") statMatch = "AD";
                                       else if (statId === "1" || formId === "1") statMatch = "AP";

                                       const maxRank = spell.maxrank || 5;
                                       let ranks = spell.effect[effectIdx].filter(v => v !== null);
                                       if (ranks.length > maxRank) ranks = ranks.slice(0, maxRank);

                                       if (arrayMultiplier && arrayMultiplier.length > 0) {
                                           let mults = arrayMultiplier;
                                           if (mults.length > maxRank) mults = mults.slice(0, maxRank);
                                           ranks = ranks.map((rVal, idx) => {
                                               const m = mults.length > idx ? mults[idx] : mults[mults.length-1];
                                               return typeof rVal === 'number' ? rVal * m : rVal;
                                           });
                                       }

                                       const allSame = ranks.every(v => v === ranks[0]);
                                       const multiplier = isPercent ? 10000 : 100;
                                       if (allSame || ranks.length === 0) {
                                           const coeff = ranks.length > 0 ? ranks[0] : 0;
                                           localScalings.push(`+${Math.round(coeff * multiplier)}% ${statMatch}`);
                                       } else {
                                           const joined = ranks.map(v => Math.round(v * multiplier)).join('/');
                                           localScalings.push(`+${joined}% ${statMatch}`);
                                       }
                                   }
                              }

                              if (namedPart && namedPart.mDataValue) {
                                   const dvKey = namedPart.mDataValue.toLowerCase();
                                   if (cdDataValuesMap[dvKey] && cdDataValuesMap[dvKey].length > 0) {
                                        let statMatch = namedPart.mDataValue;
                                        const statId = String(namedPart.mStat);
                                        const formId = String(namedPart.mStatFormula);
                                        if (statMatch.includes("ADRatio") || statId === "2" || formId === "2") statMatch = "AD";
                                        else if (statMatch.includes("APRatio") || statId === "1" || formId === "1") statMatch = "AP";
                                        else statMatch = "Stat";

                                        const maxRank = spell.maxrank || 5;
                                        let ranks = cdDataValuesMap[dvKey];
                                        if (ranks.length > maxRank) ranks = ranks.slice(1, maxRank + 1);

                                        if (arrayMultiplier && arrayMultiplier.length > 0) {
                                            let mults = arrayMultiplier;
                                            if (mults.length > maxRank) mults = mults.slice(0, maxRank);
                                            ranks = ranks.map((rVal, idx) => {
                                                const m = mults.length > idx ? mults[idx] : mults[mults.length-1];
                                                return typeof rVal === 'number' ? rVal * m : rVal;
                                            });
                                        }

                                        const allSame = ranks.every(v => v === ranks[0]);
                                        const multiplier = isPercent ? 10000 : 100;
                                        if (allSame || ranks.length === 0) {
                                            const coeff = ranks.length > 0 ? ranks[0] : 0;
                                            localScalings.push(`+${Math.round(coeff * multiplier)}% ${statMatch}`);
                                        } else {
                                            const joined = ranks.map(v => Math.round(v * multiplier)).join('/');
                                            localScalings.push(`+${joined}% ${statMatch}`);
                                        }
                                   }
                              }
                          }
                          if (localScalings.length > 0) cdCalcMap[targetCalcKey.toLowerCase()] = localScalings.join(" ");
                     };

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
                     cdSpellData.mSpell.cd_baseMap = cdBaseMap;
                }
                
                spell.cd_dataValuesMap = cdDataValuesMap;
                spell.cd_calcMap = cdCalcMap;
                spell.cd_isPercentMap = cdIsPercentMap;
                spell.cd_baseMap = (cdSpellData.mSpell && cdSpellData.mSpell.cd_baseMap) ? cdSpellData.mSpell.cd_baseMap : {};

                // Mimic ui.ts interpolation
                const resolveVar = (key) => {
                     key = key.toLowerCase();
                     if (key.startsWith('e')) {
                         const idx = parseInt(key.substring(1), 10);
                         if (!isNaN(idx) && spell.effectBurn && spell.effectBurn[idx]) return [spell.effectBurn[idx]];
                     }
                     if (spell.vars) {
                         for (const v of spell.vars) {
                              if (v.key && v.key.toLowerCase() === key) return v.coeff;
                         }
                     }
                     
                     if (spell.cd_dataValuesMap) {
                         if (spell.cd_dataValuesMap[key]) return spell.cd_dataValuesMap[key];
                         const keys = Object.keys(spell.cd_dataValuesMap);
                         for (const k of keys) {
                              if (k === `m${key}` || k.includes(key)) return spell.cd_dataValuesMap[k];
                         }
                     }
                     
                     if (spell.cd_baseMap) {
                         if (spell.cd_baseMap[key]) return spell.cd_baseMap[key];
                         const keys = Object.keys(spell.cd_baseMap);
                         for (const k of keys) {
                              if (k === `m${key}` || k.includes(key)) return spell.cd_baseMap[k];
                         }
                     }

                     if (key.length > 2 && /^[qwer]/i.test(key)) {
                          const noPrefix = key.substring(1);
                          if (spell.cd_dataValuesMap) {
                              if (spell.cd_dataValuesMap[noPrefix]) return spell.cd_dataValuesMap[noPrefix];
                              for (const k of Object.keys(spell.cd_dataValuesMap)) {
                                  if (k === `m${noPrefix}` || k.includes(noPrefix)) return spell.cd_dataValuesMap[k];
                              }
                          }
                          if (spell.cd_baseMap) {
                              if (spell.cd_baseMap[noPrefix]) return spell.cd_baseMap[noPrefix];
                              for (const k of Object.keys(spell.cd_baseMap)) {
                                  if (k === `m${noPrefix}` || k.includes(noPrefix)) return spell.cd_baseMap[k];
                              }
                          }
                     }

                     if (key === 'cost') return [spell.costBurn];
                     if (key === 'cooldown') return [spell.cooldownBurn];
                     
                     // Manual override for Darius Q and W
                     if (spell.id === "DariusCleave") {
                         if (key === "bladedamage" && spell.effect && spell.effect[2] && spell.effect[1]) {
                              const base = spell.effect[2].join("/");
                              const adRatio = spell.effect[1].join("/");
                              return [`${base} + (${adRatio}%AD)`];
                         }
                         if (key === "handledamage" && spell.effect && spell.effect[2] && spell.effect[1]) {
                              const pctMult = (spell.effect[6] && typeof spell.effect[6][0] === 'number') ? spell.effect[6][0] / 100 : 0.35;
                              const cleanNum = (n) => Math.round(n * 10) / 10;
                              
                              const handleBase = spell.effect[2].map(v => cleanNum(v * pctMult)).join("/");
                              const handleRatio = spell.effect[1].map(v => cleanNum(v * pctMult)).join("/");
                              return [`${handleBase} + (${handleRatio}%AD)`];
                         }
                     }
                     if (spell.id === "DariusNoxianTacticsONH") {
                         if (key === "empoweredattackdamage" && spell.effect && spell.effect[4]) {
                              const adPct = spell.effect[4].map(v => Math.round((v - 1) * 100)).join("/");
                              return [`${adPct}%AD`];
                         }
                     }
                     return null;
                };

                const formatArrayObj = (ranks) => {
                     if (!ranks || ranks.length === 0) return "?";
                     let actualRanks = ranks;
                     if (ranks.length > 5) {
                         const maxRank = spell.maxrank || 5;
                         actualRanks = ranks.slice(1, maxRank + 1);
                     }
                     if (actualRanks.length === 0) return "?";
                     const cleanNum = (n) => typeof n === 'number' ? Math.round(n * 100) / 100 : n;
                     const cleanedRanks = actualRanks.map(cleanNum);
                     const allSame = cleanedRanks.every((v) => v === cleanedRanks[0]);
                     if (allSame) return cleanedRanks[0].toString();
                     return cleanedRanks.join('/');
                };

                const evalMath = (expression, varsMap) => {
                    try {
                        let expr = expression;
                        for (const [k, v] of Object.entries(varsMap)) expr = expr.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
                        if (!/^[0-9+\-*\/\(\)\.\s]+$/.test(expr)) return null;
                        const res = new Function(`return ${expr}`)();
                        return (typeof res === 'number' && !isNaN(res)) ? Math.round(res * 100) / 100 : null;
                    } catch (e) { 
                        return null; 
                    }
                };

                let desc = spell.tooltip || spell.description;
                if (!desc) continue;
                
                const failMatches = [];
                const evaluatedHtml = desc.replace(/\{\{\s*(.*?)\s*\}\}/gi, (match, p1, offset, fullStr) => {
                    const expr = p1.trim().toLowerCase();
                    if (expr === 'spellmodifierdescriptionappend') return "";
                    
                    if (fallbackMappings[spell.id] && fallbackMappings[spell.id][expr]) {
                        return fallbackMappings[spell.id][expr];
                    }

                    const nextChar = fullStr.charAt(offset + match.length);
                    const isPercentFlagged = spell.cd_isPercentMap && spell.cd_isPercentMap[expr];

                    if (/^[a-z0-9_]+$/.test(expr)) {
                        const resolvedArr = resolveVar(expr);
                        let valStr = "?";
                        if (resolvedArr) {
                            valStr = formatArrayObj(resolvedArr);
                            if (isPercentFlagged && nextChar !== '%') valStr += '%';
                        }
                        if (spell.cd_calcMap && spell.cd_calcMap[expr]) {
                            valStr += ` (${spell.cd_calcMap[expr]})`;
                        }
                        if (valStr.includes('?')) failMatches.push(expr);
                        return valStr;
                    }

                    // Math evaluation fallback omitted for simplicity, but if the final result is ?, we mark it
                    const varRefs = expr.match(/[a-z0-9_]+/gi);
                    if (varRefs) {
                        const vMap = {};
                        let missing = false;
                        for (const vName of varRefs) {
                             if (!isNaN(parseFloat(vName))) continue;
                             const valArr = resolveVar(vName);
                             
                             if (!valArr || valArr.length === 0) { missing = true; break; }
                             vMap[vName] = valArr[0]; // Take base rank for math
                        }
                        if (!missing) {
                             const r = evalMath(expr, vMap);
                             if (r !== null) return String(r);
                        }
                    }
                    failMatches.push(expr);
                    return "?";
                });

                allTooltips.push({
                    champion: champ,
                    spell: spell.id,
                    hasQuestionMark: evaluatedHtml.includes('?'),
                    missingVariables: failMatches,
                    tooltipBase: spell.tooltip,
                    tooltipEvaluated: evaluatedHtml
                });
            }
            // slight delay to prevent rate limit on raw.communitydragon
            await delay(50);

        } catch (e) {
            console.error(`Error on ${champ}:`, e);
        }
    }

    fs.mkdirSync('./tooltip_exports', { recursive: true });
    fs.writeFileSync('./tooltip_exports/all_tooltips.json', JSON.stringify(allTooltips, null, 2));
    console.log(`Scan complete! Evaluated ${allTooltips.length} tooltips. Saved to tooltip_exports/all_tooltips.json.`);
}

run();

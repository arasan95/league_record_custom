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

                const resolveStatName = (mStat, mStatFormula, dataValueName) => {
                    const sid = String(mStat || ''); const fid = String(mStatFormula || ''); const dvn = (dataValueName || '').toLowerCase();
                    if (sid.includes('AttackDamage') || sid === '2' || fid === '2') return 'AD';
                    if (sid.includes('BonusAttackDamage') || sid === '14' || fid === '14') return '増加AD';
                    if (sid.includes('AbilityPower') || sid === '1' || fid === '1' || sid === '100') return 'AP';
                    if (sid.includes('BonusHealth') || sid === '12') return '増加体力';
                    if (sid.includes('Health') || sid === '0' || sid === '11') return '最大体力';
                    if (sid.includes('Armor') || sid === '5') return '物理防御';
                    if (sid.includes('BonusArmor') || sid === '17') return '増加物理防御';
                    if (sid.includes('SpellBlock') || sid.includes('MagicResist') || sid === '6') return '魔法防御';
                    if (sid.includes('BonusMagicResist') || sid === '18') return '増加魔法防御';
                    if (sid.includes('AttackSpeed') || sid === '3' || sid === '36') return '攻撃速度';
                    if (sid.includes('MoveSpeed') || sid === '4') return '移動速度';
                    if (sid.includes('CritChance') || sid === '7') return 'クリティカル率';
                    if (sid.includes('CritDamage') || sid === '8') return 'クリティカルダメージ';
                    if (sid.includes('LifeSteal') || sid === '10') return 'ライフスティール';
                    if (sid.includes('Lethality') || sid === '15') return '脅威';
                    if (sid === '9') return 'スキルヘイスト';
                    // Fallback: check DataValue name for hints
                    if (dvn.includes('ad') || dvn.includes('attack')) return 'AD';
                    if (dvn.includes('ap') || dvn.includes('ability')) return 'AP';
                    if (dvn.includes('hp') || dvn.includes('health')) return '体力';
                    return 'AD'; // default to AD instead of 'Stat'
                };

                if (cdSpellData.mSpell.mSpellCalculations) {
                     const processFormulaParts = (targetCalcKey, formulaParts, isPercent, arrayMultiplier) => {
                          const localScalings = [];
                          for (const part of formulaParts) {
                              if (part.__type === "StatByCoefficientCalculationPart" && part.mCoefficient) {
                                  let statMatch = resolveStatName(part.mStat, part.mStatFormula);
                                  
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

                              if (namedPart && namedPart.mDataValue) {
                                   const dvKey = namedPart.mDataValue.toLowerCase();
                                   if (cdDataValuesMap[dvKey] && cdDataValuesMap[dvKey].length > 0) {
                                        let statMatch = resolveStatName(namedPart.mStat, namedPart.mStatFormula, namedPart.mDataValue);

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

                               if (baseCalc && baseCalc.mFormulaParts && multArray && multArray.length > 0) {
                                    const isPercent = calc.mDisplayAsPercent || baseCalc.mDisplayAsPercent;
                                    if (isPercent) cdIsPercentMap[calcKey.toLowerCase()] = true;
                                    processFormulaParts(calcKey, baseCalc.mFormulaParts, isPercent, multArray);
                               }
                          }
                     }

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
                                   }
                              }
                          } else if (calc.__type === "GameCalculationModified" && calc.mModifiedGameCalculation) {
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
                     cdSpellData.mSpell.cd_baseMap = cdBaseMap;
                }
                
                spell.cd_dataValuesMap = cdDataValuesMap;
                spell.cd_calcMap = cdCalcMap;
                spell.cd_isPercentMap = cdIsPercentMap;
                spell.cd_baseMap = (cdSpellData.mSpell && cdSpellData.mSpell.cd_baseMap) ? cdSpellData.mSpell.cd_baseMap : {};

                // Mimic ui.ts interpolation
                const resolveVar = (key) => {
                     key = key.toLowerCase();

                     // 0. Handle cross-spell references: spell.gnarq:minitotaldamage
                     if (key.includes(':')) {
                         const [spellRef, varName] = key.split(':');
                         const spellPrefix = spellRef.replace('spell.', '');
                         // Find the other spell's CDragon data
                         const otherKeys = Object.keys(cdChampExt);
                         for (const ok of otherKeys) {
                             if (ok.toLowerCase().includes(spellPrefix.toLowerCase()) && cdChampExt[ok].mSpell) {
                                 const otherSpell = cdChampExt[ok].mSpell;
                                 // Build a temporary DataValues map for the other spell
                                 const otherDV = {};
                                 if (otherSpell.DataValues) {
                                     for (const dv of otherSpell.DataValues) {
                                         if (dv.mName && dv.mValues) otherDV[dv.mName.toLowerCase()] = dv.mValues;
                                     }
                                 }
                                 // Also add flat fields from mSpell
                                 for (const sk in otherSpell) {
                                     const sv = otherSpell[sk];
                                     if (typeof sv === 'number') otherDV[sk.toLowerCase()] = [sv];
                                     else if (Array.isArray(sv) && typeof sv[0] === 'number') otherDV[sk.toLowerCase()] = sv;
                                 }
                                 // Check mSpellCalculations of the other spell too
                                 if (otherSpell.mSpellCalculations) {
                                     for (const ck in otherSpell.mSpellCalculations) {
                                         const calc = otherSpell.mSpellCalculations[ck];
                                         if (calc.mFormulaParts) {
                                             for (const part of calc.mFormulaParts) {
                                                 if (part.__type === "NamedDataValueCalculationPart" && part.mDataValue) {
                                                     const dvKey = part.mDataValue.toLowerCase();
                                                     if (otherDV[dvKey]) {
                                                         otherDV[ck.toLowerCase()] = otherDV[dvKey];
                                                     }
                                                 }
                                             }
                                         }
                                     }
                                 }

                                 const vn = varName.toLowerCase();
                                 if (otherDV[vn]) return otherDV[vn];
                                 // Fuzzy match
                                 for (const k of Object.keys(otherDV)) {
                                     if (k.includes(vn)) return otherDV[k];
                                 }
                                 // Check mEffectAmount for effect-style references
                                 if (otherSpell.mEffectAmount && vn.startsWith('effect') && vn.endsWith('amount')) {
                                     const idx = parseInt(vn.replace('effect', '').replace('amount', ''), 10);
                                     if (!isNaN(idx) && otherSpell.mEffectAmount[idx] && otherSpell.mEffectAmount[idx].value) {
                                         return otherSpell.mEffectAmount[idx].value;
                                     }
                                 }
                                 break;
                             }
                         }
                         return null;
                     }

                     // 1. effectBurn
                     if (key.startsWith('e')) {
                         const idx = parseInt(key.substring(1), 10);
                         if (!isNaN(idx) && spell.effectBurn && spell.effectBurn[idx]) return [spell.effectBurn[idx]];
                     }

                     // 2. DDragon vars (a1, f1, etc)
                     if (spell.vars) {
                         for (const v of spell.vars) {
                              if (v.key && v.key.toLowerCase() === key) return v.coeff;
                         }
                     }

                     // 2b. f-variables from mEffectAmount
                     if (key.startsWith('f') && cdSpellData.mSpell && cdSpellData.mSpell.mEffectAmount) {
                         const fMatch = key.match(/^f(\d+)(?:\.(\d+))?$/);
                         if (fMatch) {
                             const idx = parseInt(fMatch[1], 10);
                             const subIdx = fMatch[2] !== undefined ? parseInt(fMatch[2], 10) : null;
                             if (cdSpellData.mSpell.mEffectAmount[idx]) {
                                 const ea = cdSpellData.mSpell.mEffectAmount[idx];
                                 if (ea.value) {
                                     if (subIdx !== null) return [ea.value[subIdx]];
                                     return ea.value;
                                 }
                             }
                         }
                     }
                     
                     // 3. CDragon DataValues
                     if (spell.cd_dataValuesMap) {
                         if (spell.cd_dataValuesMap[key]) return spell.cd_dataValuesMap[key];
                         const keys = Object.keys(spell.cd_dataValuesMap);
                         for (const k of keys) {
                              if (k === `m${key}` || k.includes(key)) return spell.cd_dataValuesMap[k];
                         }
                     }
                     
                     // 4. CDragon BaseMap
                     if (spell.cd_baseMap) {
                         if (spell.cd_baseMap[key]) return spell.cd_baseMap[key];
                         const keys = Object.keys(spell.cd_baseMap);
                         for (const k of keys) {
                              if (k === `m${key}` || k.includes(key)) return spell.cd_baseMap[k];
                         }
                     }

                     // 5. Strip spell-slot prefix
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

                     // 6. Check flat numeric fields directly from cdSpellData.mSpell
                     if (cdSpellData.mSpell) {
                         for (const sk in cdSpellData.mSpell) {
                             if (sk.toLowerCase() === key) {
                                 const sv = cdSpellData.mSpell[sk];
                                 if (typeof sv === 'number') return [sv];
                                 if (Array.isArray(sv) && typeof sv[0] === 'number') return sv;
                             }
                         }
                     }

                     if (key === 'cost') return [spell.costBurn];
                     if (key === 'cooldown') return [spell.cooldownBurn];
                     
                     // Manual override for Darius Q
                     if (spell.id === "DariusCleave") {
                         if (key === "bladedamage" && spell.effect[2]) {
                             return spell.effect[2];
                         }
                         if (key === "handledamage" && spell.effect[2]) {
                             const mult = (spell.effect[6] && typeof spell.effect[6] === 'number') ? spell.effect[6] / 100 : 0.35;
                             return spell.effect[2].map(v => v * mult);
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

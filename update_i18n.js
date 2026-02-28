import fs from 'fs';

const i18nPath = 'src/ts/i18n.ts';
let content = fs.readFileSync(i18nPath, 'utf8');

const stats = {
  en: {
    statAD: "AD", statBonusAD: "Bonus AD", statAP: "AP", statHealth: "Health", statBonusHealth: "Bonus Health",
    statArmor: "Armor", statBonusArmor: "Bonus Armor", statMagicResist: "MR", statBonusMagicResist: "Bonus MR",
    statAttackSpeed: "Attack Speed", statMoveSpeed: "Move Speed", statCritChance: "Crit Chance", statCritDamage: "Crit Damage",
    statLifeSteal: "Life Steal", statLethality: "Lethality", statAbilityHaste: "Ability Haste"
  },
  ja: {
    statAD: "AD", statBonusAD: "増加AD", statAP: "AP", statHealth: "体力", statBonusHealth: "増加体力",
    statArmor: "物理防御", statBonusArmor: "増加物理防御", statMagicResist: "魔法防御", statBonusMagicResist: "増加魔法防御",
    statAttackSpeed: "攻撃速度", statMoveSpeed: "移動速度", statCritChance: "クリティカル率", statCritDamage: "クリティカルダメージ",
    statLifeSteal: "ライフスティール", statLethality: "脅威", statAbilityHaste: "スキルヘイスト"
  },
  zh: {
    statAD: "攻击力", statBonusAD: "额外攻击力", statAP: "法术强度", statHealth: "生命值", statBonusHealth: "额外生命值",
    statArmor: "护甲", statBonusArmor: "额外护甲", statMagicResist: "魔抗", statBonusMagicResist: "额外魔抗",
    statAttackSpeed: "攻击速度", statMoveSpeed: "移动速度", statCritChance: "暴击几率", statCritDamage: "暴击伤害",
    statLifeSteal: "生命偷取", statLethality: "穿甲", statAbilityHaste: "技能急速"
  },
  ko: {
    statAD: "공격력", statBonusAD: "추가 공격력", statAP: "주문력", statHealth: "체력", statBonusHealth: "추가 체력",
    statArmor: "방어력", statBonusArmor: "추가 방어력", statMagicResist: "마법 저항력", statBonusMagicResist: "추가 마법 저항력",
    statAttackSpeed: "공격 속도", statMoveSpeed: "이동 속도", statCritChance: "치명타 확률", statCritDamage: "치명타 피해량",
    statLifeSteal: "생명력 흡수", statLethality: "물리 관통력", statAbilityHaste: "스킬 가속"
  },
  vi: {
    statAD: "SMCK", statBonusAD: "SMCK Cộng Thêm", statAP: "SMPT", statHealth: "Máu", statBonusHealth: "Máu Cộng Thêm",
    statArmor: "Giáp", statBonusArmor: "Giáp Cộng Thêm", statMagicResist: "Kháng Phép", statBonusMagicResist: "Kháng Phép Cộng Thêm",
    statAttackSpeed: "Tốc Độ Đánh", statMoveSpeed: "Tốc Độ Di Chuyển", statCritChance: "Tỉ Lệ Chí Mạng", statCritDamage: "Sát Thương Chí Mạng",
    statLifeSteal: "Hút Máu", statLethality: "Sát Lực", statAbilityHaste: "Điểm Hồi Kỹ Năng"
  },
  pt: {
    statAD: "DdA", statBonusAD: "DdA Bônus", statAP: "PdH", statHealth: "Vida", statBonusHealth: "Vida Bônus",
    statArmor: "Armadura", statBonusArmor: "Armadura Bônus", statMagicResist: "RM", statBonusMagicResist: "RM Bônus",
    statAttackSpeed: "Velocidade de Ataque", statMoveSpeed: "Velocidade de Movimento", statCritChance: "Chance de Acerto Crítico", statCritDamage: "Dano Crítico",
    statLifeSteal: "Roubo de Vida", statLethality: "Letalidade", statAbilityHaste: "Aceleração de Habilidade"
  },
  es: {
    statAD: "DA", statBonusAD: "DA Adicional", statAP: "PH", statHealth: "Vida", statBonusHealth: "Vida Adicional",
    statArmor: "Armadura", statBonusArmor: "Armadura Adicional", statMagicResist: "RM", statBonusMagicResist: "RM Adicional",
    statAttackSpeed: "Velocidad de Ataque", statMoveSpeed: "Velocidad de Movimiento", statCritChance: "Probabilidad de Crítico", statCritDamage: "Daño Crítico",
    statLifeSteal: "Robo de Vida", statLethality: "Letalidad", statAbilityHaste: "Aceleración de Habilidad"
  },
  fr: {
    statAD: "Dégâts d'Attaque", statBonusAD: "Dégâts d'Attaque Bonus", statAP: "Puissance", statHealth: "PV", statBonusHealth: "PV Bonus",
    statArmor: "Armure", statBonusArmor: "Armure Bonus", statMagicResist: "Résistance Magique", statBonusMagicResist: "Résistance Magique Bonus",
    statAttackSpeed: "Vitesse d'Attaque", statMoveSpeed: "Vitesse de Déplacement", statCritChance: "Chances de Coup Critique", statCritDamage: "Dégâts Critiques",
    statLifeSteal: "Vol de Vie", statLethality: "Létalité", statAbilityHaste: "Accélération de Compétence"
  },
  de: {
    statAD: "Angriffsschaden", statBonusAD: "Zusätzlicher Angriffsschaden", statAP: "Fähigkeitsstärke", statHealth: "Leben", statBonusHealth: "Zusätzliches Leben",
    statArmor: "Rüstung", statBonusArmor: "Zusätzliche Rüstung", statMagicResist: "Magieresistenz", statBonusMagicResist: "Zusätzliche Magieresistenz",
    statAttackSpeed: "Angriffstempo", statMoveSpeed: "Lauftempo", statCritChance: "Kritische Trefferchance", statCritDamage: "Kritischer Trefferschaden",
    statLifeSteal: "Lebensraub", statLethality: "Tödlichkeit", statAbilityHaste: "Fähigkeitstempo"
  },
  ru: {
    statAD: "Сила Атаки", statBonusAD: "Доп. Сила Атаки", statAP: "Сила Умений", statHealth: "Здоровье", statBonusHealth: "Доп. Здоровье",
    statArmor: "Броня", statBonusArmor: "Доп. Броня", statMagicResist: "Сопротивление Магии", statBonusMagicResist: "Доп. Сопротивление Магии",
    statAttackSpeed: "Скорость Атаки", statMoveSpeed: "Скорость Передвижения", statCritChance: "Шанс Крит. Удара", statCritDamage: "Критический Урон",
    statLifeSteal: "Вампиризм", statLethality: "Смертоносность", statAbilityHaste: "Ускорение Умений"
  },
  tr: {
    statAD: "Saldırı Gücü", statBonusAD: "İlave Saldırı Gücü", statAP: "Yetenek Gücü", statHealth: "Can", statBonusHealth: "İlave Can",
    statArmor: "Zırh", statBonusArmor: "İlave Zırh", statMagicResist: "Büyü Direnci", statBonusMagicResist: "İlave Büyü Direnci",
    statAttackSpeed: "Saldırı Hızı", statMoveSpeed: "Hareket Hızı", statCritChance: "Kritik Vuruş İhtimali", statCritDamage: "Kritik Vuruş Hasarı",
    statLifeSteal: "Can Çalma", statLethality: "Zırh Deşme", statAbilityHaste: "Yetenek Hızı"
  },
  pl: {
    statAD: "Obrażenia od Ataku", statBonusAD: "Dodatkowe Obrażenia od Ataku", statAP: "Moc Umiejętności", statHealth: "Zdrowie", statBonusHealth: "Dodatkowe Zdrowie",
    statArmor: "Pancerz", statBonusArmor: "Dodatkowy Pancerz", statMagicResist: "Odporność na Magię", statBonusMagicResist: "Dodatkowa Odporność",
    statAttackSpeed: "Prędkość Ataku", statMoveSpeed: "Prędkość Ruchu", statCritChance: "Szansa na Trafienie Krytyczne", statCritDamage: "Obrażenia Krytyczne",
    statLifeSteal: "Kradzież Życia", statLethality: "Defensywność", statAbilityHaste: "Przyspieszenie Umiejętności"
  },
  it: {
    statAD: "Attacco Fisico", statBonusAD: "Attacco Fisico Bonus", statAP: "Potere Magico", statHealth: "Salute", statBonusHealth: "Salute Bonus",
    statArmor: "Armatura", statBonusArmor: "Armatura Bonus", statMagicResist: "Resistenza Magica", statBonusMagicResist: "Resistenza Magica Bonus",
    statAttackSpeed: "Velocità d'Attacco", statMoveSpeed: "Velocità di Movimento", statCritChance: "Probabilità di Colpo Critico", statCritDamage: "Danni Critici",
    statLifeSteal: "Rubavita", statLethality: "Letalità", statAbilityHaste: "Velocità abilità"
  }
};

for (const [lang, translations] of Object.entries(stats)) {
  const marker = `    ${lang}: {`;
  if (!content.includes(marker)) continue;
  
  const translationsStr = Object.entries(translations).map(([k, v]) => `        ${k}: "${v}"`).join(",\n");
  
  // Replace the start of the language block by injecting the new translations at the top of the block
  content = content.replace(marker, `${marker}\n${translationsStr},`);
}

fs.writeFileSync(i18nPath, content, 'utf8');
console.log("Updated i18n");

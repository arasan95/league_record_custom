const fs = require('fs');
let d = JSON.parse(fs.readFileSync('tooltip_exports/fallback_mappings.json', 'utf8'));

if (!d['PowerFist']) d['PowerFist'] = {};
d['PowerFist']['totaldamage'] = '175% AD';

if (!d['JarvanIVDemacianStandard']) d['JarvanIVDemacianStandard'] = {};
d['JarvanIVDemacianStandard']['totaldamage'] = '80/120/160/200/240 (+80% AP)';

if (!d['KaisaW']) d['KaisaW'] = {};
d['KaisaW']['totaldamage'] = '30/55/80/105/130 (+130% AD +45% AP)';

if (!d['KhazixE']) d['KhazixE'] = {};
d['KhazixE']['totaldamage'] = '65/100/135/170/205 (+20% AD)';

if (!d['LucianR']) d['LucianR'] = {};
d['LucianR']['totalnumshots'] = '22 (+25% クリティカル率)';
d['LucianR']['totaldamage'] = '330/660/990 (+550% AD +330% AP)';

if (!d['VelkozR']) d['VelkozR'] = {};
d['VelkozR']['totaldamage'] = '500/725/950 (+150% AP)';

if (!d['ViegoR']) d['ViegoR'] = {};
d['ViegoR']['totaldamage'] = '120% AD';

if (!d['BelvethQ']) d['BelvethQ'] = {};
d['BelvethQ']['f1'] = '10/15/20/25/30 (+100% AD)';

if (!d['GarenE']) d['GarenE'] = {};
d['GarenE']['f1'] = '25';

if (!d['Obduracy']) d['Obduracy'] = {};
d['Obduracy']['f1'] = '+10% 物理防御';
d['Obduracy']['f2'] = '+30% 物理防御';

if (!d['SettW']) d['SettW'] = {};
d['SettW']['f1'] = '最大25% (+100 増加ADごとに20%)';

if (!d['CamilleQ']) d['CamilleQ'] = {};
d['CamilleQ']['bonusdamage'] = '20/25/30/35/40 (+20/25/30/35/40% AD)';

if (!d['RengarR']) d['RengarR'] = {};
d['RengarR']['bonusdamage'] = '50% AD';

if (!d['XinZhaoQ']) d['XinZhaoQ'] = {};
d['XinZhaoQ']['bonusdamage'] = '16/25/34/43/52 (+40% AD)';

if (!d['FizzQ']) d['FizzQ'] = {};
d['FizzQ']['qdamage'] = '10/25/40/55/70';
delete d['FizzQ']['totaldamage'];

fs.writeFileSync('tooltip_exports/fallback_mappings.json', JSON.stringify(d, null, 2));

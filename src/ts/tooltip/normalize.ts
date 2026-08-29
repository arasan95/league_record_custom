export function normalizeScaleCoefficientsForDisplay(html: string): string {
    if (!html) return html;
    const trimNum = (n: number): string => {
        return String(n)
            .replace(/\.0+$/, "")
            .replace(/(\.\d*?[1-9])0+$/, "$1");
    };
    const ratioToPercentText = (n: number): string => {
        const p = n * 100;
        const abs = Math.abs(p);
        let digits = 1;
        if (abs < 0.1) digits = 3;
        else if (abs < 1) digits = 2;
        else if (abs < 10) digits = 1;
        const rounded = Number(p.toFixed(digits));
        return trimNum(rounded);
    };

    const toPercent = (rawNum: string): string | null => {
        const n = Number(rawNum);
        if (!Number.isFinite(n)) return null;
        if (Math.abs(n) > 1) return null;
        return `${ratioToPercentText(n)}%`;
    };
    const convertSeriesToPercent = (raw: string, maxAbs: number = 1, includeOne: boolean = true): string | null => {
        const parts = raw.split(/([~/])/);
        const out: string[] = [];
        let hasNumeric = false;
        for (const part of parts) {
            if (part === "~" || part === "/") {
                out.push(part);
                continue;
            }
            const t = part.trim();
            if (!t) {
                out.push(part);
                continue;
            }
            const n = Number(t);
            if (!Number.isFinite(n) || Math.abs(n) > maxAbs) return null;
            if (!includeOne && Math.abs(n) >= 1) return null;
            out.push(ratioToPercentText(n));
            hasNumeric = true;
        }
        return hasNumeric ? `${out.join("")}%` : null;
    };
    let out = html;

    // e.g. 増加攻撃力x0.1 / AP*0.6 -> 増加攻撃力x10% / AP*60%
    out = out.replace(
        /((?:増加攻撃力|追加攻撃力|合計攻撃力|攻撃力|魔力|AP|AD|bonusAD|bAD)\s*[x×*]\s*)([+\-]?\d*\.\d+)/gi,
        (_m, prefix: string, num: string) => {
            const pct = toPercent(num);
            if (!pct) return `${prefix}${num}`;
            return `${prefix}${pct}`;
        },
    );

    // e.g. +0.5AP / +0.35AD -> +50%AP / +35%AD
    out = out.replace(
        /([+\-]\s*)(\d*\.\d+)\s*(AD|AP|bonusAD|bAD)\b/gi,
        (_m, sign: string, num: string, stat: string) => {
            const pct = toPercent(num);
            if (!pct) return `${sign}${num}${stat}`;
            return `${sign}${pct}${stat}`;
        },
    );

    // e.g. +0.02%AD / +0.01%AP -> +2%AD / +1%AP
    out = out.replace(
        /([+\-]?\s*)(\d*\.\d+)%\s*(AD|AP|bonusAD|bAD)\b/gi,
        (_m, sign: string, num: string, stat: string) => {
            const pct = toPercent(num);
            if (!pct) return `${sign}${num}%${stat}`;
            return `${sign}${pct}${stat}`;
        },
    );

    // e.g. 最大体力の0.1~0.18の魔法ダメージ -> 最大体力の10~18%の魔法ダメージ
    // Also handles already-scaled percent values written without '%' (e.g. 5~9).
    // Applies only to health-based damage clauses to avoid changing unrelated decimals.
    // NOTE:
    // The previous lookahead-heavy regexes here could catastrophically backtrack
    // on long slash-separated rank values (observed with JA Garen passive).
    // We match the numeric block first, then validate the immediate tail context.
    out = out.replace(
        /((?:最大|現在|減少)?体力の)\s*([0-9]*\.?[0-9]+(?:[~/][0-9]*\.?[0-9]+)*)/gi,
        (match: string, prefix: string, series: string, offset: number, full: string) => {
            const tail = full.slice(offset + match.length);
            if (!/^\s*の(?:物理|魔法|確定)?ダメージ/.test(tail)) return match;
            const converted = convertSeriesToPercent(series, 100);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );
    out = out.replace(
        /((?:最大|現在|減少)?体力の)\s*([0-9]*\.?[0-9]+(?:[~/][0-9]*\.?[0-9]+)*)/gi,
        (match: string, prefix: string, series: string, offset: number, full: string) => {
            const tail = full.slice(offset + match.length);
            if (!/^\s*にあたる(?:物理|魔法|確定)?ダメージ/.test(tail)) return match;
            const converted = convertSeriesToPercent(series, 100);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // e.g. 与えたダメージの0.2~0.4の魔法ダメージ / ダメージの0.25にあたる体力を回復
    out = out.replace(
        /((?:与えた|受けた)?(?:物理|魔法|確定)?ダメージの)\s*([0-9]*\.?[0-9]+(?:[~/][0-9]*\.?[0-9]+)*)\s*(?=(?:の(?:物理|魔法|確定)?ダメージ|にあたる体力を回復))/gi,
        (_m, prefix: string, series: string) => {
            const converted = convertSeriesToPercent(series, 1);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // e.g. 移動速度が0.03増加 / 移動速度が0.03 -> 移動速度が3%
    out = out.replace(
        /((?:移動速度|攻撃速度|クリティカル率|ライフスティール|オムニヴァンプ)(?:が|は))\s*([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)\s*(?!%)(?=(?:<\/[^>]+>\s*)?(?:増加|減少|上昇|低下|\(|。|、|,|$))/gi,
        (_m, prefix: string, series: string) => {
            if (/(?:秒|秒間|秒ごと|秒かけて)/.test(series)) return `${prefix}${series}`;
            const converted = convertSeriesToPercent(series, 1, false);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // Broader stat-ratio fallback:
    // e.g. 攻撃速度: 0.03 / 攻撃速度は0.03 など、語尾が「増加」で終わらない表記も補正。
    // Avoid base-stat phrases such as 基礎攻撃速度 0.625.
    out = out.replace(
        /((?:(?!基礎|基本)[^0-9<]{0,8})?(?:移動速度|攻撃速度|クリティカル率|ライフスティール|オムニヴァンプ|ヘイスト|スロウ|ダメージ軽減率|軽減率)\s*(?:が|は|:|：)\s*)([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)(?!%)/gi,
        (_m, prefix: string, series: string) => {
            const converted = convertSeriesToPercent(series, 1, false);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // e.g. 体力0.03/0.04/0.05, 攻撃力0.03(...) など、粒度の粗い stat-label 表記を補正
    out = out.replace(
        /((?:最大|現在|減少)?体力|攻撃力|移動速度|攻撃速度|物理防御|魔法防御)\s*([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)(?!%)(?=(?:<\/[^>]+>\s*)?(?:\(|増加|減少|上昇|低下|の|。|、|,|$))/gi,
        (_m, label: string, series: string) => {
            const converted = convertSeriesToPercent(series, 1, false);
            if (!converted) return `${label}${series}`;
            return `${label}${converted}`;
        },
    );

    // e.g. 100 + (60%AP) * 0.01 -> 1% (+60%AP)
    out = out.replace(
        /([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)\s*\+\s*\(([^()]*%[a-zA-Z][^()]*)\)\s*\*\s*0\.0*1\b/g,
        (_m, baseSeries: string, scaling: string) => {
            return `${baseSeries} + (${scaling}) * 0.01`;
        },
    );
    out = out.replace(/(%){2,}/g, "%");
    out = out.replace(/\s\*\s/g, " × ");
    return out;
}

export function normalizeTooltipTextLight(input: string): string {
    return (input || "")
        .replace(/<br\/>\s*<br\/>\s*<br\/>/g, "<br/><br/>")
        .replace(/\s{2,}/g, " ");
}

export function estimateNormalizeComplexity(input: string): number {
    const len = input.length;
    const atVars = (input.match(/@[A-Za-z0-9_.:*+\-]+@/g) || []).length;
    const tags = (input.match(/<[^>]+>/g) || []).length;
    const braces = (input.match(/\{[A-Za-z0-9_]+\}/g) || []).length;
    const ratios = (input.match(/[0-9]+(?:\.[0-9]+)?\/[0-9]+(?:\.[0-9]+)?/g) || []).length;
    return len + atVars * 80 + tags * 20 + braces * 30 + ratios * 40;
}

export const NORMALIZE_COMPLEXITY_THRESHOLD = 9000;
export const NORMALIZE_SLOW_MS = 24;
export const heavyNormalizeBypassKeys = new Set<string>();

export function normalizeTooltipTextSafe(input: string, guardKey: string = ""): string {
    if (!input) return input;
    const out = normalizeTooltipTextLight(input);
    // Keep this path intentionally cheap to avoid hover-time UI stalls.
    return out
        .replace(/(%){2,}/g, "%")
        .replace(/\s\*\s(?=\d)/g, " × ");
}


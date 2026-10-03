/**
 * 拼音声调核心逻辑：
 * - 数字声调（1-5，5 为轻声）与元音附调号两种写法互转
 * - 调号落点规则：有 a 标 a；无 a 标 e；ou 标 o；其余标最后一个元音
 * - ü 的输入写法：ü / v / u:（数字写法中），输出固定为 ü（调号式）与 v（数字式）
 * - 大小写约定：逐字母保留输入大小写（见 README）
 */
export type Tone = 1 | 2 | 3 | 4 | 5;
export type ErrorCode =
  | "EMPTY_INPUT"
  | "INVALID_CHAR"
  | "MISSING_VOWEL"
  | "MULTIPLE_TONES"
  | "TONE_CONFLICT"
  | "TONE_OUT_OF_RANGE"
  | "TONE_DIGIT_POSITION";
export interface SyllableError {
  code: ErrorCode;
  message: string;
  /** 出错字符在音节内的偏移（0 起），整体错误时为 -1 */
  position: number;
}
export interface SyllableReport {
  /** 输入中的音节序号（0 起） */
  index: number;
  /** 原始音节文本 */
  input: string;
  ok: boolean;
  /** 基础字母串（ü 以 ü 表示，如 "hao3" -> "hao"） */
  base?: string;
  /** 声调 1-5，无调号视为 5（轻声） */
  tone?: Tone;
  /** 调号承载字母（基础字母形式） */
  carrier?: string;
  /** 调号承载字母在基础字母串中的下标 */
  carrierIndex?: number;
  /** 规范数字写法（ü -> v，末尾带声调数字） */
  numbered?: string;
  /** 规范调号写法（ü -> ü，轻声不带调号） */
  marked?: string;
  error?: SyllableError;
}
export interface ConvertResult {
  direction: "to-mark" | "to-number";
  ok: boolean;
  syllables: SyllableReport[];
  /** 全部成功时的整体输出（空格连接） */
  output?: string;
}
const VOWELS = ["a", "e", "i", "o", "u", "ü"] as const;
type Vowel = (typeof VOWELS)[number];
/** 各元音 1-4 声预组合字符（小写） */
const MARKED: Record<Vowel, [string, string, string, string]> = {
  a: ["ā", "á", "ǎ", "à"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  o: ["ō", "ó", "ǒ", "ò"],
  u: ["ū", "ú", "ǔ", "ù"],
  "ü": ["ǖ", "ǘ", "ǚ", "ǜ"],
};
const MARKED_UPPER: Record<Vowel, [string, string, string, string]> = {
  a: ["Ā", "Á", "Ǎ", "À"],
  e: ["Ē", "É", "Ě", "È"],
  i: ["Ī", "Í", "Ǐ", "Ì"],
  o: ["Ō", "Ó", "Ǒ", "Ò"],
  u: ["Ū", "Ú", "Ǔ", "Ù"],
  "ü": ["Ǖ", "Ǘ", "Ǚ", "Ǜ"],
};
/** 预组合字符 -> [基础元音, 声调, 是否大写] */
const PRECOMPOSED = new Map<string, [Vowel, Tone, boolean]>();
for (const v of VOWELS) {
  for (let t = 1; t <= 4; t++) {
    PRECOMPOSED.set(MARKED[v][t - 1], [v, t as Tone, false]);
    PRECOMPOSED.set(MARKED_UPPER[v][t - 1], [v, t as Tone, true]);
  }
}
/** 组合调号（NFC 未能合成预组合字符时的兜底）：U+0304/0301/030C/0300 */
const COMBINING_TONE: Record<string, Tone> = {
  "\u0304": 1,
  "\u0301": 2,
  "\u030c": 3,
  "\u0300": 4,
};
interface Letter {
  /** 基础小写形式（v/u: 归一为 ü） */
  base: string;
  upper: boolean;
  /** 字母自带的调号声调（无则 undefined） */
  markTone?: Tone;
}
function isVowel(base: string): base is Vowel {
  return (VOWELS as readonly string[]).includes(base);
}
function fail(input: string, index: number, code: ErrorCode, message: string, position: number): SyllableReport {
  return { index, input, ok: false, error: { code, message, position } };
}
/** 解析单个音节，返回完整诊断报告 */
export function parseSyllable(token: string, index: number): SyllableReport {
  const nfc = token.normalize("NFC");
  const chars = Array.from(nfc);
  const letters: Letter[] = [];
  let digitTone: Tone | undefined;
  let digitPos = -1;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const pre = PRECOMPOSED.get(ch);
    if (pre) {
      letters.push({ base: pre[0], upper: pre[2], markTone: pre[1] });
      continue;
    }
    const combTone = COMBINING_TONE[ch];
    if (combTone !== undefined) {
      const prev = letters[letters.length - 1];
      if (!prev || !isVowel(prev.base)) {
        return fail(token, index, "INVALID_CHAR", "组合调号出现在非法位置（前面没有元音字母）", i);
      }
      if (prev.markTone !== undefined) {
        return fail(token, index, "MULTIPLE_TONES", "同一字母上出现多个调号", i);
      }
      prev.markTone = combTone;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      if (digitTone !== undefined) {
        return fail(token, index, "MULTIPLE_TONES", "一个音节出现多个声调数字", i);
      }
      const d = Number(ch);
      if (d < 1 || d > 5) {
        return fail(token, index, "TONE_OUT_OF_RANGE", `声调数字 ${d} 越界（仅允许 1-5，5 为轻声）`, i);
      }
      digitTone = d as Tone;
      digitPos = i;
      continue;
    }
    if (ch === "ü") {
      letters.push({ base: "ü", upper: false });
      continue;
    }
    if (ch === "Ü") {
      letters.push({ base: "ü", upper: true });
      continue;
    }
    if (ch === "v" || ch === "V") {
      letters.push({ base: "ü", upper: ch === "V" });
      continue;
    }
    if ((ch === "u" || ch === "U") && chars[i + 1] === ":") {
      letters.push({ base: "ü", upper: ch === "U" });
      i++;
      continue;
    }
    if (ch === ":") {
      return fail(token, index, "INVALID_CHAR", '非法字符 ":"（u: 仅作为 ü 的写法出现）', i);
    }
    if (/[a-zA-Z]/.test(ch)) {
      letters.push({ base: ch.toLowerCase(), upper: ch === ch.toUpperCase() });
      continue;
    }
    return fail(token, index, "INVALID_CHAR", `非法字符 "${ch}"（仅允许 a-z、ü、v、u:、声调数字与调号）`, i);
  }
  if (letters.length === 0) {
    return fail(token, index, "INVALID_CHAR", "音节不包含任何字母", -1);
  }
  if (digitTone !== undefined && digitPos !== chars.length - 1) {
    return fail(token, index, "TONE_DIGIT_POSITION", "声调数字必须位于音节末尾", digitPos);
  }
  const markTones = letters.filter((l) => l.markTone !== undefined);
  if (markTones.length > 1) {
    return fail(token, index, "MULTIPLE_TONES", "一个音节出现多个调号", -1);
  }
  if (markTones.length === 1 && digitTone !== undefined) {
    return fail(token, index, "TONE_CONFLICT", `数字声调 ${digitTone} 与字母调号（${markTones[0].markTone} 声）同时出现，互相冲突`, digitPos);
  }
  const tone: Tone = digitTone ?? markTones[0]?.markTone ?? 5;
  const vowelIdxs = letters.map((l, i) => (isVowel(l.base) ? i : -1)).filter((i) => i >= 0);
  if (vowelIdxs.length === 0) {
    return fail(token, index, "MISSING_VOWEL", "音节缺少元音（a/e/i/o/u/ü），不在支持范围内", -1);
  }
  // 调号落点：a > e > ou 的 o > 最后一个元音
  let carrierIndex: number;
  const aIdx = letters.findIndex((l) => l.base === "a");
  const eIdx = letters.findIndex((l) => l.base === "e");
  if (aIdx >= 0) {
    carrierIndex = aIdx;
  } else if (eIdx >= 0) {
    carrierIndex = eIdx;
  } else {
    const ouIdx = letters.findIndex((l, i) => l.base === "o" && letters[i + 1]?.base === "u");
    carrierIndex = ouIdx >= 0 ? ouIdx : vowelIdxs[vowelIdxs.length - 1];
  }
  const carrier = letters[carrierIndex];
  const numbered = letters.map((l) => renderBase(l)).join("") + String(tone);
  const marked = letters
    .map((l, i) => {
      if (i === carrierIndex && tone !== 5) {
        const table = l.upper ? MARKED_UPPER : MARKED;
        return table[l.base as Vowel][tone - 1];
      }
      return renderMarked(l);
    })
    .join("");
  return {
    index,
    input: token,
    ok: true,
    base: letters.map((l) => l.base).join(""),
    tone,
    carrier: carrier.base,
    carrierIndex,
    numbered,
    marked,
  };
}
function renderBase(l: Letter): string {
  const ch = l.base === "ü" ? "v" : l.base;
  return l.upper ? ch.toUpperCase() : ch;
}
function renderMarked(l: Letter): string {
  const ch = l.base;
  return l.upper ? ch.toUpperCase() : ch;
}
/** 按空白切分输入为音节 */
export function tokenize(input: string): string[] {
  return input.split(/\s+/).filter((t) => t.length > 0);
}
const EMPTY_RESULT: SyllableReport = {
  index: -1,
  input: "",
  ok: false,
  error: { code: "EMPTY_INPUT", message: "输入为空或不包含任何音节", position: -1 },
};
/** 转换整段输入（空格分隔的音节） */
export function convert(input: string, direction: "to-mark" | "to-number"): ConvertResult {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    return { direction, ok: false, syllables: [EMPTY_RESULT] };
  }
  const syllables = tokens.map((t, i) => parseSyllable(t, i));
  const ok = syllables.every((s) => s.ok);
  return {
    direction,
    ok,
    syllables,
    output: ok ? syllables.map((s) => (direction === "to-mark" ? s.marked : s.numbered)).join(" ") : undefined,
  };
}
/** 诊断：始终返回逐项报告（不短路），保留原有次序 */
export function diagnose(input: string): ConvertResult {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    return { direction: "to-mark", ok: false, syllables: [EMPTY_RESULT] };
  }
  const syllables = tokens.map((t, i) => parseSyllable(t, i));
  return { direction: "to-mark", ok: syllables.every((s) => s.ok), syllables };
}

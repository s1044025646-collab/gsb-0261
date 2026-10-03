/**
 * 拼音声调核心模块。
 *
 * 支持的输入写法：
 *  - 数字声调：hao3 / ma5（轻声统一为 5），ü 可写作 v、u: 或 ü
 *  - 元音附调号：hǎo（预组合字符或 字母+组合调号，经 NFC 归一化后等价）
 *
 * 调号落点规则：有 a 标 a；无 a 标 e；ou 标在 o 上；其余标最后一个元音。
 */

export type Tone = 1 | 2 | 3 | 4 | 5;

export type ErrorCode =
  | "EMPTY_INPUT"
  | "INVALID_CHAR"
  | "MISSING_VOWEL"
  | "MULTIPLE_TONES"
  | "TONE_CONFLICT"
  | "TONE_OUT_OF_RANGE"
  | "WRONG_TONE_POSITION";

export class PinyinError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public token?: string,
    public position?: number
  ) {
    super(message);
    this.name = "PinyinError";
  }
}

export interface SyllableResult {
  /** 在输入中的音节序号（从 0 开始） */
  index: number;
  /** 原始音节文本 */
  token: string;
  ok: boolean;
  /** 基础字母形式（ü 保留为 ü，小写） */
  base?: string;
  /** 声调 1-5，5 为轻声 */
  tone?: Tone;
  /** 调号承载字母（基础形式） */
  toneCarrier?: string;
  /** 承载字母在基础形式中的下标 */
  carrierIndex?: number;
  /** 数字声调规范写法（ü 输出为 v） */
  numbered?: string;
  /** 附调号规范写法（ü 输出为 ü） */
  marked?: string;
  errorCode?: ErrorCode;
  error?: string;
}

const VOWELS = ["a", "e", "i", "o", "u", "ü"] as const;
type BaseVowel = (typeof VOWELS)[number];

/** 各元音 1-4 声的预组合字符表 */
const MARK_TABLE: Record<BaseVowel, [string, string, string, string]> = {
  a: ["ā", "á", "ǎ", "à"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  o: ["ō", "ó", "ǒ", "ò"],
  u: ["ū", "ú", "ǔ", "ù"],
  "ü": ["ǖ", "ǘ", "ǚ", "ǜ"],
};

/** 预组合字符 -> [基础元音, 声调] */
const MARK_LOOKUP = new Map<string, { base: BaseVowel; tone: Tone }>();
for (const base of VOWELS) {
  MARK_TABLE[base].forEach((ch, i) => {
    MARK_LOOKUP.set(ch, { base, tone: (i + 1) as Tone });
    MARK_LOOKUP.set(ch.toUpperCase(), { base, tone: (i + 1) as Tone });
  });
}

const isAsciiLetter = (ch: string) => /^[a-zA-Z]$/.test(ch);

/** 大小写约定：全大写 -> 全大写；首字母大写 -> 首字母大写；其余全小写 */
type CaseStyle = "lower" | "upper" | "capital";

function detectCaseStyle(token: string): CaseStyle {
  const letters = [...token].filter((c) => isAsciiLetter(c) || MARK_LOOKUP.has(c) || c === "ü" || c === "Ü");
  if (letters.length === 0) return "lower";
  const allUpper = letters.every((c) => c === c.toUpperCase());
  if (allUpper) return "upper";
  if (letters[0] === letters[0].toUpperCase() && letters.slice(1).every((c) => c === c.toLowerCase())) {
    return "capital";
  }
  return "lower";
}

function applyCase(s: string, style: CaseStyle): string {
  if (style === "upper") return s.toUpperCase();
  if (style === "capital") return s[0].toUpperCase() + s.slice(1);
  return s;
}

/** 依据调号落点规则选择承载元音下标 */
export function chooseCarrierIndex(vowels: BaseVowel[]): number {
  const aIdx = vowels.indexOf("a");
  if (aIdx >= 0) return aIdx;
  const eIdx = vowels.indexOf("e");
  if (eIdx >= 0) return eIdx;
  for (let i = 0; i < vowels.length - 1; i++) {
    if (vowels[i] === "o" && vowels[i + 1] === "u") return i;
  }
  return vowels.length - 1;
}

interface ParsedSyllable {
  base: string;
  tone: Tone;
  carrierIndex: number;
  caseStyle: CaseStyle;
}

function parseSyllable(rawToken: string, index: number): ParsedSyllable {
  // NFC 归一化：字母+组合调号 与 预组合字符 等价
  const token = rawToken.normalize("NFC");
  if (token.length === 0) {
    throw new PinyinError("EMPTY_INPUT", "空音节", rawToken, index);
  }

  const caseStyle = detectCaseStyle(token);
  const chars = [...token.toLowerCase()];

  // 声调数字只允许一个、且位于音节末尾
  const digitCount = chars.filter((c) => c >= "0" && c <= "9").length;
  if (digitCount > 1) {
    throw new PinyinError("MULTIPLE_TONES", `一个音节包含多个声调数字：${rawToken}`, rawToken, index);
  }

  const vowels: BaseVowel[] = [];
  /** 每个元音在 baseLetters 中的下标 */
  const vowelLetterIdx: number[] = [];
  /** 每个输入字符对应的基础字母（ü/v/u: 归一为 ü） */
  const baseLetters: string[] = [];
  let markTone: Tone | null = null;
  let markVowelIdx = -1;
  let digitTone: Tone | null = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch >= "0" && ch <= "9") {
      if (i !== chars.length - 1) {
        throw new PinyinError("INVALID_CHAR", `声调数字只能出现在音节末尾：${rawToken}`, rawToken, index);
      }
      const n = Number(ch);
      if (n < 1 || n > 5) {
        throw new PinyinError("TONE_OUT_OF_RANGE", `声调数字越界（仅允许 1-5）：${rawToken}`, rawToken, index);
      }
      digitTone = n as Tone;
      continue;
    }
    if (ch === "ü") {
      vowelLetterIdx.push(baseLetters.length);
      vowels.push("ü");
      baseLetters.push("ü");
      continue;
    }
    if (ch === "v") {
      vowelLetterIdx.push(baseLetters.length);
      vowels.push("ü");
      baseLetters.push("ü");
      continue;
    }
    if (ch === "u" && chars[i + 1] === ":") {
      vowelLetterIdx.push(baseLetters.length);
      vowels.push("ü");
      baseLetters.push("ü");
      i++; // 跳过冒号
      continue;
    }
    const marked = MARK_LOOKUP.get(ch);
    if (marked) {
      if (markTone !== null) {
        throw new PinyinError("MULTIPLE_TONES", `一个音节包含多个调号：${rawToken}`, rawToken, index);
      }
      markTone = marked.tone;
      markVowelIdx = vowels.length;
      vowelLetterIdx.push(baseLetters.length);
      vowels.push(marked.base);
      baseLetters.push(marked.base);
      continue;
    }
    if (isAsciiLetter(ch)) {
      if ((VOWELS as readonly string[]).includes(ch)) {
        vowelLetterIdx.push(baseLetters.length);
        vowels.push(ch as BaseVowel);
      }
      baseLetters.push(ch);
      continue;
    }
    throw new PinyinError("INVALID_CHAR", `非法字符 “${token[i]}”：${rawToken}`, rawToken, index);
  }

  if (vowels.length === 0) {
    throw new PinyinError("MISSING_VOWEL", `音节缺少可标调元音（不支持单独成音节的 m/n 等）：${rawToken}`, rawToken, index);
  }
  if (markTone !== null && digitTone !== null) {
    throw new PinyinError(
      "TONE_CONFLICT",
      `数字声调与字母调号同时出现：${rawToken}`,
      rawToken,
      index
    );
  }

  const tone: Tone = markTone ?? digitTone ?? 5;
  const carrierVowelIdx = chooseCarrierIndex(vowels);
  const carrierIndex = vowelLetterIdx[carrierVowelIdx];

  if (markTone !== null && markVowelIdx !== carrierVowelIdx) {
    throw new PinyinError(
      "WRONG_TONE_POSITION",
      `调号落点不符合规则（应标在 “${vowels[carrierVowelIdx]}” 上）：${rawToken}`,
      rawToken,
      index
    );
  }

  return { base: baseLetters.join(""), tone, carrierIndex, caseStyle };
}

function toMarked(parsed: ParsedSyllable): string {
  if (parsed.tone === 5) return applyCase(parsed.base, parsed.caseStyle);
  const chars = [...parsed.base];
  const carrier = chars[parsed.carrierIndex] as BaseVowel;
  chars[parsed.carrierIndex] = MARK_TABLE[carrier][parsed.tone - 1];
  return applyCase(chars.join(""), parsed.caseStyle);
}

function toNumbered(parsed: ParsedSyllable): string {
  const withV = parsed.base.replace(/ü/g, "v");
  return applyCase(withV, parsed.caseStyle) + String(parsed.tone);
}

function errorResult(index: number, token: string, err: PinyinError): SyllableResult {
  return { index, token, ok: false, errorCode: err.code, error: err.message };
}

/** 解析单个音节，返回完整诊断信息 */
export function analyzeSyllable(token: string, index = 0): SyllableResult {
  try {
    const parsed = parseSyllable(token, index);
    const carrier = [...parsed.base][parsed.carrierIndex];
    return {
      index,
      token,
      ok: true,
      base: applyCase(parsed.base, parsed.caseStyle),
      tone: parsed.tone,
      toneCarrier: applyCase(carrier, parsed.caseStyle === "upper" ? "upper" : "lower"),
      carrierIndex: parsed.carrierIndex,
      numbered: toNumbered(parsed),
      marked: toMarked(parsed),
    };
  } catch (err) {
    if (err instanceof PinyinError) return errorResult(index, token, err);
    throw err;
  }
}

export type Direction = "number-to-mark" | "mark-to-number";

export interface ConversionResponse {
  ok: boolean;
  direction: Direction;
  input: string;
  output: string;
  results: SyllableResult[];
}

/** 转换整段以空格分隔的拼音 */
export function convert(input: string, direction: Direction): ConversionResponse {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new PinyinError("EMPTY_INPUT", "输入为空");
  }
  const tokens = trimmed.split(/\s+/);
  const results = tokens.map((t, i) => analyzeSyllable(t, i));
  const ok = results.every((r) => r.ok);
  const output = ok
    ? results.map((r) => (direction === "number-to-mark" ? r.marked : r.numbered)).join(" ")
    : "";
  return { ok, direction, input, output, results };
}

/** 规范写法检查：返回每个音节的诊断与规范形式 */
export function check(input: string): ConversionResponse {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new PinyinError("EMPTY_INPUT", "输入为空");
  }
  const tokens = trimmed.split(/\s+/);
  const results = tokens.map((t, i) => analyzeSyllable(t, i));
  return {
    ok: results.every((r) => r.ok),
    direction: "number-to-mark",
    input,
    output: results.every((r) => r.ok) ? results.map((r) => r.marked).join(" ") : "",
    results,
  };
}

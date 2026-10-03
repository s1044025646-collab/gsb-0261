import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSyllable, check, chooseCarrierIndex, convert } from "../src/pinyin.js";

// ---- 调号落点规则（固定预期） ----
test("调号落点：a/e/ou 优先级与其余情况", () => {
  assert.equal(chooseCarrierIndex([..."hao"] as never[]), 1); // a 优先
  assert.equal(chooseCarrierIndex([..."hen"] as never[]), 1); // 无 a 标 e
  assert.equal(chooseCarrierIndex([..."kou"] as never[]), 1); // ou 标 o
  assert.equal(chooseCarrierIndex([..."liu"] as never[]), 2); // iu 标最后一个
  assert.equal(chooseCarrierIndex([..."gui"] as never[]), 2); // ui 标最后一个
  assert.equal(chooseCarrierIndex([..."lüe"] as never[]), 2); // üe 标 e
});

// ---- 数字 -> 调号（固定预期） ----
test("数字声调转附调号", () => {
  const cases: Array<[string, string]> = [
    ["hao3", "hǎo"],
    ["liu2", "liú"],
    ["gui4", "guì"],
    ["nv3", "nǚ"],
    ["nu:3", "nǚ"],
    ["nü3", "nǚ"],
    ["lüe4", "lüè"],
    ["ma5", "ma"],
    ["kou1", "kōu"],
    ["shui2", "shuí"],
    ["qiu1", "qiū"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(convert(input, "number-to-mark").output, expected, input);
  }
});

// ---- 调号 -> 数字（固定预期，ü 输出为 v，轻声为 5） ----
test("附调号转数字声调", () => {
  const cases: Array<[string, string]> = [
    ["hǎo", "hao3"],
    ["liú", "liu2"],
    ["guì", "gui4"],
    ["nǚ", "nv3"],
    ["lüè", "lve4"],
    ["ma", "ma5"],
    ["kōu", "kou1"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(convert(input, "mark-to-number").output, expected, input);
  }
});

// ---- 预组合与组合形式等价 ----
test("NFC：预组合与字母+组合调号结果一致", () => {
  const combining = "h" + "a\u030C" + "o"; // a + 组合调号 U+030C（NFC 后等价于 ǎ）
  assert.notEqual(combining, "hǎo");
  const a = analyzeSyllable("hǎo");
  const b = analyzeSyllable(combining);
  assert.equal(a.marked, b.marked);
  assert.equal(a.numbered, b.numbered);
  assert.equal(a.tone, b.tone);
});

// ---- 大小写约定 ----
test("大小写：全大写/首字母大写/小写", () => {
  assert.equal(convert("HAO3", "number-to-mark").output, "HǍO");
  assert.equal(convert("Hao3", "number-to-mark").output, "Hǎo");
  assert.equal(convert("hao3", "number-to-mark").output, "hǎo");
  assert.equal(convert("HǍO", "mark-to-number").output, "HAO3");
});

// ---- 轻声 ----
test("轻声：无调号视作 5，数字 5 输出不带调号", () => {
  const r = analyzeSyllable("ma");
  assert.equal(r.tone, 5);
  assert.equal(r.numbered, "ma5");
  assert.equal(r.marked, "ma");
  assert.equal(convert("ma5", "number-to-mark").output, "ma");
});

// ---- 错误定位 ----
test("错误：重复调号 / 数字与调号冲突 / 越界 / 缺元音 / 非法字符 / 空输入 / 落点错误", () => {
  assert.equal(analyzeSyllable("hǎǒ").errorCode, "MULTIPLE_TONES");
  assert.equal(analyzeSyllable("hao33").errorCode, "MULTIPLE_TONES");
  assert.equal(analyzeSyllable("hǎo3").errorCode, "TONE_CONFLICT");
  assert.equal(analyzeSyllable("hao7").errorCode, "TONE_OUT_OF_RANGE");
  assert.equal(analyzeSyllable("hao0").errorCode, "TONE_OUT_OF_RANGE");
  assert.equal(analyzeSyllable("h3").errorCode, "MISSING_VOWEL");
  assert.equal(analyzeSyllable("m2").errorCode, "MISSING_VOWEL");
  assert.equal(analyzeSyllable("hao@").errorCode, "INVALID_CHAR");
  assert.equal(analyzeSyllable("ha3o").errorCode, "INVALID_CHAR");
  assert.equal(analyzeSyllable("haò").errorCode, "WRONG_TONE_POSITION");
  assert.throws(() => convert("", "number-to-mark"), /输入为空/);
  assert.throws(() => convert("   ", "number-to-mark"), /输入为空/);
});

// ---- 双向往返 + 独立固定预期 ----
test("往返一致性：number -> mark -> number", () => {
  const numbered = ["hao3", "liu2", "gui4", "nv3", "lüe4", "ma5", "kou1", "shui2", "jiang1", "zhuang4"];
  for (const n of numbered) {
    const marked = convert(n, "number-to-mark").output;
    const back = convert(marked, "mark-to-number").output;
    // 独立固定预期：ü 在数字形式中统一输出为 v
    const expected = n.replace(/ü/g, "v").replace(/u:/g, "v");
    assert.equal(back, expected, n);
  }
});

test("往返一致性：mark -> number -> mark", () => {
  const marked = ["hǎo", "liú", "guì", "nǚ", "lüè", "ma", "kōu", "shuí", "jiāng"];
  for (const m of marked) {
    const numbered = convert(m, "mark-to-number").output;
    const back = convert(numbered, "number-to-mark").output;
    assert.equal(back, m, m);
  }
});

// ---- 多音节与次序 ----
test("多音节转换保留次序，失败项被定位", () => {
  const r = convert("hao3 liu2 gui4 nv3 lüe4 ma5", "number-to-mark");
  assert.equal(r.output, "hǎo liú guì nǚ lüè ma");
  const bad = check("hao3 xx@ liu2");
  assert.equal(bad.ok, false);
  assert.equal(bad.results[0].ok, true);
  assert.equal(bad.results[1].ok, false);
  assert.equal(bad.results[1].index, 1);
  assert.equal(bad.results[2].ok, true);
});

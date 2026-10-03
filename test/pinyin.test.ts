import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, diagnose, parseSyllable } from "../src/pinyin";
import { Store } from "../src/store";

// 独立固定预期：[数字写法, 调号写法, 承载字母, 承载下标, 声调]
const PAIRS: Array<[string, string, string, number, number]> = [
  ["hao3", "hǎo", "a", 1, 3], // a 优先
  ["ma1", "mā", "a", 1, 1],
  ["ke4", "kè", "e", 1, 4], // 无 a 标 e
  ["shou1", "shōu", "o", 2, 1], // ou 标 o
  ["kou3", "kǒu", "o", 1, 3],
  ["liu2", "liú", "u", 2, 2], // iu 标最后一个元音
  ["gui4", "guì", "i", 2, 4], // ui 标最后一个元音
  ["nv3", "nǚ", "ü", 1, 3], // ü（v 写法）
  ["lve4", "lüè", "e", 2, 4], // üe 标 e（数字写法中 ü 输出为 v）
  ["ma5", "ma", "a", 1, 5], // 轻声不标调
  ["ba5", "ba", "a", 1, 5],
];

test("固定预期：数字 -> 调号", () => {
  for (const [numbered, marked, carrier, carrierIndex, tone] of PAIRS) {
    const r = parseSyllable(numbered, 0);
    assert.ok(r.ok, `${numbered} 应解析成功: ${JSON.stringify(r.error)}`);
    assert.equal(r.marked, marked, `${numbered} 调号写法`);
    assert.equal(r.carrier, carrier, `${numbered} 承载字母`);
    assert.equal(r.carrierIndex, carrierIndex, `${numbered} 承载位置`);
    assert.equal(r.tone, tone);
  }
});

test("固定预期：调号 -> 数字", () => {
  for (const [numbered, marked] of PAIRS) {
    const r = parseSyllable(marked, 0);
    assert.ok(r.ok, `${marked} 应解析成功`);
    assert.equal(r.numbered, numbered, `${marked} 数字写法`);
  }
});

test("双向往返：数字 -> 调号 -> 数字 还原", () => {
  for (const [numbered] of PAIRS) {
    const toMark = convert(numbered, "to-mark");
    assert.ok(toMark.ok);
    const back = convert(toMark.output!, "to-number");
    assert.ok(back.ok);
    assert.equal(back.output, numbered);
  }
});

test("双向往返：调号 -> 数字 -> 调号 还原", () => {
  for (const [, marked] of PAIRS) {
    const toNum = convert(marked, "to-number");
    assert.ok(toNum.ok);
    const back = convert(toNum.output!, "to-mark");
    assert.ok(back.ok);
    assert.equal(back.output, marked);
  }
});

test("无调号视为轻声 5", () => {
  const r = parseSyllable("ma", 0);
  assert.ok(r.ok);
  assert.equal(r.tone, 5);
  assert.equal(r.numbered, "ma5");
  assert.equal(r.marked, "ma");
});

test("ü 的 v / u: / ü 三种写法等价", () => {
  const a = parseSyllable("nv3", 0);
  const b = parseSyllable("nu:3", 0);
  const c = parseSyllable("nǚ", 0);
  for (const r of [a, b, c]) assert.ok(r.ok);
  assert.equal(a.marked, "nǚ");
  assert.equal(b.marked, "nǚ");
  assert.equal(c.numbered, "nv3");
  assert.equal(a.numbered, b.numbered);
});

test("预组合与组合调号形式得到相同规范结果", () => {
  const pre = convert("hǎo lüè", "to-number");
  const comb = convert("haǒ lüè", "to-number");
  assert.ok(pre.ok && comb.ok);
  assert.equal(pre.output, comb.output);
  assert.equal(pre.output, "hao3 lve4");
});

test("大小写：逐字母保留", () => {
  assert.equal(parseSyllable("HAO3", 0).marked, "HǍO");
  assert.equal(parseSyllable("Hao3", 0).marked, "Hǎo");
  assert.equal(parseSyllable("hǎo", 0).numbered, "hao3");
  assert.equal(parseSyllable("NV3", 0).marked, "NǙ");
});

test("错误：数字与调号冲突", () => {
  const r = parseSyllable("hǎo3", 0);
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "TONE_CONFLICT");
});

test("错误：重复调号", () => {
  assert.equal(parseSyllable("hāá", 0).error!.code, "MULTIPLE_TONES");
  assert.equal(parseSyllable("hao33", 0).error!.code, "MULTIPLE_TONES");
});

test("错误：数字越界", () => {
  assert.equal(parseSyllable("hao6", 0).error!.code, "TONE_OUT_OF_RANGE");
  assert.equal(parseSyllable("hao0", 0).error!.code, "TONE_OUT_OF_RANGE");
});

test("错误：声调数字不在末尾", () => {
  assert.equal(parseSyllable("h3ao", 0).error!.code, "TONE_DIGIT_POSITION");
});

test("错误：缺少元音", () => {
  assert.equal(parseSyllable("xyz", 0).error!.code, "MISSING_VOWEL");
  assert.equal(parseSyllable("m", 0).error!.code, "MISSING_VOWEL");
});

test("错误：非法字符", () => {
  assert.equal(parseSyllable("好", 0).error!.code, "INVALID_CHAR");
  assert.equal(parseSyllable("hao!", 0).error!.code, "INVALID_CHAR");
});

test("错误：空输入", () => {
  const r = convert("   ", "to-mark");
  assert.equal(r.ok, false);
  assert.equal(r.syllables[0].error!.code, "EMPTY_INPUT");
});

test("调号放错元音时按规则归一化", () => {
  // haó 的调号在 o 上，规范结果应落在 a 上
  const r = parseSyllable("haó", 0);
  assert.ok(r.ok);
  assert.equal(r.marked, "háo");
  assert.equal(r.carrier, "a");
});

test("批量诊断保留次序并标出失败项", () => {
  const r = diagnose("hao3 hǎo3 liu2 hao6");
  assert.equal(r.ok, false);
  assert.equal(r.syllables.length, 4);
  assert.deepEqual(
    r.syllables.map((s) => s.ok),
    [true, false, true, false]
  );
  assert.deepEqual(
    r.syllables.map((s) => s.index),
    [0, 1, 2, 3]
  );
});

test("整段转换输出以空格连接", () => {
  const r = convert("hao3 liu2 gui4 nv3 lüe4 ma5", "to-mark");
  assert.ok(r.ok);
  assert.equal(r.output, "hǎo liú guì nǚ lüè ma");
});

test("存储：保存后可读取（模拟重启后读旧报告）", () => {
  const store = new Store(":memory:");
  const result = convert("hao3", "to-mark");
  const id = store.save("convert", "hao3", { direction: "to-mark" }, result);
  const rec = store.get(id);
  assert.ok(rec);
  assert.equal(rec.input, "hao3");
  assert.equal(rec.action, "convert");
  const parsed = JSON.parse(rec.result);
  assert.equal(parsed.output, "hǎo");
  assert.equal(store.list(10).length, 1);
  store.close();
});

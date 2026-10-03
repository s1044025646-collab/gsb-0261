import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert, check } from "./pinyin.js";

function show(title: string, fn: () => void): void {
  console.log(`\n=== ${title} ===`);
  fn();
}

export function runDemo(): void {
  show("数字声调 -> 附调号", () => {
    const r = convert("hao3 liu2 gui4 nv3 lüe4 ma5", "number-to-mark");
    console.log(`输入: ${r.input}`);
    console.log(`输出: ${r.output}`);
    for (const s of r.results) {
      console.log(`  ${s.token}: 基础=${s.base} 声调=${s.tone} 调号落在 '${s.toneCarrier}' (下标 ${s.carrierIndex})`);
    }
  });

  show("附调号 -> 数字声调", () => {
    const r = convert("hǎo liú guì nǚ lüè ma", "mark-to-number");
    console.log(`输入: ${r.input}`);
    console.log(`输出: ${r.output}`);
  });

  show("预组合 与 字母+组合调号 输入等价", () => {
    const precomposed = "hǎo"; // 预组合 ǎ
  const combining = "h" + "a\u030C" + "o"; // a + 组合调号 U+030C（NFC 后等价于 ǎ）
    const a = convert(precomposed, "mark-to-number");
    const b = convert(combining, "mark-to-number");
    console.log(`预组合:   ${precomposed} -> ${a.output}`);
    console.log(`组合形式: ${combining} -> ${b.output}`);
    console.log(`结果一致: ${a.output === b.output && a.results[0].marked === b.results[0].marked}`);
  });

  show("ü 的三种数字写法统一", () => {
    for (const token of ["nv3", "nu:3", "nü3", "nǚ"]) {
      const r = check(token);
      console.log(`  ${token} -> numbered=${r.results[0].numbered} marked=${r.results[0].marked}`);
    }
  });

  show("诊断：错误定位", () => {
    for (const bad of ["ha3o", "hao7", "hǎo3", "hǎǒ", "h3", "m2", "hao@", "haò"]) {
      const r = check(bad);
      const s = r.results[0];
      console.log(`  ${bad} -> [${s.errorCode}] ${s.error}`);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDemo();
}

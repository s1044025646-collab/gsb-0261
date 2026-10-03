#!/usr/bin/env node
import { convert, check, PinyinError, type Direction } from "./pinyin.js";
import { Store } from "./store.js";
import { startServer } from "./server.js";

const USAGE = `拼音声调转换与诊断 CLI

用法：
  node dist/src/cli.js <命令> [参数]

命令：
  convert --to mark|number "<拼音>"   双向转换（数字声调 <-> 附调号）
  check "<拼音>"                      规范写法检查与逐音节诊断
  diagnose "<拼音1>" ["<拼音2>" ...]  批量诊断（保留输入次序）
  history [limit]                     查看历史记录
  export [--format json|csv]          导出历史记录
  serve [--port <端口>]               启动 HTTP API（默认端口 0，即自动选空闲端口）
  demo                                运行内置演示

示例：
  node dist/src/cli.js convert --to mark "hao3 liu2 gui4 nv3 lüe4 ma5"
  node dist/src/cli.js check "hǎo liú"
`;

function fail(err: unknown): never {
  if (err instanceof PinyinError) {
    console.error(`错误 [${err.code}] ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`错误 ${err.message}`);
  } else {
    console.error(String(err));
  }
  process.exit(1);
}

function printResults(response: ReturnType<typeof convert>): void {
  console.log(`输入:   ${response.input}`);
  if (response.ok) console.log(`输出:   ${response.output}`);
  console.log(`状态:   ${response.ok ? "全部成功" : "存在失败项"}`);
  for (const r of response.results) {
    if (r.ok) {
      console.log(
        `  [${r.index}] ${r.token} -> base=${r.base} tone=${r.tone} ` +
          `carrier=${r.toneCarrier}@${r.carrierIndex} numbered=${r.numbered} marked=${r.marked}`
      );
    } else {
      console.log(`  [${r.index}] ${r.token} -> 失败 [${r.errorCode}] ${r.error}`);
    }
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const store = new Store();

  switch (command) {
    case "convert": {
      const toIdx = args.indexOf("--to");
      const to = toIdx >= 0 ? args[toIdx + 1] : undefined;
      const input = args.find((a, i) => !a.startsWith("--") && i !== toIdx + 1);
      const direction: Direction =
        to === "mark" ? "number-to-mark" : to === "number" ? "mark-to-number" : (undefined as never);
      if (!direction || !input) {
        console.error("用法: convert --to mark|number \"<拼音>\"");
        process.exit(2);
      }
      const response = convert(input, direction);
      store.save(direction, response);
      printResults(response);
      if (!response.ok) process.exit(1);
      break;
    }
    case "check": {
      const input = args.join(" ").trim();
      if (!input) fail(new PinyinError("EMPTY_INPUT", "输入为空"));
      const response = check(input);
      store.save("check", response);
      printResults(response);
      if (!response.ok) process.exit(1);
      break;
    }
    case "diagnose": {
      const items = args.filter((a) => !a.startsWith("--"));
      if (items.length === 0) fail(new PinyinError("EMPTY_INPUT", "请提供至少一个待诊断条目"));
      let allOk = true;
      items.forEach((input, i) => {
        const response = check(input);
        store.save("diagnose", response);
        allOk = allOk && response.ok;
        console.log(`--- 条目 ${i} ---`);
        printResults(response);
      });
      console.log(allOk ? "批量诊断：全部通过" : "批量诊断：存在失败条目");
      if (!allOk) process.exit(1);
      break;
    }
    case "history": {
      const limit = Number(args[0] ?? "20");
      for (const e of store.history(limit)) {
        console.log(`#${e.id} [${e.createdAt}] mode=${e.mode} ok=${e.ok} input="${e.input}" output="${e.output}"`);
      }
      break;
    }
    case "export": {
      const fmtIdx = args.indexOf("--format");
      const format = fmtIdx >= 0 ? args[fmtIdx + 1] : "json";
      const entries = store.history(10000);
      if (format === "csv") {
        console.log("id,created_at,mode,input,ok,output");
        const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
        for (const e of entries) {
          console.log([e.id, e.createdAt, e.mode, esc(e.input), e.ok ? 1 : 0, esc(e.output)].join(","));
        }
      } else {
        console.log(JSON.stringify(entries, null, 2));
      }
      break;
    }
    case "serve": {
      const portIdx = args.indexOf("--port");
      const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 0);
      const { port: actual } = await startServer(port);
      console.log(`API 服务已启动: http://127.0.0.1:${actual}`);
      console.log("端点: POST /api/convert  POST /api/check  POST /api/diagnose  GET /api/history  GET /api/export");
      break;
    }
    case "demo": {
      const { runDemo } = await import("./demo.js");
      runDemo();
      break;
    }
    default:
      process.stdout.write(USAGE);
      if (command) process.exit(2);
  }
  store.close();
}

main().catch(fail);

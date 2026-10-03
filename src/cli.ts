import { convert, diagnose, type SyllableReport } from "./pinyin";
import { Store } from "./store";
import { startServer } from "./server";

function printReport(s: SyllableReport): string {
  if (!s.ok) {
    return `  [${s.index}] ${JSON.stringify(s.input)}  失败: ${s.error!.code} - ${s.error!.message}`;
  }
  return (
    `  [${s.index}] ${s.input} -> ${s.marked} / ${s.numbered}` +
    `  (基础字母=${s.base} 声调=${s.tone} 调号落在=${s.carrier} 位置=${s.carrierIndex})`
  );
}

function runConvert(direction: "to-mark" | "to-number", input: string, store: Store): number {
  const result = convert(input, direction);
  const id = store.save("convert", input, { direction }, result);
  console.log(`记录 #${id}  整体${result.ok ? "成功" : "存在失败"}`);
  for (const s of result.syllables) console.log(printReport(s));
  if (result.output) console.log(`输出: ${result.output}`);
  return result.ok ? 0 : 1;
}

function runCheck(input: string, store: Store): number {
  const result = diagnose(input);
  const id = store.save("check", input, {}, result);
  console.log(`记录 #${id}  ${result.ok ? "全部音节规范" : "存在不规范音节"}`);
  for (const s of result.syllables) console.log(printReport(s));
  if (result.ok) console.log(`规范调号写法: ${result.syllables.map((s) => s.marked).join(" ")}`);
  return result.ok ? 0 : 1;
}

function runDiagnose(input: string, store: Store): number {
  const result = diagnose(input);
  const id = store.save("diagnose", input, {}, result);
  const failed = result.syllables.filter((s) => !s.ok).map((s) => s.index);
  console.log(`记录 #${id}  共 ${result.syllables.length} 个音节，失败 ${failed.length} 个${failed.length ? `（序号: ${failed.join(", ")}）` : ""}`);
  for (const s of result.syllables) console.log(printReport(s));
  return result.ok ? 0 : 1;
}

function runHistory(store: Store, limit: number): void {
  const rows = store.list(limit);
  if (rows.length === 0) {
    console.log("暂无历史记录");
    return;
  }
  for (const r of rows) {
    console.log(`#${r.id}  ${r.created_at}  ${r.action}  ok=${r.ok}  input=${JSON.stringify(r.input)}`);
  }
}

function runExport(store: Store, format: string): void {
  const rows = store.all();
  if (format === "csv") {
    const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    console.log("id,created_at,action,input,params,ok");
    for (const r of rows) console.log([r.id, r.created_at, r.action, esc(r.input), esc(r.params), r.ok].join(","));
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }
}

function runDemo(store: Store): void {
  console.log("== 演示 1：数字 -> 调号 ==");
  runConvert("to-mark", "hao3 liu2 gui4 nv3 lüe4 ma5", store);
  console.log("\n== 演示 2：调号 -> 数字 ==");
  runConvert("to-number", "hǎo liú guì nǚ lüè ma", store);
  console.log("\n== 演示 3：预组合与组合形式等价 ==");
  const pre = convert("hǎo", "to-number");
  const comb = convert("haǒ", "to-number");
  console.log(`  预组合 hǎo -> ${pre.output}`);
  console.log(`  组合形式 ha + U+030C -> ${comb.output}`);
  console.log(`  结果一致: ${pre.output === comb.output}`);
  console.log("\n== 演示 4：u: 与 v 写法 ==");
  runConvert("to-mark", "nu:3 nv3 nǚ", store);
  console.log("\n== 演示 5：错误诊断 ==");
  runDiagnose("hao3 hǎo3 ha33 hao6 xyz h3llo", store);
}

function usage(): void {
  console.log(`用法: node dist/cli.js <命令> [参数]
命令:
  serve [--port=N]            启动 HTTP 服务（默认自动选择空闲端口）
  convert --to mark|number <拼音>   双向转换
  check <拼音>                规范写法检查
  diagnose <拼音>             批量诊断（逐项报告，保留次序）
  history [limit]             查看历史
  export [json|csv]           导出历史
  demo                        运行演示`);
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const store = new Store();
  let code = 0;
  try {
    switch (cmd) {
      case "serve": {
        const portArg = args.find((a) => a.startsWith("--port="));
        const port = portArg ? Number(portArg.split("=")[1]) : undefined;
        const { port: actual } = await startServer(port);
        console.log(`拼音声调服务已启动: http://localhost:${actual}`);
        return; // 保持进程运行
      }
      case "convert": {
        const toIdx = args.indexOf("--to");
        const to = toIdx >= 0 ? args[toIdx + 1] : undefined;
        const input = args.filter((a, i) => i !== toIdx && i !== toIdx + 1).join(" ");
        if (to !== "mark" && to !== "number") {
          console.error("错误: 需要 --to mark 或 --to number");
          code = 2;
          break;
        }
        code = runConvert(to === "mark" ? "to-mark" : "to-number", input, store);
        break;
      }
      case "check":
        code = runCheck(args.join(" "), store);
        break;
      case "diagnose":
        code = runDiagnose(args.join(" "), store);
        break;
      case "history":
        runHistory(store, args[0] ? Number(args[0]) : 50);
        break;
      case "export":
        runExport(store, args[0] ?? "json");
        break;
      case "demo":
        runDemo(store);
        break;
      default:
        usage();
        code = cmd ? 2 : 0;
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
  process.exitCode = code;
}

main();

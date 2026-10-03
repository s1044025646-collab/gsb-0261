import * as http from "node:http";
import { convert, diagnose } from "./pinyin";
import { Store } from "./store";

interface ApiError {
  error: { code: string; message: string };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function badRequest(res: http.ServerResponse, message: string): void {
  const body: ApiError = { error: { code: "BAD_REQUEST", message } };
  sendJson(res, 400, body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      if (Buffer.concat(chunks).length > 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJsonBody(raw: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "POST" && (path === "/api/convert" || path === "/api/check" || path === "/api/diagnose")) {
        const body = parseJsonBody(await readBody(req));
        if (!body) return badRequest(res, "请求体必须是 JSON 对象");
        const input = body.input;
        if (typeof input !== "string") return badRequest(res, "缺少字符串字段 input");

        if (path === "/api/convert") {
          const direction = body.direction;
          if (direction !== "to-mark" && direction !== "to-number") {
            return badRequest(res, '字段 direction 必须为 "to-mark" 或 "to-number"');
          }
          const result = convert(input, direction);
          const id = store.save("convert", input, { direction }, result);
          return sendJson(res, result.ok ? 200 : 422, { id, ...result });
        }
        if (path === "/api/check") {
          const result = diagnose(input);
          const id = store.save("check", input, {}, result);
          return sendJson(res, result.ok ? 200 : 422, {
            id,
            ok: result.ok,
            normalized: result.ok ? result.syllables.map((s) => s.marked).join(" ") : undefined,
            syllables: result.syllables,
          });
        }
        const result = diagnose(input);
        const id = store.save("diagnose", input, {}, result);
        return sendJson(res, 200, {
          id,
          ok: result.ok,
          total: result.syllables.length,
          failed: result.syllables.filter((s) => !s.ok).map((s) => s.index),
          syllables: result.syllables,
        });
      }

      if (req.method === "GET" && path === "/api/history") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 500);
        return sendJson(res, 200, { items: store.list(limit) });
      }

      const histMatch = path.match(/^\/api\/history\/(\d+)$/);
      if (req.method === "GET" && histMatch) {
        const rec = store.get(Number(histMatch[1]));
        if (!rec) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "记录不存在" } });
        return sendJson(res, 200, rec);
      }

      if (req.method === "GET" && path === "/api/export") {
        const format = url.searchParams.get("format") ?? "json";
        const rows = store.all();
        if (format === "csv") {
          const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
          const header = "id,created_at,action,input,params,ok";
          const lines = rows.map((r) =>
            [r.id, r.created_at, r.action, esc(r.input), esc(r.params), r.ok].join(",")
          );
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
          return res.end("﻿" + [header, ...lines].join("\r\n"));
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="history.json"',
        });
        return res.end(JSON.stringify(rows, null, 2));
      }

      if (req.method === "GET" && path === "/api/health") {
        return sendJson(res, 200, { ok: true });
      }

      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
    } catch (err) {
      sendJson(res, 500, { error: { code: "INTERNAL", message: String(err) } });
    }
  });
}

export function startServer(port?: number): Promise<{ server: http.Server; port: number }> {
  const store = new Store();
  const server = createServer(store);
  const p = port ?? (process.env.PORT ? Number(process.env.PORT) : 0); // 0 = 自动选择空闲端口
  return new Promise((resolve) => {
    server.listen(p, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : p;
      resolve({ server, port: actual });
    });
  });
}

if (require.main === module) {
  const argPort = process.argv.find((a) => a.startsWith("--port="));
  const port = argPort ? Number(argPort.split("=")[1]) : undefined;
  startServer(port).then(({ port }) => {
    console.log(`拼音声调服务已启动: http://localhost:${port}`);
  });
}

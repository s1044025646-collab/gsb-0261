import http from "node:http";
import { convert, check, PinyinError, type Direction } from "./pinyin.js";
import { Store, type Mode } from "./store.js";

const DIRECTIONS: Direction[] = ["number-to-mark", "mark-to-number"];

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function errorBody(err: unknown): { error: string; code?: string } {
  if (err instanceof PinyinError) return { error: err.message, code: err.code };
  if (err instanceof Error) return { error: err.message };
  return { error: String(err) };
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "POST" && url.pathname === "/api/convert") {
        const body = JSON.parse(await readBody(req));
        const direction = body.direction as Direction;
        if (!DIRECTIONS.includes(direction)) {
          return sendJson(res, 400, {
            error: `direction 必须是 ${DIRECTIONS.join(" 或 ")}`,
            code: "BAD_DIRECTION",
          });
        }
        if (typeof body.input !== "string") {
          return sendJson(res, 400, { error: "缺少字符串字段 input", code: "BAD_INPUT" });
        }
        const response = convert(body.input, direction);
        const id = store.save(direction, response);
        return sendJson(res, response.ok ? 200 : 422, { id, ...response });
      }

      if (req.method === "POST" && url.pathname === "/api/check") {
        const body = JSON.parse(await readBody(req));
        if (typeof body.input !== "string") {
          return sendJson(res, 400, { error: "缺少字符串字段 input", code: "BAD_INPUT" });
        }
        const response = check(body.input);
        const id = store.save("check", response);
        return sendJson(res, response.ok ? 200 : 422, { id, ...response });
      }

      if (req.method === "POST" && url.pathname === "/api/diagnose") {
        const body = JSON.parse(await readBody(req));
        const items: string[] = Array.isArray(body.items)
          ? body.items
          : typeof body.input === "string"
            ? [body.input]
            : [];
        if (items.length === 0 || items.some((it) => typeof it !== "string")) {
          return sendJson(res, 400, {
            error: "需要提供字符串数组 items 或字符串 input",
            code: "BAD_INPUT",
          });
        }
        const entries = items.map((input, i) => {
          try {
            const response = check(input);
            const id = store.save("diagnose", response);
            return { index: i, id, ...response };
          } catch (err) {
            return { index: i, input, ok: false, ...errorBody(err) };
          }
        });
        return sendJson(res, 200, {
          ok: entries.every((e) => e.ok),
          total: entries.length,
          failed: entries.filter((e) => !e.ok).map((e) => e.index),
          entries,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const limit = Number(url.searchParams.get("limit") ?? "50");
        return sendJson(res, 200, { entries: store.history(limit) });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/history/")) {
        const id = Number(url.pathname.split("/").pop());
        const entry = store.get(id);
        if (!entry) return sendJson(res, 404, { error: `记录 ${id} 不存在`, code: "NOT_FOUND" });
        return sendJson(res, 200, entry);
      }

      if (req.method === "GET" && url.pathname === "/api/export") {
        const format = url.searchParams.get("format") ?? "json";
        const entries = store.history(Number(url.searchParams.get("limit") ?? "1000"));
        if (format === "csv") {
          const header = "id,created_at,mode,input,ok,output";
          const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
          const lines = entries.map((e) =>
            [e.id, e.createdAt, e.mode, esc(e.input), e.ok ? 1 : 0, esc(e.output)].join(",")
          );
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
          return res.end([header, ...lines].join("\n"));
        }
        return sendJson(res, 200, { entries });
      }

      sendJson(res, 404, { error: "未知路由", code: "NOT_FOUND" });
    } catch (err) {
      const status = err instanceof PinyinError ? 400 : 500;
      sendJson(res, status, errorBody(err));
    }
  });
}

export function startServer(port: number): Promise<{ port: number; close: () => void }> {
  const store = new Store();
  const server = createServer(store);
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({ port: actualPort, close: () => server.close() });
    });
  });
}

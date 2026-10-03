import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ConvertResult } from "./pinyin";

export interface HistoryRecord {
  id: number;
  created_at: string;
  action: string;
  input: string;
  params: string;
  ok: number;
  result: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const file = dbPath ?? process.env.PINYIN_DB ?? path.join(process.cwd(), "data", "pinyin.db");
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        action TEXT NOT NULL,
        input TEXT NOT NULL,
        params TEXT NOT NULL,
        ok INTEGER NOT NULL,
        result TEXT NOT NULL
      );
    `);
  }

  save(action: string, input: string, params: Record<string, unknown>, result: ConvertResult): number {
    const stmt = this.db.prepare(
      "INSERT INTO history (action, input, params, ok, result) VALUES (?, ?, ?, ?, ?)"
    );
    const info = stmt.run(action, input, JSON.stringify(params), result.ok ? 1 : 0, JSON.stringify(result));
    return Number(info.lastInsertRowid);
  }

  list(limit = 50): HistoryRecord[] {
    const stmt = this.db.prepare("SELECT * FROM history ORDER BY id DESC LIMIT ?");
    return stmt.all(limit) as unknown as HistoryRecord[];
  }

  get(id: number): HistoryRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM history WHERE id = ?");
    return stmt.get(id) as unknown as HistoryRecord | undefined;
  }

  all(): HistoryRecord[] {
    const stmt = this.db.prepare("SELECT * FROM history ORDER BY id ASC");
    return stmt.all() as unknown as HistoryRecord[];
  }

  close(): void {
    this.db.close();
  }
}

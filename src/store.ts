import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConversionResponse, Direction, SyllableResult } from "./pinyin.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = process.env.PINYIN_DATA_DIR ?? path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "pinyin.db");

export type Mode = Direction | "check" | "diagnose";

export interface HistoryEntry {
  id: number;
  createdAt: string;
  mode: Mode;
  input: string;
  ok: boolean;
  output: string;
  results: SyllableResult[];
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        mode TEXT NOT NULL,
        input TEXT NOT NULL,
        ok INTEGER NOT NULL,
        output TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES requests(id),
        position INTEGER NOT NULL,
        token TEXT NOT NULL,
        ok INTEGER NOT NULL,
        base TEXT,
        tone INTEGER,
        tone_carrier TEXT,
        carrier_index INTEGER,
        numbered TEXT,
        marked TEXT,
        error_code TEXT,
        error TEXT
      );
    `);
  }

  save(mode: Mode, response: ConversionResponse): number {
    const insertReq = this.db.prepare(
      "INSERT INTO requests (mode, input, ok, output) VALUES (?, ?, ?, ?)"
    );
    const insertRes = this.db.prepare(
      `INSERT INTO results
       (request_id, position, token, ok, base, tone, tone_carrier, carrier_index, numbered, marked, error_code, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const req = insertReq.run(mode, response.input, response.ok ? 1 : 0, response.output);
    const requestId = Number(req.lastInsertRowid);
    for (const r of response.results) {
      insertRes.run(
        requestId,
        r.index,
        r.token,
        r.ok ? 1 : 0,
        r.base ?? null,
        r.tone ?? null,
        r.toneCarrier ?? null,
        r.carrierIndex ?? null,
        r.numbered ?? null,
        r.marked ?? null,
        r.errorCode ?? null,
        r.error ?? null
      );
    }
    return requestId;
  }

  history(limit = 50): HistoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM requests ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as Array<{
      id: number;
      created_at: string;
      mode: Mode;
      input: string;
      ok: number;
      output: string;
    }>;
    return rows.map((row) => ({ ...this.toEntry(row), results: this.resultsFor(row.id) }));
  }

  get(id: number): HistoryEntry | null {
    const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as
      | { id: number; created_at: string; mode: Mode; input: string; ok: number; output: string }
      | undefined;
    if (!row) return null;
    return { ...this.toEntry(row), results: this.resultsFor(id) };
  }

  private toEntry(row: {
    id: number;
    created_at: string;
    mode: Mode;
    input: string;
    ok: number;
    output: string;
  }) {
    return {
      id: row.id,
      createdAt: row.created_at,
      mode: row.mode,
      input: row.input,
      ok: row.ok === 1,
      output: row.output,
    };
  }

  private resultsFor(requestId: number): SyllableResult[] {
    const rows = this.db
      .prepare("SELECT * FROM results WHERE request_id = ? ORDER BY position")
      .all(requestId) as unknown as Array<{
      position: number;
      token: string;
      ok: number;
      base: string | null;
      tone: number | null;
      tone_carrier: string | null;
      carrier_index: number | null;
      numbered: string | null;
      marked: string | null;
      error_code: string | null;
      error: string | null;
    }>;
    return rows.map((r) => ({
      index: r.position,
      token: r.token,
      ok: r.ok === 1,
      ...(r.base !== null ? { base: r.base } : {}),
      ...(r.tone !== null ? { tone: r.tone as SyllableResult["tone"] } : {}),
      ...(r.tone_carrier !== null ? { toneCarrier: r.tone_carrier } : {}),
      ...(r.carrier_index !== null ? { carrierIndex: r.carrier_index } : {}),
      ...(r.numbered !== null ? { numbered: r.numbered } : {}),
      ...(r.marked !== null ? { marked: r.marked } : {}),
      ...(r.error_code !== null ? { errorCode: r.error_code as SyllableResult["errorCode"] } : {}),
      ...(r.error !== null ? { error: r.error } : {}),
    }));
  }

  close(): void {
    this.db.close();
  }
}

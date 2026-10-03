import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { convert } from "../src/pinyin.js";

test("存储：保存后重启（新实例）可读取旧报告", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pinyin-test-"));
  const dbPath = path.join(dir, "test.db");
  const s1 = new Store(dbPath);
  const id = s1.save("number-to-mark", convert("hao3 ma5", "number-to-mark"));
  s1.close();

  const s2 = new Store(dbPath);
  const entry = s2.get(id);
  assert.ok(entry);
  assert.equal(entry.input, "hao3 ma5");
  assert.equal(entry.output, "hǎo ma");
  assert.equal(entry.results.length, 2);
  assert.equal(entry.results[0].toneCarrier, "a");
  assert.equal(entry.results[1].tone, 5);
  assert.equal(s2.history(10).length, 1);
  s2.close();
});

const { startServer } = require("./dist/server");

async function main() {
  const { server, port } = await startServer(0);
  const base = `http://localhost:${port}`;
  const post = async (p, body) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return [r.status, await r.json()];
  };
  const get = async (p) => {
    const r = await fetch(base + p);
    return [r.status, await r.json()];
  };

  let [s1, convertRes] = await post("/api/convert", { input: "hao3 liu2 gui4 nv3 lüe4 ma5", direction: "to-mark" });
  console.log("convert:", s1, convertRes.output);
  let [s2, checkRes] = await post("/api/check", { input: "hǎo3" });
  console.log("check(冲突):", s2, checkRes.syllables[0].error.code);
  let [s3, diagRes] = await post("/api/diagnose", { input: "hao3 hao6 ma" });
  console.log("diagnose:", s3, "total=", diagRes.total, "failed=", diagRes.failed);
  let [s4, hist] = await get("/api/history");
  console.log("history:", s4, "count=", hist.items.length, "first input=", hist.items[0].input);
  let [s5, one] = await get(`/api/history/${hist.items[0].id}`);
  console.log("history/:id:", s5, one.action);
  const csv = await fetch(base + "/api/export?format=csv");
  console.log("export csv:", csv.status, (await csv.text()).split("\r\n")[0]);
  let [s6, bad] = await post("/api/convert", { input: 123 });
  console.log("bad request:", s6, bad.error.code);
  server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

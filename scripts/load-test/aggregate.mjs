// 读取 results/*.jsonl，按 group/leg 输出 P50/P90/P95/min/max 与错误/断流/长度统计
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? join(import.meta.dirname, 'results');
const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
const groups = new Map();
for (const f of files) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const key = `${r.group} ${r.leg}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
}
const pct = (arr, p) => {
  if (arr.length === 0) return '-';
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1);
  return s[Math.max(0, i)];
};
const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) : '-');
for (const [key, rs] of [...groups.entries()].sort()) {
  const ok = rs.filter((r) => r.ok);
  const totals = ok.map((r) => r.totalMs).filter((x) => x != null);
  const ttfts = ok.map((r) => r.ttftMs).filter((x) => x != null);
  const acks = ok.map((r) => r.ackMs).filter((x) => x != null);
  const chars = ok.map((r) => r.contentChars).filter((x) => x != null);
  const errs = rs.filter((r) => !r.ok && !r.dropped);
  const drops = rs.filter((r) => r.dropped);
  const reasoning = rs.reduce((a, r) => a + (r.reasoningBlocks ?? 0), 0);
  console.log(`\n== ${key}  n=${rs.length} ok=${ok.length} err=${errs.length} drop=${drops.length} reasoning=${reasoning}`);
  console.log(`  total(ms):  p50=${fmt(pct(totals, 50))} p90=${fmt(pct(totals, 90))} p95=${fmt(pct(totals, 95))} min=${fmt(Math.min(...totals))} max=${fmt(Math.max(...totals))}`);
  console.log(`  ttft(ms):   p50=${fmt(pct(ttfts, 50))} p90=${fmt(pct(ttfts, 90))} p95=${fmt(pct(ttfts, 95))} min=${fmt(Math.min(...ttfts))} max=${fmt(Math.max(...ttfts))}`);
  console.log(`  ack(ms):    p50=${fmt(pct(acks, 50))} p90=${fmt(pct(acks, 90))}`);
  console.log(`  chars:      p50=${fmt(pct(chars, 50))} min=${fmt(Math.min(...chars))} max=${fmt(Math.max(...chars))}`);
  for (const e of errs) console.log(`  ERR: ${e.seq} ${e.error}`);
  for (const d of drops) console.log(`  DROP: ${d.seq} ${d.error ?? ''}`);
}

#!/usr/bin/env node
/* test-engine.js — engine.js 검증
 *  1) 같은 시드로 여러 번 돌려 결과가 항상 같은지 (결정성)
 *  2) 원본 public/index.html 의 전투 코드를 Node(vm)에서 그대로 돌린 결과와
 *     engine.js 결과를 틱마다 비교 (동일성)
 * 사용: node test-engine.js [index.html 경로]   (기본 ./public/index.html)
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const Engine = require('./engine.js');
const htmlPath = process.argv[2] || path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const SCRIPT = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

// ---- 원본과 같은 난수 (mulberry32) ----
let _s = 1;
const seedH = n => { _s = (n >>> 0) || 1; };
const rndH = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- 아무 호출이나 받아주는 가짜 DOM ----
const U = () => { const f = function () { return U(); }; return new Proxy(f, {
  get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'length' ? 0 : k === 'then' ? undefined : U(),
  set: () => true, apply: () => U(), construct: () => U() }); };

function makeOrig() {
  const ctx = vm.createContext({ document: U(), window: U(), Image: U(), performance: { now: () => 0 }, setTimeout: () => 0, setInterval: () => 0,
    requestAnimationFrame: () => 0, confirm: () => true, alert: () => {}, console, localStorage: U(), location: U() });
  ctx.Math = Object.create(Math); ctx.Math.random = rndH;
  vm.runInContext(SCRIPT, ctx, { filename: 'index.html' });
  return { run: code => vm.runInContext(code, ctx) };
}

// ---- 전체 상태 덤프 (engine.js 의 fullState 와 같은 형식) ----
const DUMP = `JSON.stringify({ t: B.t, res: B.res, rng: __RNG__(), us: B.us.map(u => { const o = {}; for (const k of Object.keys(u).sort()) { const v = u[k]; if (typeof v !== 'object' || v === null) o[k] = typeof v === 'number' ? +v.toFixed(4) : v; } return o; }) })`;
const getRng = () => _s;

function baseSt(round) {
  const roster = [[1, 7], [2, 7], [3, 7], [4, 7], [3, 8]].map(p => ({ type: 'inf', c: p[0], r: p[1] }));
  roster.push({ type: 'med', c: 2, r: 9 });
  return { roster, lives: 3, round, kami: 0, neg: 0, negMax: 0, starUsed: [], aiAug: [], seduce: 0, dm: 0, aiSed: 0, aiNapo: 0, met: 0, bid: 0, aug: [], phase: 'prep', sel: null, pend: null, tgt: false, hover: null };
}

// 원본 안에서 증강을 실제로 적용해 st 를 만든다 (choose 는 원본 그대로)
function buildSt(orig, round, augIds, hard, seed) {
  seedH(seed);
  orig.run(`st=${JSON.stringify(baseSt(round))};st.en=genEn(st.round);${hard ? 'st.hard=1;' : ''}`);
  for (const id of augIds) {
    try { orig.run(`st.phase='pick';st.lose=0;st.pend=null;choose(${JSON.stringify(id)});st.pend=null;`); }
    catch (e) { return { err: id + ': ' + e.message }; }
  }
  return { st: JSON.parse(orig.run('JSON.stringify(st)')) };
}

function lockstep(orig, st, seed, maxTicks, dt) {
  // 원본
  orig.run(`st=${JSON.stringify(st)};st.phase='prep';st.pend=null;st.paused=0;B=null;`);
  seedH(seed); orig.run('start()');
  const dumpO = () => orig.run(DUMP.replace('__RNG__()', String(0))).replace('"rng":0', '"rng":' + getRng());
  // 엔진
  Engine.begin({ seed, st });
  let tick = 0, endedO = false;
  const cmp = (why) => { const a = dumpO(), b = Engine.fullState(); if (a !== b) { const A = JSON.parse(a), Bq = JSON.parse(b); let where = 'top'; for (const k of ['t', 'res', 'rng']) if (A[k] !== Bq[k]) where = k + ' ' + A[k] + ' vs ' + Bq[k]; if (where == 'top') for (let i = 0; i < Math.max(A.us.length, Bq.us.length); i++) { if (JSON.stringify(A.us[i]) !== JSON.stringify(Bq.us[i])) { where = 'unit#' + i + ' ' + (A.us[i] && A.us[i].type); break; } } return `${why} tick ${tick}: ${where}`; } return null; };
  let bad = cmp('start'); if (bad) return { bad };
  while (tick < maxTicks) {
    tick++;
    const oEnd = orig.run(`(B&&!B.end)?(upd(${dt}),!!B.end):true`);
    const eEnd = Engine.step(dt);
    bad = cmp('step'); if (bad) return { bad, tick };
    if (oEnd !== eEnd) return { bad: `종료 시점 불일치 tick ${tick}` };
    if (oEnd) break;
  }
  return { ok: true, tick, res: Engine.result() };
}

let pass = 0, fail = 0, skipped = 0; const fails = [];
function scenario(name, round, augs, hard, seed) {
  const orig = makeOrig();
  const b = buildSt(orig, round, augs, hard, seed * 7 + 1);
  if (b.err) { skipped++; fails.push(`SKIP ${name}: 증강 적용 실패 ${b.err}`); return; }
  const r = lockstep(orig, b.st, seed, 3000, 0.05);
  if (r.ok) pass++; else { fail++; fails.push(`FAIL ${name} seed=${seed}: ${r.bad}`); }
}

// 1) 결정성
let det = 0;
for (const seed of [1, 2, 3]) { for (const round of [1, 6, 12]) {
  const st = baseSt(round); st.en = Engine.genEn(round);
  const run = () => { Engine.begin({ seed, st }); let n = 0; while (!Engine.step(0.05) && n++ < 3000); return Engine.fullState(); };
  const a = run(), b = run(), c = run(); if (a === b && b === c) det++; else fails.push(`NONDET seed=${seed} round=${round}`); } }
console.log(`[결정성] 같은 시드 3회 실행 동일: ${det}/9`);

// 2) 원본 vs 엔진
for (const round of [1, 2, 3, 5, 8, 10, 12, 15]) for (const seed of [11, 12]) scenario(`기본 round${round}`, round, [], false, seed);
const AUG = JSON.parse(vm.runInContext(`JSON.stringify(A.map(a=>a.id))`, (() => { const c = vm.createContext({ document: U(), window: U(), Image: U(), performance: { now: () => 0 }, setTimeout: () => 0, setInterval: () => 0, requestAnimationFrame: () => 0, confirm: () => true, console, localStorage: U() }); vm.runInContext(SCRIPT, c); return c; })()));
for (const id of AUG) for (const seed of [21, 22]) scenario(`증강 ${id}`, 4, [id], false, seed);
for (const id of AUG) scenario(`증강 ${id} (고난)`, 6, [id], true, 31);
// 3) 조합
let k = 99; const pick = () => { k = (k * 1103515245 + 12345) & 0x7fffffff; return k; };
for (let i = 0; i < 60; i++) { const n = 2 + (pick() % 3), a = []; for (let j = 0; j < n; j++) a.push(AUG[pick() % AUG.length]); scenario(`조합 [${a}]`, 3 + (pick() % 9), a, !!(pick() & 1), 41 + i); }

console.log(`[동일성] 통과 ${pass} / 실패 ${fail} / 건너뜀 ${skipped}`);
fails.slice(0, 40).forEach(f => console.log(f));
process.exit(fail || det < 9 ? 1 : 0);

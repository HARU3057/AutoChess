#!/usr/bin/env node
/* test-engine.js — engine.js 검증
 *  1) 같은 시드로 여러 번 돌려 결과가 항상 같은지 (결정성)
 *  2) 원본 public/index.html 의 전투 코드를 Node(vm)에서 그대로 돌린 결과와
 *     engine.js 결과를 틱마다 비교 (동일성)
 *  3) (--pvp) PvP 모드: 증강이 해당 팀에만 적용되는지, 1번 팀/2번 팀 어느 쪽이어도 대칭인지
 * 사용: node test-engine.js [index.html 경로]        호환 모드(1,2)
 *       node test-engine.js --pvp [index.html 경로]  PvP 모드(3)
 *       node test-engine.js --aug [index.html 경로]  서버 증강 선택(Aug)이 원본 choose/클릭과 같은지(4)
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const Engine = require('./engine.js');
const PVP = process.argv.includes('--pvp');
const AUGT = process.argv.includes('--aug');
const htmlPath = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, 'public', 'index.html');
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


if (AUGT) {
  // 원본에서 AI 증강/적 생성만 끄고(서버는 안 함), 나머지는 원본 그대로 실행
  const mkOrig = () => {
    const o = makeOrig();
    o.run('aiPick=function(){};aiApplyAll=function(){};genEn=function(){return []};');
    const hdr = 'cv.onclick=e=>{if(st.paused)return;const p=pos(e);if(!p)return;const[c,r]=p;';
    const a = SCRIPT.indexOf(hdr), z = SCRIPT.indexOf('st.sel=o};', a) + 'st.sel=o'.length;
    if (a < 0 || z < 10) throw new Error('클릭 핸들러를 찾지 못함');
    o.run('function __click(c,r){if(st.paused)return;' + SCRIPT.slice(a + hdr.length, z) + '}');
    return o;
  };
  const NORM = `(function(S){const p=S.pend;const x=JSON.parse(JSON.stringify(S,(k,v)=>(k==='en'||k==='hover'||k==='sel'||k==='pend'||k==='offer')?undefined:v));
    x.sel=S.sel?[S.sel.c,S.sel.r,S.sel.type]:null;
    x.pend=p?{k:p.k,step:p.step||0,got:(p.got||[]).map(o=>[o.c,o.r]),g:p.g?[p.g.c,p.g.r]:null,elig:S.roster.filter(p.f).map(o=>[o.c,o.r])}:null;
    return JSON.stringify(x)})`;
  const normE = () => (0, eval)(NORM)(Engine.getSt());
  const normO = o => o.run(NORM + '(st)');
  const AUGIDS = Engine.Aug.list().map(a => a.id);
  let ok = 0, bad = 0; const log = [];
  const fail = m => { bad++; if (log.length < 30) log.push('FAIL ' + m); };
  let k = 12345; const pick = n => { k = (k * 1103515245 + 12345) & 0x7fffffff; return k % n; };
  const rngCell = st => { const rs = st.roster.filter(o => o.r >= 5); return rs.length ? rs[pick(rs.length)] : null; };

  // (a) 증강 선택 + 기물 지정 + 배치 이동이 원본과 같은지
  for (const id of AUGIDS) for (let ctx = 0; ctx < 4; ctx++) {
    const orig = mkOrig(); const seed0 = 500 + ctx * 17 + id.length, round = 1 + pick(9), hard = ctx == 3 ? 1 : 0, lose = ctx == 2 ? 1 : 0;
    seedH(seed0);
    orig.run(`st=${JSON.stringify(baseSt(round))};st.en=[];${hard ? 'st.hard=1;' : ''}`);
    const nPrev = ctx == 0 ? 0 : 1 + pick(3);
    for (let i = 0; i < nPrev; i++) { const pid = AUGIDS[pick(AUGIDS.length)]; try { orig.run(`st.phase='pick';st.lose=0;choose(${JSON.stringify(pid)});st.pend=null;st.sel=null;`); } catch (e) { } }
    orig.run(`st.phase='pick';st.pend=null;st.sel=null;st.lose=${lose};`);
    const S = JSON.parse(orig.run('JSON.stringify(st)'));
    const tag = `${id} ctx${ctx}`;
    // 원본 choose
    seedH(900 + ctx); try { orig.run(`choose(${JSON.stringify(id)})`); } catch (e) { fail(tag + ' 원본 오류 ' + e.message); continue; }
    // 서버 Aug
    S.offer = [id]; let r1; try { r1 = Engine.Aug.choose(S, id, 900 + ctx); } catch (e) { fail(tag + ' 엔진 오류 ' + e.message); continue; }
    if (!r1.ok) { fail(tag + ' choose 거부 ' + JSON.stringify(r1)); continue; }
    let a = normO(orig), b = normE(); if (a !== b) { const A1 = JSON.parse(a), B1 = JSON.parse(b); const ks = Object.keys(A1).concat(Object.keys(B1)).filter((q, i, ar) => ar.indexOf(q) == i && JSON.stringify(A1[q]) !== JSON.stringify(B1[q])); fail(tag + ' choose 결과 다름: ' + ks.join(',') + (ks.includes('roster') ? (() => { const n = Math.max(A1.roster.length, B1.roster.length); let i = 0; while (i < n && JSON.stringify(A1.roster[i]) === JSON.stringify(B1.roster[i])) i++; return ' | 개수 원본 ' + A1.roster.length + ' 엔진 ' + B1.roster.length + ', 첫 차이 #' + i + ' 원본=' + JSON.stringify(A1.roster[i]) + ' 엔진=' + JSON.stringify(B1.roster[i]) + ' | flash 원본=' + A1.flash + ' 엔진=' + B1.flash; })() : ' | ' + ks.map(q => q + ' 원본=' + JSON.stringify(A1[q]) + ' 엔진=' + JSON.stringify(B1[q])).join(' ; '))); continue; }
    // 기물 지정 이어서 처리
    let step = 0, good = true;
    while (JSON.parse(a).pend && step < 8) {
      const pd = JSON.parse(a).pend, c = pd.elig.find(p => !pd.got.some(g => g[0] == p[0] && g[1] == p[1])); if (!c) break;
      seedH(950 + step); orig.run(`__click(${c[0]},${c[1]})`);
      const rr = Engine.Aug.pendPick(S, c[0], c[1], 950 + step); if (!rr.accepted) { fail(tag + ' pend 거부됨 step' + step); good = false; break; }
      a = normO(orig); b = normE(); if (a !== b) { fail(tag + ' pend step' + step + ' 다름'); good = false; break; } step++;
    }
    if (!good) continue;
    // 배치 이동
    if (!JSON.parse(a).pend) for (let m = 0; m < 6; m++) {
      const u = rngCell(JSON.parse(a)) || null; const so = JSON.parse(a).roster.filter(o => o.r >= 5); if (!so.length) break;
      const s1 = so[pick(so.length)], c = pick(6), r = 5 + pick(5);
      orig.run(`st.sel=null;__click(${s1.c},${s1.r});__click(${c},${r});st.sel=null;hud();`); Engine.Aug.move(S, s1.c, s1.r, c, r);
      a = normO(orig); b = normE(); if (a !== b) { fail(tag + ' 이동 ' + m + ' 다름'); good = false; break; }
    }
    if (good) ok++;
  }
  console.log(`[증강 선택/지정/이동] 원본과 같음 ${ok} / 다름 ${bad}`);

  // (b) 3장 뽑기가 원본 roll3 와 같은지, 제외·리롤 규칙
  let rb = 0, rbad = 0;
  for (let i = 0; i < 120; i++) {
    const orig = mkOrig(); const hard = i % 3 == 0 ? 1 : 0, first = i % 4 == 0;
    seedH(i); orig.run(`st=${JSON.stringify(baseSt(1 + i % 12))};${hard ? 'st.hard=1;' : ''}`);
    if (!first) for (let j = 0; j < 1 + i % 3; j++) { try { orig.run(`st.phase='pick';choose(${JSON.stringify(AUGIDS[pick(AUGIDS.length)])});st.pend=null;st.sel=null;`); } catch (e) { } }
    const S = JSON.parse(orig.run('JSON.stringify(st)')); S.offer = null;
    seedH(3000 + i); const want = JSON.parse(orig.run('JSON.stringify(roll3().map(a=>a.id))'));
    const got = Engine.Aug.offer(S, 3000 + i, []);
    if (JSON.stringify(want) === JSON.stringify(got)) rb++; else rbad++;
  }
  console.log(`[3장 뽑기] 원본 roll3 와 같음 ${rb} / 다름 ${rbad}`);
  const EXC = ['ice', 'quake', 'warp', 'trench', 'highland', 'siege', 'banzai', 'meteor', 'sch', 'wild', 'bounty', 'lb'];
  let leak = 0; for (let i = 0; i < 300; i++) { const S = Engine.Aug.newState(); S.round = 1 + i % 14; const o = Engine.Aug.offer(S, 7000 + i, EXC); if (o.some(x => EXC.includes(x))) leak++; }
  const Sx = Engine.Aug.newState(); Engine.Aug.offer(Sx, 1, EXC); const r1 = Engine.Aug.offer(Sx, 2, EXC, true), r2 = Engine.Aug.offer(Sx, 3, EXC, true);
  const rules = [['제외 증강이 3장에 섞이지 않음(300회)', leak == 0], ['리롤은 라운드당 1회(두 번째는 거절)', Array.isArray(r1) && r2 === null],
    ['제시되지 않은 증강 선택은 거절', (() => { const S = Engine.Aug.newState(); const o = Engine.Aug.offer(S, 9, EXC); const bad = AUGIDS.find(x => !o.includes(x)); return Engine.Aug.choose(S, bad, 1).err == 'not-offered'; })()],
    ['기물 지정 중에는 새 증강 선택 거절', (() => { const S = Engine.Aug.newState(); S.offer = ['horse', 'tough', 'bond']; Engine.Aug.choose(S, 'tough', 1); S.offer = ['bond']; return Engine.Aug.choose(S, 'bond', 1).err == 'pending'; })()],
    ['조건에 안 맞는 칸을 지정하면 상태가 안 바뀜', (() => { const S = Engine.Aug.newState(); S.offer = ['sparta']; Engine.Aug.choose(S, 'sparta', 1); const before = JSON.stringify(S.roster); const med = S.roster.find(o => o.type == 'med'); const r = Engine.Aug.pendPick(S, med.c, med.r, 1); return !r.accepted && JSON.stringify(S.roster) === before && S.pend; })()],
    ['큰 유닛(2x2) 180도 회전이 모든 유효 위치에서 올바르고 되돌릴 수 있음', (() => { const cells = (c, r) => { const o = r & 1; return [[c, r], [c + 1, r], [c + o, r + 1], [c + 1 + o, r + 1]]; }; const inb = p => p[0] >= 0 && p[0] < 6 && p[1] >= 0 && p[1] < 10; let good = true, n = 0;
      for (const ty of ['troy', 'ele']) for (let r = 0; r < 10; r++) for (let c = 0; c < 6; c++) { if (!cells(c, r).every(inb)) continue; n++; const R1 = Engine.Aug.rotate([{ type: ty, c, r }])[0], want = new Set(cells(c, r).map(p => (5 - p[0]) + ',' + (9 - p[1]))), got = cells(R1.c, R1.r); if (!got.every(p => want.has(p[0] + ',' + p[1]))) good = false; const R2 = Engine.Aug.rotate([R1])[0]; if (R2.c !== c || R2.r !== r) good = false; } return good && n > 50; })()],
    ['배치: 적 진영(윗줄)으로는 이동 불가', (() => { const S = Engine.Aug.newState(); const u = S.roster[0]; return Engine.Aug.move(S, u.c, u.r, 2, 3) === false && S.roster[0].r == u.r; })()]];
  for (const [n, c] of rules) { if (c) ok++; else { bad++; log.push('FAIL 규칙: ' + n); } console.log(`  ${c ? '통과' : '실패'}  ${n}`); }
  bad += rbad;
  console.log(`[Aug] 통과 ${ok} / 실패 ${bad}`); log.forEach(l => console.log(l));
  process.exit(bad ? 1 : 0);
}
if (PVP) {
const rot = ro => ro.map(o => ({ ...o, c: 5 - o.c, r: 9 - o.r }));
const hasBig = ro => ro.some(o => Engine.T[o.type] && Engine.T[o.type].big);
const flags = f => Object.assign(baseSt(3), { negMax: 0, neg: 0 }, f);
const runPvp = (stA, stB, seed) => { Engine.begin({ seed, st: stA, st1: stB, en: rot(stB.roster) }); let n = 0; while (!Engine.step(0.05) && n++ < 3000); return Engine.result(); };
let ok = 0, bad = 0; const log = [];
const check = (name, cond) => { if (cond) ok++; else { bad++; log.push('FAIL ' + name); } };

// (a) 결정성
for (const seed of [1, 2, 3]) { const a = flags({}), b = flags({ vers: 1, accel: 1 }); runPvp(a, b, seed); const x = Engine.fullState(); runPvp(a, b, seed); check('PvP 결정성 ' + seed, x === Engine.fullState()); }

// (b) 전투 시작 직후 효과가 해당 팀에만 붙는지
const startUs = (stA, stB) => { Engine.begin({ seed: 5, st: stA, st1: stB, en: rot(stB.roster) }); return Engine.getB().us; };
for (const side of [0, 1]) {
  const A = flags({}), Bq = flags({}); (side ? Bq : A).vers = 1;
  let us = startUs(A, Bq); check(`vers → 팀${side}만 보급(bo)`, us.filter(u => u.team == side).every(u => u.bo == 1) && us.filter(u => u.team != side && u.team < 2).every(u => !u.bo));
  const A2 = flags({}), B2 = flags({}); (side ? B2 : A2).bunseo = 1;
  us = startUs(A2, B2); check(`bunseo → 팀${side}만 사기+2`, us.filter(u => u.team == side && u.type != 'wall').every(u => u.mor == 2) && us.filter(u => u.team != side).every(u => !u.mor));
  const A3 = flags({}), B3 = flags({}); (side ? B3 : A3).accel = 1;
  us = startUs(A3, B3); check(`accel → 팀${side} 2기만 가속`, us.filter(u => u.team == side && u.hs).length == 2 && us.filter(u => u.team != side && u.hs).length == 0);
  const A4 = flags({}), B4 = flags({}); (side ? B4 : A4).marchH = 1;
  us = startUs(A4, B4); check(`marchH → 상대 팀${1 - side}만 굶주림(hu)`, us.filter(u => u.team == 1 - side && u.type != 'wall').every(u => u.hu == 1) && us.filter(u => u.team == side).every(u => !u.hu));
}
// 협상: 팀별 횟수 사용
{ const A = flags({ negMax: 1 }), Bq = flags({ negMax: 1 }); Engine.begin({ seed: 5, st: A, st1: Bq, en: rot(Bq.roster) }); Engine.negotiate(1); check('협상(팀1)이 팀1 횟수만 소모', Engine.getSt1().neg == 0 && Engine.getSt().neg == 1); }
// 팀 구분 없이 도는지 (증강 조합 무작위, 양쪽, 오류 없이 끝나는지)
{ let k = 7; const pick = () => { k = (k * 1103515245 + 12345) & 0x7fffffff; return k; }; let thrown = 0;
  const keys = ['vers', 'bunseo', 'accel', 'marchH', 'medx', 'lee', 'conf', 'comm', 'holy', 'mon', 'sacOn', 'dm', 'speed', 'wihwa', 'seduce', 'napo']; 
  for (let i = 0; i < 80; i++) { const A = flags({}), Bq = flags({}); for (const q of [A, Bq]) for (let j = 0; j < 4; j++) q[keys[pick() % keys.length]] = 1 + (pick() % 2);
    try { runPvp(A, Bq, 100 + i); } catch (e) { thrown++; log.push('THROW ' + e.message); } }
  check('PvP 무작위 증강 조합 80회 오류 없음', thrown == 0); }

// (c) 대칭성: 같은 증강을 1번 팀이 가질 때와 2번 팀이 가질 때의 승률
const orig = makeOrig(); const AUGids = JSON.parse(orig.run('JSON.stringify(A.map(a=>a.id))'));
const base = baseSt(3); let asym = [], skippedBig = 0, tot = 0, sumD = 0;
const N = 20;
// 기준선: 증강 없음, 같은 부대끼리
{ let w0 = 0, w1 = 0; for (let s = 1; s <= 40; s++) { const r = runPvp(flags({}), flags({}), s); if (r == 'win') w0++; else if (r == 'lose') w1++; } console.log(`[기준선] 증강 없는 같은 부대 40판: 1번 팀 승 ${w0}, 2번 팀 승 ${w1}`); }
for (const id of AUGids) {
  const b = buildSt(orig, 3, [id], false, 77); if (b.err || hasBig(b.st.roster)) { skippedBig++; continue; }
  const fl = b.st; fl.negMax = fl.negMax || 0;
  let w0 = 0, w1 = 0;
  for (let s = 1; s <= N; s++) { if (runPvp(fl, flags({}), s) == 'win') w0++; if (runPvp(flags({}), fl, 1000 + s) == 'lose') w1++; }
  tot++; const d = (w0 - w1) / N; sumD += Math.abs(d); if (Math.abs(d) >= 0.3) asym.push(`${id}: 1번 팀일 때 ${w0}/${N} vs 2번 팀일 때 ${w1}/${N}`);
}
console.log(`[대칭성] 증강 ${tot}종 비교 (큰 유닛 포함/적용실패 ${skippedBig}종 제외), 승률 차이 평균 ${(sumD / tot * 100).toFixed(1)}%p, 30%p 이상 차이 나는 증강 ${asym.length}종`);
asym.forEach(a => console.log('  ' + a));
console.log(`[PvP 모드] 통과 ${ok} / 실패 ${bad}`); log.forEach(l => console.log(l));
process.exit(bad ? 1 : 0);
}
if (!PVP && !AUGT) {
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

}

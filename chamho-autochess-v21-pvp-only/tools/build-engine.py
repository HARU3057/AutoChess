#!/usr/bin/env python3
"""public/index.html 의 <script> 에서 전투 계산 코드만 뽑아 engine.js 를 만든다.
사용:  python3 tools/build-engine.py public/index.html engine.js
원본 코드는 그대로 복사하고, 아래 4가지만 바꾼다.
  1) Math.random()            -> rnd()   (시드 기반)
  2) hud()                    -> 훅(아무 것도 안 함)
  3) b.fx.push / B.fx.push    -> FXP()   (이벤트 큐에도 기록)
  4) setTimeout(...finish...) -> endBattle()  (전투 종료 이벤트)
그리고 txt() 도 이벤트 큐에 기록하도록 감싼다.
"""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf8').read()
i = s.find('<script>') + 8
j = s.rfind('</script>')
L = s[i:j].split('\n')
# 줄 번호는 <script> 바로 다음 줄이 1번 (분석 때 쓴 번호와 같음)
# L[0] 은 '<script>' 뒤 빈 줄 = 1번 줄

def rng(a, b): return L[a-1:b]          # 1-based, inclusive

# --- 가져올 구간 (원본 줄 번호) ---
parts = []
parts += rng(3, 25)        # 좌표/지오메트리 상수, 유닛 표 T
parts += rng(26, 26)       # SOLD
parts += rng(156, 156)     # REL, NOCV (성직자 계열 목록 등)
parts += rng(200, 224)     # genEn, mk, start, 능력 함수들, conf, ... (UI 함수 187~199 제외)
parts += rng(225, 266)     # 이후 전투 보조 함수들 ~ INFt/shf
parts += rng(293, 361)     # troyOpen ~ upd (293 이전 268~292 는 AI 군대 생성이라 제외)
parts += rng(371, 394)     # spawnBig ~ snap (366~370 증강 뽑기 UI 제외)
code = '\n'.join(parts)

# 원본의 finish/drawEnd 는 화면 전환이므로 쓰지 않는다 (엔진은 결과만 낸다)
code = code.replace("setTimeout(()=>b.res=='draw'?drawEnd():finish(b.res=='win'),1300)", "endBattle(b.res)")
code = re.sub(r'\bMath\.random\(\)', 'rnd()', code)
code = re.sub(r'\bhud\(\)', 'hud()', code)
code = re.sub(r'\b([Bb])\.fx\.push\(', 'FXP(', code)
code = code.replace("function txt(u,s,c){B.tx.push({x:u.x,y:u.y-20,s,c,t:.7})}",
                    "function txt(u,s,c){B.tx.push({x:u.x,y:u.y-20,s,c,t:.7});EV.push({k:'txt',x:u.x,y:u.y-20,s,c})}")
assert 'endBattle(b.res)' in code and 'EV.push' in code
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import team_patch
code = team_patch.apply(code)
import aug_extract
aug = aug_extract.extract(s[i:j])
aug = re.sub(r'\bMath\.random\(\)', 'rnd()', aug)
aug = re.sub(r'\bhud\(\)', 'hud()', aug)
code = code + '\n' + aug

header = r'''/* engine.js — 참호 오토체스 전투 계산 엔진 (자동 생성: tools/build-engine.py)
 * 브라우저와 Node 양쪽에서 동작. DOM/canvas 를 쓰지 않는다.
 * 사용법은 engine-report.md 참고.
 */
(function (root) {
'use strict';
// ---- 시드 난수 (mulberry32) ----
let _s = 1;
function seed(n) { _s = (n >>> 0) || 1; }
function rnd() { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
// ---- 화면용 이벤트 큐 ----
let EV = [];
// 이펙트 이벤트: 유닛 객체 참조(a,b)는 네트워크로 보낼 수 있게 B.us 인덱스({u:i}) 또는 좌표({x,y})로 바꿔 기록한다.
function evRef(v) { if (v && typeof v === 'object') { const i = B ? B.us.indexOf(v) : -1; return i >= 0 ? { u: i } : { x: v.x, y: v.y }; } return v; }
function FXP() { for (const f of arguments) { B.fx.push(f); const e = Object.assign({}, f); if ('a' in e) e.a = evRef(e.a); if ('b' in e) e.b = evRef(e.b); EV.push(e); } }
function hud() { fuseCheck(); }          // 원본 hud()는 화면 갱신 외에 'AI+보병 융합' 규칙(fuseCheck)도 실행한다. 화면 부분만 뺐다.
let st = {}, st1 = {}, B = null, RESULT = null, LEG = true;   // st = 0번 팀(P1) 상태/증강, st1 = 1번 팀(P2) 상태/증강
const ES = {};
const SS = t => t === 0 ? st : t === 1 ? st1 : ES;           // 팀별 증강 상태
const TEAMS = () => LEG ? [0] : [0, 1];                       // 호환 모드(싱글)는 0번 팀만 증강 적용
const AN = k => st[k] || st1[k];                               // 전장 전체 규칙(시간 제한 등)
function endBattle(res) { RESULT = res; EV.push({ k: 'end', res }); }
'''
footer = r'''
// ---- 공개 API ----
function begin(opts) {
  // 호환 모드(싱글): { seed, st }           원본과 똑같이 동작 (증강은 0번 팀만, 적은 st.en)
  // PvP 모드:        { seed, st, st1, en }  st=P1, st1=P2 의 st 사본(각자 증강 플래그/negMax),
  //                                         en = P2 부대를 180도 회전해 P1 시점 좌표로 바꾼 배열
  seed(opts.seed);
  const cl = o => JSON.parse(JSON.stringify(o));
  LEG = !opts.st1;
  st = cl(opts.st);
  st1 = LEG ? { seduce: st.aiSed || 0 } : cl(opts.st1);
  if (!LEG && opts.en) st.en = cl(opts.en);
  st.phase = 'prep'; st.pend = null; st.paused = 0;
  EV = []; RESULT = null; B = null;
  start();
  return B ? true : false;
}
function step(dt) {                     // dt 초만큼 진행. 끝났으면 true
  if (!B) return true;
  if (!B.end) upd(dt);
  return !!B.end;
}
function negotiateNow(team) { negotiate(team | 0); }
function drain() { const e = EV; EV = []; return e; }
function snapshot() {
  return {
    t: +B.t.toFixed(3), end: B.end, res: B.res,
    us: B.us.map((u, i) => ({ i, team: u.team, type: u.type, c: u.c, r: u.r, x: +u.x.toFixed(1), y: +u.y.toFixed(1),
      hp: Math.round(u.hp), mx: u.mx, dead: u.dead | 0, gone: u.gone | 0, hid: u.hid | 0, fz: u.fz ? 1 : 0, stun: u.stun > 0 ? 1 : 0 }))
  };
}
function fullState() { return JSON.stringify({ t: B.t, res: B.res, rng: _s, us: B.us.map(u => { const o = {}; for (const k of Object.keys(u).sort()) { const v = u[k]; if (typeof v !== 'object' || v === null) o[k] = typeof v === 'number' ? +v.toFixed(4) : v; } return o; }) }); }
function result() { return RESULT; }
// ---- 네트워크 전송용: 유닛의 값 필드만(객체 제외, 소수 2자리), 그리기에 필요한 전투 보조 정보 ----
function units() { return B.us.map(u => { const o = {}; for (const k in u) { const v = u[k]; if (v === null || typeof v !== 'object') o[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v; } return o; }); }
function safe(v, d) {
  if (v === null || typeof v !== 'object') return v;
  if (B && B.us.indexOf(v) >= 0) return { u: B.us.indexOf(v) };
  if (v instanceof Set) return [...v];
  if (d > 4) return null;
  if (Array.isArray(v)) return v.map(x => safe(x, d + 1));
  const o = {}; for (const k of Object.keys(v)) { const x = v[k]; if (typeof x !== 'function') o[k] = safe(x, d + 1); } return o;
}
function aux() {
  return safe({ tz: B.tz || null, hole: B.hole || null, pl: B.pl || [], cf: B.cf || null, terr: B.terr || null, road: B.road || null,
    tr: B.tr || null, qk: B.qk || null, fr: B.fr || 0, sf: B.sf || null, dmD: B.dmD || null, end: B.end ? 1 : 0, res: B.res || null }, 0);
}
function getB() { return B; }
function getSt() { return st; }
function getSt1() { return st1; }

// ---- 증강 선택 API (서버가 증강 뽑기/선택/기물 지정/배치 이동을 직접 처리) ----
// 모든 함수는 플레이어 상태 S(= 원본의 st)를 받는다. S 는 서버 메모리에만 있다. seedN 은 서버가 정한 난수 시드.
function aOffer(S, seedN, excluded, reroll) {
  st = S; seed(seedN);
  if (reroll) { if (S.rrR == S.round) return null; S.rrR = S.round; }   // 리롤은 라운드당 1회
  const ex = new Set(excluded || []);
  let out, t = 0;
  do { out = roll3(); t++; } while (out.some(a => ex.has(a.id)) && t < 50);   // 제외 증강이 나오면 3장을 다시 뽑음 (기존 pvp.js 와 같은 방식)
  S.offer = out.map(a => a.id);
  return S.offer.slice();
}
function aChoose(S, id, seedN) {
  st = S;
  if (S.phase != 'pick' && S.phase != 'prep') return { err: 'phase' };
  if (!S.offer || !S.offer.includes(id)) return { err: 'not-offered' };
  if (S.pend) return { err: 'pending' };
  seed(seedN); S.offer = null; chooseCore(id);
  return { ok: 1 };
}
function aPendPick(S, c, r, seedN) {
  st = S; seed(seedN);
  if (S.phase != 'prep' || !S.pend) return { err: 'no-pend' };
  const o = occR(c, r), sig = () => JSON.stringify([S.roster, S.pend && [S.pend.k, S.pend.step, (S.pend.got || []).length], S.bid]);
  const before = sig();
  pendPickCore(o);
  return { ok: 1, accepted: sig() !== before };
}
function aMove(S, c0, r0, c, r) {
  st = S;
  if (S.phase != 'prep' || S.pend || S.paused) return false;
  if (r0 < 5 || r < 5) return false;
  const a = occR(c0, r0); if (!a) return false;
  st.sel = a; const o = occR(c, r); moveCore(o, c, r); st.sel = null; hud();   // 원본은 다음 화면 갱신(hud)에서 융합 규칙이 돈다
  return a.c != c0 || a.r != r0 || (o && (o.c != c || o.r != r));
}
function aView(S) {
  const p = S.pend, got = p && p.got || [];
  return { roster: S.roster.map(o => Object.assign({}, o)), aug: (S.aug || []).slice(), lives: S.lives, round: S.round, kami: S.kami, negMax: S.negMax || 0,
    flash: S.flash || '', own: Object.keys(S.own || {}), negEver: S.negEver ? 1 : 0, offer: S.offer ? S.offer.slice() : null, rrUsed: S.rrR == S.round, lose: S.lose ? 1 : 0, hard: S.hard ? 1 : 0,
    pend: p ? { k: p.k, step: p.step || 0, got: got.map(o => [o.c, o.r]), elig: S.roster.filter(p.f).filter(o => !got.includes(o)).map(o => [o.c, o.r]) } : null };
}
function aRotate(roster) {   // 상대 시점으로 180도 회전 (큰 유닛은 점유 칸 집합이 같아지는 기준점을 찾음)
  return roster.map(o => {
    if (!T[o.type] || !T[o.type].big) return Object.assign({}, o, { c: 5 - o.c, r: 9 - o.r });
    const want = new Set(cellsOf(o).map(p => (5 - p[0]) + ',' + (9 - p[1])));
    for (let r = 0; r < 10; r++) for (let c = 0; c < 6; c++) {
      const q = Object.assign({}, o, { c, r }), cs = cellsOf(q);
      if (cs.length == want.size && cs.every(p => want.has(p[0] + ',' + p[1]))) return q;
    }
    return Object.assign({}, o, { c: 5 - o.c, r: 9 - o.r });
  });
}
const Aug = { newState: newPlayerState, offer: aOffer, choose: aChoose, pendPick: aPendPick, move: aMove, view: aView, rotate: aRotate, list: () => A.map(a => ({ id: a.id, n: a.n, d: a.d, rar: a.rar, star: !!a.star })) };
const Engine = { begin, step, drain, snapshot, fullState, result, units, aux, negotiate: negotiateNow, seed, rnd, getB, getSt, getSt1, Aug, T, genEn, W, H };
if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);
'''
open(dst, 'w', encoding='utf8').write(header + code + '\n' + footer)
print('wrote', dst, len(code), 'bytes of copied logic')

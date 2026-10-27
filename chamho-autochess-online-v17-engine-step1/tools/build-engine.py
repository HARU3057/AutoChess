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
function FXP() { for (const f of arguments) { B.fx.push(f); EV.push(Object.assign({ k: 'fx' }, f)); } }
function hud() {}                       // 원본의 화면 갱신 호출 (엔진에서는 아무 것도 안 함)
let st = {}, B = null, RESULT = null;
function endBattle(res) { RESULT = res; EV.push({ k: 'end', res }); }
'''
footer = r'''
// ---- 공개 API ----
function begin(opts) {
  // opts: { seed, st }  st = 원본 st 객체의 JSON 사본 (roster, en, round, 증강 플래그 ...)
  seed(opts.seed);
  st = JSON.parse(JSON.stringify(opts.st));
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
function negotiateNow() { negotiate(); }
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
function getB() { return B; }
function getSt() { return st; }
const Engine = { begin, step, drain, snapshot, fullState, result, negotiate: negotiateNow, seed, rnd, getB, getSt, T, genEn, W, H };
if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);
'''
open(dst, 'w', encoding='utf8').write(header + code + '\n' + footer)
print('wrote', dst, len(code), 'bytes of copied logic')

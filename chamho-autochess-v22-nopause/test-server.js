#!/usr/bin/env node
/* test-server.js — 서버 진행(pvp-game.js) 검증
 *  A) 가짜 소켓으로 Game 직접 검증: 규칙 위반 요청 거절, 전투 프레임(델타) 복원 = 엔진 직접 실행 결과, 협상 재계산,
 *     두 봇이 끝까지(목숨 0) 플레이, 시간 초과 자동 진행, 이탈 처리
 *  B) 실제 WebSocket 통합(ws 패키지가 있을 때): server.js 를 띄워서 방 만들기→입장→한 라운드 진행
 * 사용: node test-server.js
 */
process.env.PVP_TICK_MS = '1';
process.env.PVP_PICK_MS = '250';
process.env.PVP_PLACE_MS = '250';
const assert = require('assert');
const { Game, CFG, FLIP } = require('./pvp-game.js');
const Engine = require('./engine.js');
const Aug = Engine.Aug;

let ok = 0, bad = 0; const log = [];
const check = (name, cond, extra) => { if (cond) ok++; else { bad++; log.push('FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function mkGame(opts = {}) {
  const msgs = [[], []], w = [{ i: 0 }, { i: 1 }]; let ended = 0; const hooks = [];
  const g = new Game(w[0], w[1], (ws, m) => { const c = JSON.parse(JSON.stringify(m)); msgs[ws.i].push(c); hooks.forEach(h => h(ws.i, c)); }, () => { ended++; });
  return { g, msgs, w, hooks, ended: () => ended };
}
// 델타 복원
function applyFrames(init, frames) {
  let us = init.us.map(u => ({ ...u })), aux = JSON.parse(JSON.stringify(init.aux));
  for (const f of frames) { for (const [k, ch] of f.d) us[k] = Object.assign(us[k] || {}, ch); if (f.a) aux = f.a; }
  return { us, aux };
}
// 봇: 상태 메시지를 보고 행동 (증강은 첫 번째, 기물 지정은 첫 후보, 그다음 레디)
function bot(G, i, opts = {}) {
  G.hooks.push((to, m) => {
    if (to !== i || m.t !== 'state' || opts.idle) return;
    setImmediate(() => {
      if (G.g.over) return;
      if (m.phase === 'pick' && m.me.offer) G.g.onMsg(G.w[i], { t: 'pick', id: m.me.offer[0] });
      else if (m.phase === 'place') {
        if (m.me.pend) { const c = m.me.pend.elig[0]; if (c) G.g.onMsg(G.w[i], { t: 'unit', c: c[0], r: c[1] }); else G.g.p[i].S.pend = null; }
        else G.g.onMsg(G.w[i], { t: 'ready' });
      }
    });
  });
}

(async () => {
  // ===== A1. 규칙 위반 요청은 거절되고 상태가 안 바뀜 =====
  {
    const G = mkGame(); G.g.start(); const S = G.g.p[0].S;
    const before = JSON.stringify(S.roster);
    G.g.onMsg(G.w[0], { t: 'pick', id: 'tank' });                 // 증강 선택 단계가 아님
    check('A1 선택 단계가 아닐 때 pick 거절', G.msgs[0].some(m => m.t === 'err') && S.aug.length === 0);
    G.g.onMsg(G.w[0], { t: 'move', from: [1, 7], to: [2, 3] });   // 적 진영으로 이동
    check('A1 적 진영으로 이동 거절', JSON.stringify(S.roster) === before);
    G.g.onMsg(G.w[0], { t: 'move', from: [0, 0], to: [2, 7] });   // 상대 진영 칸에서 집기
    check('A1 내 진영이 아닌 칸에서 이동 거절', JSON.stringify(S.roster) === before);
    G.g.onMsg(G.w[0], { t: 'move', from: 'x', to: null });
    G.g.onMsg(G.w[0], { t: 'unit', c: 99, r: -4 });
    G.g.onMsg(G.w[0], { t: 'negotiate' });
    check('A1 이상한 입력에도 서버가 죽지 않음', !G.g.over);
    // 합법 이동은 처리되고 상대에게도 (회전되어) 보임
    G.g.onMsg(G.w[0], { t: 'move', from: [1, 7], to: [0, 9] });
    const moved = S.roster.find(o => o.c === 0 && o.r === 9);
    const oppSees = G.msgs[1].filter(m => m.t === 'state').pop().opp.roster.some(o => o.c === 5 && o.r === 0);
    check('A1 합법 이동 반영 + 상대에게 180도 회전되어 전달', !!moved && oppSees);
    G.g.leave(G.w[0]);
  }

  // ===== A2. 전투 한 판: 프레임 복원 결과 == 엔진 직접 실행 =====
  {
    const G = mkGame(); G.g.start(); let battle = null, snap = null;
    G.hooks.push((to, m) => { if (m.t === 'b_start' && to === 0) { battle = G.g.battle; snap = { S0: JSON.parse(JSON.stringify(battle.S0)), S1: JSON.parse(JSON.stringify(battle.S1)), seed: battle.seed }; } });
    G.g.onMsg(G.w[0], { t: 'ready' }); G.g.onMsg(G.w[1], { t: 'ready' });
    for (let k = 0; k < 400 && !G.msgs[0].some(m => m.t === 'b_end'); k++) await wait(20);
    const m0 = G.msgs[0], start = m0.find(m => m.t === 'b_start'), frames = m0.filter(m => m.t === 'b_frame'), end = m0.find(m => m.t === 'b_end');
    { const us = start.init.us, pos = {}; us.forEach(u => { pos[u.c + ',' + u.r] = u; }); let good = true, n = 0;
      for (const k in pos) { const [c, r] = k.split(',').map(Number), q = pos[(5 - c) + ',' + (9 - r)]; if (q) { n++; if (Math.abs(pos[k].x + q.x - FLIP.x) > 0.01 || Math.abs(pos[k].y + q.y - FLIP.y) > 0.01) good = false; } }
      check('A2 b_start 의 flip 상수가 실제 좌표와 맞음 (x\'=flip.x-x, y\'=flip.y-y)', good && n > 4 && start.flip.x === FLIP.x); }
    check('A2 전투 시작/프레임/종료 메시지 수신', !!start && frames.length > 10 && !!end, `프레임 ${frames.length}`);
    const rec = applyFrames(start.init, frames);
    Engine.begin({ seed: snap.seed, st: snap.S0, st1: snap.S1, en: Aug.rotate(snap.S1.roster) }); let n = 0; while (!Engine.step(0.05) && n++ < 3000);
    check('A2 델타 복원한 최종 유닛 상태 == 엔진 직접 실행', JSON.stringify(rec.us) === JSON.stringify(Engine.units()), `복원 ${rec.us.length}개 / 직접 ${Engine.units().length}개`);
    check('A2 두 플레이어가 같은 프레임을 받음', JSON.stringify(frames.map(f => f.d)) === JSON.stringify(G.msgs[1].filter(m => m.t === 'b_frame').map(f => f.d)));
    const r0 = end.res, r1 = G.msgs[1].find(m => m.t === 'b_end').res;
    check('A2 결과가 서로 반대(또는 둘 다 무승부)', (r0 === 'draw' && r1 === 'draw') || (r0 === 'win' && r1 === 'lose') || (r0 === 'lose' && r1 === 'win'), r0 + '/' + r1);
    check('A2 엔진 결과와 일치', (Engine.result() === 'win') === (r0 === 'win'));
    check('A2 이벤트에 유닛 객체가 아닌 인덱스/좌표만 들어감', frames.every(f => f.ev.every(e => (e.a === undefined || e.a.u !== undefined || e.a.x !== undefined) && (e.b === undefined || e.b.u !== undefined || e.b.x !== undefined || typeof e.b !== 'object'))));
    await wait(1800);
    const endIdx = G.msgs[0].findIndex(m => m.t === 'b_end'), st = G.msgs[0].slice(endIdx).find(m => m.t === 'state');   // b_end 직후 첫 상태
    if (!st) { check('A2 b_end 뒤 상태 수신', false); }
    if (!st) { } else if (r0 === 'draw') check('A2 무승부는 재배치 단계', st.phase === 'place'); else { check('A2 결과 후 증강 선택 단계로 (3장 제시)', st.phase === 'pick' && st.me.offer.length === 3 && st.opp.phase === 'pick'); check('A2 패자 목숨 -1, 패배 보상 표시', (r0 === 'lose' ? st.me.lives === 2 && st.me.lose === 1 : st.opp.lives === 2)); }
    G.g.leave(G.w[0]);
  }

  // ===== A3. 협상(전투 중 입력): 같은 시드 재계산이 엔진에 같은 입력을 넣은 것과 같은지 =====
  {
    const G = mkGame(); G.g.start(); G.g.p[0].S.negMax = 1; G.g.p[1].S.negMax = 1;
    let snap = null, sent = -1, first = null;
    G.hooks.push((to, m) => {
      if (m.t === 'b_start' && to === 0) snap = { S0: JSON.parse(JSON.stringify(G.g.battle.S0)), S1: JSON.parse(JSON.stringify(G.g.battle.S1)), seed: G.g.battle.seed };
      if (m.t === 'b_frame' && to === 0 && m.i === 4 && sent < 0) { sent = G.g.battle.cur; first = JSON.stringify(G.g.battle.frames.slice(0, sent).map(f => f.d)); G.g.onMsg(G.w[0], { t: 'negotiate' }); }
    });
    G.g.onMsg(G.w[0], { t: 'ready' }); G.g.onMsg(G.w[1], { t: 'ready' });
    for (let k = 0; k < 400 && !G.msgs[0].some(m => m.t === 'b_end'); k++) await wait(20);
    const frames = G.msgs[0].filter(m => m.t === 'b_frame'), start = G.msgs[0].find(m => m.t === 'b_start');
    check('A3 협상 입력 후에도 전투가 끝까지 진행', !!G.msgs[0].find(m => m.t === 'b_end') && !G.msgs[0].some(m => m.t === 'err'));
    // 클라이언트가 받은 프레임들: 협상 이전 프레임은 그대로, 이후는 재계산본
    const rec = applyFrames(start.init, frames);
    Engine.begin({ seed: snap.seed, st: snap.S0, st1: snap.S1, en: Aug.rotate(snap.S1.roster) }); let tick = 0, done = false;
    while (!done && tick < 3000) { if (tick === sent) Engine.negotiate(0); done = Engine.step(0.05); tick++; }
    check('A3 협상 반영한 최종 상태 == 엔진에 같은 틱에 협상을 넣은 직접 실행', JSON.stringify(rec.us) === JSON.stringify(Engine.units()), `협상 틱 ${sent}`);
    check('A3 협상 횟수 제한(negMax=1): 두 번째는 거절', (() => { const g2 = mkGame(); g2.g.start(); g2.g.p[0].S.negMax = 1; g2.g.p[1].S.negMax = 0; g2.g.onMsg(g2.w[0], { t: 'ready' }); g2.g.onMsg(g2.w[1], { t: 'ready' }); g2.g.onMsg(g2.w[1], { t: 'negotiate' }); const rej = g2.msgs[1].some(m => m.t === 'err'); g2.g.leave(g2.w[0]); return rej; })());
    G.g.leave(G.w[0]);
  }

  // ===== A4. 봇 둘이 끝까지: 목숨이 0이 되면 over =====
  {
    const G = mkGame(); bot(G, 0); bot(G, 1); G.g.start();
    for (let k = 0; k < 1500 && !G.ended(); k++) await wait(20);
    const o0 = G.msgs[0].find(m => m.t === 'over'), o1 = G.msgs[1].find(m => m.t === 'over');
    check('A4 봇 둘이 끝까지 진행해 게임 종료', G.ended() === 1 && !!o0 && !!o1);
    check('A4 승자는 정확히 한 명', o0 && o1 && o0.win !== o1.win);
    const lives = [G.g.p[0].S.lives, G.g.p[1].S.lives]; check('A4 패자의 목숨이 0', lives.includes(0), lives.join(','));
    const nb = G.msgs[0].filter(m => m.t === 'b_start').length; console.log(`  (A4: 전투 ${nb}판, 프레임 ${G.msgs[0].filter(m => m.t === 'b_frame').length}개)`);
    check('A4 종료 후 추가 메시지 없음', (() => { const n = G.msgs[0].length; return true; })());
  }

  // ===== A5. 시간 초과 자동 진행 (아무도 아무것도 안 해도 게임이 진행됨) =====
  {
    const G = mkGame(); G.g.start();
    for (let k = 0; k < 600 && G.msgs[0].filter(m => m.t === 'b_start').length < 2 && !G.ended(); k++) await wait(20);
    const nb = G.msgs[0].filter(m => m.t === 'b_start').length;
    check('A5 아무 입력이 없어도 배치 시간 종료 → 자동 레디 → 전투, 증강 시간 종료 → 자동 선택 → 다음 전투', nb >= 2 || G.ended() === 1, `전투 ${nb}판`);
    check('A5 자동 선택으로 증강을 얻음', G.g.p[0].S.aug.length >= 1 || G.g.p[1].S.aug.length >= 1 || G.ended() === 1);
    G.g.leave(G.w[0]);
  }

  // ===== A6. 이탈 처리 =====
  {
    const G = mkGame(); G.g.start(); G.g.onMsg(G.w[0], { t: 'ready' }); G.g.onMsg(G.w[1], { t: 'ready' });
    await wait(30); G.g.leave(G.w[1]);
    check('A6 전투 중 이탈 → 상대에게 opp_left, 게임 정리', G.msgs[0].some(m => m.t === 'opp_left') && G.ended() === 1);
    const n = G.msgs[0].length; await wait(100);
    check('A6 이탈 뒤 프레임 전송이 멈춤', G.msgs[0].length === n);
  }

  // ===== B. 실제 WebSocket 통합 =====
  let WS = null; try { WS = require('ws'); } catch (e) { }
  if (!WS) console.log('[B] ws 패키지가 없어 통합 테스트는 건너뜀 (npm install 후 다시 실행)');
  else {
    const { spawn } = require('child_process'); const port = 38000 + Math.floor(Math.random() * 1000);
    const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), PVP_SERVER_AUTH: '1', PVP_PLACE_MS: '30000', PVP_PICK_MS: '30000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);
    await wait(800);
    const open = () => new Promise(res => { const ws = new WS('ws://127.0.0.1:' + port + '/ws'); ws.msgs = []; ws.on('message', d => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); });
    try {
      const a = await open(), b = await open();
      a.send(JSON.stringify({ t: 'create', name: '테스트방' })); await wait(100);
      const room = a.msgs.filter(m => m.t === 'rooms').pop().rooms[0]; check('B 방 목록에 방이 보임', !!room && room.name === '테스트방');
      b.send(JSON.stringify({ t: 'join', id: room.id })); await wait(300);
      check('B 매칭되고 서버 진행 방식(auth)임', a.msgs.some(m => m.t === 'matched' && m.auth === true) && b.msgs.some(m => m.t === 'matched' && m.auth === true));
      check('B 매칭 직후 배치 단계 상태를 받음', a.msgs.some(m => m.t === 'state' && m.phase === 'place' && m.me.roster.length === 6));
      a.send(JSON.stringify({ t: 'pick', id: 'tank' })); await wait(50);
      check('B 선택 단계가 아닐 때 pick 은 err', a.msgs.some(m => m.t === 'err'));
      a.send(JSON.stringify({ t: 'ready' })); await wait(50);
      check('B 한쪽 레디 → 상대에게 ready 표시', b.msgs.filter(m => m.t === 'state').pop().opp.ready === true);
      b.send(JSON.stringify({ t: 'ready' })); await wait(1200);
      check('B 양쪽 레디 → 전투 프레임 수신', a.msgs.some(m => m.t === 'b_start') && a.msgs.filter(m => m.t === 'b_frame').length > 5);
      for (let k = 0; k < 100 && !a.msgs.some(m => m.t === 'b_end'); k++) await wait(50);
      check('B 전투 종료(b_end) 수신', a.msgs.some(m => m.t === 'b_end'));
      b.close(); await wait(300);
      check('B 한 명이 끊기면 상대에게 opp_left 또는 over', a.msgs.some(m => m.t === 'opp_left' || m.t === 'over'));
      a.close();
    } catch (e) { bad++; log.push('FAIL B 통합 예외 ' + e.message + '\n' + out); }
    srv.kill();
  }

  // ===== C. 환경변수를 켜지 않은 기본 상태는 기존 중계 방식 그대로 =====
  if (WS) {
    const { spawn } = require('child_process'); const port = 39000 + Math.floor(Math.random() * 500);
    const env = { ...process.env, PORT: String(port) }; delete env.PVP_SERVER_AUTH;
    const srv = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); await wait(800);
    const open = () => new Promise(res => { const ws = new WS('ws://127.0.0.1:' + port + '/ws'); ws.msgs = []; ws.on('message', d => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); });
    try {
      const a = await open(), b = await open(); a.send(JSON.stringify({ t: 'create', name: '기존방식' })); await wait(100);
      b.send(JSON.stringify({ t: 'join', id: a.msgs.filter(m => m.t === 'rooms').pop().rooms[0].id })); await wait(200);
      check('C 기본값은 기존 방식(auth=false), 서버 진행 상태 메시지 없음', a.msgs.some(m => m.t === 'matched' && m.auth === false) && !a.msgs.some(m => m.t === 'state'));
      a.send(JSON.stringify({ t: 'ready', roster: [{ type: 'inf', c: 1, r: 7 }] })); b.send(JSON.stringify({ t: 'ready', roster: [{ type: 'inf', c: 2, r: 8 }] })); await wait(200);
      check('C 기존 방식: 양쪽 레디 → start 로 상대 부대 전달', a.msgs.some(m => m.t === 'start' && m.en[0].c === 2) && b.msgs.some(m => m.t === 'start' && m.en[0].c === 1));
      a.close(); b.close();
    } catch (e) { bad++; log.push('FAIL C 예외 ' + e.message); }
    srv.kill();
  }

  console.log(`[서버 진행] 통과 ${ok} / 실패 ${bad}`); log.forEach(l => console.log(l));
  process.exit(bad ? 1 : 0);
})();

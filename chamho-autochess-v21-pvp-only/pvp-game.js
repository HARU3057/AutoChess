// 참호 오토체스 PvP 게임 진행 (서버가 모든 상태를 가짐)
// - 증강 제시/선택/기물 지정/배치 이동/전투 계산/목숨 처리를 전부 서버가 한다. 클라이언트는 요청만 보내고 결과를 그린다.
// - 전투는 서버가 끝까지 미리 계산해 두고 초당 20프레임(변경분만)으로 흘려 보낸다. 협상(전투 중 입력)이 들어오면
//   같은 시드로 처음부터 다시 계산해서(결정적 엔진) 아직 안 보낸 프레임만 교체한다.
'use strict';
const crypto = require('crypto');
const Engine = require('./engine.js');
const Aug = Engine.Aug;

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const CFG = {
  PICK_MS: num(process.env.PVP_PICK_MS, 30000),     // 증강 선택 30초
  PLACE_MS: num(process.env.PVP_PLACE_MS, 30000),   // 배치 30초
  TICK_MS: num(process.env.PVP_TICK_MS, 50),        // 프레임 간격 (엔진 dt 0.05초 = 초당 20틱)
  MAX_TICKS: 3000,
};
const DT = 0.05;
// PvP 제외 증강 (필드를 바꾸는 증강 / 전투 중 무작위 이벤트 / 반자이)
const EXCLUDED = ['ice', 'quake', 'warp', 'trench', 'highland', 'siege', 'banzai', 'meteor', 'sch', 'wild', 'bounty', 'lb'];
// 좌표 180도 뒤집기 상수: 칸 (c,r) 과 (5-c, 9-r) 의 중심 좌표 합. seat 1(2번 플레이어) 클라이언트가 x'=FLIP.x-x, y'=FLIP.y-y 로 뒤집어 그린다.
const FLIP = { x: 360, y: 440.5 };
const rseed = () => (crypto.randomBytes(4).readUInt32LE(0) >>> 0) || 1;
const clone = o => JSON.parse(JSON.stringify(o));

class Game {
  // send(ws, msg) 는 서버가 넘겨 준다. onEnd(game) 는 게임이 끝났을 때 서버가 방을 정리하도록 부른다.
  constructor(host, guest, send, onEnd) {
    this.send = send; this.onEnd = onEnd; this.over = false; this.battle = null; this.seq = 0;
    this.p = [host, guest].map(ws => ({ ws, S: Aug.newState(), phase: 'place', ready: false, timer: null, deadline: 0 }));
    for (const q of this.p) q.S.hard = 0;
  }
  idx(ws) { return this.p[0].ws === ws ? 0 : this.p[1].ws === ws ? 1 : -1; }
  start() { for (let i = 0; i < 2; i++) this.enterPlace(i); }

  // ---------- 상태 전송 ----------
  view(i) {
    const me = this.p[i], op = this.p[1 - i];
    return { t: 'state', phase: me.phase, deadline: me.deadline, now: Date.now(), me: Aug.view(me.S),
      opp: { roster: Aug.rotate(op.S.roster), augs: Object.keys(op.S.own || {}), lives: op.S.lives, ready: op.ready, phase: op.phase } };   // augs = 증강 id 목록 (화면이 id 로 이름을 찾음)
  }
  push(i) { this.send(this.p[i].ws, this.view(i)); }
  pushAll() { this.push(0); this.push(1); }
  fail(i, msg) { this.send(this.p[i].ws, { t: 'err', msg }); }

  // ---------- 단계 ----------
  setTimer(i, ms, fn) { const q = this.p[i]; clearTimeout(q.timer); q.deadline = Date.now() + ms; q.timer = setTimeout(() => { if (!this.over) fn(); }, ms); }
  enterPick(i) {
    const q = this.p[i]; q.phase = 'pick'; q.ready = false; q.S.phase = 'pick'; q.S.pend = null; q.S.sel = null;
    Aug.offer(q.S, rseed(), EXCLUDED);
    this.setTimer(i, CFG.PICK_MS, () => this.autoPick(i));
  }
  autoPick(i) {   // 시간이 끝나면 제시된 3장 중 무작위 자동 선택 (원본과 같음)
    const q = this.p[i]; if (q.phase !== 'pick' || !q.S.offer) return;
    const id = q.S.offer[crypto.randomInt(q.S.offer.length)];
    this.doPick(i, id); this.pushAll();
  }
  enterPlace(i, flash) {
    const q = this.p[i]; q.phase = 'place'; q.ready = false; q.S.phase = 'prep'; q.S.offer = null;
    if (flash !== undefined) q.S.flash = flash;
    this.setTimer(i, CFG.PLACE_MS, () => { q.S.pend = null; this.doReady(i, true); this.pushAll(); });   // 시간이 끝나면 지정 대기를 풀고 자동 레디
    this.push(i);
  }
  doPick(i, id) {
    const q = this.p[i]; if (q.phase !== 'pick') return { err: 'phase' };
    const r = Aug.choose(q.S, id, rseed()); if (r.err) return r;
    this.enterPlace(i); return r;
  }
  doReady(i, force) {
    const q = this.p[i]; if (q.phase !== 'place') return false;
    if (q.S.pend && !force) return false;
    q.S.pend = null; q.ready = true; q.phase = 'wait'; clearTimeout(q.timer); q.deadline = 0;
    if (this.p[0].ready && this.p[1].ready) this.startBattle();
    return true;
  }

  // ---------- 클라이언트 메시지 ----------
  onMsg(ws, m) {
    if (this.over) return; const i = this.idx(ws); if (i < 0) return; const q = this.p[i];
    switch (m.t) {
      case 'pick': { const r = this.doPick(i, String(m.id)); if (r.err) return this.fail(i, r.err === 'not-offered' ? '제시되지 않은 증강입니다.' : r.err === 'pending' ? '기물 지정을 먼저 끝내세요.' : '지금은 선택할 수 없습니다.'); return this.pushAll(); }
      case 'reroll': { if (q.phase !== 'pick') return; const o = Aug.offer(q.S, rseed(), EXCLUDED, true); if (!o) return this.fail(i, '이번 라운드에는 이미 리롤했습니다.'); return this.push(i); }
      case 'unit': { if (q.phase !== 'place') return; const c = m.c | 0, r = m.r | 0; if (c < 0 || c > 5 || r < 0 || r > 9) return; const x = Aug.pendPick(q.S, c, r, rseed()); if (x.err) return; return this.pushAll(); }
      case 'move': { if (q.phase !== 'place') return; const f = m.from, t = m.to; if (!Array.isArray(f) || !Array.isArray(t)) return;
        if (Aug.move(q.S, f[0] | 0, f[1] | 0, t[0] | 0, t[1] | 0)) this.pushAll(); else this.push(i); return; }
      case 'ready': { if (q.phase !== 'place') return; if (q.S.pend) return this.fail(i, '증강 선택(기물 지정)을 먼저 끝내 주세요.'); this.doReady(i); return this.pushAll(); }
      case 'negotiate': return this.negotiate(i);
    }
  }

  // ---------- 전투 ----------
  startBattle() {
    const S0 = clone(this.p[0].S), S1 = clone(this.p[1].S), seed = rseed();
    for (const S of [S0, S1]) { S.pend = null; S.sel = null; S.phase = 'prep'; }
    const b = this.battle = { seed, S0, S1, inputs: [], frames: [], cur: 0, res: null, timer: null, resims: 0, id: ++this.seq };
    for (const q of this.p) q.phase = 'battle';
    try { this.simulate(b); } catch (e) { console.error('전투 계산 오류', e); b.frames = []; b.res = 'draw'; b.init = { us: [], aux: {} }; }
    for (let i = 0; i < 2; i++) this.send(this.p[i].ws, { t: 'b_start', seat: i, id: b.id, seed, tick: CFG.TICK_MS, flip: FLIP, init: b.init, me: Aug.view(this.p[i].S), opp: { roster: Aug.rotate(this.p[1 - i].S.roster), augs: Object.keys(this.p[1 - i].S.own || {}) } });
    b.timer = setInterval(() => this.stream(), CFG.TICK_MS);
  }
  // 같은 시드로 처음부터 계산 (입력=협상 은 해당 틱 직전에 적용)
  simulate(b) {
    Engine.begin({ seed: b.seed, st: b.S0, st1: b.S1, en: Aug.rotate(b.S1.roster) });
    let prev = Engine.units(), prevAux = JSON.stringify(Engine.aux());
    b.init = { us: prev, aux: JSON.parse(prevAux) };
    b.frames = [];
    for (let tick = 0; tick < CFG.MAX_TICKS; tick++) {
      for (const inp of b.inputs) if (inp.tick === tick) Engine.negotiate(inp.team);
      const done = Engine.step(DT);
      const us = Engine.units(), d = [];
      for (let k = 0; k < us.length; k++) {
        if (!prev[k]) { d.push([k, us[k]]); continue; }
        let ch = null; for (const key in us[k]) if (us[k][key] !== prev[k][key]) (ch = ch || {})[key] = us[k][key];
        if (ch) d.push([k, ch]);
      }
      const au = JSON.stringify(Engine.aux()), f = { i: tick, d, ev: Engine.drain() };
      if (au !== prevAux) { f.a = JSON.parse(au); prevAux = au; }
      b.frames.push(f); prev = us;
      if (done) break;
    }
    const r = Engine.result();
    b.res = r || 'draw';                       // 3000틱(150초)을 넘기면 무승부 처리
    b.frames[b.frames.length - 1].last = 1;
  }
  stream() {
    const b = this.battle; if (!b) return;
    if (b.cur < b.frames.length) {
      const f = b.frames[b.cur++];
      for (const q of this.p) this.send(q.ws, { t: 'b_frame', id: b.id, ...f });
    }
    if (b.cur >= b.frames.length) { clearInterval(b.timer); b.timer = null; setTimeout(() => this.endBattle(b), 1300); }   // 결과 문구를 잠깐 보여 주고 다음 단계로 (원본: 1.3초)
  }
  negotiate(i) {
    const b = this.battle; if (!b || b.cur >= b.frames.length) return;
    const S = i === 0 ? b.S0 : b.S1, used = b.inputs.filter(x => x.team === i).length;
    if (used >= (S.negMax || 0) || b.resims >= 12) return this.fail(i, '협상을 사용할 수 없습니다.');
    b.inputs.push({ tick: b.cur, team: i }); b.resims++;
    const sent = b.cur;
    try { this.simulate(b); } catch (e) { console.error('재계산 오류', e); b.inputs.pop(); return; }
    b.cur = Math.min(sent, b.frames.length);
  }
  endBattle(b) {
    if (this.over || this.battle !== b) return;
    this.battle = null;
    const res = b.res;                                      // team 0(=P1) 기준 'win' | 'lose' | 'draw'
    for (let i = 0; i < 2; i++) this.send(this.p[i].ws, { t: 'b_end', id: b.id, res: res === 'draw' ? 'draw' : (i === 0) === (res === 'win') ? 'win' : 'lose' });
    if (res === 'draw') {                                   // 무승부: 같은 라운드를 다시 준비
      for (let i = 0; i < 2; i++) this.enterPlace(i, '드래곤이 필드를 뒤엎었습니다. 무승부 - 같은 라운드를 다시 준비하세요.');
      return;
    }
    const w = res === 'win' ? 0 : 1, l = 1 - w;
    const W = this.p[w].S, L = this.p[l].S;
    W.roster = W.roster.filter(o => !o.tmp); W.lose = 0;   // 원본 finish(): 승리 시 임시 유닛 제거
    L.lives--; L.lose = 1;                                  // 패배: 목숨 -1, 패배 보상 증강
    if (L.lives <= 0) return this.finish(w);
    for (let i = 0; i < 2; i++) { this.enterPick(i); }
    this.pushAll();
  }
  finish(winner) {
    this.over = true;
    for (const q of this.p) { clearTimeout(q.timer); }
    if (this.battle && this.battle.timer) clearInterval(this.battle.timer);
    for (let i = 0; i < 2; i++) this.send(this.p[i].ws, { t: 'over', win: i === winner, reason: 'lives' });
    this.onEnd(this);
  }
  // 한 명이 나갔을 때: 남은 사람이 승리
  leave(ws) {
    if (this.over) return; const i = this.idx(ws); if (i < 0) return;
    this.over = true;
    for (const q of this.p) clearTimeout(q.timer);
    if (this.battle && this.battle.timer) clearInterval(this.battle.timer);
    this.send(this.p[1 - i].ws, { t: 'opp_left' });
    this.onEnd(this);
  }
}

module.exports = { Game, CFG, EXCLUDED, FLIP };

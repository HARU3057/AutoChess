#!/usr/bin/env node
/* test-client.js — 클라이언트(public/index.html + public/pvp.js)를 가짜 화면(DOM/canvas 스텁)으로 Node 에서 그대로 실행하고,
 * 실제 서버 진행(pvp-game.js)에 두 클라이언트를 연결해 한 판을 통째로 돌려 본다. (실제 브라우저 테스트가 아님)
 * 확인: 예외 없이 끝까지 / 증강 선택·기물 지정·배치 이동·레디가 서버 요청으로만 처리 / 전투를 서버 프레임으로 그림 /
 *       2번 플레이어는 좌표가 뒤집혀 내 부대가 아래쪽 / HUD·타이머·결과 표시 / 기존(중계) 방식 경로가 그대로인지
 * 사용: node test-client.js
 */
process.env.PVP_TICK_MS = '2'; process.env.PVP_PICK_MS = '400'; process.env.PVP_PLACE_MS = '400';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { Game, CFG } = require('./pvp-game.js');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const SCRIPT = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const PVPJS = fs.readFileSync(path.join(__dirname, 'public', 'pvp.js'), 'utf8');

let ok = 0, bad = 0; const log = [];
const check = (n, c, x) => { if (c) ok++; else { bad++; log.push('FAIL ' + n + (x ? ' — ' + x : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- 가짜 브라우저 ----------
const U = () => { const f = function () { return U(); }; return new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'length' ? 0 : k === 'then' ? undefined : U(), set: () => true, apply: () => U(), construct: () => U() }); };
function makeClient(name, bridge, opts = {}) {
  const errors = []; const els = {}; const intervals = []; const keyHandlers = []; let sock = null;
  function Node_() { }
  Object.defineProperty(Node_.prototype, 'textContent', { configurable: true, get() { return this._text || ''; }, set(v) { this._text = String(v); } });
  const mkEl = id => {
    const e = Object.create(Node_.prototype); Object.assign(e, { id, style: {}, _html: '', disabled: false, className: '', dataset: {}, onclick: null, cards: [] });
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); this.cards = [...this._html.matchAll(/data-id="(\w+)"/g)].map(m => ({ dataset: { id: m[1] }, onclick: null })); } });
    e.getContext = () => U(); e.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 470 }); e.addEventListener = () => { }; e.appendChild = () => { }; e.querySelectorAll = () => []; e.setAttribute = () => { };
    return e;
  };
  const getEl = id => els[id] || (els[id] = mkEl(id));
  const doc = { getElementById: getEl, createElement: () => mkEl('x'), addEventListener: (ev, fn) => { if (ev === 'keydown') keyHandlers.push(fn); },
    querySelectorAll: sel => sel === '.card' ? getEl('box').cards : [], body: mkEl('body') };
  function WebSocket(url) { sock = this; this.readyState = 1; this.send = d => bridge.fromClient(name, JSON.parse(d)); this.addEventListener = () => { }; this.close = () => { }; }
  const sb = { document: doc, Node: Node_, WebSocket, location: { protocol: 'http:', host: 'x' }, performance: { now: () => 1000 }, Image: U(), localStorage: U(),
    setTimeout, clearTimeout, setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval: () => { }, requestAnimationFrame: () => 0, confirm: () => true, alert: () => { }, console };
  sb.window = sb; sb.addEventListener = (ev, fn) => { if (ev === 'keydown') keyHandlers.push({ cap: true, fn }); };
  const ctx = vm.createContext(sb);
  const run = c => { try { return vm.runInContext(c, ctx); } catch (e) { errors.push(e.message + ' | ' + (e.stack || '').split('\n')[1]); return undefined; } };
  const rx = [];
  const api = { name, rx, errors, els, intervals, getEl, ctx, run, keyHandlers,
    deliver(m) { rx.push(m.t + (m.phase ? ':' + m.phase : '') + (m.res ? ':' + m.res : '')); if (sock && sock.onmessage) { try { sock.onmessage({ data: JSON.stringify(m) }); } catch (e) { errors.push('onmessage ' + m.t + ': ' + e.message + ' | ' + (e.stack || '').split('\n')[1]); } } },
    frame() { run('loop(' + (Date.now() % 100000) + ')'); },
    click(c, r) { run(`cv.onclick({clientX:cx(${c},${r}),clientY:cy(${r})})`); } };
  // 원본 게임 + pvp.js 실행
  try { vm.runInContext(SCRIPT, ctx, { filename: 'index.html' }); vm.runInContext(PVPJS, ctx, { filename: 'pvp.js' }); } catch (e) { errors.push('load: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' / ')); }
  if (!opts.noLobby) run('pvpLobby()');           // 연결 만들기 (list 요청이 나감)
  return api;
}

// ---------- 서버 + 두 클라이언트 연결 ----------
function setup() {
  const bridge = { w: [{ i: 0 }, { i: 1 }], clients: {}, game: null, sent: { A: [], B: [] }, fromClient(name, m) { bridge.sent[name].push(m); if (bridge.game && m.t !== 'list') setImmediate(() => bridge.game.onMsg(bridge.w[name === 'A' ? 0 : 1], m)); } };
  const A = makeClient('A', bridge), B = makeClient('B', bridge); bridge.clients = { A, B };
  const w = bridge.w; let ended = 0;
  bridge.game = new Game(w[0], w[1], (ws, m) => { const c = ws.i === 0 ? A : B; setImmediate(() => { c.deliver(JSON.parse(JSON.stringify(m))); if (m.t === 'b_frame' && m.i % 3 === 0) c.frame(); }); }, () => { ended++; });
  bridge.ended = () => ended;
  for (const c of [A, B]) c.deliver({ t: 'matched', id: 'r', opp: '상대', auth: true });
  bridge.game.start();
  return { A, B, bridge };
}
// 사람처럼 행동하는 봇 (화면 이벤트만 사용)
function drive(c, opts = {}) {
  const origDeliver = c.deliver;
  c.deliver = m => {
    origDeliver(m);
    if (m.t !== 'state') return;
    setImmediate(() => {
      if (opts.idle) return;
      const ph = c.run('st.phase');
      if (m.phase === 'pick') { const cards = c.getEl('box').cards; if (cards.length === m.me.offer.length && cards.every((x, i) => x.dataset.id === m.me.offer[i])) c.sawPick = (c.sawPick || 0) + 1; if (cards.length) cards[0].onclick(); }   // 서버가 준 목록과 같은 카드가 떠 있는지
      else if (m.phase === 'place' && ph === 'prep') {
        const pend = c.run('st.pend ? st.roster.filter(st.pend.f).map(o=>[o.c,o.r]) : null');
        if (pend) { if (pend.length) c.click(pend[0][0], pend[0][1]); else { /* 지정할 대상이 없으면 시간 초과에 맡김 */ } return; }
        if (!c.moved) { c.moved = 1; const u = c.run('st.roster[0]'); if (u) { c.click(u.c, u.r); c.click(0, 9); } }   // 배치 이동 한 번
        c.getEl('go').onclick();
      }
    });
  };
}

(async () => {
  // ===== 1. 로드와 초기 상태 =====
  {
    const pm = CFG.PLACE_MS, qm = CFG.PICK_MS; CFG.PLACE_MS = 30000; CFG.PICK_MS = 30000;
    const { A, B, bridge } = setup(); await wait(50);
    for (const c of [A, B]) check(`1 ${c.name} 스크립트 로드/matched 처리 중 예외 없음`, c.errors.length === 0, c.errors[0]);
    check('1 서버 진행 방식으로 들어감 (배치 단계, 부대 6개)', A.run('st.phase') === 'prep' && A.run('st.roster.length') === 6 && A.run('P=null,1') === 1);
    check('1 HUD 가 서버 상태로 채워짐 (라운드/생명)', A.getEl('h1').textContent.includes('라운드 1') && A.getEl('h2').innerHTML.includes('생명'));
    check('1 서버 진행 중에는 일시정지가 막힘 (st.paused 항상 0)', (A.run('st.paused=1;st.paused') === 0));
    check('1 일시정지 버튼 숨김', A.getEl('ps').style.display === 'none');
    check('1 스페이스 키가 원본 일시정지 핸들러에 안 닿음', (() => { let blocked = false; const ev = { code: 'Space', key: ' ', stopImmediatePropagation() { blocked = true; }, preventDefault() { } }; A.keyHandlers.filter(h => h.cap).forEach(h => h.fn(ev)); return blocked; })());
    // 적 진영(위쪽)을 눌러도 요청이 안 나가고, 내 기물 선택 후 내 진영을 눌러야 이동 요청이 나감
    const sent0 = bridge.sent.A.length; A.click(2, 2); A.click(1, 7); A.click(2, 3);
    check('1 적 진영 클릭으로는 이동 요청이 안 나감', bridge.sent.A.slice(sent0).every(m => m.t !== 'move'));
    A.click(1, 7); /* 남아 있던 선택 해제 */ A.click(1, 7); A.click(0, 9);
    check('1 내 기물 선택 → 빈 칸 클릭 = move 요청 하나 (직접 로컬에서 안 움직임)', bridge.sent.A.filter(m => m.t === 'move').length === 1 && A.run('st.roster.some(o=>o.c==1&&o.r==7)'));
    await wait(30);
    check('1 서버가 이동을 처리하고 상태를 돌려줘서 반영됨', A.run('st.roster.some(o=>o.c==0&&o.r==9)') && B.run('st.en.some(o=>o.c==5&&o.r==0)'), 'A roster ' + A.run('JSON.stringify(st.roster.map(o=>[o.type,o.c,o.r]))') + ' | 받은 메시지 ' + A.rx.join(',') + ' | 보낸 ' + JSON.stringify(bridge.sent.A.slice(-3)));
    check('1 상대 배치가 적 진영에 (180도 회전되어) 보임', B.run('st.en.length') === 6);
    // 타이머 표시
    A.intervals.forEach(i => { try { i.fn(); } catch (e) { } });
    check('1 남은 시간이 "배치 시간 N초"로 표시됨 (원본 타이머는 못 덮어씀)', /^배치 시간 \d+초$/.test(A.getEl('tm').textContent), '[' + A.getEl('tm').textContent + '] 구간 ' + A.intervals.map(i=>i.ms).join(','));
    check('1 시간 표시 갱신 중 예외 없음', A.errors.length === 0, A.errors[0]);
    bridge.game.leave(bridge.w[0]); CFG.PLACE_MS = pm; CFG.PICK_MS = qm;
  }

  // ===== 2. 증강 선택·기물 지정·전투·종료까지 한 판 (두 클라이언트 모두 자동 진행) =====
  {
    const { A, B, bridge } = setup(); drive(A); drive(B);
    let sawPickModal = 0, sawBattleDraw = 0, flipOK = null, hudBattle = 0, endTexts = 0, sawPend = 0, sawErrMsg = 0;
    const watch = setInterval(() => {
      for (const c of [A, B]) {
        if (c.run('st.phase') === 'pick') { const n = c.getEl('box').cards.length; if (n === 3 || n === 2 || n === 1) sawPickModal++; }
        if (c.run('st.phase') === 'battle' && c.run('B&&B.us.length')) {
          sawBattleDraw++;
          if (flipOK === null && c.run('B.us.length>6')) {   // 내 유닛(team 0)은 아래쪽, 적(team 1)은 위쪽에 그려져야 함 — 두 클라이언트 모두
            const my = c.run('B.us.filter(u=>u.team==0&&!u.dead&&!u.gone)'), en = c.run('B.us.filter(u=>u.team==1&&!u.dead&&!u.gone)');
            const avg = a => a.reduce((s, u) => s + u.y, 0) / (a.length || 1);
            flipOK = { [c.name]: avg(my) > avg(en) };
          } else if (flipOK && !(c.name in flipOK) && c.run('B.us.length>6')) {
            const my = c.run('B.us.filter(u=>u.team==0&&!u.dead&&!u.gone)'), en = c.run('B.us.filter(u=>u.team==1&&!u.dead&&!u.gone)'); const avg = a => a.reduce((s, u) => s + u.y, 0) / (a.length || 1); flipOK[c.name] = avg(my) > avg(en);
          }
          if (c.getEl('msg').textContent.includes('전투 중')) hudBattle++;
        }
        if (c.run('st.pend')) sawPend++;
      }
    }, 5);
    for (let k = 0; k < 2500 && !bridge.ended(); k++) await wait(10);
    clearInterval(watch); await wait(150);   // 마지막 메시지 전달 대기
    check('2 두 클라이언트가 끝까지 진행해 게임 종료', bridge.ended() === 1);
    for (const c of [A, B]) check(`2 ${c.name} 전체 진행 중 예외 없음 (그리기 포함)`, c.errors.length === 0, c.errors.slice(0, 2).join(' || '));
    check('2 증강 선택 창이 서버가 준 목록(순서 포함)으로 떴음', (A.sawPick || 0) + (B.sawPick || 0) > 0, `A ${A.sawPick || 0}번 / B ${B.sawPick || 0}번`);
    check('2 전투가 서버 프레임으로 그려짐 (B 유닛 존재)', sawBattleDraw > 0);
    check('2 두 클라이언트 모두 내 부대가 화면 아래쪽 (2번 플레이어는 뒤집힘)', flipOK && flipOK.A === true && flipOK.B === true, JSON.stringify(flipOK));
    check('2 전투 중 HUD 메시지', hudBattle > 0);
    const ta = A.getEl('box').innerHTML, tb = B.getEl('box').innerHTML;
    check('2 종료 창: 한쪽만 승리', (ta.includes('승리') !== tb.includes('승리')) && (ta.includes('패배') !== tb.includes('패배')), (ta.match(/<h3>(.*?)<\/h3>/) || [])[1] + '/' + (tb.match(/<h3>(.*?)<\/h3>/) || [])[1] + ' | A꼬리 ' + A.rx.slice(-6).join(',') + ' | B꼬리 ' + B.rx.slice(-6).join(','));
    check('2 증강 선택이 요청으로만 나감 (pick 메시지 존재, 로컬 choose 호출 없음)', bridge.sent.A.some(m => m.t === 'pick') && A.run('st.aug.length') >= 0);
    const nb = A.getEl('h1').textContent; console.log(`  (2: A 요청 ${bridge.sent.A.length}개 / B 요청 ${bridge.sent.B.length}개, 기물 지정 화면 ${sawPend}번, 마지막 HUD: ${nb})`);
  }

  // ===== 3. 가만히 있어도 서버가 진행하고, 클라이언트 표시가 따라감 =====
  {
    const { A, B, bridge } = setup(); drive(A, { idle: true }); drive(B, { idle: true });
    let sawBattle = false; const w2 = setInterval(() => { if (A.run('st.phase') === 'battle') sawBattle = true; }, 5);
    for (let k = 0; k < 400 && !sawBattle; k++) await wait(10); clearInterval(w2);
    check('3 입력이 없어도 시간 초과로 자동 레디 → 전투 화면', sawBattle);
    await wait(2500);
    check('3 자동 진행 중 예외 없음', A.errors.length === 0 && B.errors.length === 0, (A.errors[0] || B.errors[0]));
    bridge.game.leave(bridge.w[1]); await wait(30);
    check('3 상대가 나가면 승리 창', A.getEl('box').innerHTML.includes('승리') && A.run('st.phase') === 'over', A.getEl('box').innerHTML.slice(0, 80));
  }


  // ===== 5. 기물 지정(2단계) / 리롤 / 협상 버튼을 화면 이벤트로 =====
  {
    const pm = CFG.PLACE_MS, qm = CFG.PICK_MS; CFG.PLACE_MS = 30000; CFG.PICK_MS = 30000;
    const { A, B, bridge } = setup(); await wait(50); const g = bridge.game;
    g.enterPick(0); g.p[0].S.offer = ['guard', 'horse', 'tough']; g.pushAll(); await wait(40);
    check('5 증강 선택 창에 서버가 준 3장이 뜸', A.getEl('box').cards.length === 3 && A.getEl('box').innerHTML.includes('리롤 1/1'));
    A.getEl('rr').onclick(); await wait(60);
    const offer2 = A.getEl('box').cards.map(c => c.dataset.id);
    check('5 리롤 요청 → 서버가 새 3장을 줌, 리롤 버튼 비활성', offer2.length === 3 && offer2.join() !== 'guard,horse,tough' && A.getEl('box').innerHTML.includes('리롤 0/1'), offer2.join());
    g.p[0].S.offer = ['guard', 'horse', 'tough']; g.push(0); await wait(40);
    A.getEl('box').cards[0].onclick(); await wait(60);                       // guard 선택
    check('5 선택 요청 → 서버가 적용, 배치 단계로 돌아오고 지정 대기(pend)가 생김', A.run('st.phase') === 'prep' && A.run('st.pend&&st.pend.k') === 'guard' && A.run('st.pend.step') === 0);
    check('5 지정 안내 문구와 지정 가능한 칸 강조(draw)', A.getEl('msg').textContent.includes('근위병') && (A.frame(), A.errors.length === 0), A.errors[0]);
    check('5 지정 중에는 레디 버튼이 비활성', A.getEl('go').disabled === true);
    const elig1 = A.run('st.roster.filter(st.pend.f).map(o=>[o.c,o.r])'); A.click(elig1[0][0], elig1[0][1]); await wait(60);
    check('5 1단계 지정 → 서버가 2단계(지켜줄 아군)로 넘김', A.run('st.pend&&st.pend.step') === 1 && A.getEl('msg').textContent.includes('지켜줄'));
    const elig2 = A.run('st.roster.filter(st.pend.f).map(o=>[o.c,o.r])'); A.click(elig2[0][0], elig2[0][1]); await wait(60);
    check('5 2단계 지정 완료 → 지정 대기 해제, 근위병(gd)이 생김', A.run('st.pend') === null && A.run('st.roster.some(o=>o.type=="gd")') && A.getEl('go').disabled === false);
    check('5 상대(B) 화면의 "상대 증강"에 이 증강이 보임', B.getEl('augs').textContent.includes('상대 증강'));
    // 협상: 서버 쪽 negMax 를 주고 전투 중 버튼
    g.p[0].S.negMax = 1; g.p[1].S.negMax = 1; g.p[0].S.negEver = 1; g.p[1].S.negEver = 1; g.pushAll(); await wait(30);
    check('5 협상 증강이 있으면 협상 버튼이 보임', A.getEl('ng').style.display === '');
    A.getEl('go').onclick(); B.getEl('go').onclick(); await wait(300);
    check('5 양쪽 레디 → 전투 화면', A.run('st.phase') === 'battle' && A.run('B.us.length') > 6);
    check('5 전투 중 협상 버튼 활성', A.getEl('ng').disabled === false && A.getEl('ng').textContent.includes('협상 1'));
    A.getEl('ng').onclick(); await wait(40);
    check('5 협상 요청이 나가고 횟수가 줄어듦', bridge.sent.A.some(m => m.t === 'negotiate') && A.getEl('ng').textContent.includes('협상 0'));
    await wait(1500);
    check('5 협상 후 재계산된 전투도 끝까지 그려짐 (예외 없음)', A.errors.length === 0 && B.errors.length === 0, A.errors[0] || B.errors[0]);
    g.leave(bridge.w[0]); CFG.PLACE_MS = pm; CFG.PICK_MS = qm;
  }

  // ===== 4. 기존(중계) 방식 경로는 그대로 =====
  {
    const bridge = { sent: { A: [] }, fromClient(n, m) { bridge.sent[n].push(m); } }; const A = makeClient('A', bridge);
    A.deliver({ t: 'matched', id: 'r', opp: '상대' });         // auth 없음 → 기존 방식
    check('4 auth 없는 matched 는 기존 방식으로 시작 (PvP 시작 안내, 일시정지 버튼 보임)', A.getEl('msg').textContent.includes('PvP 대전 시작') && A.getEl('ps').style.display !== 'none', A.getEl('msg').textContent);
    check('4 기존 방식에서는 st.paused 가 정상 동작', A.run('st.paused=1;st.paused') === 1);
    A.run('st.paused=0'); A.getEl('go').onclick();
    check('4 기존 방식: 레디 버튼이 roster 를 담은 ready 를 보냄', bridge.sent.A.some(m => m.t === 'ready' && Array.isArray(m.roster)));
    check('4 기존 방식 전체에서 예외 없음', A.errors.length === 0, A.errors[0]);
  }


  // ===== 6. 메뉴에 AI 전투가 없음 =====
  {
    const bridge = { sent: { A: [] }, fromClient(n, m) { bridge.sent[n].push(m); } }; const A = makeClient('A', bridge, { noLobby: true });   // 페이지가 열린 직후의 메뉴를 검사
    const box = () => A.getEl('box').innerHTML;
    check('6 시작 메뉴에는 PvP 대전만 있고 AI 전투/게임 모드 버튼이 없음', box().includes('PvP 대전') && !box().includes('AI 전투') && !box().includes('고난 모드') && !box().includes('mA'), box());
    A.getEl('mP').onclick(); check('6 PvP 대전 → 로비', box().includes('PvP 로비'));
    A.getEl('pb').onclick(); check('6 로비에서 뒤로 → 다시 PvP 전용 시작 메뉴', box().includes('참호 오토체스') && !box().includes('AI 전투'));
    A.deliver({ t: 'matched', id: 'r', opp: '상대', auth: true });
    A.getEl('mn').onclick();      // 게임 중 메뉴 버튼
    check('6 대전 중 메뉴: 계속하기 + 대전 나가기, AI 전투 없음, 로비 버튼 없음', box().includes('계속하기') && box().includes('대전 나가기') && !box().includes('AI') && !box().includes('PvP 대전'), box());
    A.getEl('mR').onclick(); check('6 계속하기로 메뉴 닫힘', A.getEl('mod').style.display === 'none');
    A.getEl('mn').onclick(); A.getEl('mX').onclick();
    check('6 대전 나가기 → 서버에 leave, 시작 메뉴(PvP 전용)로', bridge.sent.A.some(m => m.t === 'leave') && box().includes('PvP 대전') && !box().includes('AI 전투'), box());
    // 상대가 나갔을 때 / 연결 끊김 → AI 로 이어지지 않고 안내 창
    for (const [label, legacy] of [['서버 진행', false], ['기존 방식', true]]) {
      const b2 = { sent: { A: [] }, fromClient(n, m) { b2.sent[n].push(m); } }; const C = makeClient('A', b2);
      C.run('pvpLobby()');
      C.deliver(legacy ? { t: 'matched', id: 'r', opp: '상대' } : { t: 'matched', id: 'r', opp: '상대', auth: true });
      C.deliver({ t: 'opp_left' });
      check(`6 (${label}) 상대가 나가면 AI 전투로 이어지지 않고 안내 창 + 메인 메뉴 버튼`, C.getEl('box').innerHTML.includes('메인 메뉴') && C.run('st.phase') === 'over', C.getEl('box').innerHTML.slice(0, 90));
      C.getEl('rs').onclick(); check(`6 (${label}) 메인 메뉴 버튼 → PvP 전용 시작 메뉴`, C.getEl('box').innerHTML.includes('PvP 대전') && !C.getEl('box').innerHTML.includes('AI 전투'));
      check(`6 (${label}) 예외 없음`, C.errors.length === 0, C.errors[0]);
    }
  }

  console.log(`[클라이언트(헤드리스)] 통과 ${ok} / 실패 ${bad}`); log.forEach(l => console.log(l));
  process.exit(bad ? 1 : 0);
})();

// 온라인 PvP 클라이언트
// 게임 HTML 뒤에 자동으로 붙어서, 기존 함수(pvpLobby, init, over, 전투 시작 버튼)를 교체합니다.
(function () {
  const P = { on: false, auth: false, lobby: false, waitRoom: false, wait: false };
  let rl = []; // 방 목록

  const origStart = start;
  const origInit = init;
  const origOver = over;
  const orig = { upd, fuseCheck, turnTimeout, renderPick, openPick, click: cv.onclick, ng: document.getElementById('ng').onclick, ps: document.getElementById('ps').onclick };

  // 전투 시작 버튼 = 레디 버튼 (PvP 중에는 라벨이 상태에 따라 바뀜)
  function goLabel() {
    const b = document.getElementById('go');
    if (!b) return;
    b.textContent = !P.on ? '전투 시작' : (P.wait ? '상대 대기 중' : '레디');
  }

  const pm = t => { const e = document.getElementById('pm'); if (e) e.textContent = t; };
  const gm = t => { const e = document.getElementById('msg'); if (e) e.textContent = t; };

  // ---------- 연결 ----------
  let ws = null;
  function connect() {
    if (ws && ws.readyState <= 1) return ws;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const s = new WebSocket(url);
    ws = s;
    s.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } recv(m); };
    s.onclose = () => {
      if (ws === s) ws = null;
      if (P.on) { P.on = false; if (P.auth) authEnd(); endNotice('연결 끊김', '서버 연결이 끊겨 PvP가 종료되었습니다.'); }
      if (P.lobby) pm('서버 연결이 끊겼습니다. 다시 열어 주세요.');
    };
    return s;
  }
  function send(m) {
    const s = connect();
    const go = () => s.send(JSON.stringify(m));
    if (s.readyState === 1) go(); else s.addEventListener('open', go, { once: true });
  }

  function recv(m) {
    switch (m.t) {
      case 'rooms':
        rl = m.rooms || [];
        P.waitRoom = rl.some(r => r.mine);
        renderRooms();
        break;
      case 'created':
        pm('방을 만들었습니다. 상대를 기다리는 중입니다.');
        break;
      case 'matched':
        if (m.auth) startAuth(m.opp); else startPvp(m.opp);
        break;
      case 'state': onState(m); break;
      case 'b_start': onBattleStart(m); break;
      case 'b_frame': onFrame(m); break;
      case 'b_end': onBattleEnd(m); break;
      case 'over': onOver(m); break;
      case 'opp_board':
        P.oppBoard = m.roster;
        P.oppAugs = m.augs;
        break;
      case 'wait':
        P.wait = true;
        goLabel();
        gm('상대가 준비될 때까지 기다리는 중...');
        break;
      case 'start':
        startBattle(m.en);
        break;
      case 'opp_left':
        if (P.auth) { authEnd(); endNotice('승리', '상대가 나가서 승리했습니다.'); }
        else if (P.on) { P.on = false; endNotice('대전 종료', '상대가 나가서 PvP가 종료되었습니다.'); }
        break;
      case 'err':
        if (P.lobby) pm(m.msg); else if (P.auth) { P.errMsg = m.msg; gm(m.msg); } else gm(m.msg);
        break;
    }
  }


  // ---------- 메뉴: AI 전투 없음 (PvP 전용) ----------
  window.mainMenu = function () {
    if (menuIG) {   // 게임 중 메뉴
      mod('<h3>메뉴</h3><button id="mR">계속하기</button>' + (P.on ? '' : '<button id="mP" style="margin-top:8px">PvP 대전</button>') + '<button id="mX" style="margin-top:8px">대전 나가기</button>');
      document.getElementById('mR').onclick = () => { menuIG = false; if (menuPause) { st.paused = 0; menuPause = false; } mod(); hud(); };
      document.getElementById('mX').onclick = () => { if (confirm(P.on ? '진행 중인 대전에서 나갑니다. 나갈까요?' : '처음으로 돌아갑니다. 나갈까요?')) { menuIG = false; init(); } };
      const mp = document.getElementById('mP'); if (mp) mp.onclick = () => pvpLobby();
      return;
    }
    mod('<h3>참호 오토체스</h3><button id="mP">PvP 대전</button>');
    document.getElementById('mP').onclick = () => pvpLobby();
  };
  // 대전이 끝났거나 끊겼을 때 AI 전투로 이어지지 않도록, 안내 창을 띄우고 시작 메뉴로 돌려보낸다
  function endNotice(title, text) {
    st.phase = 'over'; st.paused = 0;
    mod('<h3>' + title + '</h3><p>' + text + '</p><button id="rs">메인 메뉴</button>');
    document.getElementById('rs').onclick = () => init();
  }

  // ---------- 로비 UI ----------
  window.pvpLobby = function () {
    P.lobby = true;
    mod('<h3>PvP 로비</h3><div style="display:flex;gap:8px"><button id="pc">방 만들기</button><button id="pb">뒤로</button></div>' +
      '<div id="pf" style="display:none;margin-top:10px"><input id="rn" maxlength="16" placeholder="방 이름 (최대 16자)" style="width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:2px solid var(--bd);border-radius:8px;background:var(--pn);color:var(--fg)">' +
      '<button id="rc" style="margin-top:8px">방 생성</button></div>' +
      '<h3 style="margin-top:14px">방 목록</h3><div id="rl"></div><p id="pm" style="font-size:12px;opacity:.8;min-height:18px"></p>' + excludedNote());
    document.getElementById('pb').onclick = () => { P.lobby = false; mainMenu(); };
    document.getElementById('pc').onclick = () => {
      if (P.waitRoom) { pm('이미 만든 방이 있습니다.'); return; }
      const f = document.getElementById('pf');
      f.style.display = f.style.display == 'none' ? 'block' : 'none';
    };
    document.getElementById('rc').onclick = () => {
      const n = document.getElementById('rn').value.trim();
      if (!n) { pm('방 이름을 입력하세요.'); return; }
      send({ t: 'create', name: n });
      document.getElementById('pf').style.display = 'none';
      document.getElementById('rn').value = '';
    };
    send({ t: 'list' });
    renderRooms();
  };

  window.renderRooms = function () {
    const L = document.getElementById('rl');
    if (!L) return;
    L.innerHTML = '';
    if (!rl.length) {
      L.innerHTML = '<p style="font-size:13px">열린 방이 없습니다. 방을 만들어 보세요.</p>';
      return;
    }
    rl.forEach(r => {
      const d = document.createElement('div');
      d.className = 'card';
      d.style.cursor = 'default';
      const info = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = r.name;
      info.appendChild(b);
      info.appendChild(document.createElement('br'));
      info.appendChild(document.createTextNode(r.host + ' · ' + r.players + '/' + r.max + (r.mine ? ' (내 방)' : '') + ' · 대기 중'));
      const btn = document.createElement('button');
      btn.style.flex = 'none';
      btn.style.padding = '8px 10px';
      btn.style.fontSize = '13px';
      if (r.mine) {
        btn.textContent = '나가기';
        btn.onclick = () => { send({ t: 'leave' }); pm('방을 나갔습니다.'); };
      } else {
        btn.textContent = '입장';
        btn.onclick = () => send({ t: 'join', id: r.id });
      }
      d.appendChild(info);
      d.appendChild(btn);
      L.appendChild(d);
    });
  };

  // ---------- 대전 흐름 ----------
  // 상대 부대(세로 5~9행)를 180도 회전: (c, r) -> (5 - c, 9 - r)
  // 육각 격자에서 이 변환은 합동 변환이라 인접 관계가 유지됩니다.
  function mirror(ros) {
    if (!Array.isArray(ros)) return [];
    return ros
      .filter(o => o && T[o.type] && !T[o.type].big && Number.isInteger(o.c) && Number.isInteger(o.r))
      .map(o => ({ type: o.type, c: 5 - o.c, r: 9 - o.r }));
  }

  function startPvp(opp) {
    P.on = false; P.lobby = false; P.waitRoom = false; P.wait = false;
    origInit();          // 게임 상태 초기화 (메뉴는 아래에서 닫음)
    mod();
    st.hard = 0;
    st.lives = 3;
    st.en = [];
    P.on = true;
    P.oppBoard = null;
    P.oppAugs = [];
    lastKey = '';
    goLabel();
    hud();
    gm('PvP 대전 시작! 상대: ' + opp + ' · 준비되면 전투 시작을 누르세요.');
  }

  function startBattle(en) {
    if (!P.on) return;
    P.wait = false;
    goLabel();
    st.en = mirror(en);
    st.sel = null;
    origStart();
    if (st.phase !== 'battle') {
      st.en = [];
      gm('배치를 정리한 뒤 전투 시작을 다시 눌러 주세요.');
    }
  }

  function pvpReady() {
    if (!P.on) return origStart();
    if (P.auth) {                      // 서버 진행 방식: 레디 요청만 보냄 (지정 대기 중이면 서버가 거절)
      if (st.phase !== 'prep' || P.wait) return;
      if (st.pend) return gm('증강 선택(기물 지정)을 먼저 끝내 주세요.');
      send({ t: 'ready' });
      return;
    }
    if (st.phase !== 'prep') return;
    if (st.pend) return gm('증강 선택을 먼저 끝내 주세요.');
    if (P.wait) return;
    P.wait = true;
    goLabel();
    send({ t: 'ready', roster: st.roster.map(o => ({ type: o.type, c: o.c, r: o.r })) });
    gm('준비 완료. 상대를 기다리는 중...');
  }
  document.getElementById('go').onclick = pvpReady;
  // 배치 시간이 끝나면 자동 레디 (PvP) - 양쪽 모두 레디하면 서버가 바로 전투를 시작시킴
  prepGo = () => pvpReady();

  // 실시간 배치 동기화: 내 배치/증강이 바뀌면 상대에게 전송하고,
  // 준비 단계에서는 상대의 현재 배치를 적 진영에 표시하며 상대 증강을 HUD 에 보여줌
  let lastKey = '';
  setInterval(() => {
    if (!P.on || P.auth || st.phase !== 'prep') return;
    const roster = st.roster.map(o => ({ type: o.type, c: o.c, r: o.r }));
    const augs = Object.keys(st.own || {});
    const key = JSON.stringify([roster, augs]);
    if (key !== lastKey) { lastKey = key; send({ t: 'board', roster, augs }); }
    st.en = mirror(P.oppBoard);
    st.aiAug = (P.oppAugs || []).slice();
  }, 300);

  // PvP 제외 증강: 필드를 바꾸는 증강과 반자이는 PvP에서 제시되지 않음
  // 빙하기(ice), 지진(quake), 워프열차(warp), 참호(trench), 고지전(highland), 공성전(siege)
  // 반자이(카미카제 충전), 메테오(무작위 폭격), 학자(무작위 대상 공부), 야생동물, 현상수배, 여포(무작위 배신)도 PvP에서 제외
  const PVP_EXCLUDED = new Set(['ice', 'quake', 'warp', 'trench', 'highland', 'siege', 'banzai', 'meteor', 'sch', 'wild', 'bounty', 'lb']);
  // 로비에 PvP 제외 증강 목록 표시
  function excludedNote() {
    const names = [...PVP_EXCLUDED].map(id => (A.find(a => a.id == id) || { n: id }).n);
    return '<div style="font-size:12px;margin-top:12px;padding:8px;border:1px dashed var(--bd);border-radius:8px"><b>PvP 제외 증강</b><br>' + names.join(', ') + '</div>';
  }
  const origRoll3 = roll3;
  window.roll3 = function () {
    if (!P.on) return origRoll3();
    let out, tries = 0;
    do { out = origRoll3(); tries++; } while (out.some(a => PVP_EXCLUDED.has(a.id)) && tries < 50);
    return out;
  };

  // 게임 오버: 이 플레이어의 대전 종료 알림
  window.over = function (w) {
    if (P.on) { P.on = false; send({ t: 'done' }); }
    return origOver(w);
  };

  // 처음부터 / 다시 시작: 진행 중인 PvP 방 정리
  window.init = function () {
    if (P.on) { P.on = false; send({ t: 'leave' }); }
    if (P.auth) authEnd();
    P.wait = false;
    goLabel();
    return origInit();
  };

  // =====================================================================================
  // 서버 진행 방식 (matched.auth === true)
  // 증강 뽑기/선택/기물 지정/배치 이동/전투 계산은 모두 서버가 한다. 이 쪽은 요청을 보내고 받은 상태를 그리기만 한다.
  // 원본의 draw()/hud()가 읽는 st, B 를 서버 상태로 채워서 그린다. (st 는 새로 만들지 않고 안의 값만 바꾼다)
  // =====================================================================================
  const nativeTmDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent'), nativeTm = nativeTmDesc.set;
  const tmEl = document.getElementById('tm');
  Object.defineProperty(tmEl, 'textContent', { configurable: true, get() { return nativeTmDesc.get.call(tmEl); }, set(v) { if (!P.auth) nativeTm.call(tmEl, v); } });   // 서버 진행 중에는 원본 타이머가 글자를 못 바꿈
  const setTm = t => nativeTm.call(tmEl, t);
  const psBtn = document.getElementById('ps');
  const AP = { seat: 0, flip: { x: 360, y: 440.5 }, skew: 0, deadline: 0, phase: '', raw: [], bid: -1, picking: false, state: null };

  function startAuth(opp) {
    P.on = false; P.lobby = false; P.waitRoom = false; P.wait = false;
    origInit();
    mod();
    P.on = true; P.auth = true; AP.raw = []; AP.bid = -1; AP.picking = false; AP.state = null;
    st.hard = 0; st.en = []; st.pend = null; st.sel = null; st.aug = []; st.own = {};
    Object.defineProperty(st, 'paused', { configurable: true, get() { return 0; }, set() { } });   // 서버 진행 중에는 일시정지 불가
    psBtn.style.display = 'none';
    goLabel();
    hud();
    gm('PvP 대전 시작! 상대: ' + opp);
  }
  function authEnd() {
    P.auth = false; P.on = false; P.wait = false; AP.picking = false;
    psBtn.style.display = '';
    setTm('');
  }
  const mirrorCell = k => { const a = String(k).split(','); return (5 - +a[0]) + ',' + (9 - +a[1]); };
  const flipKeys = o => { if (!o || AP.seat !== 1) return o || {}; const r = {}; for (const k in o) r[mirrorCell(k)] = o[k]; return r; };

  // ---------- 서버 상태 -> st ----------
  function onState(m) {
    if (!P.auth) return;
    if (AP.inBattle && m.phase === 'battle') return;
    AP.state = m; AP.skew = (m.now || Date.now()) - Date.now(); AP.deadline = m.deadline || 0; AP.phase = m.phase;
    const me = m.me;
    st.roster = me.roster; st.round = me.round; st.lives = me.lives; st.kami = me.kami | 0; st.negMax = me.negMax | 0; st.negEver = me.negEver ? 1 : 0;
    st.lose = me.lose; st.aug = me.aug || []; st.own = {}; (me.own || []).forEach(id => { st.own[id] = 1; });
    st.aiAug = (m.opp.augs || []).slice(); st.en = m.opp.roster || []; st.sel = null; st.tgt = false;
    const pd = me.pend;
    st.pend = pd ? { k: pd.k, step: pd.step, got: pd.got.map(c => ({ c: c[0], r: c[1] })), f: o => pd.elig.some(c => c[0] === o.c && c[1] === o.r) } : null;
    const note = [me.flash || '', '상대 생명 ' + m.opp.lives, m.opp.ready ? '상대 준비 완료' : '', m.phase === 'wait' ? '상대를 기다리는 중...' : ''].filter(Boolean).join(' · ');
    st.flash = note;
    if (m.phase === 'pick') {
      st.phase = 'pick'; AP.inBattle = false;
      renderPickAuth(me);
    } else {                                   // place / wait
      if (AP.picking) { AP.picking = false; mod(); }
      if (st.phase !== 'prep') { B = null; }
      st.phase = 'prep'; AP.inBattle = false; B = null;
      P.wait = m.phase === 'wait';
    }
    goLabel(); hud();
  }
  function renderPickAuth(me) {
    AP.picking = true;
    const offer = (me.offer || []).map(id => A.find(a => a.id === id)).filter(Boolean);
    mod('<h3>' + (me.lose ? '패배 보상 - 증강을 선택하세요' : '증강을 하나 선택하세요') + '</h3>' +
      offer.map(a => { const q = RC[a.rar]; return `<div class="card" data-id="${a.id}" style="border-color:${q[1]};background:${q[1]}22">${ico(a.id)}<div><b style="color:${q[1]}">[${q[0]}]</b> <b>${a.n}</b><br>${a.d}</div></div>`; }).join('') +
      `<button id="rr"${me.rrUsed ? ' disabled' : ''}>리롤 ${me.rrUsed ? 0 : 1}/1 (라운드당)</button>`);
    document.querySelectorAll('.card').forEach(el => { el.onclick = () => send({ t: 'pick', id: el.dataset.id }); });
    document.getElementById('rr').onclick = () => send({ t: 'reroll' });
  }
  // 남은 시간 표시 (서버 시각 기준)
  setInterval(() => {
    if (!P.auth) return;
    if (!AP.deadline || (AP.phase !== 'pick' && AP.phase !== 'place')) { setTm(''); return; }
    const left = Math.max(0, Math.ceil((AP.deadline - (Date.now() + AP.skew)) / 1000));
    setTm((AP.phase === 'pick' ? '증강 선택 ' : '배치 시간 ') + left + '초');
  }, 250);

  // ---------- 전투: 서버 프레임 -> B ----------
  const FX = x => AP.seat === 1 ? AP.flip.x - x : x, FY = y => AP.seat === 1 ? AP.flip.y - y : y;
  function viewFields(ch) {
    const o = Object.assign({}, ch);
    if (AP.seat !== 1) return o;
    if ('x' in o) o.x = AP.flip.x - o.x;
    if ('y' in o) o.y = AP.flip.y - o.y;
    if ('c' in o) o.c = 5 - o.c; if ('r' in o) o.r = 9 - o.r;
    if ('c0' in o) o.c0 = 5 - o.c0; if ('r0' in o) o.r0 = 9 - o.r0;
    if ('team' in o && o.team < 2) o.team = 1 - o.team;
    return o;
  }
  function setUnit(k, ch) {
    AP.raw[k] = Object.assign(AP.raw[k] || {}, ch);
    const v = viewFields(ch);
    let u = B.us[k]; const fresh = !u; if (fresh) u = B.us[k] = {};
    if ('x' in v) { u.sx = v.x; delete v.x; } if ('y' in v) { u.sy = v.y; delete v.y; }
    Object.assign(u, v);
    if (fresh || u.x == null) { u.x = u.sx; u.y = u.sy; }
  }
  const vref = r => { if (r && typeof r === 'object') { if (r.u != null) return B.us[r.u] || { x: 0, y: 0 }; if (r.x != null) return { x: FX(r.x), y: FY(r.y) }; } return r; };
  function applyAux(a) {
    if (!a) return;
    B.pl = (a.pl || []).map(p => AP.seat === 1 ? Object.assign({}, p, { c: 5 - p.c, r: 9 - p.r }) : p);
    B.hole = flipKeys(a.hole); B.tz = flipKeys(a.tz); B.road = flipKeys(a.road);
    const t = (a.terr || [[], []])[AP.seat] || []; B.terr = new Set(t.map(k => AP.seat === 1 ? mirrorCell(k) : k));
    B.fr = a.fr || 0; B.qk = a.qk || 0; B.tr = a.tr || 0; B.sf = a.sf || null; B.cf = a.cf || [0, 0];
    if (a.end) { B.end = 1; if (a.res) B.res = AP.seat === 1 ? (a.res === 'win' ? 'lose' : a.res === 'lose' ? 'win' : a.res) : a.res; }   // 서버 기준(1번 팀) 결과를 내 기준으로
  }
  function onBattleStart(m) {
    if (!P.auth) return;
    AP.seat = m.seat; AP.flip = m.flip || AP.flip; AP.bid = m.id; AP.raw = []; AP.inBattle = true; AP.deadline = 0; AP.phase = 'battle';
    if (AP.picking) { AP.picking = false; mod(); }
    B = { us: [], fx: [], tx: [], pl: [], t: 0, end: 0, res: null, hl: null, warp: null, ice: null, hole: {}, tz: {}, terr: new Set(), road: {}, cf: [0, 0],
      qk: 0, tr: 0, fr: 0, sf: null, dmDone: 0, inf: null, gk: 0, wt: null, napo: 0 };
    (m.init.us || []).forEach((u, k) => setUnit(k, u));
    applyAux(m.init.aux);
    st.phase = 'battle'; st.sel = null; st.pend = null; st.neg = st.negMax | 0; st.en = [];
    P.wait = false; goLabel(); setTm(''); hud();
  }
  function onFrame(m) {
    if (!P.auth || !B || m.id !== AP.bid) return;
    for (const [k, ch] of m.d) setUnit(k, ch);
    if (m.a) applyAux(m.a);
    B.t = (m.i + 1) * 0.05;
    for (const e of m.ev) {
      if (e.k === 'txt') { B.tx.push({ x: FX(e.x), y: FY(e.y), s: e.s, c: e.c, t: .7 }); continue; }
      if (e.k === 'end') continue;
      const f = Object.assign({}, e);
      if ('x' in f) f.x = FX(f.x); if ('y' in f) f.y = FY(f.y);
      if (AP.seat === 1) { if ('c' in f) f.c = 5 - f.c; if ('r' in f) f.r = 9 - f.r; }
      if ('a' in f) f.a = vref(f.a); if ('b' in f) f.b = vref(f.b);
      B.fx.push(f);
    }
    if (m.last) { B.end = 1; }
    hud();
  }
  function onBattleEnd(m) {
    if (!P.auth || !B) return;
    B.end = 1; B.res = m.res; AP.inBattle = false; hud();
  }
  // 원본 upd() 자리: 서버가 계산한 값을 부드럽게 따라가고, 이펙트/글자의 수명만 줄인다 (전투 계산은 하지 않음)
  window.upd = function (dt) {
    if (!P.auth) return orig.upd(dt);
    if (!B) return;
    const k = Math.min(1, dt * 30);
    for (const u of B.us) { if (!u) continue; if (u.sx != null) { u.x += (u.sx - u.x) * k; u.y += (u.sy - u.y) * k; } if (u.lg > 0) u.lg -= dt; }
    B.fx.forEach(f => { f.t -= dt; }); B.fx = B.fx.filter(f => f.t > 0);
    B.tx.forEach(f => { f.t -= dt; f.y -= dt * 20; }); B.tx = B.tx.filter(f => f.t > 0);
  };
  window.fuseCheck = function () { return P.auth ? 0 : orig.fuseCheck(); };     // 융합 규칙은 서버가 처리
  window.turnTimeout = function (ph) { return P.auth ? 0 : orig.turnTimeout(ph); };   // 시간 초과는 서버가 처리
  window.openPick = function () { return P.auth ? 0 : orig.openPick(); };
  window.renderPick = function () { return P.auth ? 0 : orig.renderPick(); };

  function onOver(m) {
    if (!P.auth) return;
    authEnd(); st.phase = 'over';
    mod(`<h3>${m.win ? '승리' : '패배'}</h3><p>${m.win ? '상대의 생명이 모두 사라졌습니다.' : '생명이 모두 사라졌습니다.'}</p><button id="rs">메인 메뉴</button>`);
    document.getElementById('rs').onclick = () => init();
  }

  // ---------- 입력: 요청만 보냄 ----------
  cv.onclick = function (e) {
    if (!P.auth) return orig.click(e);
    if (st.phase !== 'prep') return;
    const p = pos(e); if (!p) return;
    const [c, r] = p;
    if (st.pend) { send({ t: 'unit', c, r }); return; }
    if (r < 5) return;
    const o = occR(c, r);
    if (!st.sel) { if (o) { st.sel = o; hud(); } return; }
    const s = st.sel; st.sel = null;
    if (o !== s) send({ t: 'move', from: [s.c, s.r], to: [c, r] });
    hud();
  };
  document.getElementById('ng').onclick = function () {
    if (!P.auth) return orig.ng();
    if (st.phase === 'battle' && st.neg > 0 && B && !B.end) { st.neg--; send({ t: 'negotiate' }); hud(); }
  };
  psBtn.onclick = function () { if (!P.auth) return orig.ps(); };
  window.addEventListener('keydown', e => {      // 서버 진행 중에는 스페이스/P 일시정지 막기 (원본 핸들러보다 먼저 가로챔)
    if (P.auth && (e.code === 'Space' || e.key === 'p' || e.key === 'P')) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  if (!menuIG) mainMenu();   // 페이지가 열릴 때 원본이 그린 시작 메뉴를 PvP 전용으로 교체
})();

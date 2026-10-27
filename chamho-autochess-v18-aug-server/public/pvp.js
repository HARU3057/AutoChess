// 온라인 PvP 클라이언트
// 게임 HTML 뒤에 자동으로 붙어서, 기존 함수(pvpLobby, init, over, 전투 시작 버튼)를 교체합니다.
(function () {
  const P = { on: false, lobby: false, waitRoom: false, wait: false };
  let rl = []; // 방 목록

  const origStart = start;
  const origInit = init;
  const origOver = over;

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
      if (P.on) { P.on = false; gm('서버 연결이 끊겨 PvP가 종료되었습니다.'); }
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
        startPvp(m.opp);
        break;
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
        if (P.on) { P.on = false; gm('상대가 나가서 PvP가 종료되었습니다.'); }
        break;
      case 'err':
        if (P.lobby) pm(m.msg); else gm(m.msg);
        break;
    }
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
    if (!P.on || st.phase !== 'prep') return;
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
    P.wait = false;
    goLabel();
    return origInit();
  };
})();

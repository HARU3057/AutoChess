// 참호 오토체스 온라인 대전 서버
// - public/index.html 을 서빙하고, 실행 시 public/pvp.js 를 자동으로 붙입니다.
// - /ws 경로에서 WebSocket 으로 방 만들기 / 목록 / 입장 / 대전 동기화를 처리합니다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { Game } = require('./pvp-game.js');

// PVP_SERVER_AUTH=1 이면 서버가 증강 선택·배치·전투 계산을 모두 맡는 방식으로 동작합니다.
// (아직 클라이언트가 새 방식에 맞게 바뀌지 않았다면 켜지 마세요. 기본은 꺼짐 = 기존 중계 방식 그대로)
const AUTH = process.env.PVP_SERVER_AUTH === '1';

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

// ---------- 정적 파일 ----------
let gameHtml = null;
function loadHtml() {
  try {
    const raw = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
    const tag = '<script src="/pvp.js"></script>';
    const i = raw.lastIndexOf('</body>');
    gameHtml = i >= 0 ? raw.slice(0, i) + tag + '\n' + raw.slice(i) : raw + tag;
  } catch (e) {
    gameHtml = null;
    console.error('public/index.html 을 찾을 수 없습니다.');
  }
}
loadHtml();

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    if (!gameHtml) { res.writeHead(500); return res.end('public/index.html 이 없습니다.'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(gameHtml);
  }
  if (u === '/pvp.js') {
    return fs.readFile(path.join(PUB, 'pvp.js'), (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(data);
    });
  }
  if (u === '/health') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end('not found');
});

// ---------- 방 / 연결 상태 ----------
const rooms = new Map();   // id -> room
const clients = new Set(); // WebSocket 연결들
let seq = 0;

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function err(ws, msg) { send(ws, { t: 'err', msg }); }

function waitingRooms() {
  return [...rooms.values()].filter(r => r.state === 'waiting');
}
function roomsFor(c) {
  return waitingRooms().map(r => ({
    id: r.id,
    name: r.name,
    host: r.host.nick,
    players: r.guest ? 2 : 1,
    max: 2,
    mine: r.host === c,
  }));
}
function sendRooms(c) { send(c, { t: 'rooms', rooms: roomsFor(c) }); }
function broadcastRooms() { for (const c of clients) sendRooms(c); }

function other(c, r) { return r.host === c ? r.guest : r.host; }

function leaveRoom(c) {
  const r = c.room;
  if (!r) return;
  if (r.game) {   // 서버 진행 방식: 한 명이 나가면 남은 사람이 승리, 방 정리
    c.room = null;
    r.game.leave(c);
    return;
  }
  c.room = null;
  r.ready.delete(c);
  if (r.state === 'waiting') { rooms.delete(r.id); return; }
  if (r.done.has(c)) { if (r.done.size === 2) rooms.delete(r.id); return; }
  // 대전 중 중도 이탈: 상대에게 알리고 방 정리
  const opp = other(c, r);
  rooms.delete(r.id);
  if (opp && opp.room === r) {
    opp.room = null;
    send(opp, { t: 'opp_left' });
  }
  r.ready.clear();
}

// 클라이언트가 보낸 부대 배치 검증 (내 진영: 세로 5~9행, 가로 0~5열)
function sanitizeRoster(ros) {
  if (!Array.isArray(ros)) return [];
  return ros.slice(0, 40)
    .filter(o => o && typeof o.type === 'string' && o.type.length <= 12 &&
      Number.isInteger(o.c) && Number.isInteger(o.r) &&
      o.c >= 0 && o.c < 6 && o.r >= 5 && o.r <= 9)
    .map(o => ({ type: o.type, c: o.c, r: o.r }));
}

function sanitizeAugs(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, 80).filter(x => typeof x === 'string' && x.length <= 20);
}

const GAME_MSGS = new Set(['pick', 'reroll', 'unit', 'move', 'ready', 'negotiate']);
function handle(c, m) {
  if (c.room && c.room.game && GAME_MSGS.has(m.t)) return c.room.game.onMsg(c, m);
  switch (m.t) {
    case 'list':
      return sendRooms(c);

    case 'create': {
      if (c.room) return err(c, '이미 방에 있습니다.');
      const name = String(m.name || '').trim().slice(0, 16);
      if (!name) return err(c, '방 이름을 입력하세요.');
      const id = (++seq).toString(36) + Math.random().toString(36).slice(2, 7);
      const r = { id, name, host: c, guest: null, state: 'waiting',
                  ready: new Map(), done: new Set() };
      rooms.set(id, r);
      c.room = r;
      send(c, { t: 'created', id });
      return broadcastRooms();
    }

    case 'join': {
      if (c.room) return err(c, '이미 방에 있습니다.');
      const r = rooms.get(String(m.id));
      if (!r || r.state !== 'waiting' || r.host === c) return err(c, '입장할 수 없는 방입니다.');
      r.guest = c;
      r.state = 'playing';
      c.room = r;
      send(r.host, { t: 'matched', id: r.id, opp: c.nick, auth: AUTH });
      send(c, { t: 'matched', id: r.id, opp: r.host.nick, auth: AUTH });
      if (AUTH) {
        r.game = new Game(r.host, r.guest, send, () => {
          rooms.delete(r.id);
          if (r.host.room === r) r.host.room = null;
          if (r.guest && r.guest.room === r) r.guest.room = null;
        });
        r.game.start();
      }
      return broadcastRooms();
    }

    case 'leave':
      leaveRoom(c);
      return broadcastRooms();

    case 'ready': {
      const r = c.room;
      if (!r || r.state !== 'playing' || r.done.has(c)) return;
      const opp = other(c, r);
      if (!opp || r.done.has(opp)) return send(c, { t: 'opp_left' });
      r.ready.set(c, sanitizeRoster(m.roster));
      if (r.ready.has(opp)) {
        const mine = r.ready.get(c), theirs = r.ready.get(opp);
        r.ready.clear();
        send(c, { t: 'start', en: theirs });
        send(opp, { t: 'start', en: mine });
      } else {
        send(c, { t: 'wait' });
      }
      return;
    }

    case 'board': {
      // 배치/증강 실시간 공유: 레디 전이라도 상대에게 바로 전달
      const r = c.room;
      if (!r || r.state !== 'playing') return;
      const opp = other(c, r);
      if (!opp) return;
      send(opp, { t: 'opp_board', roster: sanitizeRoster(m.roster), augs: sanitizeAugs(m.augs) });
      return;
    }

    case 'done': {
      // 한쪽이 게임 오버: 이 플레이어의 대전은 끝. 둘 다 끝나면 방 삭제
      const r = c.room;
      if (!r) return;
      r.done.add(c);
      r.ready.delete(c);
      c.room = null;
      if (r.done.size === 2) rooms.delete(r.id);
      return;
    }
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.room = null;
  ws.nick = '플레이어' + (1000 + Math.floor(Math.random() * 9000));
  clients.add(ws);
  sendRooms(ws);

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    handle(ws, m);
  });

  ws.on('close', () => {
    leaveRoom(ws);
    clients.delete(ws);
    broadcastRooms();
  });
});

// 연결이 끊긴 소켓 정리 (Render 등 프록시 환경에서 유휴 연결 정리용)
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('server on port ' + PORT + (AUTH ? ' (서버 진행 방식)' : ' (기존 중계 방식)')));

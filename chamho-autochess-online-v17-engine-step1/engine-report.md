# engine-report.md — 1단계 결과 (전투 계산 엔진 분리)

> **주의: 실제 브라우저 테스트는 하지 못했습니다.** 확인한 것은 문법 검사와 Node 실행 검사뿐입니다.
> 기존 `public/index.html`, `public/pvp.js`, `server.js`, `render.yaml`은 **한 글자도 바꾸지 않았습니다.** 싱글 AI 전투 동작은 그대로입니다.

## 1. 한 줄 요약
`engine.js`를 만들었고, 원본 `index.html`의 전투 코드와 **틱마다 완전히 같은 결과**가 나오는 것을 Node에서 301개 시나리오로 확인했습니다.

## 2. 산출물
| 파일 | 설명 |
|---|---|
| `engine.js` | 전투 계산 엔진. 브라우저/Node 공용, DOM 없음, 시드 난수 |
| `test-engine.js` | 검증 스크립트 (`npm run test:engine` 또는 `node test-engine.js`) |
| `tools/build-engine.py` | `index.html`에서 `engine.js`를 다시 뽑는 스크립트 |
| `engine-report.md` | 이 문서 |
| `package.json` | `scripts.test:engine` 한 줄만 추가 (그 외 동일) |

## 3. 함수 분류 (index.html 전체 109개)
| 분류 | 개수 | 함수 |
|---|---|---|
| 전투 중 실제로 쓰이는 로직 (엔진 핵심) | 42 | mk,start,studyGive,graceGive,graceAll,holyCover,merPay,bunseoStart,burnSet,studyEnd,studyStart,wildSpawn,wildAI,conf,lbCharge,lbBetray,enpass,sacKill,bountySet,sacStart,vsStart,dbg,txt,die,save,setupFx,warpTo,postMove,quake,release,negotiate,troyOpen,moveBig,hit,blast,revive,upd,asp,mdm,pierce,lineShip,bro |
| 엔진에 복사됐지만 전투 중엔 안 쓰는 라운드 준비용 | 15 | genEn,popeCheck,fuseCheck,rollField,spawnBig,applyPend,spawn,total,fixSn,formation,madApply,fixGd,fixMon,fixMar,snap |
| 엔진 제외: 증강 선택·AI 군대 생성·라운드 전환 | 11 | enOc,enAdd,enConv,enBig,aiPick,aiApplyAll,aiApply,drawEnd,finish,roll3,choose |
| 엔진 제외: 화면·메뉴·그리기·타이머 | 41 | init,modeSel,mainMenu,pvpLobby,setMode,openPick,renderPick,duckd,over,mod,hud,pos,codex,hex,soldier,piece,tankd,troyd,eled,psd,demond,seald,unit,bodyDraw,shd,saFx,aid,animd,tksd,shipd,walld,shkd,relMark,aced,mpkd,hogd,merd,plane,draw,turnTimeout,turnTick |

- 전투 로직은 화면과 거의 분리되어 있어서, 화면 호출은 `hud()` 4곳, `setTimeout` 1곳, `B.fx.push` 6곳뿐이었습니다.
- `txt()`(떠오르는 글자)와 `B.fx`(이펙트)는 이미 "이벤트 배열" 형태라서 그대로 이벤트로 씁니다.
- 라운드 준비용 15개는 서버 전투에는 필요 없습니다. 클라이언트가 `st`를 만들어 보낼 때 쓰는 함수들이라 복사만 해 두었습니다.

## 4. 원본에서 바꾼 것 (딱 4가지, 나머지는 글자 그대로 복사)
1. `Math.random()` → `rnd()` (mulberry32 시드 난수, 호출 48곳)
2. `hud()` → 아무 일도 안 하는 함수
3. `B.fx.push(...)` → `FXP(...)` (원래대로 `B.fx`에도 넣고 이벤트 큐에도 기록)
4. `setTimeout(()=>... finish/drawEnd ...,1300)` → `endBattle(결과)` (결과를 저장하고 `end` 이벤트 기록). 화면 전환(증강 선택, 다음 라운드)은 엔진이 하지 않습니다.

`txt()`는 원래 동작 + 이벤트 큐 기록을 하도록 한 줄 감쌌습니다.

## 5. 사용법
```js
const Engine = require('./engine.js');           // 브라우저는 <script src> 후 window.Engine
Engine.begin({ seed: 12345, st: stJsonCopy });   // st = 원본 st 객체의 JSON 사본
while (!Engine.step(0.05)) {                      // 0.05초(=20틱/초) 단위로 진행, 끝나면 true
  const events = Engine.drain();                 // [{k:'txt'|'fx'|'end', ...}]  화면 연출용
  const snap = Engine.snapshot();                // 유닛 위치/체력 등 압축 상태
}
Engine.result();                                 // 'win' | 'lose' | 'draw'  (team 0 기준)
```
- `Engine.negotiate()`는 원본 `negotiate()`(협상)와 같습니다. 전투 중 사용자 입력은 이것 하나뿐입니다.
- **dt는 호출자가 정합니다.** 원본 브라우저는 프레임마다 dt(최대 0.05)를 썼습니다. 서버는 고정 dt를 쓰면 되고, 결과는 dt 값에 따라 달라지므로 서버가 한 값으로 고정해야 합니다.

## 6. 검증 결과 (Node, 실제 브라우저 아님)
- **결정성**: 같은 시드·같은 입력으로 3번 실행하면 최종 상태가 완전히 같음 → 9/9
- **동일성**: 원본 `index.html` 스크립트를 Node의 `vm`에서 가짜 DOM으로 실행하고, 같은 시드·같은 dt로 `engine.js`와 **매 틱 전체 유닛 상태 + 난수 위치**를 비교 → **301개 통과 / 0 실패**
  - 기본 라운드 1~15 (16개), 증강 75종 각각 단독(2시드, 150개) + 고난 모드(75개), 무작위 증강 2~4개 조합(60개)
  - 증강은 원본의 `choose()`를 그대로 호출해 `st`를 만들었으므로, 실제 게임에서 생기는 `st`와 같은 모양입니다.
- **테스트가 헛돌지 않는지 확인**: 엔진의 불사 처리 한 줄을 일부러 바꾸면 17건이 실패로 잡힘
- 이 검증 중 `REL`(성직자 계열 목록) 상수가 빠진 것을 테스트가 잡아서 고쳤습니다.

## 7. 알려진 한계와 주의점
1. **엔진은 복사본입니다.** 싱글 AI 전투는 계속 `index.html` 안의 원래 코드로 돌아갑니다. 전투 규칙(유닛 표, 증강 효과)을 `index.html`에서 고치면 `python3 tools/build-engine.py public/index.html engine.js`로 엔진을 다시 만들어야 합니다. 그 뒤 `npm run test:engine`으로 확인하세요. (번호 범위로 뽑기 때문에 `index.html`의 줄 구조가 크게 바뀌면 스크립트의 범위도 손봐야 합니다.)
2. **결과가 브라우저의 기존 결과와 "같은 시드로" 비교되는 것은 아닙니다.** 브라우저는 `Math.random`(시드 없음)이라 재현이 안 되기 때문에, 원본 코드의 난수만 같은 시드 난수로 바꿔 끼워서 비교했습니다. 논리는 같지만 브라우저 실물에서의 수치 일치까지 본 것은 아닙니다.
3. **PvP에서 증강 효과가 한쪽(team 0)에만 적용되는 구조 (2단계에서 결정 필요).** 원본은 `st` 하나에 증강 플래그가 있고 `!u.team`(아군)에게만 적용되는 코드가 많습니다. 서버가 한 번만 전투를 돌리려면 "누구의 `st`를 team 0으로 쓰느냐"를 정해야 하고, 상대(team 1)의 전장 규칙형 증강은 지금 구조에서는 적용되지 않습니다. 사용자가 정한 "각자 자기 부대에만 적용"을 지키려면 다음 중 하나가 필요합니다.
   - (가) 전투를 두 번 계산 (A 시점, B 시점) → 두 결과가 다를 수 있어 부적합
   - (나) 엔진에서 증강 플래그를 팀별로 나누기 (`st.a[team]`) → 코드 수정이 크고, 원본과의 동일성 검증을 팀 0 기준으로만 유지
   - (다) 한쪽 시점으로만 계산하고, 상대 전장 규칙형 증강은 적용하지 않음 (가장 작은 변경, 규칙 위반 가능)
4. 일부 코드(`shf`)는 `sort(() => rnd() - .5)` 방식의 셔플이라 Node 버전이 달라지면 순서가 달라질 수 있습니다. 서버에서만 계산하면 문제없습니다.
5. 증강 선택 후 생기는 `st.pend`(유닛 선택 대기)는 엔진이 `null`로 비웁니다. PvP 전투 시작 시점에는 이미 확정되어 있어야 합니다.
6. 이펙트 이벤트에는 좌표가 있지만 유닛 식별자가 없습니다. 유닛은 `B.us`의 인덱스로 구분합니다 (전투 중 유닛이 추가될 수는 있지만 삭제되지는 않음).

## 8. 다음 단계(2단계) 전에 정해야 할 것
1. 서버 틱 주기: 초당 10 / 15 / 20회 (지금 검증은 20회=0.05초 기준. 원본 브라우저의 dt 상한과 같아서 가장 원본에 가깝습니다. 10회로 하면 결과가 달라지고 다시 검증해야 합니다.)
2. 위 7-3의 증강 적용 방식 (가/나/다)
3. 클라이언트가 서버로 보낼 `st` 범위 (로스터, 증강 플래그, 라운드 등) — 서버가 클라이언트의 `st`를 그대로 믿을지(부정 가능) 서버가 증강 선택 자체를 관리할지

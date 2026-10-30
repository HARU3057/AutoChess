# engine-report.md — 전투 계산 엔진 + 서버 증강 선택 (1단계, 팀별 증강, 증강 서버 관리)

> **주의: 실제 브라우저 테스트는 하지 못했습니다.** 확인한 것은 문법 검사와 Node 실행 검사뿐입니다.
> `public/index.html`, `render.yaml`은 **한 글자도 바꾸지 않았습니다.** (AI 전투 버튼은 `public/pvp.js`에서 메뉴만 바꿔서 숨겼습니다. `pvp-protocol.md`의 "메뉴" 참고) `server.js`와 `public/pvp.js`는 서버 진행 방식을 위해 확장했고, `PVP_SERVER_AUTH`를 켜지 않으면 기존 중계 방식 그대로 동작합니다(테스트로 확인).

## 1. 한 줄 요약
전투 계산을 `engine.js`로 분리했고, **증강 효과를 팀별로 나눴고**, 이번에 **증강 선택(뽑기·선택·기물 지정·배치 이동)을 서버가 직접 처리하는 `Aug` API**를 추가했습니다. 싱글과 같은 "호환 모드"는 원본과 틱마다 완전히 같고(301개 통과), PvP 모드에서는 각 증강이 가진 쪽 팀에만 적용됩니다.

## 2. 산출물
| 파일 | 설명 |
|---|---|
| `engine.js` | 전투 엔진 (브라우저/Node 공용, DOM 없음, 시드 난수) |
| `test-engine.js` | 엔진 검증. `npm run test:engine`(전투, 호환 모드), `npm run test:pvp`(전투, PvP 모드), `npm run test:aug`(증강 선택) |
| `pvp-game.js`, `server.js` | 서버 진행(증강 제시·선택·배치·전투·목숨). `PVP_SERVER_AUTH=1`일 때만 켜짐. 규격은 `pvp-protocol.md` |
| `test-server.js` | 서버 검증. `npm run test:server` (`ws`가 설치돼 있어야 통합 테스트까지 실행) |
| `public/pvp.js` | 클라이언트. 서버 진행 방식(`matched.auth`)일 때 서버 상태를 그리기만 함. 아닐 때는 기존 동작 그대로 |
| `test-client.js` | 클라이언트 검증. `npm run test:client` (원본 `index.html`+`pvp.js`를 가짜 화면으로 실행해 두 클라이언트를 서버에 연결, 한 판 통째로) |
| `tools/build-engine.py`, `team_patch.py`, `aug_extract.py` | `index.html`에서 `engine.js`를 다시 만드는 스크립트 (팀 분리 규칙은 `team_patch.py`, 증강 추출은 `aug_extract.py`) |
| `package.json` | 이름을 `chamho-autochess`로 통일, 테스트 스크립트 2줄 추가 |

## 3. 두 가지 모드
| | 호환 모드 (싱글과 동일) | PvP 모드 |
|---|---|---|
| 호출 | `Engine.begin({seed, st})` | `Engine.begin({seed, st, st1, en})` |
| 증강 | 0번 팀(나)만 적용, 적(AI)은 `aiSed`/`aiNapo`만 | **`st`는 P1, `st1`은 P2**의 증강 플래그. 각자 자기 팀에만 적용 |
| 적 부대 | `st.en` + 라운드 배율 | `en` = P2 부대를 P1 시점으로 회전한 배열, **라운드 배율 없음** |
| 검증 | 원본과 틱마다 동일 (301개) | 증강별 적용 대상 확인 + 승률 대칭 확인 |

```js
const Engine = require('./engine.js');
Engine.begin({ seed, st: stP1, st1: stP2, en: rotatedP2Roster });   // st/st1 = 각 플레이어 st 의 JSON 사본
while (!Engine.step(0.05)) { const ev = Engine.drain(); const snap = Engine.snapshot(); }   // 0.05초 = 초당 20틱
Engine.result();      // 'win' = P1 승, 'lose' = P2 승, 'draw'
Engine.negotiate(team); // 팀별 협상 (team 0 또는 1)
```
- **dt는 0.05초로 고정하세요.** (결정하신 초당 20틱. 검증도 이 값 기준입니다.)
- 회전: `c → 5-c`, `r → 9-r`. 2×2 큰 유닛은 육각 줄 홀짝 때문에 단순 회전이 안 맞을 수 있어서 호출하는 쪽(기존 pvp.js 방식)에서 처리해야 합니다.

## 4. 팀별로 나눈 것 (`team_patch.py`, 41곳 패치)
"아군 = team 0"으로 박혀 있던 코드를 `team` 기준으로 바꿨습니다. 호환 모드에서는 team 1에게 효과가 가지 않도록 막아서 원본과 같게 동작합니다.
- **증강 플래그 → 팀별 적용:** vers, bunseo, marchH(상대에게 굶주림), accel, medx, lee, conf, comm, holy, mon, napo, seduce, sacOn, dm, wihwa, 거북선 증식, 앙파상(방향 반전), 협상(팀별 횟수)
- **카드·교황, 고지 영토(gk), 학자(sch)** 등 유닛 능력도 팀별 집계로 변경
- **전장 전체 규칙** (`speed`, `dm`의 시간 제한)은 둘 중 한 쪽이라도 있으면 적용
- **몬(mon) 사망:** 호환 모드는 기존처럼 내 몬이 죽을 때만 패배. PvP는 어느 쪽 몬이든 죽으면 그 팀이 패배

## 5. 검증 결과 (Node, 실제 브라우저 아님)
**호환 모드:** 결정성 9/9, 원본 대비 동일성 **301 통과 / 0 실패** (라운드 1~15, 증강 75종 단독·고난, 무작위 조합 60개). 팀 분리·`hud` 수정 후에도 통과.
**PvP 모드:** 13개 항목 통과
- 같은 시드 결정성
- vers·bunseo·accel은 **가진 팀에만**, marchH는 **상대 팀에만** 붙는지 (1번 팀·2번 팀 양쪽에서)
- 협상이 해당 팀 횟수만 쓰는지
- 무작위 증강 조합 80판이 오류 없이 끝나는지
- **대칭성:** 증강 없는 같은 부대끼리 40판 → 1번 팀 20승 / 2번 팀 20승. 증강 73종을 "1번 팀이 가질 때"와 "2번 팀이 가질 때"로 나눠 20판씩 돌렸을 때 승률 차이 평균 7.3%p (20판 표본의 잡음 수준). 30%p 이상 차이는 `wild` 1종뿐이며, 이는 PvP 제외 증강이라 정상입니다.

## 5-2. 서버 증강 선택 API (`Engine.Aug`) — 4번째 검증 결과 포함
플레이어마다 상태 객체 `S`(원본의 `st`)를 **서버 메모리에만** 두고, 클라이언트는 요청만 보냅니다. 난수 시드는 서버가 정해서 넘깁니다.
```js
const S = Engine.Aug.newState();                       // 새 플레이어 상태 (원본 init 과 같은 시작 부대)
Engine.Aug.offer(S, seed, EXCLUDED);                   // 3장 뽑기 → ['id','id','id'] (제외 증강은 3장을 다시 뽑음, 기존 pvp.js 와 같은 방식)
Engine.Aug.offer(S, seed, EXCLUDED, true);             // 리롤 (라운드당 1회, 두 번째는 null)
Engine.Aug.choose(S, id, seed);                        // 제시된 3장 중 하나만 허용 → {ok} / {err:'not-offered'|'pending'|'phase'}
Engine.Aug.pendPick(S, c, r, seed);                    // 기물 지정(말, 거대화, 결속 등): 조건에 안 맞으면 {accepted:false}
Engine.Aug.move(S, c0, r0, c, r);                      // 배치 이동 (내 진영 5~9줄만, 원본 규칙: 해병·근위병 등 제한 포함) → true/false
Engine.Aug.view(S);                                    // 클라이언트에 보낼 상태 (부대, 증강 이름, 지정 대기 중이면 선택 가능한 칸 목록)
Engine.Aug.rotate(roster);                             // 상대 시점 180도 회전 (큰 유닛 포함)
```
- **원본과의 차이는 의도한 것 두 가지뿐:** (1) 싱글 전용인 AI 증강 뽑기/적 생성(`aiPick`, `genEn`, `aiApplyAll`)은 뺐고, (2) 서버가 제시한 3장 밖의 증강은 거절합니다.
- **`hud()`의 숨은 규칙:** 원본 `hud()`는 화면 갱신 외에 "AI와 보병이 붙으면 사이보그로 융합"(`fuseCheck`)도 실행합니다. 엔진의 `hud()`는 화면 부분만 빼고 이 규칙은 그대로 실행합니다. (검증 중 `total` 증강에서 차이로 발견했습니다.)
- **검증 (원본 `choose()`·클릭 핸들러를 Node에서 그대로 돌려 비교):**
  - 증강 75종 × 4가지 상황(새 상태 / 앞선 증강 1~3개 후 / 패배 보상 / 고난 모드) = 300개: 증강 적용 → 기물 지정 끝까지 → 무작위 배치 이동 6번, **전부 같은 상태**
  - 3장 뽑기: 같은 시드로 원본 `roll3()`와 120개 비교, **전부 같은 결과**
  - 규칙 6개 통과: 제외 증강이 3장에 섞이지 않음(300회), 리롤은 라운드당 1회, 제시 안 된 증강 선택 거절, 기물 지정 중 새 증강 거절, 조건에 안 맞는 칸 지정은 무시, 큰 유닛 회전, 적 진영으로 이동 불가
- **아직 서버에 없는 것(다음 작업):** 라운드 진행(전투 결과 → 목숨 차감/패배 보상 증강/승리 시 다음 라운드), 타이머(증강 30초·배치 30초 자동 선택), 방/레디/소켓 메시지. `finish()`와 `drawEnd()` 규칙은 코드에서 확인했습니다(패배: 목숨 −1 후 보상 증강 `lose=1`, 승리: `tmp` 유닛 제거 후 증강, 15라운드 승리 시 종료, 무승부는 같은 라운드 재준비).

## 6. 아직 팀별로 나뉘지 않은 것 (모두 PvP 제외 증강)
`siege, trench, ice, warp, quake, highland(hl), meteor(met), bounty, wild, lb, banzai`는 **0번 팀 기준 그대로**입니다. PvP에서 나오지 않게 막아 둔 목록과 같아서 지금은 영향이 없습니다. 이 중 하나를 PvP에 풀 때는 따로 작업해야 합니다.

## 7. 한계와 주의점
1. **엔진은 복사본입니다.** 싱글 AI 전투는 계속 `index.html` 안의 원래 코드로 돕니다. 규칙을 고치면 `python3 tools/build-engine.py public/index.html engine.js` 후 `npm run test:engine && npm run test:pvp`를 실행하세요. `index.html` 줄 구조가 크게 바뀌면 `build-engine.py`의 줄 범위와 `team_patch.py`의 문자열도 손봐야 합니다(문자열이 안 맞으면 빌드가 바로 멈춥니다).
2. PvP 전투 모드의 **개별 증강 효과는 시작 효과 4종만 직접 확인**했고, 나머지는 "오류 없이 도는지"와 "승률이 대칭인지"로 확인했습니다. 원본과 같은 비교 기준이 없어서 이 부분은 호환 모드만큼 강한 검증이 아닙니다.
3. 증강 선택 후 `st.pend`(유닛 선택 대기)는 엔진이 비웁니다. 전투 시작 전에 확정되어 있어야 합니다.
4. 이펙트 이벤트에는 유닛 식별자가 없습니다. 유닛은 `B.us` 인덱스로 구분합니다(전투 중 추가는 되지만 삭제는 안 됨).
5. 브라우저는 시드 없는 난수를 쓰므로, 브라우저 실물과 수치까지 같다고 확인한 것은 아닙니다(논리가 같다는 의미).
6. `render.yaml`의 서비스 이름(`chamho-autochess-online`)은 **바꾸지 않았습니다.** 이미 Render에 배포되어 있다면 이름을 바꿀 때 새 서비스가 생길 수 있어서입니다. 통일을 원하시면 알려 주세요.


## 7-2. 엔진에서만 고친 원본 버그 2건 (`index.html`은 그대로)
서버에서 모든 증강 조합을 돌리다가 **원본 게임에도 있는 무한 재귀**를 발견했습니다. 브라우저 원본에서도 같은 조합이면 `Maximum call stack size exceeded`로 전투가 멈춥니다.
1. **`comm`(공산주의) + `guard`(근위병)**: 피해를 나누는 `comm`이 보호받는 아군에게도 피해를 주고, 그 아군은 근위병에게 피해를 넘기며, 근위병이 다시 `comm`을 발동하는 순환. → 근위병에게 넘기는 호출에도 "이미 나눔" 표시를 이어 주도록 수정.
2. **`piggy`(업어주기) + `guard`**: 두 증강이 `gid`/`gdg` 필드를 같이 써서 두 유닛이 서로를 보호하는 순환이 생길 수 있음. → 보호 전달을 최대 5번까지만 따르도록 제한.
정상적인 한 단계 보호의 동작은 같고(호환 모드 301개 전부 그대로 통과), 위 조합일 때만 달라집니다. 싱글 게임(`index.html`)도 고치길 원하시면 같은 두 줄을 알려 드릴 수 있습니다.
또 `hud()`가 숨은 규칙(AI+보병 융합)을 실행하는 것과, 서버가 새로 만든 상태에 `en`이 없어서 `mad`(광기)에서 오류가 나던 것도 이번에 잡았습니다(450가지 증강 조합 선택+전투가 오류 없이 도는 테스트 추가).

## 8. 함수 분류 (index.html 전체 109개)
| 분류 | 개수 | 함수 |
|---|---|---|
| 전투 중 실제로 쓰이는 로직 (엔진 핵심) | 42 | mk,start,studyGive,graceGive,graceAll,holyCover,merPay,bunseoStart,burnSet,studyEnd,studyStart,wildSpawn,wildAI,conf,lbCharge,lbBetray,enpass,sacKill,bountySet,sacStart,vsStart,dbg,txt,die,save,setupFx,warpTo,postMove,quake,release,negotiate,troyOpen,moveBig,hit,blast,revive,upd,asp,mdm,pierce,lineShip,bro |
| 엔진에 복사됐지만 전투 중엔 안 쓰는 라운드 준비용 | 15 | genEn,popeCheck,fuseCheck,rollField,spawnBig,applyPend,spawn,total,fixSn,formation,madApply,fixGd,fixMon,fixMar,snap |
| 엔진 제외: 증강 선택·AI 군대 생성·라운드 전환 | 11 | enOc,enAdd,enConv,enBig,aiPick,aiApplyAll,aiApply,drawEnd,finish,roll3,choose |
| 엔진 제외: 화면·메뉴·그리기·타이머 | 41 | init,modeSel,mainMenu,pvpLobby,setMode,openPick,renderPick,duckd,over,mod,hud,pos,codex,hex,soldier,piece,tankd,troyd,eled,psd,demond,seald,unit,bodyDraw,shd,saFx,aid,animd,tksd,shipd,walld,shkd,relMark,aced,mpkd,hogd,merd,plane,draw,turnTimeout,turnTick |

## 9. 다음 단계
1. **(완료)** 서버 진행: `pvp-game.js` + `server.js` (35개 검증 통과). 규격은 `pvp-protocol.md`.
2. **(완료)** 클라이언트 `public/pvp.js`: 서버 상태를 그리기만 함 (헤드리스 42개 검증 통과).
3. **(남음)** 실제 브라우저에서 확인. `PVP_SERVER_AUTH=1`로 켜서 두 브라우저(또는 PC+폰)로 한 판 해 보세요. 화면 그림, 터치, 2번 플레이어 화면의 뒤집힘이 핵심 확인 항목입니다.

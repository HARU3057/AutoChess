/* engine.js — 참호 오토체스 전투 계산 엔진 (자동 생성: tools/build-engine.py)
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
const W=360,H=470,S=27,HW=Math.sqrt(3)*S,OX=(W-(6*HW+HW/2))/2+HW/2,OY=38;
const cx=(c,r)=>OX+c*HW+(r&1)*HW/2,cy=r=>OY+r*S*1.5;
const cube=(c,r)=>{const x=c-(r-(r&1))/2;return[x,r,-x-r]};
const D=(a,b)=>{const p=cube(a.c,a.r),q=cube(b.c,b.r);return Math.max(Math.abs(p[0]-q[0]),Math.abs(p[1]-q[1]),Math.abs(p[2]-q[2]))};
const DIR=[[[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]],[[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]]];
const nb=(c,r)=>DIR[r&1].map(d=>[c+d[0],r+d[1]]).filter(p=>p[0]>=0&&p[0]<6&&p[1]>=0&&p[1]<10);
const cellsAt=(c,r)=>{const o=r&1?1:0;return[[c,r],[c+1,r],[c+o,r+1],[c+1+o,r+1]]};
const cellsOf=u=>u.type&&T[u.type]&&T[u.type].big?cellsAt(u.c,u.r):[[u.c,u.r]];
const dTo=(p,u)=>Math.min(...cellsOf(u).map(q=>D({c:p[0],r:p[1]},{c:q[0],r:q[1]})));
const DU=(a,b)=>Math.min(...cellsOf(a).map(p=>dTo(p,b)));
const ctr=o=>{const cs=cellsOf(o);return[cs.reduce((a,p)=>a+cx(p[0],p[1]),0)/cs.length,cs.reduce((a,p)=>a+cy(p[1]),0)/cs.length]};
const occR=(c,r,ign)=>st.roster.find(o=>o!==ign&&cellsOf(o).some(p=>p[0]==c&&p[1]==r));
const bigFree=(c,r,ign)=>cellsAt(c,r).every(p=>p[0]>=0&&p[0]<6&&p[1]>=5&&p[1]<10&&!occR(p[0],p[1],ign));
const T={inf:{n:'보병',hp:100,atk:11,rng:1,as:.8},chn:{n:'중공군',hp:55,atk:9,rng:1,as:.7,resp:1},
med:{n:'의무병',hp:70,atk:0,rng:3,as:1,heal:14},gnt:{n:'거대 보병',hp:320,atk:24,rng:1,as:1.1,sc:1.6},
kn:{n:'나이트',hp:170,atk:20,rng:1,as:.7,spd:.28},bi:{n:'비숍',hp:110,atk:15,rng:3,as:.9},
rk:{n:'룩',hp:280,atk:16,rng:1,as:1},qn:{n:'퀸',hp:200,atk:26,rng:2,as:.8,spd:.35},
duck:{n:'창파나이트',hp:190,atk:14,rng:1,as:.8},mar:{n:'해병',hp:154,atk:17.6,rng:1,as:.8,weak:1},bay:{n:'총검병',hp:115,atk:9,rng:3,as:.8},
lf:{n:'루피',hp:170,atk:14,rng:1,as:.7},sn:{n:'저격수',hp:90,atk:0,rng:12,as:6},
mu:{n:'머스켓',hp:95,atk:150,rng:7,as:9},mg:{n:'몽골군',hp:158,atk:17.6,rng:3,as:.8,spd:.3},gk:{n:'칭기즈칸',hp:336,atk:30.8,rng:1,as:.7,spd:.3},
mc:{n:'기관총병',hp:110,atk:7,rng:5,as:.15,spd:.8},tk:{n:'탱크',hp:380,atk:55,rng:6,as:3,spd:.9,sc:1.2},gr:{n:'척탄병',hp:60,atk:22,rng:4,as:1.6},cr:{n:'십자군',hp:150,atk:17,rng:1,as:.8},jn:{n:'예니체리',hp:150,atk:20,rng:1,as:.6,spd:.4},
np:{n:'나폴레옹',hp:260,atk:26,rng:5,as:1.1,spd:.5,sc:1.25},ps:{n:'피슈터',hp:110,atk:13,rng:12,as:.9},sk:{n:'해골',hp:35,atk:9,rng:1,as:.65},dm:{n:'대마왕',hp:700,atk:90,rng:1,as:.22,spd:.08,sc:2},
sp:{n:'스파르타군',hp:130,atk:7,rng:1,as:.25,spd:.4},fr:{n:'프랑스 돌격군',hp:170,atk:26,rng:1,as:.55,spd:.22},ship:{n:'스페인 함선',hp:650,atk:14,rng:4,as:1.2,spd:.7,sc:1.5},gd:{n:'근위병',hp:260,atk:10,rng:1,as:.9},fan:{n:'광신도',hp:90,atk:8,rng:1,as:.8},sch:{n:'학자',hp:80,atk:0,rng:0,as:9,spd:99},ai:{n:'AI',hp:130,atk:22,rng:6,as:1.1,spd:.6},cy:{n:'사이보그',hp:210,atk:12,rng:5,as:.28,spd:.45},sheep:{n:'양',hp:120,atk:0,rng:0,as:9,spd:99},deer:{n:'사슴',hp:160,atk:14,rng:1,as:.9,spd:.5},lion:{n:'사자',hp:300,atk:28,rng:1,as:.8,spd:.4},drg:{n:'드래곤',hp:5000,atk:0,rng:0,as:9,spd:99,sc:2.6},sh:{n:'시협회 2과 부장',hp:480,atk:42,rng:1,as:.9,spd:.45},lb:{n:'여포',hp:240,atk:20,rng:1,as:.22,spd:.35,sc:1.15},cl:{n:'광대',hp:90,atk:0,rng:0,as:9,spd:1},mon:{n:'절대군주',hp:650,atk:18,rng:3,as:1.5,spd:99,sc:1.3},tks:{n:'거북선',hp:520,atk:30,rng:5,as:2.4,spd:.8,sc:1.5},ger:{n:'독일군',hp:150,atk:14,rng:1,as:.8},prs:{n:'성직자',hp:90,atk:0,rng:0,as:99,spd:99},card:{n:'추기경',hp:130,atk:4,rng:1,as:.25,spd:.4},pope:{n:'교황',hp:280,atk:14,rng:1,as:.9,spd:.45,sc:1.2},mpk:{n:'미니 페카',hp:520,atk:70,rng:1,as:1.25,spd:.25},hog:{n:'호그 라이더',hp:220,atk:26,rng:1,as:.8,spd:.28},mer:{n:'이슬람 상인',hp:160,atk:0,rng:0,as:99,spd:.35},bkg:{n:'부캉이',hp:150,atk:16,rng:1,as:.7,spd:.35},ace:{n:'포트거스 D 에이스',hp:300,atk:5,rng:2,as:.25,spd:.45,sc:1.15},wall:{n:'성벽',hp:250,atk:0,rng:0,as:99},troy:{n:'트로이 목마',hp:320,atk:0,rng:0,as:99,big:1,sc:2.2},ele:{n:'코끼리',hp:900,atk:30,rng:1,as:1.3,spd:3.5,big:1,sc:2.2}};
const SOLD=['inf','chn','gnt','mar','bay','lf','sn','mc','gr','cr','jn'];
const REL=['cr','prs','pope','bi','card'],NOCV=['np','gk','dm','lb','tks','mon','cl','sch','sh','prs','pope','card','cr','ace','bkg','gd','sn','troy','ele','tk','ai','cy','wall'];
function genEn(n){const ty=[];for(let i=0;i<Math.min(3+n,n>=11?15:12);i++)ty.push('inf');
if(n%3==0)ty.unshift('gnt');if(n>=4)ty.unshift('kn');if(n>=5)ty.push('bi');if(n>=7)ty.unshift('rk');if(n>=9)ty.unshift('qn');if(n>=2)ty.push('med');if(n>=11)ty.unshift('rk');if(n>=12)ty.push('bi');if(n>=13)ty.unshift('qn');if(n>=14)ty.unshift('gnt');if(n>=15)ty.push('mc');
const o=[];for(let r=4;r>=0;r--)for(let c=0;c<6;c++)o.push([c,r]);return ty.map((t,i)=>({type:t,c:o[i][0],r:o[i][1]}))}
function mk(team,o,m){const t=T[o.type],hp=Math.round(t.hp*(m||1)*(1+(o.hpb||0)));const u={team,type:o.type,c:o.c,r:o.r,c0:o.c,r0:o.r,x:cx(o.c,o.r),y:cy(o.r),hp,mx:hp,atk:t.atk*(m?1+(m-1)*.6:1),at:rnd()*.4,mt:rnd()*.3,fl:0,used:0,rt:0,gone:0,dead:0,bid:o.bid,bk:o.bk,hpb:o.hpb,gid:o.gid,gdg:o.gdg,sac:o.sac,enp:o.enp,rd:o.rd,horse:o.horse};const p=ctr(u);u.x=p[0];u.y=p[1];return u}
function start(){if(st.phase!='prep'||st.pend)return;st.sel=null;st.paused=0;st.flash='';st.neg=st.negMax||0;if(!LEG)st1.neg=st1.negMax||0;const m=LEG?1+.1*(st.round-1):undefined;
B={us:[...st.roster.map(o=>mk(0,o)),...st.en.map(o=>mk(1,o,m))],t:0,pl:[],fx:[],tx:[],tz:{},hole:{},end:0,res:''};
for(let i=0;i<st.met;i++)B.pl.push({k:'m',d:2+rnd()*11,c:rnd()*6|0,r:rnd()*10|0});
B.napo=LEG?[st.napo||st.aiNapo,st.napo||st.aiNapo,st.napo||st.aiNapo]:[st.napo,st1.napo,0];B.cf=[0,0];B.hl=st.hlSet||null;B.fr=B.us.some(u=>u.type=='fr');if(st.debug)dbg();bountySet();sacStart();vsStart();lbBetray();wildSpawn();studyStart();bunseoStart();setupFx();if(st.siege){B.wl={};for(let c=0;c<6;c++){const w=mk(0,{type:'wall',c,r:5});w.hp=w.mx=250+25*(st.round-1);B.us.push(w);B.wl[c+',5']=w}}{B.gk=[0,0];B.terr=[new Set(),new Set()];for(const T0 of TEAMS()){const k=B.us.find(u=>u.team==T0&&u.type=='gk');B.gk[T0]=!!k;B.terr[T0]=new Set(k?[k.c+','+k.r]:[])}}
if(st.trench){B.tr=1;B.trs=B.us.filter(u=>u.team&&u.r>=3&&u.r<=4)}st.phase='battle';hud()}
const cyN=u=>B.us.filter(x=>x.type=='cy'&&x.team==u.team&&!x.dead&&!x.gone).length;
function studyGive(u){if(!u||u.sy)return;const k=['hp','atk','as','spd'][rnd()*4|0];u.sy=k;u.syT=4;if(k=='hp'){u.mx=Math.round(u.mx*1.2);u.hp=Math.round(u.hp*1.2)}txt(u,'공부 '+({hp:'체력',atk:'공격력',as:'공격속도',spd:'이동속도'})[k]+' +20%','#8cf')}
function graceGive(u,q){if(!u||u.dead||u.gone)return;u.grc=Math.min(8,(u.grc||0)+1);u.bl=Math.min(8,(u.bl||0)+1);if(!q)txt(u,'신의 가호','#ff9')}
function graceAll(tm){B.us.filter(x=>x.team==tm&&!x.dead&&!x.gone&&!['wall','cl','sch'].includes(x.type)).forEach(x=>{graceGive(x,1);txt(x,'가호 '+x.grc,'#ff9');FXP({k:'w',x:x.x,y:x.y,t:.4})})}
function holyCover(u){const up=nb(u.c,u.r).filter(p=>p[1]==u.r-1);return B.us.some(x=>x!==u&&x.team==u.team&&!x.dead&&!x.gone&&REL.includes(x.type)&&cellsOf(x).some(q=>up.some(p=>p[0]==q[0]&&p[1]==q[1])))}
function popeCheck(){if(!st.conc||st.popeDone||st.round<st.conc)return;const el=x=>!T[x.type].big&&(!NOCV.includes(x.type)||x.type=='cr'),o=shf(st.roster.filter(x=>el(x)&&x.type!='cr'))[0]||shf(st.roster.filter(el))[0];if(o){o.type='pope';st.popeDone=1;st.flash='교황이 선출되었습니다.'}}
function merPay(u,occ){const rows=u.team?[0,1,2,3,4]:[9,8,7,6,5];let n=0;for(const r of rows)for(let c=0;c<6&&n<3;c++){const k=c+','+r;if(occ[k]||B.tz[k]||B.hole[k])continue;const x=mk(u.team,{type:'inf',c,r});B.us.push(x);occ[k]=x;n++;txt(x,'지급','#fd3')}txt(u,'보병 지급','#fd3')}
function bunseoStart(){B.road={};B.cardN=[0,0];for(const T0 of TEAMS()){B.cardN[T0]=B.us.filter(u=>u.team==T0&&u.type=='card').length;if(SS(T0).marchH)B.us.forEach(u=>{if(u.team==1-T0&&u.type!='wall'&&!u.gone){u.hu=1}});if(SS(T0).bunseo)B.us.forEach(u=>{if(u.team==T0&&!u.gone&&!['wall','cl','sch'].includes(u.type)){u.mor=(u.mor||0)+2;txt(u,'사기 x2','#fd3')}})}}
function burnSet(s,o,d){if(o.dead||o.gone)return;o.brD=8*(1+B.t*.12)*sb(s);o.brn=Math.max(o.brn||0,d);o.brS=s}
function studyEnd(u){if(u.sy=='hp'){u.mx=Math.round(u.mx/1.2);u.hp=Math.min(u.hp,u.mx)}u.sy=null}
function studyStart(){for(const T0 of TEAMS()){if(!B.us.some(u=>u.type=='sch'&&u.team==T0&&!u.gone))continue;shf(B.us.filter(u=>u.team==T0&&!u.gone&&!['sch','wall','cl'].includes(u.type))).slice(0,2).forEach(studyGive)}}
function wildSpawn(){if(!st.wild)return;const x=rnd(),ty=x<.33?'sheep':x<.66?'deer':x<.99?'lion':'drg',fr=[];for(let r=3;r<=6;r++)for(let c=0;c<6;c++)if(!B.us.some(u=>!u.gone&&u.c==c&&u.r==r))fr.push([c,r]);const p=fr[rnd()*fr.length|0];if(!p)return;const w=mk(2,{type:ty,c:p[0],r:p[1]});w.wild=1;B.us.push(w);if(ty=='drg'){B.dg=1;txt(w,'드래곤 출현!','#f84')}else txt(w,T[ty].n+' 출현','#cfc')}
function wildAI(u,occ){const b=B,t=T[u.type];if(u.type=='sheep'||u.type=='drg')return;let tg=null;if(u.type=='deer'){if(u.agg&&!u.agg.dead&&!u.agg.gone)tg=u.agg;else return}else{tg=b.us.filter(o=>o!==u&&!o.dead&&!o.gone&&!o.wild&&o.type!='wall'&&DU(u,o)<=3).sort((a,z)=>DU(u,a)-DU(u,z))[0];if(!tg)return}
const d=DU(u,tg);if(d<=1){if(u.at<=0){hit(tg,u.atk*(u.wb?1.25:1),0);u.at=t.as}}else if(u.mt<=0){let best=null,bd=d;for(const[c,r]of nb(u.c,u.r)){if(occ[c+','+r]||b.hole[c+','+r])continue;const dd=dTo([c,r],tg);if(dd<bd){bd=dd;best=[c,r]}}if(best){delete occ[u.c+','+u.r];u.c=best[0];u.r=best[1];occ[best+'']=u}u.mt=t.spd}}
function fuseCheck(){if(st.phase!='prep')return;for(const a of st.roster.filter(o=>o.type=='ai')){const f=st.roster.find(x=>x.type=='inf'&&nb(a.c,a.r).some(p=>p[0]==x.c&&p[1]==x.r));if(f){a.type='cy';st.roster.splice(st.roster.indexOf(f),1);if(st.sel===f)st.sel=null;st.flash='AI와 보병이 융합해 사이보그가 되었습니다.'}}}
const monRv=u=>SS(u.team).mon&&!u.used&&!T[u.type].big&&!['np','gk','dm','lb','mon','wall','cl'].includes(u.type)&&B.us.some(x=>x.type=='mon'&&!x.team&&!x.dead&&!x.gone);
function conf(u,tg,t){const c=B.us.find(x=>x.type=='cl'&&!x.dead&&!x.gone&&DU(x,u)<=1);if(!c)return tg;if(rnd()>(u.team?.5:.2))return tg;if(rnd()<.5){txt(u,'빗나감','#aaa');return null}const l=B.us.filter(o=>o!==u&&!o.dead&&!o.gone&&o.type!='wall'&&DU(u,o)<=Math.max(1,t.rng));txt(u,'혼란','#fc6');return l.length?l[rnd()*l.length|0]:tg}
function lbCharge(u,foes){const f=u.team?1:-1,l=foes.filter(o=>!o.dead&&!o.gone&&(o.y-u.y)*f>-4&&Math.abs(o.x-u.x)<HW*.8);if(!l.length)return;txt(u,'돌진','#f55');l.sort((a,z)=>(a.y-u.y)*f-(z.y-u.y)*f);const far=l[l.length-1];l.forEach(o=>{hit(o,u.atk*10,1);FXP({k:'x',c:o.c,r:o.r,t:.5})});FXP({k:'b',a:u,b:far,t:.3});const occ=B.occ,cd=nb(far.c,far.r).filter(p=>!occ[p+'']&&!B.hole[p+'']).sort((a,z)=>dTo(a,u)-dTo(z,u))[0];if(cd){delete occ[u.c+','+u.r];u.c=cd[0];u.r=cd[1];occ[cd+'']=u}}
function lbBetray(){const me=B.us.filter(u=>!u.team&&!u.gone&&u.type!='wall'&&u.type!='cl').length,en=B.us.filter(u=>u.team==1&&!u.gone).length;if(en<=me)return;const p=Math.min(.9,(en-me)*.12);B.us.forEach(u=>{if(u.type=='lb'&&!u.team&&rnd()<p){u.team=1;u.bty=1;u.hp=u.mx=Math.round(u.mx*.7);txt(u,'배신','#f55')}})}
function enpass(){B.us.forEach(u=>{if(u.team<2&&(!LEG||u.team==0)&&u.enp&&!u.enu&&!u.dead&&!u.gone&&B.t>=2){const c=B.us.filter(o=>o.team==1-u.team&&!o.dead&&!o.gone&&!T[o.type].big&&!['dm','wall','tks'].includes(o.type));if(!c.length)return;const dr=u.team==0?1:-1,m=dr>0?Math.min(...c.map(o=>o.r)):Math.max(...c.map(o=>o.r)),back=c.filter(o=>dr>0?o.r<=m+1:o.r>=m-1).sort((a,z)=>z.mx-a.mx)[0];u.enu=1;const cd=nb(back.c,back.r).filter(p=>!B.occ[p+'']&&!B.hole[p+'']).sort((a,z)=>dr*(a[1]-z[1]))[0];txt(u,'앙파상','#f66');FXP({k:'b',a:u,b:back,t:.3});if(cd){delete B.occ[u.c+','+u.r];u.c=cd[0];u.r=cd[1];B.occ[cd+'']=u}back.imm=0;back.bk=0;back.hp=0;txt(back,'즉사','#f44');die(back)}})}
const mv=u=>(1+.5*(u.bo||0))*(u.hu?.7:1)*(u.gb?1.3:1)*(u.sy=='spd'?1.2:1);
function sacKill(x){const fk=B.fk,cc=B.cur;B.cur=null;x.used=1;x.hp=0;x.imm=0;x.bk=0;die(x);B.fk=fk;B.cur=cc}
function bountySet(){B.wt=null;if(!st.bounty)return;const e=B.us.filter(u=>u.team==1&&u.type!='wall');if(!e.length)return;const rw=u=>Math.max(...cellsOf(u).map(p=>p[1])),fr=Math.max(...e.map(rw)),c=e.filter(u=>rw(u)==fr);B.wt=c[rnd()*c.length|0];txt(B.wt,'현상수배','#e33')}
function sacStart(){for(const T0 of TEAMS()){if(!SS(T0).sacOn)continue;const f=B.us.find(u=>u.team==T0&&u.sac&&u.type=='fan'&&!u.gone);if(!f)continue;const al=B.us.filter(o=>o!==f&&o.team==T0&&!o.gone&&o.type!='wall'&&o.type!='dm'&&!T[o.type].big&&DU(f,o)<=1).sort((a,z)=>a.hp-z.hp)[0];if(!al)continue;sacKill(al);sacKill(f);txt(f,'인신공양','#fd3');B.us.forEach(u=>{if(u.team==T0&&!u.gone&&u.type!='wall'){u.gb=1}})}}
function vsStart(){for(const T0 of TEAMS())if(SS(T0).vers)B.us.forEach(u=>{if(u.team==T0)u.bo=(u.bo||0)+1})}
function dbg(){[0,1].forEach(t=>{const us=B.us.filter(u=>u.team==t&&!T[u.type].big),bc=new Set();B.us.filter(u=>u.team==t&&T[u.type].big).forEach(u=>cellsOf(u).forEach(p=>bc.add(p+'')));const cs=[];for(let r=t?0:5;r<(t?5:10);r++)for(let c=0;c<6;c++)if(!bc.has(c+','+r))cs.push([c,r]);shf(cs).forEach((p,i)=>{const u=us[i];if(u){u.c=u.c0=p[0];u.r=u.r0=p[1];const q=ctr(u);u.x=q[0];u.y=q[1]}})})}
const blk=(u,c,r)=>{const k=c+','+r,w=B.wl&&B.wl[k];return !!((u.team&&w&&!w.gone)||(B.hl&&B.hl[k]&&!B.hl[u.c+','+u.r]))};
function txt(u,s,c){B.tx.push({x:u.x,y:u.y-20,s,c,t:.7});EV.push({k:'txt',x:u.x,y:u.y-20,s,c})}
function die(u){if(u.type=='prs'&&!u.pg){u.pg=1;txt(u,'성직자 순교','#ff9');graceAll(u.team)}if(u.type=='mon'&&u.team<2&&(!LEG||u.team==0))B.md=u.team+1;if(u.wild&&u.type!='drg'){const k=B.cur;if(k&&k.team!=2)B.us.forEach(x=>{if(x.team==k.team&&!x.dead&&!x.gone&&x.type!='wall'&&x!==u){if(u.type=='lion'){x.wb=1;txt(x,'공격력 증가','#fa4')}else{x.hp=Math.min(x.mx,x.hp+Math.round(x.mx*.2));txt(x,'회복','#6f6')}}})}if(B.cur&&B.cur.type=='lion'&&!u.wild){const l=B.cur;l.hp=Math.min(l.mx,l.hp+Math.round(l.mx*.3));txt(l,'사냥','#f84')}
if(SS(u.team).lee&&u.type=='tks')lineShip(u);if(st.bounty&&B.wt===u){B.wt=null;B.us.forEach(x=>{if(!x.team&&!x.dead&&!x.gone&&x.type!='wall'){x.bo=(x.bo||0)+1;txt(x,'보수','#ffd23a')}})}if(u.type!='wall'){for(const T0 of TEAMS())if(SS(T0).conf){if(u.team==T0)B.cf[T0]=Math.max(-.6,(B.cf[T0]||0)-.075);else B.cf[T0]=Math.min(1.5,(B.cf[T0]||0)+.1)}}if(!B.fk){B.fk=1;const k=B.cur;if(k&&k.team<2&&SS(k.team).seduce){B.us.forEach(f=>{if(f.team!=k.team&&f!==u&&!f.dead&&!f.gone&&f.type!='dm'&&f.type!='wall'&&f.type!='tks'&&DU(f,u)<=2){f.team=k.team;txt(f,'꼬드김','#f9c')}});SS(k.team).seduce=0}}
if(monRv(u)){u.dead=1;u.rt=4;txt(u,'4초 후 부활','#fd8')}else if(T[u.type].resp&&!u.used){u.used=1;u.dead=1;u.rt=2}else{u.dead=1;u.gone=1;if(u.type=='troy')troyOpen(u)}}
function save(u){if(u.type=='pope'&&B.cardN[u.team]>0&&B.us.filter(x=>x.type=='card'&&x.team==u.team&&!x.dead&&!x.gone).length>=B.cardN[u.team]){u.hp=Math.ceil(u.mx*.1);u.fl=.12;txt(u,'불사','#ff9');return true}if(u.imm>0){u.hp=1;return true}if(u.bk&&!u.bkUsed){u.bkUsed=1;u.imm=3;u.hp=1;u.fl=.12;txt(u,'불사','#f55');return true}return false}
function rollField(){st.hlSet=null;if(st.hl){const cs=[];for(let r=8;r<10;r++)for(let c=0;c<6;c++)cs.push([c,r]);const s0=cs[rnd()*cs.length|0],set={[s0+'']:1},ls=[s0];while(ls.length<5){const cd=[];ls.forEach(p=>nb(p[0],p[1]).forEach(q=>{if(q[1]>=8&&!set[q+''])cd.push(q)}));const q=cd[rnd()*cd.length|0];set[q+'']=1;ls.push(q)}st.hlSet=set}
st.wp=null;st.ic=null;st.wpath=null;
if(st.warp){const c=rnd()*4|0,r=1+(rnd()*7|0),o=r&1;st.wpath=[[c,r],[c+o,r+1],[c+1,r],[c+1+o,r+1],[c+2,r]];st.wp={};st.wpath.forEach(p=>st.wp[p+'']=1)}
if(st.ice){st.ic={};const all=[];for(let r=0;r<10;r++)for(let c=0;c<6;c++)if(!(st.wp&&st.wp[c+','+r]))all.push([c,r]);shf(all).slice(0,3).forEach(p=>st.ic[p+'']=1)}}
function setupFx(){B.warp=st.wp||null;B.ice=st.ic||null;B.wpath=st.wpath||null;
if(st.ice)shf(B.us.filter(u=>!T[u.type].big&&u.type!='dm'&&u.type!='tks')).slice(0,3).forEach(u=>{u.fz=1});
for(const T0 of TEAMS())if(SS(T0).accel)shf(B.us.filter(u=>u.team==T0&&!T[u.type].big&&u.type!='ps')).slice(0,2*SS(T0).accel).forEach(u=>{u.hs=1})}
function warpTo(u,occ){const tc=5-u.c,tr=9-u.r;let best=null,bd=1e9;
for(let r=0;r<10;r++)for(let c=0;c<6;c++){const k=c+','+r;if(occ[k]||B.warp[k]||B.hole[k]||B.tz[k]||blk(u,c,r)||(B.tr&&u.team&&r>=5))continue;const d=D({c,r},{c:tc,r:tr});if(d<bd){bd=d;best=[c,r]}}
if(!best)return;delete occ[u.c+','+u.r];FXP({k:'w',x:u.x,y:u.y,t:.4});u.c=best[0];u.r=best[1];occ[best+'']=u;u.x=cx(u.c,u.r);u.y=cy(u.r);FXP({k:'w',x:u.x,y:u.y,t:.4});txt(u,'워프','#c9f')}
function postMove(u,oc,or,occ){const b=B;
if(b.ice&&u.type!='tks'&&u.type!='mon'&&b.ice[u.c+','+u.r]){const idx=DIR[or&1].findIndex(d=>oc+d[0]==u.c&&or+d[1]==u.r);
if(idx>=0){const d=DIR[u.r&1][idx],nc=u.c+d[0],nr=u.r+d[1],nk=nc+','+nr;
if(nc>=0&&nc<6&&nr>=0&&nr<10&&!occ[nk]&&!b.tz[nk]&&!b.hole[nk]&&!blk(u,nc,nr)&&!(b.tr&&u.team&&nr>=5)){delete occ[u.c+','+u.r];u.c=nc;u.r=nr;occ[nk]=u;txt(u,'미끄럼','#9df')}}
if(rnd()<.05){u.stun=1;txt(u,'미끄러짐','#9df')}}
if(b.warp&&u.type!='tks'&&u.type!='mon'&&b.warp[u.c+','+u.r])warpTo(u,occ)}
function quake(b){for(let r=0;r<10;r++)for(let c=0;c<6;c++)if(c==0||c==5||r==0||r==9)b.hole[c+','+r]=1;
b.us.forEach(u=>{if(!u.gone&&u.type!='wall'&&u.type!='tks'&&cellsOf(u).some(p=>b.hole[p+''])){cellsOf(u).forEach(p=>delete b.occ[p+'']);u.dead=1;u.gone=1;txt(u,'추락','#f44')}})}
function release(b,T0){const occ=b.occ;let sum=0;b.us.forEach(u=>{if(u.team==T0&&!u.gone&&u.type!='wall'){if(!u.dead)sum+=u.mx;u.gone=1;u.dead=1;cellsOf(u).forEach(p=>delete occ[p+''])}});
const mx=W/2,my=(cy(4)+cy(5))/2;let best=null,bd=1e9;for(let r=0;r<10;r++)for(let c=0;c<6;c++){if(occ[c+','+r]||b.tz[c+','+r]||b.hole[c+','+r])continue;const d=Math.hypot(cx(c,r)-mx,cy(r)-my);if(d<bd){bd=d;best=[c,r]}}
if(!best)return;const s=mk(T0,{type:'dm',c:best[0],r:best[1]});s.hp=s.mx=700+Math.round(sum*.5);s.x=mx;s.y=my;b.us.push(s);occ[best+'']=s;FXP({k:'x',c:best[0],r:best[1],t:.6});txt(s,'대마왕 각성','#f4f')}
function negotiate(T0=0){const S=SS(T0);if(st.paused)return;if(st.phase!='battle'||!S.neg||!B||B.end)return;S.neg--;
const al=B.us.filter(u=>u.team==T0&&!u.dead&&!u.gone&&u.type!='dm'&&u.type!='wall'),en=B.us.filter(u=>(T0==0?u.team:u.team==0)&&!u.dead&&!u.gone);
if(al.length&&en.length){const a=al[rnd()*al.length|0],e=en[rnd()*en.length|0];a.team=1-T0;e.team=T0;txt(a,'협상','#8cf');txt(e,'협상','#8cf')}
B.us.forEach(u=>{if(u.team==T0&&!u.gone&&!u.dead){u.mor=(u.mor||0)+1;txt(u,'사기','#fd3')}});hud()}
const INFt=o=>o.type=='inf'||o.type=='chn',SLD=o=>SOLD.includes(o.type),shf=l=>l.slice().sort(()=>rnd()-.5);
function troyOpen(u){const occ=B.occ||(B.occ={}),own=cellsOf(u);own.forEach(p=>delete occ[p+'']);const ring=[];
own.forEach(p=>nb(p[0],p[1]).forEach(q=>{if(!ring.some(z=>z[0]==q[0]&&z[1]==q[1])&&!own.some(z=>z[0]==q[0]&&z[1]==q[1]))ring.push(q)}));
const free=ring.concat(own).filter(p=>!occ[p+'']&&!B.tz[p+'']&&!B.hole[p+'']);let n=0;for(const p of free){if(n>=4)break;const s=mk(u.team,{type:'sp',c:p[0],r:p[1],bk:1});B.us.push(s);occ[p+'']=s;n++}
txt(u,'목마가 열린다','#fd3')}
function moveBig(u,tg,bd,occ){let best=null,bdist=bd;const old=cellsOf(u);
for(const[c,r]of nb(u.c,u.r)){const cs=cellsAt(c,r);if(!cs.every(p=>p[0]>=0&&p[0]<6&&p[1]>=0&&p[1]<10&&!B.hole[p+'']&&(!occ[p+'']||occ[p+'']===u)))continue;if(B.tr&&u.team&&cs.some(p=>p[1]>=5))continue;
const d=Math.min(...cs.map(p=>dTo(p,tg)));if(d<bdist||(d==bdist&&!best&&rnd()<.25)){bdist=d;best=[c,r]}}
if(best){old.forEach(p=>delete occ[p+'']);u.c=best[0];u.r=best[1];const nw=cellsOf(u);nw.forEach(p=>occ[p+'']=u);
old.filter(p=>!nw.some(q=>q[0]==p[0]&&q[1]==p[1])).forEach(p=>{B.tz[p+'']={t:1e9,k:0}})}
u.mt=(T[u.type].spd||.5)/(1+.1*(u.mor||0))/mv(u)}
function hit(u,a,rg,sh,sp){if(u.dead||u.hid)return;const a0=a;if(SS(u.team).comm&&!sp&&u.type!='wall'){const al=B.us.filter(x=>x.team==u.team&&!x.dead&&!x.gone&&!['wall','cl','sch'].includes(x.type));if(al.length>1){al.forEach(x=>hit(x,a/al.length,rg,1,1));return}}if(u.wild&&B.cur&&B.cur.team!=2)u.agg=B.cur;if(u.gdg&&(B.gdN||0)<5){const gg=B.us.find(x=>x.gid==u.gdg&&x.team==u.team&&!x.dead&&!x.gone&&x!==u);if(gg){B.gdN=(B.gdN||0)+1;const rv=hit(gg,a,rg,1,sp);B.gdN--;return rv}}if(u.type=='wall'){const s=B.us.find(x=>x!==u&&!x.team&&x.type!='wall'&&!x.dead&&!x.gone&&x.c==u.c&&x.r==u.r&&!T[x.type].big);if(s)return hit(s,a,rg,sh)}if(B.hl&&B.hl[u.c+','+u.r]&&!rg&&!B.air){txt(u,'고지','#9cf');return}if(st.siege&&!u.team&&u.type!='wall'&&u.r>=5)a/=1.1;if(u.hu)a*=1.25;if(u.grc)a*=1-.05*u.grc;if(SS(u.team).holy&&holyCover(u)){a*=.1;if(rnd()<.3)txt(u,'성전','#ff9')}if(rg&&T[u.type].weak)a*=1.6;
const p=!sh&&u.bid&&B.us.find(x=>x!==u&&x.team==u.team&&x.bid==u.bid&&!x.dead&&!x.gone);
if(p){a/=2;hit(p,a,0,1)}
u.hp-=a;u.fl=.12;txt(u,Math.round(a),'#f66');{const c=B.cur;if(u.type=='tks'&&c&&c!==u&&c.team!=u.team&&!c.dead&&!c.gone){const rf=a0*.5;c.hp-=rf;c.fl=.12;txt(c,Math.round(rf),'#9cf');if(c.hp<=0&&!save(c))die(c)}}if(u.hp<=0&&!save(u))die(u)}
function blast(c,r,a){FXP({k:'x',c,r,t:.6});B.air=1;B.us.forEach(u=>{if(!u.dead&&!u.gone&&u.type!='tks'&&DU(u,{c,r})<=1)hit(u,a)});B.air=0}
function revive(u,occ){const cs=[[u.c0,u.r0],...nb(u.c0,u.r0)];let f=cs.find(p=>!occ[p+'']&&!B.hole[p+'']);
if(!f){const a=[];for(let r=u.team?0:5;r<(u.team?5:10);r++)for(let c=0;c<6;c++)if(!occ[c+','+r]&&!B.hole[c+','+r])a.push([c,r]);f=a[0]}
if(!f){u.rt=.5;return}u.c=f[0];u.r=f[1];u.x=cx(u.c,u.r);u.y=cy(u.r);u.hp=u.mx*.8;u.dead=0;occ[f+'']=u}
function upd(dt){const b=B;b.t+=dt;const occ={};b.us.forEach(u=>{if(!u.dead&&!u.gone&&u.type!='wall'&&!u.rd)cellsOf(u).forEach(p=>occ[p+'']=u)});b.occ=occ;
for(const u of b.us){if(u.gone)continue;u.fl-=dt;if(u.imm>0&&!u.dead){u.imm-=dt;if(u.imm<=0&&u.hp<=1){u.hp=0;txt(u,'쓰러짐','#f44');die(u);if(u.gone)continue}}if(u.dead){u.rt-=dt;if(u.rt<=0)revive(u,occ);continue}
b.cur=u;u.at-=dt;u.mt-=dt;if(u.fz)continue;if(u.stun>0){u.stun-=dt;continue}if(u.type=='cr'){u.bt=(u.bt||0)+dt;if(u.bt>=2){u.bt-=2;u.bl=Math.min(8,(u.bl||0)+1);txt(u,'신의 가호','#ff9')}}const t=T[u.type],foes=u.type=='bkg'?b.us.filter(o=>o!==u&&!o.dead&&!o.gone&&!o.hid&&!o.wild&&!['wall','cl','sch'].includes(o.type)):b.us.filter(o=>(u.team==2?o.team==(u.rbo==null?1:u.rbo):o.team!=u.team&&(o.team!=2||o.wild))&&!o.dead&&!o.gone&&!o.hid);
if(u.type=='sh')u.sk2=(u.sk2==null?3:u.sk2)-dt;
if(u.syT>0){u.syT-=dt;if(u.syT<=0)studyEnd(u)}
if(u.wild){wildAI(u,occ);continue}
if(u.type=='bkg'){if(u.hid==null){u.hid=1;u.esT=3}if(u.hid){u.esT-=dt;if(u.esT<=0){u.hid=0;txt(u,'수로 탈출','#fd3');FXP({k:'w',x:u.x,y:u.y,t:.4})}continue}}
if(u.type=='ace'||u.type=='lf'){if(bro(u)>1){if(!u.brk){u.brk=1;txt(u,'형제 공격력 +35%','#fa4')}}else u.brk=0}
if(u.type=='mer'){if(u.mph==null){u.mph=0;b.road[u.c+','+u.r]=u.team+1}if(u.mt<=0&&!u.paid){const dr=u.team?1:-1,endR=u.team?9:0;if(u.mph==0&&u.r==endR){u.mph=1;txt(u,'교역로 개척','#fd3')}const nr=u.r+(u.mph?-dr:dr),k=u.c+','+nr;if(nr>=0&&nr<=9&&!occ[k]&&!b.tz[k]&&!b.hole[k]&&!blk(u,u.c,nr)){const oc=u.c,or=u.r;delete occ[oc+','+or];u.r=nr;occ[u.c+','+u.r]=u;b.road[u.c+','+u.r]=u.team+1;postMove(u,oc,or,occ);u.mt=T.mer.spd/(1+.1*(u.mor||0))}else u.mt=.2}if(u.mph==1&&!u.paid&&(u.team?u.r<=u.r0:u.r>=u.r0)){u.paid=1;merPay(u,occ)}continue}
if(u.type=='prs')continue;
if(u.type=='pope'){u.pg2=(u.pg2==null?2:u.pg2)-dt;if(u.pg2<=0){u.pg2=2;graceAll(u.team);txt(u,'교황의 가호','#ff9')}}
if(u.type=='sch'){u.sct=(u.sct==null?5:u.sct)-dt;if(u.sct<=0){u.sct=5;const al=b.us.filter(o=>o.team==u.team&&!o.dead&&!o.gone&&!['sch','wall','cl'].includes(o.type));studyGive(al[rnd()*al.length|0])}continue}
if(u.rd){const cr=b.us.find(x=>x.gid==u.gdg&&x.team==u.team&&!x.dead&&!x.gone&&x!==u);if(cr){u.c=cr.c;u.r=cr.r;u.mt=9}else u.rd=0}
if(u.type=='cl'){u.ct=(u.ct==null?1:u.ct)-dt;if(u.ct<=0){u.ct=1;const fr=[];for(let r=0;r<10;r++)for(let c=0;c<6;c++)if(!occ[c+','+r]&&!b.hole[c+','+r])fr.push([c,r]);const p=fr[rnd()*fr.length|0];if(p){delete occ[u.c+','+u.r];u.c=p[0];u.r=p[1];occ[p+'']=u}}continue}
if(u.type=='troy'||u.type=='wall')continue;
if(u.type=='ps'){const f=u.team?1:-1;let tg=null,bd=1e9;for(const o of foes){const dy=(o.y-u.y)*f;if(dy>0&&Math.abs(o.x-u.x)<HW*.55&&dy<bd){bd=dy;tg=o}}if(tg&&u.at<=0){hit(tg,u.atk,1);u.at=asp(u);FXP({k:'p',a:{x:u.x,y:u.y},b:tg,t:.22,d:.22})}continue}
if(t.heal){const al=b.us.filter(o=>o.team==u.team&&!o.dead&&!o.gone&&o.hp<o.mx&&DU(u,o)<=t.rng).sort((a,z)=>a.hp/a.mx-z.hp/z.mx)[0];
if(al&&u.at<=0){const hv=t.heal*(SS(u.team).medx?2:1);al.hp=Math.min(al.mx,al.hp+hv);u.at=asp(u);FXP({k:'h',a:u,b:al,t:.3});txt(al,'+'+hv,'#6f6')}continue}
if(!foes.length)continue;if(u.type=='dm'){u.lz=(u.lz==null?1:u.lz)-dt;if(u.lz<=0){u.lz=1;const f=foes[rnd()*foes.length|0];hit(f,50,1);FXP({k:'l',a:u,b:f,t:.3});txt(f,'레이저','#f4f')}}
if(u.type=='lf'){u.sk=(u.sk==null?1:u.sk)-dt;if(u.sk<=0){let ff=foes[0],fd=0;for(const f of foes){const d=DU(u,f);if(d>fd){fd=d;ff=f}}if(fd>1){hit(ff,5*fd*fd*sb(u),1);u.sk=2;FXP({k:'a',a:u,b:ff,t:.35});txt(u,'고무고무 총','#fd3')}else u.sk=.3}}
if(u.type=='sn'){if(u.s0==null){u.s0=1;u.at=2}let ff=foes[0],fd=-1;for(const f of foes){const d=DU(u,f);if(d>fd){fd=d;ff=f}}if(u.at<=0){ff.hp=0;ff.fl=.2;if(!save(ff)){die(ff);txt(ff,'즉사','#f44')}FXP({k:'b',a:u,b:ff,t:.3});u.at=6}continue}
if(u.type=='fan'){u.sf=(u.sf==null?1:u.sf)-dt;if(u.sf<=0){u.sf=1;const al=b.us.filter(o=>o!==u&&o.team==u.team&&!o.dead&&!o.gone&&o.type!='wall'&&o.type!='dm'&&!T[o.type].big&&DU(u,o)<=1).sort((a,z)=>a.hp-z.hp)[0];if(al){const fk=b.fk,cc=b.cur;b.cur=null;al.used=1;al.hp=0;al.imm=0;al.bk=0;die(al);b.fk=fk;b.cur=cc;u.fs=(u.fs||0)+1;txt(u,'제물','#f66')}}}
if(u.type=='ship'){u.cn=(u.cn==null?2:u.cn)-dt;if(u.cn<=0){u.cn=4;const f=u.team?1:-1;let t2=null,b2=1e9;for(const o of foes){const dy=(o.y-u.y)*f;if(dy>0&&Math.abs(o.x-u.x)<HW*.7&&dy<b2){b2=dy;t2=o}}if(!t2)t2=foes.slice().sort((a,z)=>DU(u,a)-DU(u,z))[0];hit(t2,70,1);FXP({k:'b',a:u,b:t2,t:.3},{k:'x',c:t2.c,r:t2.r,t:.6});b.us.forEach(o=>{if(o.team!=u.team&&o!==t2&&!o.dead&&!o.gone&&DU(o,t2)<=1)hit(o,35,1)});txt(u,'포격','#fd3')}}
if(u.type=='ace'){u.afc=(u.afc==null?3:u.afc)-dt;if(u.afc<=0){const f=u.team?1:-1,tl=foes.filter(o=>{const dy=(o.y-u.y)*f;return dy>-6&&dy<S*4.5+10&&Math.abs(o.x-u.x)<HW*.8});if(tl.length){u.afc=3;tl.forEach(o=>{hit(o,45*sb(u),1,1,1);burnSet(u,o,2.2)});FXP({k:'fist',x:u.x,y:u.y,f,t:.45,m:.45});txt(u,'불주먹','#f93')}else u.afc=.3}
if(!u.ayo&&u.hp<=u.mx*.3&&rnd()<dt*.6){u.ayo=1;b.inf={t:3,k:0,src:u,m:3};txt(u,'염제','#f33')}}
if(u.type=='hog'&&!u.hj&&b.t>.4&&foes.length){const rr=u.team?Math.max(...foes.map(o=>o.r)):Math.min(...foes.map(o=>o.r)),dr=u.team?1:-1,rf=foes.slice().sort((a,z)=>DU(u,a)-DU(u,z))[0];let dn=0;for(const r of[rr+dr,rr,rr-dr,rr-2*dr]){if(dn||r<0||r>9)continue;for(const c of[0,1,2,3,4,5].sort((a,z)=>Math.abs(a-rf.c)-Math.abs(z-rf.c))){const k=c+','+r;if(occ[k]||b.tz[k]||b.hole[k]||blk(u,c,r))continue;const oc=u.c,or=u.r;delete occ[oc+','+or];u.c=c;u.r=r;occ[k]=u;u.hj=1;dn=1;FXP({k:'w',x:u.x,y:u.y,t:.4});postMove(u,oc,or,occ);txt(u,'도약','#fd3');break}}}
let tg=foes[0],bd=99;for(const f of foes){const d=DU(u,f);if(d<bd){bd=d;tg=f}}
if(!u.team&&B.wt&&B.wt.team==1&&!B.wt.dead&&!B.wt.gone&&foes.includes(B.wt)){tg=B.wt;bd=DU(u,tg)}
{const hh=foes.filter(o=>o.horse).sort((a,z)=>DU(u,a)-DU(u,z))[0];if(hh&&DU(u,hh)<=bd+3){tg=hh;bd=DU(u,hh)}}
if(tg.type=='mer'){const o2=foes.filter(x=>x.type!='mer').sort((a,z)=>DU(u,a)-DU(u,z))[0];if(o2){tg=o2;bd=DU(u,o2)}}
if(u.type=='hog'){let bs=1e9;for(const f of foes){const sc=((T[f.type].big||f.type=='wall')?0:1000)+(u.team?9-f.r:f.r)*10+DU(u,f);if(sc<bs){bs=sc;tg=f}}bd=DU(u,tg)}
if(bd<=t.rng){if(u.at<=0){const sa=u.type=='duck'&&!u.sa;if(sa){u.sa=1;u.stun=5;txt(u,'스타 어썰트','#fd3');FXP({k:'b',a:u,b:tg,t:.3})}
const dm=(u.bo?mv(u):1)*sb(u)*(sa?240:u.type=='cy'?Math.round(u.atk*(1+.2*(cyN(u)-1))):u.type=='fan'?Math.round(u.atk*(1+.25*(u.fs||0))):u.type=='sp'?Math.round(u.atk*(1+.06*(u.st||0))):u.type=='bay'?(bd>1?9:18):u.type=='mu'?mdm(u):u.atk);{const tz=conf(u,tg,t);if(tz){if(u.type=='sh'&&u.sk2<=0){u.sk2=6;hit(tz,dm*7,0);FXP({k:'sa',x:tz.x,y:tz.y,t:1.3,m:1.3});txt(u,'사의 경계','#f33')}else hit(tz,dm,DU(u,tz)>1)}}if(u.type=='ace'&&!tg.dead){FXP({k:'fl',a:u,b:tg,t:.16});burnSet(u,tg,2.5)}if(u.type=='lb'){u.lc=(u.lc||0)+1;if(u.lc>=12){u.lc=0;lbCharge(u,foes)}}if(u.type=='tks')FXP({k:'x',c:tg.c,r:tg.r,t:.5});if(u.type=='ship')foes.filter(o=>o!==tg&&DU(u,o)<=t.rng).sort((a,z)=>DU(u,a)-DU(u,z)).slice(0,2).forEach(o=>{hit(o,dm,1);FXP({k:'b',a:u,b:o,t:.15})});if(u.type=='mu'||u.type=='ai'||u.type=='cy')pierce(u,tg,dm);if(u.type=='tk'||u.type=='gr'){FXP({k:'x',c:tg.c,r:tg.r,t:.6});b.us.forEach(o=>{if(o.team!=u.team&&!o.dead&&!o.gone&&o!==tg&&DU(o,tg)<=1)hit(o,dm*(u.type=='tk'?.7:.5),1)})}if(u.type=='sp')u.st=(u.st||0)+1;u.at=asp(u);u.lg=.12;if(bd>1)FXP({k:'b',a:u,b:tg,t:.15})}}
else if(u.mt<=0&&u.type=='ele'){moveBig(u,tg,bd,occ)}else if(u.mt<=0){let best=null,bdist=bd;for(const[c,r]of nb(u.c,u.r)){if(occ[c+','+r]||b.tz[c+','+r]||b.hole[c+','+r]||blk(u,c,r)||u.type=='mon')continue;if(b.tr&&u.team&&r>=5)continue;const d=dTo([c,r],tg);if(d<bdist||(d==bdist&&!best&&rnd()<.25)){bdist=d;best=[c,r]}}
if(best){const oc=u.c,or=u.r;delete occ[u.c+','+u.r];u.c=best[0];u.r=best[1];occ[best+'']=u;postMove(u,oc,or,occ)}u.mt=(t.spd||.5)/(u.type=='cr'?1+.15*(u.bl||0):1)/(1+.1*(u.mor||0))/(u.hs?1.5:1)/(u.horse?1.6:1)/(b.road&&b.road[u.c+','+u.r]==u.team+1?1.25:1)/mv(u)}}
for(const T0 of TEAMS()){b.dmD=b.dmD||[0,0];if(SS(T0).dm&&!b.dmD[T0]&&b.t>=35){b.dmD[T0]=1;release(b,T0)}}
if(st.quake&&!b.qk&&b.t>=5){b.qk=1;quake(b)}enpass();
if(b.dg&&!b.dgd&&b.t>=1.5){b.dgd=1;b.us.forEach(u=>{if(!u.dead&&!u.gone&&!u.wild){u.imm=0;u.bk=0;u.used=1;u.hp=0;die(u)}})}
for(const T0 of TEAMS())if(SS(T0).wihwa){b.us.forEach(u=>{if(u.team==1-T0&&!u.dead&&!u.gone&&!u.ent&&(T0==0?u.r>=5:u.r<=4)&&u.type!='wall'&&u.type!='dm'&&!T[u.type].big){u.ent=1;if((b.rbN||0)<2&&rnd()<.05){b.rbN=(b.rbN||0)+1;u.team=2;if(T0)u.rbo=0;u.rb=1;txt(u,'반란','#c9f')}}})}
for(const T0 of TEAMS())if(SS(T0).vers){b.hTa=b.hTa||[null,null];b.gma=b.gma||[0,0];b.hTa[T0]=(b.hTa[T0]==null?3:b.hTa[T0])-dt;if(b.hTa[T0]<=0){b.hTa[T0]=3;const l=b.us.filter(u=>u.team==1-T0&&!u.dead&&!u.gone&&u.type!='wall'),l2=l.filter(u=>!u.hu),q=l2.length?l2:l,p=q[rnd()*q.length|0];if(p){p.hu=1;txt(p,'굶주림','#c93')}}
if(!b.gma[T0]&&b.t>=30){b.gma[T0]=1;const l=b.us.filter(u=>u.team==1-T0&&!u.dead&&!u.gone&&!T[u.type].big&&u.type!='dm'&&u.type!='wall'),p=l[rnd()*l.length|0];if(p){p.type='ger';p.team=T0;p.hp=p.mx=150;p.hu=0;p.at=.5;txt(p,'독일군','#9cf');b.us.forEach(u=>{if(u.team==T0&&!u.dead&&!u.gone&&u.type!='wall'){u.mor=(u.mor||0)+1;txt(u,'사기','#fd3')}})}}}
if(!b.sf&&b.t>=50){b.sf=1;b.us.forEach(u=>{if(u.type=='fr'&&!u.gone){u.dead=1;u.gone=1;cellsOf(u).forEach(p=>delete occ[p+'']);txt(u,'항복','#fff')}})}
b.us.forEach(u=>{if(b.gk[u.team]&&!u.dead&&!u.gone&&(u.type=='gk'||u.type=='mg'))b.terr[u.team].add(u.c+','+u.r)});
b.cur=null;for(const k in b.tz){const z=b.tz[k];z.t-=dt;z.k-=dt;if(z.t<=0){delete b.tz[k];continue}const[zc,zr]=k.split(',').map(Number);b.us.slice().forEach(o=>{if(o.type!='ele'&&!o.dead&&!o.gone&&cellsOf(o).some(p=>p[0]==zc&&p[1]==zr)){o.hp=0;if(!save(o)){die(o);txt(o,'짓밟힘','#f44')}}})}
b.us.forEach(o=>{if(o.brn>0&&!o.dead&&!o.gone){o.brn-=dt;o.brT=(o.brT||0)+dt;if(o.brT>=.5){o.brT-=.5;const sr=o.brS,c0=b.cur;b.cur=sr&&!sr.dead?sr:null;hit(o,o.brD*.5,1,1,1);b.cur=c0;if(rnd()<.4)txt(o,'화상','#f73')}}else if(o.brn>0)o.brn=0});
if(b.inf&&b.inf.t>0){b.inf.t-=dt;b.inf.k-=dt;if(b.inf.k<=0){b.inf.k=.5;const sr=b.inf.src;b.us.slice().forEach(o=>{if(o.dead||o.gone||o.hid||o.type=='wall'||o.type=='cl'||o.team==sr.team)return;b.cur=sr;hit(o,40*sb(sr),1,1,1);burnSet(sr,o,2);b.cur=null})}}
b.us.forEach(u=>{const k=Math.min(1,dt*10),p=ctr(u);u.x+=(p[0]-u.x)*k;u.y+=(p[1]-u.y)*k;if(u.lg>0)u.lg-=dt});
b.pl.forEach(p=>{p.d-=dt;if(p.d<=0){blast(p.c,p.r,p.k=='k'?110:70);p.done=1}});b.pl=b.pl.filter(p=>!p.done);
b.fx.forEach(f=>f.t-=dt);b.fx=b.fx.filter(f=>f.t>0);b.tx.forEach(f=>{f.t-=dt;f.y-=dt*20});b.tx=b.tx.filter(f=>f.t>0);
if(b.tr&&b.trs.every(x=>x.gone)){b.tr=0;FXP({k:'x',c:2,r:5,t:.6},{k:'x',c:4,r:5,t:.6})}if(!b.end){const a=b.us.filter(u=>!u.team&&!u.gone&&u.type!='cl'&&u.type!='sch'),e=b.us.filter(u=>u.team==1&&!u.gone);
const wd=b.md||(st.siege&&b.wl&&!b.us.some(u=>u.type=='wall'&&!u.gone));if(!a.length||!e.length||wd||b.t>(AN('speed')?60:AN('dm')?90:b.fr?60:50)){const s=l=>l.reduce((x,u)=>x+(u.dead?0:u.hp),0);b.end=1;b.res=b.dgd?'draw':wd?(b.md==2?'win':'lose'):(AN('speed')&&a.length&&e.length&&a.length!=e.length)?(a.length>e.length?'win':'lose'):s(a)>s(e)?'win':'lose';st.tgt=false;hud();endBattle(b.res)}}}
function spawnBig(t){for(const r of[7,6,5,8])for(let c=0;c<5;c++)if(bigFree(c,r)){st.roster.push({type:t,c,r});return}
const c=2,r=7;cellsAt(c,r).forEach(p=>{const o=occR(p[0],p[1]);if(o)st.roster.splice(st.roster.indexOf(o),1)});st.roster.push({type:t,c,r});st.flash='빈 공간이 없어 일부 기물이 밀려났습니다.'}
function applyPend(p,o){const k=p.k;if(k=='shk'){o.type='sh';return}if(k=='enp'){o.enp=1;return}if(k=='mon'){o.type='mon';return}if(k=='sac'){o.type='fan';o.sac=1;return}if(k=='medx'){o.type='med';return}if(k=='bsk'){o.bk=1;return}if(k=='sparta'){o.type='sp';o.bk=1;return}if(k=='tough'){o.hpb=(o.hpb||0)+.25;return}
o.type=k=='giant'?'gnt':k=='luffy'?'lf':k=='sniper'?'sn':k=='musk'?'mu':k=='mgun'?'mc':k=='crus'?'cr':['kn','bi','rk','qn'][rnd()*4|0]}
function spawn(t,n,rows){for(let i=0;i<n;i++){const cs=[];for(const r of rows||[5,6,7,8,9])for(let c=0;c<6;c++)if(!occR(c,r))cs.push([c,r]);const f=cs[0];if(f)st.roster.push({type:t,c:f[0],r:f[1]})}}
function total(){for(let r=5;r<10;r++)for(let c=0;c<6;c++)if(!occR(c,r))st.roster.push({type:'inf',c,r,tmp:1});st.en=[];for(let r=4;r>=0;r--)for(let c=0;c<6;c++)st.en.push({type:'inf',c,r})}
function asp(u){const t=T[u.type];let a=t.as-(u.type=='mu'&&B.napo[u.team]?3:0);if(B.gk[u.team])a/=1+Math.min(1,B.terr[u.team].size*.05);if(u.type=='cr')a/=1+.15*(u.bl||0);if(u.type=='med'&&SS(u.team).medx)a=.5;if(u.fs)a/=1+.2*u.fs;if(u.gb)a/=1.3;if(SS(u.team).lee&&(u.type=='tks'||u.type=='ship'))a/=1.3;if(u.sy=='as')a/=1.2;if(u.type=='cy')a/=1+.1*(cyN(u)-1);if(u.bty)a*=1.7;a/=1+.1*(u.mor||0);a/=1+.05*(u.grc||0);if(u.horse&&u.type=='lb')a/=1.6;if(B.cf[u.team])a/=Math.min(3,Math.max(.4,1+B.cf[u.team]));return a}
function mdm(u){return 150*(1+(B.napo[u.team]?.25*(B.us.filter(x=>x.type=='mu'&&!x.dead&&!x.gone).length-1):0))}
function pierce(u,tg,dm){const dx=tg.x-u.x,dy=tg.y-u.y,L=Math.hypot(dx,dy)||1;let best=null,bp=1e9;
for(const o of B.us){if(o.team==u.team||o.dead||o.gone||o===tg)continue;const rx=o.x-u.x,ry=o.y-u.y,pr=(rx*dx+ry*dy)/L,pd=Math.abs(rx*dy-ry*dx)/L;if(pr>L&&pd<16&&pr<bp){bp=pr;best=o}}
FXP({k:'b',a:u,b:best||tg,t:.3});if(best)hit(best,dm,1)}
function fixSn(){st.roster.filter(o=>o.type=='sn'&&o.r<8).forEach(o=>{let f=null;for(const r of[8,9])for(let c=0;c<6;c++)if(!f&&!occR(c,r))f=[c,r];if(f){o.c=f[0];o.r=f[1]}else{const b=st.roster.find(x=>x!==o&&x.r>7&&x.type!='sn'&&!T[x.type].big);if(b)[o.c,o.r,b.c,b.r]=[b.c,b.r,o.c,o.r];else o.type='inf'}})}
function formation(){const us=st.roster.filter(o=>!T[o.type].big),big=new Set();st.roster.filter(o=>T[o.type].big).forEach(o=>cellsOf(o).forEach(p=>big.add(p+'')));const cells=[],has=(c,r)=>cells.some(p=>p[0]==c&&p[1]==r),ideal=c=>Math.round(5+3*(1-Math.abs(c-2.5)/2.5));
for(let L=0;L<5;L++)for(let c=0;c<6;c++){const r=ideal(c)+L;if(r<=9&&!big.has(c+','+r)&&!has(c,r))cells.push([c,r])}
for(let r=5;r<10;r++)for(let c=0;c<6;c++)if(!big.has(c+','+r)&&!has(c,r))cells.push([c,r]);
const k=o=>o.type=='gd'?0:o.type=='mar'?1:o.type=='sn'?5:T[o.type].heal?4:T[o.type].rng>1?3:2;us.sort((a,b)=>k(a)-k(b)).forEach((o,i)=>{const p=cells[i];if(p){o.c=p[0];o.r=p[1]}});fixMar()}
function lineShip(u){const T0=u.team;if(B.tkN==null)B.tkN=[B.us.filter(x=>x.type=='tks'&&x.team==0).length,B.us.filter(x=>x.type=='tks'&&x.team==1).length];if(B.tkN[T0]>=12)return;const c=shf(B.us.filter(x=>x.team==T0&&!x.dead&&!x.gone&&x!==u&&!T[x.type].big&&!['tks','np','gk','dm','wall'].includes(x.type)))[0];if(c){c.type='tks';c.hp=c.mx=T.tks.hp;c.atk=T.tks.atk;B.tkN[T0]++;txt(c,'거북선','#9cf')}}
function bro(u){if(u.type!='ace'&&u.type!='lf')return 1;const w=u.type=='ace'?'lf':'ace';return B&&B.us.some(x=>x.type==w&&x.team==u.team&&!x.dead&&!x.gone)?1.35:1}
const sb=u=>bro(u)*(u.horse&&u.type=='lb'?1.6:1)*(SS(u.team).lee&&(u.type=='tks'||u.type=='ship')?1.3:1)*(u.sy=='atk'?1.2:1)*(u.wb?1.25:1);
function madApply(){if(!st.mad)return;const cr=st.roster.some(o=>o.type=='cr');st.roster.forEach(o=>{if(!T[o.type].big&&o.type!='tks'&&o.type!='mon'&&o.type!='sh')o.type=cr?'cr':'fan'});st.en.forEach(o=>{if(!T[o.type].big)o.type='fan'})}
function fixGd(){st.roster.filter(o=>o.type=='gd'&&o.r!=5).forEach(o=>{let f=null;for(let c=0;c<6;c++)if(!f&&!occR(c,5))f=[c,5];if(f){o.c=f[0];o.r=f[1]}else{const b=st.roster.find(x=>x!==o&&x.r==5&&x.type!='gd'&&x.type!='mar'&&x.type!='sn'&&!T[x.type].big);if(b)[o.c,o.r,b.c,b.r]=[b.c,b.r,o.c,o.r];else o.type='inf'}})}
function fixMon(){st.roster.filter(o=>o.type=='mon'&&o.r!=9).forEach(o=>{let f=null;for(let c=0;c<6;c++)if(!f&&!occR(c,9))f=[c,9];if(f){o.c=f[0];o.r=f[1]}else{const b=st.roster.find(x=>x!==o&&x.r==9&&!['mon','gd','mar','sn'].includes(x.type)&&!T[x.type].big);if(b)[o.c,o.r,b.c,b.r]=[b.c,b.r,o.c,o.r];else o.type='inf'}})}
function fixMar(){fixSn();fixMon();fixGd();st.roster.filter(o=>o.type=='mar'&&o.r>6).forEach(o=>{let f=null;for(const r of[5,6])for(let c=0;c<6;c++)if(!f&&!occR(c,r))f=[c,r];if(f){o.c=f[0];o.r=f[1]}else o.type='inf'})}
function snap(){const all=[...st.roster.map(o=>[o,st.roster]),...st.en.map(o=>[o,st.en])].sort(()=>rnd()-.5);all.slice(0,all.length>>1).forEach(([o,l])=>{if(l.length>1)l.splice(l.indexOf(o),1)})}
const A=[{id:'wave',n:'인해전술',d:'모든 보병이 중공군으로 바뀝니다. 중공군은 체력이 낮지만 한 번 리스폰합니다.'},
{id:'banzai',n:'반자이',d:'카미카제 A6M 2대를 얻습니다. 전투 중 지정한 구역에 큰 피해를 줍니다. 아군과 적군 모두 피해를 입습니다.'},
{id:'horse',n:'말',d:'지정한 기물 하나가 체스의 말로 바뀝니다.'},
{id:'giant',n:'거대 보병',d:'지정한 보병 하나가 거대해집니다.'},
{id:'meteor',n:'운석',d:'이후 모든 전투에서 운석 3개가 추가로 떨어집니다. 아군 적군 모두 피해를 입습니다.'},
{id:'duck',n:'창파나이트',d:'창과 방패를 든 오리 한 마리를 소환합니다. 전용기 스타 어썰트는 매우 강력하지만 사용 후 5초 동안 기절합니다.'},
{id:'snap',n:'핑거스냅',d:'아군과 적군을 포함한 모든 기물의 절반을 무작위로 삭제합니다.'},
{id:'cat',n:'대격변',d:'아군의 모든 기물이 존재하는 모든 기물 중 무작위로 바뀝니다.'},
{id:'navy',n:'해병대',d:'해병 3명이 전방에 배치됩니다. 전방 1열과 2열에만 배치할 수 있습니다. 공격력이 20% 낮은 대신 체력이 10% 높고, 원거리 공격에 약합니다.'},
{id:'bay',n:'총검병',d:'보병 2명을 총검병으로 바꿉니다. 먼 적은 사격하고 가까운 적은 칼로 찌릅니다.'},
{id:'bond',n:'전우애',d:'지정한 아군 두 기물이 받는 피해가 서로 같아지도록 나뉩니다.'},
{id:'luffy',n:'몽키D루피',d:'보병 하나가 밀짚모자를 쓴 아이로 변합니다. 근접 공격을 하며, 2초마다 가장 먼 적에게 팔을 늘려 공격합니다. 거리가 멀수록 피해가 제곱으로 커집니다.'},
{id:'trench',n:'참호',d:'아군 1열 앞에 참호를 쌓습니다. 적은 넘어오지 못하고 아군만 넘어갈 수 있습니다. 적의 1열과 2열이 모두 죽으면 붕괴합니다.'},
{id:'sniper',n:'저격수',d:'보병 하나가 저격수로 변합니다. 가장 먼 적부터 즉사시키지만 공격 속도가 매우 느리며, 후열에만 배치할 수 있습니다.'},
{id:'napo',n:'나폴레옹',star:1,d:'나폴레옹이 합류하고 모든 병사가 머스켓으로 바뀝니다. 필드의 모든 머스켓은 장전이 3초 줄고, 필드에 있는 머스켓 수에 비례해 공격력이 증가합니다.'},
{id:'musk',n:'머스켓',d:'병사 한 명이 머스켓으로 바뀝니다. 매우 강력하고 적 한 명을 더 관통하지만 장전에 9초가 걸립니다.'},
{id:'mong',n:'몽골 통일',d:'모든 병사가 말(나이트)로 바뀝니다.'},
{id:'gen',n:'칭기즈칸',star:1,d:'모든 기물이 몽골군으로 바뀌고 칭기즈칸이 합류합니다. 전투 시작 시 그가 선 곳이 영토가 되고 밟은 땅으로 넓어집니다. 영토가 넓을수록 아군의 공격 속도가 빨라집니다.'},
{id:'total',n:'총력전',d:'다음 전투에서 아군과 적군 모두 모든 칸이 보병으로 채워집니다. 아군의 추가 보병은 그 전투에만 참전합니다.'},
{id:'mgun',n:'기관총병',d:'보병 하나가 기관총병으로 바뀝니다. 공격 속도가 매우 빠릅니다.'},
{id:'tank',n:'탱크',d:'보병 2명이 탱크로 바뀝니다. 공격 속도는 느리지만 원거리에서 폭발해 범위 피해를 줍니다.'},
{id:'gren',n:'척탄병',d:'척탄병 2명이 합류합니다. 수류탄을 던져 범위 피해를 주지만 체력이 낮습니다.'},
{id:'crus',n:'십자군',d:'보병 하나가 검을 든 십자군으로 바뀝니다. 2초마다 신의 가호를 받아 공격 속도와 이동 속도가 계속 증가합니다.'},
{id:'warp',n:'워프열차',d:'W모양의 타일이 생성됩니다. 라운드마다 위치가 바뀌며, 밟은 기물은 맵 반대편으로 이동합니다.'},
{id:'accel',n:'가속',d:'라운드마다 무작위 아군 기물 두 개의 이동속도가 1.5배 증가합니다.'},
{id:'ice',n:'빙하기',d:'필드가 얼어붙습니다. 얼음 타일 3개가 설치되고, 무작위 아군과 적군 기물 중 3개가 그 라운드 동안 정지합니다. 얼음 타일은 한 번에 다음 타일까지 미끄러져 넘어가지만, 5% 확률로 넘어져 1초 동안 기절합니다.'},
{id:'speed',n:'스피드 게임',d:'전투가 60초 안에 끝나지 않으면 남은 기물이 더 많은 진영이 승리합니다.'},
{id:'quake',n:'지진',d:'전투 시작 5초 뒤 필드의 가장자리가 무너져내립니다. 무너진 칸 위의 기물은 추락하고, 그 칸은 지나갈 수 없습니다.'},
{id:'pshoot',n:'피슈터',d:'전방으로 연두색 탄환을 발사하는 식물을 소환합니다. 움직이지 않고 제자리에 고정됩니다.'},
{id:'skel',n:'해골군대',d:'모든 보병이 해골로 바뀝니다. 체력이 매우 약합니다.'},
{id:'dm',n:'대마왕',star:1,d:'해골이 4마리 이상일 때만 등장합니다. 마왕이 맵 중앙에 봉인된 채 시작하며, 정확히 35초 뒤 모든 아군 기물을 흡수하고 봉인이 풀립니다. 이후 이동 속도와 공격 속도가 매우 빠르고 공격력이 매우 높은 마왕이 싸우며, 1초마다 무작위 적에게 레이저를 쏩니다.'},
{id:'tough',n:'거대한 거인',d:'지정한 기물의 체력이 25% 증가합니다.'},
{id:'neg',n:'협상가',d:'협상 버튼이 생깁니다. 전투 중 누르면 무작위 아군 하나와 적군 하나를 교환하고, 모든 아군이 사기(공격 속도와 이동 속도 10% 증가)를 얻습니다.'},
{id:'bsk',n:'광전사',d:'지정한 기물이 치명상을 입으면 체력 1로 버티며 3초 동안 죽지 않습니다. 한 번만 발동합니다.'},
{id:'sparta',n:'스파르타군',d:'보병 한 명을 스파르타군으로 바꿉니다. 체력이 1 남아도 3초 동안 죽지 않고, 공격 속도가 매우 빠르며 공격할수록 피해가 증가합니다.'},
{id:'troy',n:'트로이 목마',d:'4칸을 차지합니다. 공격하지 않지만 파괴되면 주변에 스파르타군 4명이 튀어나옵니다.'},
{id:'ele',n:'코끼리',d:'4칸을 차지합니다. 체력이 매우 높고 이동속도가 극단적으로 느립니다. 지나간 자리에 있는 모든 아군과 적군이 즉사합니다.'},
{id:'jani',n:'예니체리',d:'무작위 병사 2명이 예니체리로 바뀝니다. 스타 기물은 제외하고, 십자군이 있으면 먼저 바뀝니다.'},
{id:'highland',n:'고지전',d:'후열 두 줄의 서로 붙은 땅 5칸이 고지가 됩니다. 고지 위의 기물은 원거리 공격만 받습니다. 고지에서 내려가는 것은 가능하지만 올라오는 것은 불가능합니다.'},
{id:'siege',n:'공성전',d:'아군 필드에 성벽이 세워집니다. 성벽 안쪽 아군의 방어력이 10% 증가합니다. 성벽 위에 기물이 있으면 그 기물의 체력이 먼저 깎입니다. 적은 성벽을 넘을 수 없고, 모든 성벽이 무너지면 패배합니다.'},
{id:'conf',n:'자신감',d:'아군이 적을 처치할 때마다 공격 속도가 10% 증가하고, 아군이 죽을 때마다 7.5% 감소합니다.'},
{id:'shk',n:'시 협회',d:'지정한 아군을 시협회 2과 부장으로 바꿉니다. 부장은 공격속도가 평범하지만 공격력이 매우 강하고 체력이 단단합니다. 6초마다 스킬 사의 경계로 대상을 일격에 베어버리며, 베어버리는 순간 붉은 참격과 함께 사(死) 문양이 반으로 갈라집니다.'},
{id:'sch',n:'학자',d:'비전투 기물인 학자를 소환합니다. 학자는 전투 시작 시 무작위 아군 두 명에게, 이후 5초마다 아군 한 명에게 공부 버프를 줍니다. 공부는 체력, 공격력, 공격속도, 이동속도 중 무작위 하나를 4초 동안 20% 올립니다.'},
{id:'comm',n:'공산주의',d:'필드에 중공군이 있을 때만 등장합니다. 아군이 받는 모든 피해를 살아 있는 아군 전체가 똑같이 나눠 받습니다.'},
{id:'aibot',n:'AI',d:'레이저를 발사하는 AI 두 기를 소환합니다. AI를 보병과 인접하게 배치하면 사이보그로 융합됩니다. 사이보그는 공격속도가 매우 빠른 레이저를 쏘며, 사이보그 수가 많을수록 공격력과 공격속도가 증가합니다.'},
{id:'wild',n:'야생동물',d:'라운드마다 필드 중앙에 중립 야생동물이 한 마리 나타납니다. 양(33%)과 사슴(33%)을 처치하면 처치한 쪽 아군의 체력이 20% 회복되며, 사슴은 공격받으면 반격합니다. 사자(33%)는 주변 기물을 사냥하고, 처치하면 처치한 쪽 아군의 공격력이 25% 증가합니다. 드래곤(1%)은 모든 기물을 처치하며 그 라운드는 무승부가 됩니다.'},
{id:'lb',n:'여포',d:'여포가 합류합니다. 근접 공격이며 공격속도가 극단적으로 빠르고 체력이 약간 높습니다. 공격 12번마다 전방으로 돌진해 전방의 적들에게 매우 큰 피해를 줍니다. 전투 시작 시 아군이 적보다 적으면 수 차이에 비례한 확률로 배신하며, 배신한 여포는 공격속도와 체력이 감소합니다.'},
{id:'enp',n:'앙파상',d:'포병(탱크, 척탄병) 한 명을 지정합니다. 지정한 포병은 라운드마다 한 번, 전투 중 적 후방으로 이동해 가장 뒤쪽의 적 하나를 즉사시킵니다.'},
{id:'piggy',n:'업기',d:'아군 기물 하나를 다른 아군 기물에 업힙니다. 업힌 기물은 업은 기물의 자리에서 공격하고, 업힌 기물이 받을 피해는 업은 기물이 대신 받습니다.'},
{id:'clown',n:'광대',d:'광대를 소환합니다. 광대는 1초마다 맵의 빈 칸으로 이동하며 주변 기물의 공격이 빗나가거나 엉뚱한 대상을 향하게 만듭니다. 가끔 아군에게도 효과가 적용됩니다.'},
{id:'mon',n:'전제군주정',d:'아군 한 명을 절대군주로 지정합니다. 절대군주는 후열 1열에만 배치할 수 있고 움직이지 않으며, 사망하면 패배합니다. 살아 있는 동안 거대 기물과 스타 기물을 제외한 아군은 사망 4초 후 부활합니다.'},
{id:'medb',n:'의무병 폭탄',d:'포병(탱크, 척탄병) 3개가 의무병이 됩니다. 포병이 부족하면 보병이 대신 바뀝니다.'},
{id:'wihwa',n:'위화도 회군',d:'적이 아군 필드에 들어가면 5% 확률로 반란군이 됩니다. 모든 적이 대상이며 한 전투에 최대 2명까지 반란군이 됩니다. 반란군은 중립이며 적을 우선으로 공격합니다.'},
{id:'lee',n:'이순신',star:1,d:'아군 배열이 학익진으로 바뀌고 무작위 아군 3명이 거북선이 됩니다. 거북선이 죽으면 다른 아군이 거북선이 됩니다(최대 12척). 배 종류 기물은 공격속도와 공격력이 30% 증가합니다. 거북선은 화포가 달린 판옥선으로, 적의 부정적인 증강에 영향받지 않고 공격당하면 피해의 50%를 방어 무시로 반사하며 공격이 느립니다.'},
{id:'bounty',n:'현상수배',d:'전투 시작 시 적 최전방 1열의 무작위 기물에 현상수배를 겁니다. 아군은 현상수배 대상을 가장 먼저 공격하며, 처치하면 모든 아군이 보수를 받아 이동속도가 증가하고 이동속도에 비례해 공격력이 올라갑니다.'},
{id:'sac',n:'인신공양',d:'아군 한 명을 광신도로 바꿉니다. 전투 시작 때 그 광신도가 제물을 바칠 수 있다면 스스로도 제물이 되어 남은 모든 아군에게 신의 가호(공격속도와 이동속도 증가)를 줍니다.'},
{id:'vers',n:'베르사유 조약',d:'아군이 보수 버프를 얻습니다. 적 기물 하나가 3초마다 굶주림(이동속도 감소, 받는 피해 증가)에 걸리고, 30초가 지나면 적 기물 하나가 독일군이 되어 아군에 합류해 모든 아군에게 사기를 줍니다.'},
{id:'fra',n:'프랑스 군대',d:'모든 포병(탱크, 척탄병)을 프랑스 돌격군으로 바꿉니다. 포병이 없으면 보병 2명이 바뀝니다. 돌격군은 맹렬하고 강력하지만, 전투가 50초 안에 끝나지 않으면 모든 돌격군이 백기를 들고 항복합니다.'},
{id:'armada',n:'무적함대',d:'무작위 기물 하나(스타 기물과 거대 기물 제외)를 스페인 함선으로 바꿉니다. 함선은 체력이 매우 높고 한 번에 3명을 화살로 공격하며, 4초마다 전방으로 포를 발사합니다.'},
{id:'medx',n:'최강 의무병',d:'의무병의 회복 간격이 0.5초로 줄고 회복량이 2배가 됩니다. 의무병이 없다면 지정한 기물 하나가 의무병으로 바뀝니다.'},
{id:'guard',n:'근위병',d:'보병 하나를 근위병으로 바꿉니다. 체력이 높고 전방 1열에만 배치할 수 있으며, 지정한 아군이 받는 공격을 대신 맞습니다.'},
{id:'mad',n:'집단광기',d:'아군과 적군의 모든 기물이 광신도로 바뀌고, 앞으로 등장하는 기물도 모두 광신도가 됩니다. 십자군이 있다면 아군 기물은 모두 십자군으로 바뀝니다. 광신도는 1초마다 주변 아군을 제물로 바쳐 공격력과 공격속도가 증가합니다.'},
{id:'debug',n:'디버그',d:'전투가 시작될 때 모든 기물의 위치가 무작위로 바뀝니다. 거대 기물은 제외됩니다.'}];
A.push({id:'conc',n:'콘클라베',d:'아군 중 한 명을 십자군으로, 다른 한 명을 성직자로 바꿉니다. 3라운드 뒤 아군 중 한 명이 교황이 됩니다. 교황은 2초마다 아군 전체에 신의 가호를 부여합니다.'},
{id:'cardn',n:'추기경',d:'십자군, 성직자, 비숍 등 종교 관련 아군이 2명 이상일 때 등장합니다. 그중 두 명을 추기경으로 바꿉니다. 추기경이 모두 살아 있으면 교황은 죽지 않습니다. 추기경은 공격속도가 빠르지만 피해가 약합니다.'},
{id:'prop',n:'포교',d:'지정한 아군 두 명을 성직자로 바꿉니다. 성직자는 공격하지 않고 이동하지 않지만, 사망하면 아군 전체에 신의 가호를 부여합니다.'},
{id:'march',n:'고난의 행군',d:'모든 적군에게 굶주림을 부여합니다. 굶주린 적은 받는 피해가 25% 늘고 이동이 느려집니다.'},
{id:'holy',n:'성전',d:'바로 위(전방)에 종교 관련 아군이 있는 아군은 받는 피해가 90% 줄어듭니다.'});
A.push({id:'mpk',n:'미니 페카',d:'공격속도는 약간 느리지만 체력이 높고 이동이 빠르며 공격력이 매우 강한 미니 페카가 합류합니다.'},
{id:'hogr',n:'호그 라이더',d:'대형 기물과 성벽을 먼저 공격합니다. 전투 시작 직후 적진을 뛰어넘어 적의 맨 뒤로 이동한 뒤 뒷줄부터 공격합니다.'},
{id:'merc',n:'이슬람 상인',d:'지나간 길에 교역로를 만들고, 교역로 위의 아군은 25% 빨라집니다. 옆으로 움직일 수 없고, 적도 상인을 가장 나중에 공격합니다. 맵 끝까지 갔다가 원래 자리로 돌아오면 보병 3명을 지급합니다. 전투당 1회.'},
{id:'redh',n:'적토마',d:'아군 한 명을 적토마에 태웁니다. 여포가 있으면 자동으로 여포가 탑니다. 기수는 이동이 빨라지고 적에게 먼저 공격받습니다. 여포가 타면 공격속도와 공격력이 크게 오릅니다.'});
A.push({id:'bukang',n:'부캉이',d:'부캉이를 소환합니다. 부캉이는 전투 시작 후 3초 동안 수로에 숨어 있다가 탈출하여 가장 가까운 기물을 공격합니다. 적뿐 아니라 아군도 공격합니다.'},
{id:'ace',n:'포트거스 D 에이스',star:1,d:'에이스가 합류합니다. 빠른 공격속도로 불꽃을 발사해 화상을 입히며, 화상 피해는 시간이 지날수록 커집니다. 3초마다 불주먹으로 전방 3칸에 피해와 화상을 줍니다. 몽키 D 루피와 함께 있으면 서로의 공격력이 35% 증가합니다. 체력이 30% 이하가 되면 일정 확률로 염제를 한 번 사용하여 3초 동안 맵 전체의 적을 불태웁니다.'},
{id:'bunseo',n:'분서갱유',d:'학자가 있을 때만 등장합니다. 모든 학자를 처형하고 아군 전체에게 사기 버프의 2배를 부여합니다. 공산주의가 있다면 보병과 중공군이 대거 합류합니다.'});
const RA={c:['merc','prop','bukang','sch','wild','clown','guard','giant','horse','tough','bay','mgun','gren','accel','speed','musk','sniper','bond','bsk','pshoot','meteor','banzai','quake','ice','debug','skel'],r:['hogr','holy','comm','aibot','enp','medb','bounty','mad','navy','duck','tank','crus','sparta','troy','jani','trench','warp','luffy','highland','siege'],e:['mpk','redh','cardn','march','shk','piggy','mon','wihwa','sac','fra','medx','wave','mong','total','neg','conf'],l:['lb','conc','bunseo','vers','armada','snap','cat','ele']};
A.forEach(a=>{a.rar=a.star?'s':Object.keys(RA).find(k=>RA[k].includes(a.id))||'c';a.once=['lb','conc','cardn','march','holy','bukang','bunseo','highland','siege','conf','debug','mad','medx','bounty','sac','vers','wihwa','enp','piggy','mon','comm','wild','shk'].includes(a.id)});
function roll3(){const first=!st.aug.length,pool=A.filter(a=>!a.star&&!(a.once&&st.own&&st.own[a.id])&&!(a.id=='comm'&&!st.roster.some(o=>o.type=='chn'))&&!(a.id=='bunseo'&&!st.roster.some(o=>o.type=='sch'))&&!(a.id=='sch'&&st.bunseo)&&!(a.id=='cardn'&&st.roster.filter(o=>['cr','prs','bi'].includes(o.type)).length<2)),stars=A.filter(a=>a.star&&!st.starUsed.includes(a.id)&&(a.id!='dm'||st.roster.filter(o=>o.type=='sk').length>=4)),out=[];
for(let i=0;i<3;i++){let p;if(!first&&stars.length&&rnd()<(st.hard?.001:.04))p=stars.splice(rnd()*stars.length|0,1)[0];else{const x=rnd()*100,rr=st.hard?(x<80?'c':x<94?'r':x<97?'e':'l'):(x<50?'c':x<78?'r':x<92?'e':'l'),cd=pool.filter(a=>a.rar==rr&&!out.includes(a)),l=cd.length?cd:pool.filter(a=>!out.includes(a));p=l[rnd()*l.length|0]}out.push(p)}return out}
function chooseCore(id){st.flash='';(st.own=st.own||{})[id]=1;st.aug.push(A.find(a=>a.id==id).n);if(A.find(a=>a.id==id).star&&!st.starUsed.includes(id))st.starUsed.push(id);
if(id=='wave')st.roster.forEach(o=>{if(o.type=='inf')o.type='chn'});
if(id=='banzai')st.kami+=2;if(id=='meteor')st.met+=3;
if(id=='horse')st.pend={k:id,f:o=>['inf','chn','med','gnt'].includes(o.type)};
if(id=='giant')st.pend={k:id,f:o=>o.type=='inf'||o.type=='chn'};
if(id=='bond')st.pend={k:'bond',f:o=>true,got:[]};
if(id=='luffy')st.pend={k:'luffy',f:o=>o.type=='inf'||o.type=='chn'};
if(id=='sniper')st.pend={k:'sniper',f:o=>o.type=='inf'||o.type=='chn'};
if(id=='trench')st.trench=1;if(id=='mad')st.mad=1;if(id=='wihwa')st.wihwa=1;if(id=='shk')st.pend={k:'shk',f:o=>!T[o.type].big&&!['np','gk','dm','lb','tks','mon','cl','sch','sh'].includes(o.type)};if(id=='comm')st.comm=1;if(id=='wild')st.wild=1;
if(id=='sch'){const n0=st.roster.length;spawn('sch',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='inf');if(o)o.type='sch'}}
if(id=='aibot'){const n0=st.roster.length;spawn('ai',2);for(const o of st.roster.filter(INFt).slice(0,2-(st.roster.length-n0)))o.type='ai'}
if(id=='lb'){const n0=st.roster.length;spawn('lb',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='inf');if(o)o.type='lb'}}
if(id=='mpk'||id=='hogr'||id=='merc'){const tp={mpk:'mpk',hogr:'hog',merc:'mer'}[id],n0=st.roster.length;spawn(tp,1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='inf');if(o)o.type=tp}}
if(id=='redh'){const lbu=st.roster.find(o=>o.type=='lb'&&!o.horse);if(lbu){lbu.horse=1;st.flash='여포가 적토마에 올랐습니다.'}else{st.pend={k:'ride',got:[],f:o=>!T[o.type].big&&!o.horse&&!['wall','cl','sch','dm'].includes(o.type)};if(!st.roster.some(st.pend.f))st.pend=null}}
if(id=='conc'){const pk=()=>shf(st.roster.filter(o=>!T[o.type].big&&!NOCV.includes(o.type)))[0],a=pk();if(a)a.type='cr';const b=pk();if(b)b.type='prs';st.conc=st.round+3;st.flash='콘클라베가 시작되었습니다. 3라운드 뒤 교황이 선출됩니다.'}
if(id=='cardn')shf(st.roster.filter(o=>['cr','prs','bi'].includes(o.type))).slice(0,2).forEach(o=>o.type='card');
if(id=='prop'){st.pend={k:'prop',got:[],f:o=>!T[o.type].big&&!NOCV.includes(o.type)};if(!st.roster.some(st.pend.f))st.pend=null}
if(id=='march')st.marchH=1;if(id=='holy')st.holy=1;
if(id=='bukang'){const n0=st.roster.length;spawn('bkg',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='inf');if(o)o.type='bkg'}}
if(id=='ace'){const n0=st.roster.length;spawn('ace',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='inf');if(o)o.type='ace'}}
if(id=='bunseo'){const n=st.roster.filter(o=>o.type=='sch').length;st.roster=st.roster.filter(o=>o.type!='sch');st.bunseo=1;if(st.comm){spawn('inf',8);spawn('chn',8)}st.flash='학자 '+n+'명을 처형했습니다. 전군 사기 2배.'+(st.comm?' 보병과 중공군이 대거 합류했습니다.':'')}
if(id=='clown'){const n0=st.roster.length;spawn('cl',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='inf');if(o)o.type='cl'}}
if(id=='enp'){const pool=st.roster.some(o=>o.type=='tk'||o.type=='gr');st.pend={k:'enp',f:o=>!T[o.type].big&&(!pool||o.type=='tk'||o.type=='gr')}}
if(id=='piggy')st.pend={k:'piggy',f:o=>!T[o.type].big&&o.type!='mon'&&o.type!='cl',step:0};
if(id=='mon'){st.mon=1;st.pend={k:'mon',f:o=>!T[o.type].big&&!['np','gk','dm','lb','tks','cl'].includes(o.type)}}
if(id=='medb'){let n=0;st.roster.filter(o=>o.type=='tk'||o.type=='gr').slice(0,3).forEach(o=>{o.type='med';n++});if(n<3)st.roster.filter(INFt).slice(0,3-n).forEach(o=>o.type='med')}if(id=='lee'){st.lee=1;shf(st.roster.filter(o=>!T[o.type].big&&!['np','gk','dm','tks'].includes(o.type))).slice(0,3).forEach(o=>o.type='tks')}if(id=='bounty')st.bounty=1;if(id=='vers')st.vers=1;if(id=='sac'){st.sacOn=1;st.pend={k:'sac',f:o=>!T[o.type].big&&o.type!='dm'}}
if(id=='fra'){let n=0;st.roster.forEach(o=>{if(o.type=='tk'||o.type=='gr'){o.type='fr';n++}});if(!n)st.roster.filter(INFt).slice(0,2).forEach(o=>o.type='fr')}
if(id=='armada'){const c=shf(st.roster.filter(o=>!T[o.type].big&&!['np','gk','dm','gnt'].includes(o.type)));if(c[0])c[0].type='ship'}
if(id=='medx'){st.medx=1;if(!st.roster.some(o=>o.type=='med'))st.pend={k:'medx',f:o=>!T[o.type].big}}
if(id=='guard')st.pend={k:'guard',f:INFt,step:0};if(id=='highland')st.hl=1;if(id=='siege')st.siege=1;if(id=='conf')st.conf=1;if(id=='debug')st.debug=1;
if(id=='pshoot')spawn('ps',1);if(id=='warp')st.warp=1;if(id=='accel')st.accel=(st.accel||0)+1;if(id=='ice')st.ice=1;if(id=='speed')st.speed=1;if(id=='quake')st.quake=1;
if(id=='skel')st.roster.forEach(o=>{if(o.type=='inf'||o.type=='chn')o.type='sk'});
if(id=='dm')st.dm=1;if(id=='neg'){st.negMax=(st.negMax||0)+1;st.negEver=1}
if(id=='tough')st.pend={k:'tough',f:o=>true};
if(id=='bsk')st.pend={k:'bsk',f:o=>!o.bk&&!T[o.type].big};
if(id=='sparta')st.pend={k:'sparta',f:o=>o.type=='inf'||o.type=='chn'};
if(id=='troy'||id=='ele')spawnBig(id);
if(id=='mgun')st.pend={k:'mgun',f:o=>o.type=='inf'||o.type=='chn'};
if(id=='crus')st.pend={k:'crus',f:o=>o.type=='inf'||o.type=='chn'};
if(id=='tank'){let n=0;for(const o of st.roster.filter(o=>o.type=='inf').concat(st.roster.filter(o=>o.type=='chn')))if(n<2){o.type='tk';n++}spawn('tk',2-n)}
if(id=='gren')spawn('gr',2);
if(id=='jani'){const c=st.roster.filter(o=>o.type=='cr').concat(st.roster.filter(o=>SOLD.includes(o.type)&&o.type!='cr'&&o.type!='jn').sort(()=>rnd()-.5));let n=0;for(const o of c)if(n<2){o.type='jn';n++}}
if(id=='musk')st.pend={k:'musk',f:o=>SOLD.includes(o.type)};
if(id=='napo'){st.napo=1;st.roster.forEach(o=>{if(SOLD.includes(o.type))o.type='mu'});const n0=st.roster.length;spawn('np',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='mu');if(o)o.type='np'}}
if(id=='mong')st.roster.forEach(o=>{if(SOLD.includes(o.type))o.type='kn'});
if(id=='gen'){st.roster.forEach(o=>{if(!T[o.type].big&&!['tks','mon','lb','sh'].includes(o.type))o.type='mg'});const n0=st.roster.length;spawn('gk',1);if(st.roster.length==n0){const o=st.roster.find(x=>x.type=='mg');if(o)o.type='gk'}}
if(id=='duck')spawn('duck',1);if(id=='navy')spawn('mar',3,[5,6]);
if(id=='bay'){let n=0;for(const o of st.roster.filter(o=>o.type=='inf').concat(st.roster.filter(o=>o.type=='chn')))if(n<2){o.type='bay';n++}spawn('bay',2-n)}
if(id=='cat'){const ty=Object.keys(T).filter(k=>!T[k].big&&!['wall','mon','sheep','deer','lion','drg'].includes(k));st.roster.forEach(o=>o.type=ty[rnd()*ty.length|0]);fixMar()}
if(st.pend&&(st.roster.length<(st.pend.k=='bond'||st.pend.k=='piggy'?2:1)||!st.roster.some(st.pend.f)))st.pend=null;
const lose=st.lose;st.lose=0;if(!lose)st.round++;popeCheck();const cs=[];for(const r of[7,8,9,6,5])for(let c=0;c<6;c++)cs.push([c,r]);
const f=cs.find(p=>!occR(p[0],p[1]));if(f&&!lose)st.roster.push({type:'inf',c:f[0],r:f[1]});
if(id=='snap')snap();if(id=='total')total();madApply();if(st.lee)formation();rollField();st.phase='prep';hud()}
function pendPickCore(o){const p=st.pend;if(o&&p.f(o)&&!(p.got&&p.got.includes(o))){if(p.k=='bond'){p.got.push(o);if(p.got.length==2){const id=++st.bid;p.got.forEach(x=>x.bid=id);st.pend=null}}else if(p.k=='piggy'){if(!p.step){p.g=o;p.step=1;p.f=x=>x!==p.g&&!T[x.type].big&&x.type!='cl'&&x.type!='mon';if(!st.roster.some(p.f))st.pend=null}else{o.gid=o.gid||++st.bid;p.g.gdg=o.gid;p.g.rd=1;st.pend=null}}else if(p.k=='ride'){o.horse=1;st.pend=null}else if(p.k=='prop'){o.type='prs';p.got.push(o);if(p.got.length>=2||!st.roster.some(p.f))st.pend=null}else if(p.k=='guard'){if(!p.step){o.type='gd';o.gid=++st.bid;p.step=1;p.g=o;p.f=x=>x!==p.g&&!T[x.type].big;if(!st.roster.some(p.f))st.pend=null}else{o.gdg=p.g.gid;st.pend=null}}else{applyPend(p,o);st.pend=null}fixMar();hud()}}
function moveCore(o,c,r){if(st.sel&&T[st.sel.type].big){const s=st.sel;if(o===s)st.sel=null;else if(bigFree(c,r,s)){s.c=c;s.r=r;st.sel=null}}else if(st.sel){const s=st.sel,ok=(x,rr)=>x.type=='mar'?rr<7:x.type=='gd'?rr==5:x.type=='mon'?rr==9:x.type=='sn'?rr>7:true;if(o===s)st.sel=null;else if(o){if(!T[o.type].big&&ok(s,o.r)&&ok(o,s.r)){[s.c,s.r,o.c,o.r]=[o.c,o.r,s.c,s.r];st.sel=null}}else if(ok(s,r)){s.c=c;s.r=r;st.sel=null}}else if(o)st.sel=o}
function newPlayerState(){st={roster:[[1,7],[2,7],[3,7],[4,7],[3,8]].map(p=>({type:'inf',c:p[0],r:p[1]})),lives:3,round:1,kami:0,neg:0,negMax:0,starUsed:[],aiAug:[],seduce:0,dm:0,aiSed:0,aiNapo:0,met:0,bid:0,aug:[],phase:'prep',sel:null,pend:null,tgt:false,hover:null};st.roster.push({type:'med',c:2,r:9});st.en=[];return st}

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

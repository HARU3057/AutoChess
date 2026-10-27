"""팀별 증강 분리 패치. build-engine.py 가 불러 쓴다.
호환 모드(LEG, st1 없음)에서는 원본과 100% 같게 동작하고,
PvP 모드(st1 있음)에서는 증강 효과가 '그 증강을 가진 팀'에만 적용된다."""

def apply(code):
    def R(old, new, count=1):
        nonlocal code
        n = code.count(old)
        assert n == count, '패치 대상 불일치 (%d회, 기대 %d회): %s' % (n, count, old[:80])
        code = code.replace(old, new)

    # --- 시작 ---
    R("{const k=B.us.find(u=>!u.team&&u.type=='gk');B.gk=!!k;B.terr=new Set(k?[k.c+','+k.r]:[])}",
      "{B.gk=[0,0];B.terr=[new Set(),new Set()];for(const T0 of TEAMS()){const k=B.us.find(u=>u.team==T0&&u.type=='gk');B.gk[T0]=!!k;B.terr[T0]=new Set(k?[k.c+','+k.r]:[])}}")
    R("B.napo=st.napo||st.aiNapo;",
      "B.napo=LEG?[st.napo||st.aiNapo,st.napo||st.aiNapo,st.napo||st.aiNapo]:[st.napo,st1.napo,0];B.cf=[0,0];")
    R("const m=1+.1*(st.round-1);", "const m=LEG?1+.1*(st.round-1):undefined;")
    R("st.neg=st.negMax||0;", "st.neg=st.negMax||0;if(!LEG)st1.neg=st1.negMax||0;")
    # --- 속도/공격력 계산 ---
    R("u.type=='mu'&&B.napo?3:0", "u.type=='mu'&&B.napo[u.team]?3:0")
    R("if(!u.team&&B.gk)a/=1+Math.min(1,B.terr.size*.05)", "if(B.gk[u.team])a/=1+Math.min(1,B.terr[u.team].size*.05)")
    R("u.type=='med'&&!u.team&&st.medx", "u.type=='med'&&SS(u.team).medx")
    R("st.lee&&!u.team&&(u.type=='tks'||u.type=='ship')", "SS(u.team).lee&&(u.type=='tks'||u.type=='ship')", 2)
    R("if(!u.team&&B.cf)a/=Math.min(3,Math.max(.4,1+B.cf))", "if(B.cf[u.team])a/=Math.min(3,Math.max(.4,1+B.cf[u.team]))")
    R("B.napo?.25*", "B.napo[u.team]?.25*")
    # --- 피격 ---
    R("x!==u&&!x.team&&!x.dead&&!x.gone&&REL.includes(x.type)", "x!==u&&x.team==u.team&&!x.dead&&!x.gone&&REL.includes(x.type)")
    R("if(st.comm&&!u.team&&!sp&&u.type!='wall'){const al=B.us.filter(x=>!x.team&&!x.dead", "if(SS(u.team).comm&&!sp&&u.type!='wall'){const al=B.us.filter(x=>x.team==u.team&&!x.dead")
    R("if(st.holy&&!u.team&&holyCover(u))", "if(SS(u.team).holy&&holyCover(u))")
    # --- 전투 시작 효과 ---
    R("function bunseoStart(){B.road={};B.cardN=B.us.filter(u=>!u.team&&u.type=='card').length;if(st.marchH)B.us.forEach(u=>{if(u.team==1&&u.type!='wall'&&!u.gone){u.hu=1}});if(st.bunseo)B.us.forEach(u=>{if(!u.team&&!u.gone&&!['wall','cl','sch'].includes(u.type)){u.mor=(u.mor||0)+2;txt(u,'사기 x2','#fd3')}})}",
      "function bunseoStart(){B.road={};B.cardN=[0,0];for(const T0 of TEAMS()){B.cardN[T0]=B.us.filter(u=>u.team==T0&&u.type=='card').length;if(SS(T0).marchH)B.us.forEach(u=>{if(u.team==1-T0&&u.type!='wall'&&!u.gone){u.hu=1}});if(SS(T0).bunseo)B.us.forEach(u=>{if(u.team==T0&&!u.gone&&!['wall','cl','sch'].includes(u.type)){u.mor=(u.mor||0)+2;txt(u,'사기 x2','#fd3')}})}}")
    R("u.type=='pope'&&!u.team&&B.cardN>0&&B.us.filter(x=>x.type=='card'&&!x.team&&!x.dead&&!x.gone).length>=B.cardN",
      "u.type=='pope'&&B.cardN[u.team]>0&&B.us.filter(x=>x.type=='card'&&x.team==u.team&&!x.dead&&!x.gone).length>=B.cardN[u.team]")
    R("function studyStart(){if(!B.us.some(u=>u.type=='sch'&&!u.team&&!u.gone))return;shf(B.us.filter(u=>!u.team&&!u.gone&&!['sch','wall','cl'].includes(u.type))).slice(0,2).forEach(studyGive)}",
      "function studyStart(){for(const T0 of TEAMS()){if(!B.us.some(u=>u.type=='sch'&&u.team==T0&&!u.gone))continue;shf(B.us.filter(u=>u.team==T0&&!u.gone&&!['sch','wall','cl'].includes(u.type))).slice(0,2).forEach(studyGive)}}")
    R("function vsStart(){if(st.vers)B.us.forEach(u=>{if(!u.team)u.bo=(u.bo||0)+1})}",
      "function vsStart(){for(const T0 of TEAMS())if(SS(T0).vers)B.us.forEach(u=>{if(u.team==T0)u.bo=(u.bo||0)+1})}")
    R("function sacStart(){if(!st.sacOn)return;const f=B.us.find(u=>!u.team&&u.sac&&u.type=='fan'&&!u.gone);if(!f)return;const al=B.us.filter(o=>o!==f&&!o.team&&!o.gone&&o.type!='wall'&&o.type!='dm'&&!T[o.type].big&&DU(f,o)<=1).sort((a,z)=>a.hp-z.hp)[0];if(!al)return;sacKill(al);sacKill(f);txt(f,'인신공양','#fd3');B.us.forEach(u=>{if(!u.team&&!u.gone&&u.type!='wall'){u.gb=1}})}",
      "function sacStart(){for(const T0 of TEAMS()){if(!SS(T0).sacOn)continue;const f=B.us.find(u=>u.team==T0&&u.sac&&u.type=='fan'&&!u.gone);if(!f)continue;const al=B.us.filter(o=>o!==f&&o.team==T0&&!o.gone&&o.type!='wall'&&o.type!='dm'&&!T[o.type].big&&DU(f,o)<=1).sort((a,z)=>a.hp-z.hp)[0];if(!al)continue;sacKill(al);sacKill(f);txt(f,'인신공양','#fd3');B.us.forEach(u=>{if(u.team==T0&&!u.gone&&u.type!='wall'){u.gb=1}})}}")
    R("if(st.accel)shf(B.us.filter(u=>!u.team&&!T[u.type].big&&u.type!='ps')).slice(0,2*st.accel).forEach(u=>{u.hs=1})}",
      "for(const T0 of TEAMS())if(SS(T0).accel)shf(B.us.filter(u=>u.team==T0&&!T[u.type].big&&u.type!='ps')).slice(0,2*SS(T0).accel).forEach(u=>{u.hs=1})}")
    # --- 사망 처리 ---
    R("const monRv=u=>st.mon&&!u.team&&!u.used", "const monRv=u=>SS(u.team).mon&&!u.used")
    R("if(u.type=='mon'&&!u.team)B.md=1;", "if(u.type=='mon'&&u.team<2&&(!LEG||u.team==0))B.md=u.team+1;")
    R("if(st.lee&&u.type=='tks'&&!u.team)lineShip(u);", "if(SS(u.team).lee&&u.type=='tks')lineShip(u);")
    R("if(st.conf&&u.type!='wall'){if(u.team)B.cf=Math.min(1.5,(B.cf||0)+.1);else B.cf=Math.max(-.6,(B.cf||0)-.075)}",
      "if(u.type!='wall'){for(const T0 of TEAMS())if(SS(T0).conf){if(u.team==T0)B.cf[T0]=Math.max(-.6,(B.cf[T0]||0)-.075);else B.cf[T0]=Math.min(1.5,(B.cf[T0]||0)+.1)}}")
    R("if(k&&((k.team==0&&st.seduce)||(k.team==1&&st.aiSed))){", "if(k&&k.team<2&&SS(k.team).seduce){")
    R("if(k.team==0)st.seduce=0;else st.aiSed=0}}", "SS(k.team).seduce=0}}")
    R("function lineShip(u){if(B.tkN==null)B.tkN=B.us.filter(x=>x.type=='tks'&&!x.team).length;if(B.tkN>=12)return;const c=shf(B.us.filter(x=>!x.team&&!x.dead&&!x.gone&&x!==u&&!T[x.type].big&&!['tks','np','gk','dm','wall'].includes(x.type)))[0];if(c){c.type='tks';c.hp=c.mx=T.tks.hp;c.atk=T.tks.atk;B.tkN++;txt(c,'거북선','#9cf')}}",
      "function lineShip(u){const T0=u.team;if(B.tkN==null)B.tkN=[B.us.filter(x=>x.type=='tks'&&x.team==0).length,B.us.filter(x=>x.type=='tks'&&x.team==1).length];if(B.tkN[T0]>=12)return;const c=shf(B.us.filter(x=>x.team==T0&&!x.dead&&!x.gone&&x!==u&&!T[x.type].big&&!['tks','np','gk','dm','wall'].includes(x.type)))[0];if(c){c.type='tks';c.hp=c.mx=T.tks.hp;c.atk=T.tks.atk;B.tkN[T0]++;txt(c,'거북선','#9cf')}}")
    # --- upd ---
    R("if(st.dm&&!b.dmDone&&b.t>=35){b.dmDone=1;release(b)}",
      "for(const T0 of TEAMS()){b.dmD=b.dmD||[0,0];if(SS(T0).dm&&!b.dmD[T0]&&b.t>=35){b.dmD[T0]=1;release(b,T0)}}")
    R("function release(b){const occ=b.occ;let sum=0;b.us.forEach(u=>{if(!u.team&&!u.gone", "function release(b,T0){const occ=b.occ;let sum=0;b.us.forEach(u=>{if(u.team==T0&&!u.gone")
    R("const s=mk(0,{type:'dm'", "const s=mk(T0,{type:'dm'")
    R("b.t>(st.speed?60:st.dm?90:b.fr?60:50)", "b.t>(AN('speed')?60:AN('dm')?90:b.fr?60:50)")
    R("(st.speed&&a.length&&e.length&&a.length!=e.length)", "(AN('speed')&&a.length&&e.length&&a.length!=e.length)")
    R("wd?'lose':", "wd?(b.md==2?'win':'lose'):")
    R("(!u.team&&st.medx?2:1)", "(SS(u.team).medx?2:1)")
    R("u.team==2?o.team==1:", "u.team==2?o.team==(u.rbo==null?1:u.rbo):")
    R("if(st.wihwa){b.us.forEach(u=>{if(u.team==1&&!u.dead&&!u.gone&&!u.ent&&u.r>=5&&u.type!='wall'&&u.type!='dm'&&!T[u.type].big){u.ent=1;if((b.rbN||0)<2&&rnd()<.05){b.rbN=(b.rbN||0)+1;u.team=2;u.rb=1;",
      "for(const T0 of TEAMS())if(SS(T0).wihwa){b.us.forEach(u=>{if(u.team==1-T0&&!u.dead&&!u.gone&&!u.ent&&(T0==0?u.r>=5:u.r<=4)&&u.type!='wall'&&u.type!='dm'&&!T[u.type].big){u.ent=1;if((b.rbN||0)<2&&rnd()<.05){b.rbN=(b.rbN||0)+1;u.team=2;if(T0)u.rbo=0;u.rb=1;")
    R(r'''if(st.vers){b.hT=(b.hT==null?3:b.hT)-dt;if(b.hT<=0){b.hT=3;const l=b.us.filter(u=>u.team==1&&!u.dead&&!u.gone&&u.type!='wall'),l2=l.filter(u=>!u.hu),q=l2.length?l2:l,p=q[rnd()*q.length|0];if(p){p.hu=1;txt(p,'굶주림','#c93')}}
if(!b.gm&&b.t>=30){b.gm=1;const l=b.us.filter(u=>u.team==1&&!u.dead&&!u.gone&&!T[u.type].big&&u.type!='dm'&&u.type!='wall'),p=l[rnd()*l.length|0];if(p){p.type='ger';p.team=0;p.hp=p.mx=150;p.hu=0;p.at=.5;txt(p,'독일군','#9cf');b.us.forEach(u=>{if(!u.team&&!u.dead&&!u.gone&&u.type!='wall'){u.mor=(u.mor||0)+1;txt(u,'사기','#fd3')}})}}}''',
      r'''for(const T0 of TEAMS())if(SS(T0).vers){b.hTa=b.hTa||[null,null];b.gma=b.gma||[0,0];b.hTa[T0]=(b.hTa[T0]==null?3:b.hTa[T0])-dt;if(b.hTa[T0]<=0){b.hTa[T0]=3;const l=b.us.filter(u=>u.team==1-T0&&!u.dead&&!u.gone&&u.type!='wall'),l2=l.filter(u=>!u.hu),q=l2.length?l2:l,p=q[rnd()*q.length|0];if(p){p.hu=1;txt(p,'굶주림','#c93')}}
if(!b.gma[T0]&&b.t>=30){b.gma[T0]=1;const l=b.us.filter(u=>u.team==1-T0&&!u.dead&&!u.gone&&!T[u.type].big&&u.type!='dm'&&u.type!='wall'),p=l[rnd()*l.length|0];if(p){p.type='ger';p.team=T0;p.hp=p.mx=150;p.hu=0;p.at=.5;txt(p,'독일군','#9cf');b.us.forEach(u=>{if(u.team==T0&&!u.dead&&!u.gone&&u.type!='wall'){u.mor=(u.mor||0)+1;txt(u,'사기','#fd3')}})}}}''')
    R("if(b.gk)b.us.forEach(u=>{if(!u.team&&!u.dead&&!u.gone&&(u.type=='gk'||u.type=='mg'))b.terr.add(u.c+','+u.r)});",
      "b.us.forEach(u=>{if(b.gk[u.team]&&!u.dead&&!u.gone&&(u.type=='gk'||u.type=='mg'))b.terr[u.team].add(u.c+','+u.r)});")
    R("if(!u.team&&u.enp&&!u.enu&&!u.dead&&!u.gone&&B.t>=2){const c=B.us.filter(o=>o.team==1&&", "if(u.team<2&&(!LEG||u.team==0)&&u.enp&&!u.enu&&!u.dead&&!u.gone&&B.t>=2){const c=B.us.filter(o=>o.team==1-u.team&&")
    R("const m=Math.min(...c.map(o=>o.r)),back=c.filter(o=>o.r<=m+1).sort((a,z)=>z.mx-a.mx)[0];",
      "const dr=u.team==0?1:-1,m=dr>0?Math.min(...c.map(o=>o.r)):Math.max(...c.map(o=>o.r)),back=c.filter(o=>dr>0?o.r<=m+1:o.r>=m-1).sort((a,z)=>z.mx-a.mx)[0];")
    R(".sort((a,z)=>a[1]-z[1])[0];txt(u,'앙파상'", ".sort((a,z)=>dr*(a[1]-z[1]))[0];txt(u,'앙파상'")
    R("function negotiate(){if(st.paused)return;if(st.phase!='battle'||!st.neg||!B||B.end)return;st.neg--;\nconst al=B.us.filter(u=>!u.team&&!u.dead&&!u.gone&&u.type!='dm'&&u.type!='wall'),en=B.us.filter(u=>u.team&&!u.dead&&!u.gone);\nif(al.length&&en.length){const a=al[rnd()*al.length|0],e=en[rnd()*en.length|0];a.team=1;e.team=0;txt(a,'협상','#8cf');txt(e,'협상','#8cf')}\nB.us.forEach(u=>{if(!u.team&&!u.gone&&!u.dead){u.mor=(u.mor||0)+1;txt(u,'사기','#fd3')}});hud()}",
      "function negotiate(T0=0){const S=SS(T0);if(st.paused)return;if(st.phase!='battle'||!S.neg||!B||B.end)return;S.neg--;\nconst al=B.us.filter(u=>u.team==T0&&!u.dead&&!u.gone&&u.type!='dm'&&u.type!='wall'),en=B.us.filter(u=>(T0==0?u.team:u.team==0)&&!u.dead&&!u.gone);\nif(al.length&&en.length){const a=al[rnd()*al.length|0],e=en[rnd()*en.length|0];a.team=1-T0;e.team=T0;txt(a,'협상','#8cf');txt(e,'협상','#8cf')}\nB.us.forEach(u=>{if(u.team==T0&&!u.gone&&!u.dead){u.mor=(u.mor||0)+1;txt(u,'사기','#fd3')}});hud()}")
    return code

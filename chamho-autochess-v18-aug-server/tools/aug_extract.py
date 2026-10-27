"""증강 선택 로직(증강 표, 3장 뽑기, 선택 적용, 기물 지정, 배치 이동)을 index.html 에서 뽑는다.
build-engine.py 가 불러 쓴다. 원본 코드는 그대로 복사하고 아래만 바꾼다.
  - choose(): mod() 제거, 싱글 전용 AI 증강/적 생성(aiPick/genEn/aiApplyAll) 제거
  - 화면 클릭 핸들러의 '기물 지정(pend)'와 '배치 이동' 부분을 함수로 분리
"""
import re

def _end_of_stmt(s, i):
    depth = 0; q = None
    while i < len(s):
        ch = s[i]
        if q:
            if ch == '\\': i += 2; continue
            if ch == q: q = None
        else:
            if ch in "'\"`": q = ch
            elif ch in '([{': depth += 1
            elif ch in ')]}': depth -= 1
            elif ch == ';' and depth == 0: return i + 1
        i += 1
    raise ValueError('statement end not found')

def _end_of_block(s, i):
    """s[i] 는 '{' . 짝이 맞는 '}' 다음 위치를 돌려준다."""
    depth = 0; q = None
    while i < len(s):
        ch = s[i]
        if q:
            if ch == '\\': i += 2; continue
            if ch == q: q = None
        else:
            if ch in "'\"`": q = ch
            elif ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0: return i + 1
        i += 1
    raise ValueError('block end not found')

def _func(s, name):
    a = s.index('function %s(' % name)
    b = _end_of_block(s, s.index('{', s.index(')', a)))
    return s[a:b]

def extract(script):
    s = script
    out = []
    # 1) 증강 표: const A=[...]; 와 A.push(...); 조각들, RA, A.forEach(rar/once)
    fe = s.index('A.forEach(a=>{a.rar')
    starts = [s.index('const A=[')] + [m.start() for m in re.finditer(r'(?<![\w$.])A\.push\(', s) if m.start() < fe] + [s.index('const RA='), fe]
    starts.sort()
    for a in starts:
        out.append(s[a:_end_of_stmt(s, a)])
    # 2) 3장 뽑기
    out.append(_func(s, 'roll3'))
    # 3) 선택 적용 (싱글 AI 부분 제거)
    ch = _func(s, 'choose')
    ch = ch.replace('function choose(id){mod();', 'function chooseCore(id){', 1)
    ai = "if(!lose){for(let i=st.hard?2:(st.round==10||st.round==15)?2:1;i>0;i--)aiPick();st.en=genEn(st.round);aiApplyAll()}"
    assert 'function chooseCore(id){' in ch and ai in ch
    ch = ch.replace(ai, '')
    out.append(ch)
    # 4) 기물 지정(pend) : 클릭 핸들러 안의 if(st.pend){...return}
    a = s.index('if(st.pend){const p=st.pend;if(o&&p.f(o)')
    z = s.index('fixMar();hud()}return}', a) + len('fixMar();hud()}return}')
    pend = s[a:z]
    inner = pend[len('if(st.pend){'):-len('return}')]
    out.append('function pendPickCore(o){' + inner + '}')
    # 5) 배치 이동: 첫 클릭=선택, 둘째 클릭=이동 (원본 분기 그대로)
    a = s.index('if(st.sel&&T[st.sel.type].big){const s=st.sel;')
    z = s.index('else if(o)st.sel=o', a) + len('else if(o)st.sel=o')
    out.append('function moveCore(o,c,r){' + s[a:z] + '}')
    # 6) 초기 상태
    a = s.index('function init(){st=') + len('function init(){st=')
    z = s.index('};\nst.roster.push', a) + 1
    out.append("function newPlayerState(){st=" + s[a:z] + ";st.roster.push({type:'med',c:2,r:9});return st}")
    return '\n'.join(out)

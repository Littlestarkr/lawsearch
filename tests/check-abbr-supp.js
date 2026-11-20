// 법령 약칭 풀이(expandAbbr)와 부칙 감점(rankArticles·markSupp·parseAdmrul) 시험. 법제처를 부르지 않는다.
// 사용법: node tests/check-abbr-supp.js   (실패가 있으면 종료 코드 1)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const norm =');
const end = html.indexOf('/* ---------- AI 질문용 글');
if (start < 0 || end < 0) { console.error('index.html에서 코드를 찾지 못했습니다.'); process.exit(2); }
const ctx = { localStorage: { getItem: () => null }, document: {}, history: {}, console };
vm.createContext(ctx);
vm.runInContext(`
const $ = () => null;
const esc = s => String(s);
const toArray = v => v == null || v === '' ? [] : Array.isArray(v) ? v : [v];
const flat = v => Array.isArray(v) ? v.flat(Infinity).join('\\n') : String(v ?? '');
const cfg = {oc: '', proxy: ''};
` + html.slice(start, end) + `
this.expandAbbr = expandAbbr; this.LAW_ABBR = LAW_ABBR; this.matchTopics = matchTopics;
this.rankArticles = rankArticles; this.pickArticles = pickArticles; this.extractArticles = extractArticles; this.artLink = artLink;
this.setTerms = (m, u, arts) => { currentTerms = new Map(m); currentUserTerms = new Set(u); currentArts = arts || []; currentExact = []; };
`, ctx);

let fail = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond){ fail++; console.log('✗ ' + msg); } };

/* 1. 약칭 풀이 */
const A = [
  // [질문, 기대 [정식명, sub], 남는 말(rest)]
  ['화관법', [['화학물질관리법', '']], ''],
  ['화관법 시행령 보고 의무', [['화학물질관리법', '시행령']], '보고 의무'],
  ['화관법시행령', [['화학물질관리법', '시행령']], ''],
  ['화관법상 유해화학물질 영업허가', [['화학물질관리법', '']], '유해화학물질 영업허가'],
  ['중대재해법 적용 대상 5인 미만', [['중대재해 처벌 등에 관한 법률', '']], '적용 대상 5인 미만'],
  ['중대재해처벌법 시행령', [['중대재해 처벌 등에 관한 법률', '시행령']], ''],
  ['하도급법위반 과징금', [['하도급거래 공정화에 관한 법률', '']], '위반 과징금'],
  ['판로지원법 시행규칙 직접생산', [['중소기업제품 구매촉진 및 판로지원에 관한 법률', '시행규칙']], '직접생산'],
  ['녹색제품법 의무구매', [['녹색제품 구매촉진에 관한 법률', '']], '의무구매'],
  ['FTA관세법 원산지 증빙', [['자유무역협정의 이행을 위한 관세법의 특례에 관한 법률', '']], '원산지 증빙'],
  ['fta관세법', [['자유무역협정의 이행을 위한 관세법의 특례에 관한 법률', '']], ''],
  ['관세법 시행령 제2조', [['관세법', '시행령']], '제2조'],
  ['외환법에서 해외직접투자 신고', [['외국환거래법', '']], '해외직접투자 신고'],
  ['대외무역법과 외국환거래법', [['대외무역법', ''], ['외국환거래법', '']], ''],
  ['상생협력법 납품대금 연동제', [['대ㆍ중소기업 상생협력 촉진에 관한 법률', '']], '납품대금 연동제'],
  ['산안법과 중대재해법 차이', [['산업안전보건법', ''], ['중대재해 처벌 등에 관한 법률', '']], '차이'],
];
for (const [q, exp, rest] of A){
  const r = ctx.expandAbbr(q);
  const got = r.found.map(f => [f.full, f.sub]);
  ok(JSON.stringify(got) === JSON.stringify(exp), `약칭 '${q}': ${JSON.stringify(got)} (기대 ${JSON.stringify(exp)})`);
  ok(r.rest === rest, `약칭 '${q}' 남는 말: '${r.rest}' (기대 '${rest}')`);
}
// 풀면 안 되는 경우: 더 긴 말의 일부, 정식명을 그대로 적은 경우
const NONE = ['최근기법 소개', '수출 처음 하는데 필요한 신고나 절차', '하도급 대금을 늦게 주면 어떻게 되나요'];
for (const q of NONE) ok(ctx.expandAbbr(q).found.length === 0, `'${q}'에서 약칭을 찾으면 안 됨: ${JSON.stringify(ctx.expandAbbr(q).found)}`);
{
  const r = ctx.expandAbbr('자유무역협정의 이행을 위한 관세법의 특례에 관한 법률 제8조');
  ok(r.found.length === 0, '정식명 속 \'관세법\'을 따로 잡으면 안 됨: ' + JSON.stringify(r.found));
}
// 풀어 쓴 질문(full)
ok(ctx.expandAbbr('화관법 시행령 보고').full === '화학물질관리법 시행령 보고', 'full: ' + ctx.expandAbbr('화관법 시행령 보고').full);
// 사전 점검: 약칭이 겹치지 않고, 정식명은 같은 법 안에서 한 번만
{
  const seen = new Map();
  ctx.LAW_ABBR.forEach(([full, abs]) => abs.forEach(a => {
    ok(!seen.has(a), `약칭 '${a}'이 두 법에 있음`); seen.set(a, full);
    ok(a !== full, `약칭 '${a}'이 정식명과 같음`);
  }));
}
// 기존 시험 질문은 약칭 풀이로 바뀌지 않아야 한다 (주제 시험 결과 보존)
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'queries.json'), 'utf8'));
for (const c of cases){
  const r = ctx.expandAbbr(c.q);
  ok(r.found.length === 0 || r.found.every(f => f.a === f.full), `기존 질문 '${c.q}'에서 약칭을 풀었음: ${JSON.stringify(r.found)}`);
}

/* 2. 부칙 감점 */
const art = (no, title, text, extra = {}) => ({lines: [{t: `${no}(${title}) ${text}`, l: 0}], head: `${no}(${title})`, no, title, isHeading: false, text: `${no}(${title}) ${text}`, ...extra});
{
  ctx.setTerms([['보고', 4]], ['보고']);
  const arts = [
    art('제1조', '목적', '이 법은 화학물질 관리를 목적으로 한다.'),
    art('제5조', '영업허가', '영업자는 허가를 받아야 한다.'),
    art('제12조', '실적보고', '영업자는 매년 실적을 보고하여야 한다.'),
    {lines: [{t: '부칙', l: 0}], head: '', no: '', title: '', isHeading: true, text: '부칙'},
    art('제1조', '보고에 관한 경과조치', '이 법 시행 전에 보고한 자는 보고한 것으로 본다. 보고 보고 보고', {}),
  ];
  // markSupp를 직접 확인: 부칙 머리 줄 뒤는 부칙
  const marked = vm.runInContext('markSupp', ctx)(arts);
  ok(marked[4].supp === true && !marked[2].supp, '부칙 머리 뒤 조문은 부칙으로 표시');
  const r = ctx.rankArticles(marked).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  ok(r[0].a.no === '제12조' && !r[0].a.supp, `본칙 제12조가 1위여야 함: ${r.map(x => (x.a.supp ? '부칙 ' : '') + x.a.no + '=' + x.s.toFixed(2)).join(', ')}`);
  const sup = r.find(x => x.a.supp);
  ok(sup && sup.why.includes('부칙이라 낮춤'), '부칙 근거 표시');
  ok(ctx.artLink(marked[4], {name: '화학물질관리법', kind: 'law'}) === '', '부칙 조문에는 본칙 조문 링크를 걸지 않음');
  // 대표 조문(제1조)이 부칙 제1조에 붙지 않아야 한다
  ctx.setTerms([['보고', 4]], ['보고'], [['화학물질관리법', '제1조', '경과조치']]);
  const p = ctx.pickArticles({name: '화학물질관리법', kind: 'law'}, marked, 10);
  ok(!p.ranked.length || !(p.info.get(p.ranked[0])?.why || []).includes('대표 조문') || !p.ranked[0].supp, '부칙 조문을 대표 조문으로 잡으면 안 됨');
}
{
  // 번호가 제1조로 다시 시작하면 부칙
  const arts = [art('제1조', '목적', 'a'), art('제2조', '정의', 'b'), art('제3조', '신고', 'c'), art('제1조', '시행일', 'd'), art('제2조', '경과조치', 'e')];
  const m = vm.runInContext('markSupp', ctx)(arts);
  ok(m.map(a => !!a.supp).join() === 'false,false,false,true,true', '번호 재시작 부칙 표시: ' + m.map(a => !!a.supp).join());
  const one = vm.runInContext('markSupp', ctx)([art('제1조', '목적', 'a')]);
  ok(!one[0].supp, '조문 1개뿐인 규정은 부칙 아님');
}
{
  // 행정규칙: 본문 끝에 붙은 부칙을 떼어 낸다
  const raw = '제1조(목적) 이 고시는 신고 절차를 정한다.\n제2조(신고) 수출자는 신고하여야 한다.\n제3조(재검토기한) 3년마다 검토한다.\n부칙 <제2024-1호, 2024.1.1.>\n제1조(시행일) 이 고시는 발령한 날부터 시행한다.\n제2조(신고에 관한 경과조치) 이 고시 시행 전 신고는 신고로 본다.';
  const arts = ctx.extractArticles('admrul', {AdmRulService: {조문내용: raw}});
  const desc = arts.map(a => (a.supp ? '부칙:' : '') + (a.isHeading ? '[머리]' : a.no)).join(' ');
  ok(desc === '제1조 제2조 제3조 부칙:[머리] 부칙:제1조 부칙:제2조', '행정규칙 부칙 나누기: ' + desc);
  ok(!arts[2].text.includes('시행일'), '마지막 본칙 조문에 부칙이 붙으면 안 됨');
  ctx.setTerms([['신고', 4]], ['신고']);
  const r = ctx.rankArticles(arts).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  ok(r[0].a.no === '제2조' && !r[0].a.supp, '행정규칙도 본칙 1위: ' + r.map(x => (x.a.supp ? '부칙 ' : '') + x.a.no).join(', '));
  // 부칙이 없는 행정규칙은 그대로
  const plain = ctx.extractArticles('admrul', {AdmRulService: {조문내용: '제1조(목적) 가.\n제2조(정의) 나.'}});
  ok(plain.length === 2 && !plain.some(a => a.supp), '부칙 없는 행정규칙은 그대로');
}

console.log(`\n확인 ${n}개 · 실패 ${fail}건`);
process.exit(fail ? 1 : 0);

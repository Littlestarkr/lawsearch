// 법령 이름(약칭)으로 찾았을 때 결과 순서 시험: 그 법령 → 시행령 → 시행규칙이 맨 위에 오고, 주제 추천·본문 검색(민법 등)은 그 뒤.
// 법제처 응답은 가짜 데이터로 바꾼다(본문 검색은 늘 민법·상법이 섞여 나온다고 가정).
// 사용법: node tests/check-order.js   (Playwright 필요. 실패가 있으면 종료 코드 1)
const { chromium } = require('playwright');
const FAM = ['국가를 당사자로 하는 계약에 관한 법률','관세법','대외무역법','외국환거래법','화학물질관리법','중소기업제품 구매촉진 및 판로지원에 관한 법률','하도급거래 공정화에 관한 법률','자유무역협정의 이행을 위한 관세법의 특례에 관한 법률','중대재해 처벌 등에 관한 법률'];
const LAWS = [];
FAM.forEach(n => { LAWS.push([n,'법률']); LAWS.push([n+' 시행령','대통령령']); if (n !== '중대재해 처벌 등에 관한 법률') LAWS.push([n+' 시행규칙', '총리령']); });
['민법','지방자치단체를 당사자로 하는 계약에 관한 법률','상법','근로기준법','관세사법','수출용 원재료에 대한 관세 등 환급에 관한 특례법'].forEach(n => LAWS.push([n,'법률']));
const nz = s => s.replace(/\s+/g,'');
const QS = [
  ['국가계약법', ['국가를 당사자로 하는 계약에 관한 법률','국가를 당사자로 하는 계약에 관한 법률 시행령','국가를 당사자로 하는 계약에 관한 법률 시행규칙']],
  ['국가계약법 선금', ['국가를 당사자로 하는 계약에 관한 법률','국가를 당사자로 하는 계약에 관한 법률 시행령','국가를 당사자로 하는 계약에 관한 법률 시행규칙']],
  ['국가계약법 시행령 선금', ['국가를 당사자로 하는 계약에 관한 법률 시행령','국가를 당사자로 하는 계약에 관한 법률','국가를 당사자로 하는 계약에 관한 법률 시행규칙']],
  ['관세법', ['관세법','관세법 시행령','관세법 시행규칙']],
  ['관세법 수출신고', ['관세법','관세법 시행령','관세법 시행규칙']],
  ['대외무역법', ['대외무역법','대외무역법 시행령','대외무역법 시행규칙']],
  ['외환법 해외직접투자 신고', ['외국환거래법','외국환거래법 시행령','외국환거래법 시행규칙']],
  ['화관법시행령', ['화학물질관리법 시행령','화학물질관리법','화학물질관리법 시행규칙']],
  ['판로지원법 직접생산확인', ['중소기업제품 구매촉진 및 판로지원에 관한 법률','중소기업제품 구매촉진 및 판로지원에 관한 법률 시행령','중소기업제품 구매촉진 및 판로지원에 관한 법률 시행규칙']],
  ['하도급법 대금 지연', ['하도급거래 공정화에 관한 법률','하도급거래 공정화에 관한 법률 시행령','하도급거래 공정화에 관한 법률 시행규칙']],
  ['FTA관세법 원산지 증빙', ['자유무역협정의 이행을 위한 관세법의 특례에 관한 법률','자유무역협정의 이행을 위한 관세법의 특례에 관한 법률 시행령','자유무역협정의 이행을 위한 관세법의 특례에 관한 법률 시행규칙']],
  ['중대재해법', ['중대재해 처벌 등에 관한 법률','중대재해 처벌 등에 관한 법률 시행령']],
  ['국가를 당사자로 하는 계약에 관한 법률', ['국가를 당사자로 하는 계약에 관한 법률','국가를 당사자로 하는 계약에 관한 법률 시행령','국가를 당사자로 하는 계약에 관한 법률 시행규칙']],
];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://www.law.go.kr/**', r => {
    const u = new URL(r.request().url()); const q = nz(u.searchParams.get('query')||''); const t = u.searchParams.get('target');
    if (!u.pathname.includes('lawSearch')) return r.fulfill({contentType:'application/json', body:'{}'});
    let hit = [];
    if (t === 'law'){
      hit = u.searchParams.get('search') === '2' ? [['민법','법률'],['상법','법률']]   // 본문 검색은 늘 일반 법이 섞여 나온다고 가정
        : LAWS.filter(([n]) => q.length >= 2 && nz(n).includes(q));
    }
    const list = hit.map(([n,k]) => ({법령ID:'L'+n, 법령명한글:n, 법령일련번호:'1', 법령구분명:k, 소관부처명:'부처', 시행일자:'20250101', 법령약칭명:''}));
    const key = t==='admrul'?{AdmRulSearch:{admrul:[]}}:t==='ordin'?{OrdinSearch:{law:[]}}:{LawSearch:{law:list}};
    r.fulfill({contentType:'application/json', body: JSON.stringify(key)});
  });
  let bad = 0;
  for (const [q, exp] of QS){
    await p.goto('file://' + require('path').join(__dirname, '..', 'index.html') + '?q=' + encodeURIComponent(q));
    await p.waitForSelector('.card h3', {timeout: 8000});
    const cards = (await p.locator('.card h3').allInnerTexts()).filter(x => !x.includes('안 나오나요'));
    const top = cards.slice(0, exp.length);
    const okk = JSON.stringify(top) === JSON.stringify(exp);
    if (!okk) bad++;
    console.log((okk ? '✓ ' : '✗ ') + q + '\n    ' + cards.slice(0, exp.length + 2).join(' / '));
  }
  console.log(`\n질문 ${QS.length}개 확인 · 실패 ${bad}건${errs.length ? ' · 페이지 오류 ' + errs.join(', ') : ''}`);
  await b.close();
  process.exit(bad || errs.length ? 1 : 0);
})();

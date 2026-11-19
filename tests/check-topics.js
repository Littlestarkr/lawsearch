// 상황 사전(TOPICS) 시험: index.html의 질문 이해 부분만 꺼내 tests/queries.json의 질문을 돌려 본다.
// 사용법: node tests/check-topics.js   (사전을 고친 뒤마다 실행. 실패가 있으면 종료 코드 1)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const norm =');
const end = html.indexOf('/* ---------- API');
if (start < 0 || end < 0) { console.error('index.html에서 질문 이해 코드를 찾지 못했습니다.'); process.exit(2); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(start, end) + '\nthis.matchTopics = matchTopics; this.TOPICS = TOPICS;', ctx);

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'queries.json'), 'utf8'));
const names = new Set(ctx.TOPICS.map(t => t.n));
let fail = 0;
for (const c of cases) {
  const got = ctx.matchTopics(c.q).filter(x => x.score >= 3).map(x => x.tp.n);
  const problems = [];
  [...(c.expect || []), ...(c.not || [])].forEach(n => { if (!names.has(n)) problems.push(`없는 주제 이름: ${n}`); });
  if (c.expect && c.expect.length && got[0] !== c.expect[0]) problems.push(`첫 주제가 '${c.expect[0]}'이어야 함`);
  (c.expect || []).slice(1).forEach(n => { if (!got.includes(n)) problems.push(`'${n}'도 잡혀야 함`); });
  (c.not || []).forEach(n => { if (got.includes(n)) problems.push(`'${n}'은 잡히면 안 됨`); });
  if (c.none && got.length) problems.push('주제가 잡히면 안 됨');
  if (problems.length) { fail++; console.log(`✗ ${c.q}\n   잡힘: ${got.join(', ') || '(없음)'}\n   ${problems.join(' / ')}`); }
}
// 대표 조문(arts)의 법령명은 같은 주제의 laws에 있어야 조문 창에서 쓰인다
for (const t of ctx.TOPICS) (t.arts || []).forEach(a => {
  if (!t.laws.includes(a[0])) { fail++; console.log(`✗ ${t.n}: 대표 조문의 법령 '${a[0]}'이 laws에 없음`); }
});
console.log(`\n질문 ${cases.length}개 확인 · 실패 ${fail}건`);
process.exit(fail ? 1 : 0);

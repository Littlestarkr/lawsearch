// Cloudflare Workers 중계 서버 (법제처 API용)
// 브라우저의 CORS 제한을 우회하기 위해 법제처 API 요청만 전달합니다.
// 사용법: Cloudflare 대시보드 > Workers & Pages > Create > Hello World 템플릿에서
//        이 코드를 붙여넣고 Deploy. 배포된 주소를 LawSearch.html의 ⚙ 설정에 입력합니다.

const ALLOWED = ['/DRF/lawSearch.do', '/DRF/lawService.do'];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (!ALLOWED.includes(url.pathname)) {
      return new Response('Not allowed', { status: 403, headers: cors });
    }

    const upstream = await fetch('https://www.law.go.kr' + url.pathname + url.search, {
      headers: { 'User-Agent': 'Mozilla/5.0 (LawSearch Proxy)' }
    });
    const headers = new Headers(upstream.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};

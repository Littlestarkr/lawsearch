# HappyOh 법령 길잡이

정확한 법령명을 몰라도 상황을 적으면 관련 법령과 조문을 찾아 주는 검색 페이지입니다.
법제처 국가법령정보 공동활용 Open API를 사용합니다.

- `index.html` : 검색 페이지 (단일 파일)
- `worker.js` : 브라우저에서 법제처 서버를 직접 호출할 수 없을 때 쓰는 Cloudflare Workers 중계 코드 (선택)

참고용 도구이며 법률 자문이 아닙니다. 중요한 판단 전에는 국가법령정보센터 원문을 확인하세요.

## trade/ — HappyOh 무역통계 길잡이
- `trade/index.html` : HS코드 찾기, 한국 수출 상대국 순위(관세청+UN Comtrade 비교), 세계 수입시장·한국 점유율, 연·월 추이. 주소: `/lawsearch/trade/`
- `trade/proxy.gs` : Google Apps Script 중계 서버(관세청 인증키 숨김·CORS 우회). 배포 방법은 파일 상단 주석 참고. 배포 후 `index.html`의 `DEFAULT_PROXY`에 웹 앱 URL을 넣는다.
- 한국무역협회(K-stat)는 공개 API가 없어 링크로만 연결한다.

## cert/ — HappyOh 해외인증 길잡이
KOTRA 해외인증정보(공공데이터포털 `B410001/overseasAuthInfo/getOverseasAuthInfo`)를 품목명·인증제도명·HS코드(6자리)로 찾는다. 중계 서버 `proxy.gs`의 `a=cert`를 거치며 인증키는 `DATA_GO_KEY`를 함께 쓴다. 국가 검색 변수는 없어서 결과를 받은 뒤 국가별로 거른다. 이용허락범위가 공공누리 제4유형(출처표시·상업적 이용금지·변경금지)이므로 원문을 고치지 않고 출처를 표시한다. 무역통계 길잡이 ①탭의 [해외인증] 버튼이 `?hs=`로 연결한다.

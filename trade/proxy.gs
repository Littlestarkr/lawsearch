/**
 * HappyOh 무역통계 길잡이 — 중계 서버 (Google Apps Script)
 *
 * 하는 일
 *  - 관세청 '품목별 국가별 수출입실적'(공공데이터포털) 호출: 인증키를 서버에 숨기고, 여러 나라를 한 번에 조회
 *  - UN Comtrade 공개(preview) API·참조표 호출: 브라우저 CORS 제한 우회
 *
 * 설치: Apps Script 새 프로젝트에 이 파일을 붙여넣고
 *  1) 프로젝트 설정 > 스크립트 속성에 DATA_GO_KEY = 공공데이터포털 '일반 인증키(Encoding)' 추가
 *  2) 배포 > 새 배포 > 유형 '웹 앱' > 실행 계정 '나', 액세스 '모든 사용자' > 배포
 *  3) 나온 웹 앱 URL(…/exec)을 무역통계 페이지의 설정에 붙여넣기
 * 코드를 고치면 '배포 관리'에서 새 버전으로 다시 배포해야 반영됩니다.
 */

var CUSTOMS_URL = 'https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList';
var ITEM_URLS = ['https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList', 'https://apis.data.go.kr/1220000/itemtrade/getItemtradeList'];   // 품목별 수출입실적(국가 구분 없음)
var NATION_URL = 'https://apis.data.go.kr/1220000/nationtrade/getNationtradeList';                                              // 국가별 수출입실적(품목 구분 없음)
var CERT_URLS = ['https://apis.data.go.kr/b410001/overseasAuthInfo/getOverseasAuthInfo', 'https://apis.data.go.kr/B410001/overseasAuthInfo/getOverseasAuthInfo'];   // KOTRA 해외인증정보
var COMTRADE_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
var REF_BASE = 'https://comtradeapi.un.org/files/v1/app/reference/';
var COMTRADE_PARAMS = ['reporterCode', 'partnerCode', 'partner2Code', 'cmdCode', 'flowCode', 'period', 'motCode', 'customsCode', 'maxRecords'];
var REF_NAMES = ['Reporters', 'partnerAreas', 'HS'];

// UNI-PASS OpenAPI (인증키는 API별로 발급되어 스크립트 속성 UNIPASS_KEY_HS/TRRT/FX/LCA/LCALIST에 저장). 허용한 서비스·입력값만 중계한다.
var UNIPASS_BASE = 'https://unipass.customs.go.kr:38010/ext/rest/';
var UNIPASS_OPS = {
  hs:      { prop: 'UNIPASS_KEY_HS', path: 'hsSgnQry/searchHsSgn',                    allow: ['hsSgn', 'prnm', 'koenTp'] },   // HS 부호·품명 검색
  trrt:    { prop: 'UNIPASS_KEY_TRRT', path: 'trrtQry/retrieveTrrt',                    allow: ['hsSgn', 'trrtTpcd'] },         // 관세율(협정세율 포함)
  fx:      { prop: 'UNIPASS_KEY_FX', path: 'trifFxrtInfoQry/retrieveTrifFxrtInfo',    allow: ['qryYymmDd', 'imexTp'] },       // 관세환율
  lca:     { prop: 'UNIPASS_KEY_LCA', path: 'lcaBrkdQry/retrieveLcaBrkd',              allow: ['lcaSgn', 'brno'] },            // 관세사 내역
  lcalist: { prop: 'UNIPASS_KEY_LCALIST', path: 'lcaLstInfoQry/retrieveLcaBrkd',           allow: ['lcaSgn', 'jrsdCstm'] }         // 관세사 목록
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.a === 'customs') out = customs_(p);
    else if (p.a === 'item') out = item_(p);
    else if (p.a === 'cert') out = cert_(p);
    else if (p.a === 'nation') out = nation_(p);
    else if (p.a === 'comtrade') out = comtrade_(p);
    else if (p.a === 'ref') out = ref_(p);
    else if (p.a === 'unipass') out = unipass_(p);
    else if (p.a === 'ping') out = { ok: true, key: !!prop_('DATA_GO_KEY'), unipass: Object.keys(UNIPASS_OPS).filter(function (k) { return !!(prop_(UNIPASS_OPS[k].prop) || prop_('UNIPASS_KEY')); }) };
    else out = { error: '알 수 없는 요청입니다.' };
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

/* ---------- 관세청 ---------- */
function customs_(p) {
  var key = prop_('DATA_GO_KEY');
  if (!key) return { error: '스크립트 속성 DATA_GO_KEY(공공데이터포털 인증키)가 없습니다.' };
  var k = key.indexOf('%') >= 0 ? key : encodeURIComponent(key);
  var from = String(p.from || ''), to = String(p.to || ''), hs = String(p.hs || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(from) || !/^\d{6}$/.test(to)) return { error: '조회 기간(YYYYMM)이 올바르지 않습니다.' };
  var list = String(p.cnty || '').split(',').filter(function (c) { return /^[A-Za-z]{2}$/.test(c); }).slice(0, 80);
  if (!list.length) return { error: '국가 코드가 없습니다.' };

  var cache = CacheService.getScriptCache();
  var results = {}, reqs = [], reqCodes = [];
  list.forEach(function (c) {
    var url = CUSTOMS_URL + '?serviceKey=' + k + '&strtYymm=' + from + '&endYymm=' + to +
      (hs ? '&hsSgn=' + hs : '') + '&cntyCd=' + c.toUpperCase();
    var ck = 'c' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url.replace(k, 'K'))).slice(0, 40);
    var hit = cache.get(ck);
    if (hit) { try { results[c.toUpperCase()] = JSON.parse(hit); return; } catch (e) {} }
    reqs.push({ url: url, muteHttpExceptions: true });
    reqCodes.push({ c: c.toUpperCase(), ck: ck });
  });
  if (reqs.length) {
    var resp = UrlFetchApp.fetchAll(reqs);
    resp.forEach(function (r, i) {
      var parsed = parseCustoms_(r.getContentText(), r.getResponseCode());
      results[reqCodes[i].c] = parsed;
      if (!parsed.error && parsed.code === '00') {
        try { cache.put(reqCodes[i].ck, JSON.stringify(parsed), 21600); } catch (e) {}
      }
    });
  }
  return { results: results };
}

/* ---------- KOTRA 해외인증정보 (공공데이터포털, 같은 인증키) ---------- */
function cert_(p) {
  var key = prop_('DATA_GO_KEY');
  if (!key) return { error: '스크립트 속성 DATA_GO_KEY(공공데이터포털 인증키)가 없습니다.' };
  var k = key.indexOf('%') >= 0 ? key : encodeURIComponent(key);
  var qs = '';
  ['search1', 'search2', 'search3', 'search4', 'search5'].forEach(function (n) {
    var v = String(p[n] || '').slice(0, 100);
    if (v) qs += '&' + n + '=' + encodeURIComponent(v);
  });
  var page = Math.max(1, Math.min(500, parseInt(p.pageNo, 10) || 1));
  var rows = Math.max(1, Math.min(100, parseInt(p.numOfRows, 10) || 30));
  qs += '&pageNo=' + page + '&numOfRows=' + rows;
  var cache = CacheService.getScriptCache();
  var ck = 'k' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, qs)).slice(0, 40);
  var hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var last = { error: '응답이 없습니다.' };
  for (var i = 0; i < CERT_URLS.length; i++) {
    var r = UrlFetchApp.fetch(CERT_URLS[i] + '?serviceKey=' + k + '&type=json' + qs, { muteHttpExceptions: true });
    var text = r.getContentText();
    if (text.charAt(0) !== '<' && r.getResponseCode() === 200 && /"totalCnt"\s*:\s*"?0"?/.test(text)) {
      // 검색 칸을 모두 채워야 동작하는 경우를 대비해, 비운 칸도 함께 보내 한 번 더 시도한다
      var full = qs;
      ['search1', 'search2', 'search3', 'search4', 'search5'].forEach(function (n) { if (full.indexOf('&' + n + '=') < 0) full += '&' + n + '='; });
      var r2 = UrlFetchApp.fetch(CERT_URLS[i] + '?serviceKey=' + k + '&type=json' + full, { muteHttpExceptions: true });
      var t2 = r2.getContentText();
      if (r2.getResponseCode() === 200 && !/"totalCnt"\s*:\s*"?0"?/.test(t2)) { text = t2; r = r2; }
    }
    if (r.getResponseCode() === 404) { last = { error: 'HTTP 404', raw: text.slice(0, 200) }; continue; }
    var out;
    if (text.charAt(0) === '<') {   // 인증키 오류 등은 XML로 온다
      var pe = parseCustoms_(text, r.getResponseCode());
      out = { error: pe.error || pe.msg || '응답을 읽지 못했습니다.', raw: pe.raw };
    } else {
      var j;
      try { j = JSON.parse(text); } catch (e) { return { error: '응답을 읽지 못했습니다.', raw: text.slice(0, 200) }; }
      var resp = j.response || {};
      var code = resp.header && resp.header.resultCode;
      if (code && code !== '00') out = { error: (resp.header.resultMsg || code) };
      else {
        var body = resp.body || {};
        var it = body.itemList && body.itemList.item;
        var items = !it ? [] : (Array.isArray(it) ? it : [it]);
        out = { total: parseInt(body.totalCnt, 10) || items.length, page: page, items: items };
        if (!items.length) out.rawHead = text.slice(0, 400);   // 결과가 없을 때 화면에서 원문을 확인할 수 있도록
      }
    }
    if (!out.error && out.items && out.items.length) { try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) {} }   // 100KB 초과면 저장 생략
    return out;
  }
  return last;
}

/* ---------- 관세청 품목별(국가 합계) ---------- */
function item_(p) {
  var key = prop_('DATA_GO_KEY');
  if (!key) return { error: '스크립트 속성 DATA_GO_KEY(공공데이터포털 인증키)가 없습니다.' };
  var k = key.indexOf('%') >= 0 ? key : encodeURIComponent(key);
  var from = String(p.from || ''), to = String(p.to || ''), hs = String(p.hs || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(from) || !/^\d{6}$/.test(to)) return { error: '조회 기간(YYYYMM)이 올바르지 않습니다.' };
  if (hs.length < 2 || hs.length > 10) return { error: 'HS코드는 2~10자리여야 합니다.' };
  var cache = CacheService.getScriptCache();
  var last = { error: '응답이 없습니다.' };
  for (var i = 0; i < ITEM_URLS.length; i++) {
    var url = ITEM_URLS[i] + '?serviceKey=' + k + '&strtYymm=' + from + '&endYymm=' + to + '&hsSgn=' + hs;
    var ck = 'i' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url.replace(k, 'K'))).slice(0, 40);
    var hit = cache.get(ck);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var parsed = parseCustoms_(r.getContentText(), r.getResponseCode());
    if (!parsed.error && parsed.code === '00') { try { cache.put(ck, JSON.stringify(parsed), 21600); } catch (e) {} return parsed; }
    last = parsed;
    if (r.getResponseCode() !== 404) break;   // 주소 대소문자가 다를 때만 다음 주소를 시도한다
  }
  return last;
}

/* ---------- 관세청 국가별(품목 합계) ---------- */
function nation_(p) {
  var key = prop_('DATA_GO_KEY');
  if (!key) return { error: '스크립트 속성 DATA_GO_KEY(공공데이터포털 인증키)가 없습니다.' };
  var k = key.indexOf('%') >= 0 ? key : encodeURIComponent(key);
  var from = String(p.from || ''), to = String(p.to || '');
  if (!/^\d{6}$/.test(from) || !/^\d{6}$/.test(to)) return { error: '조회 기간(YYYYMM)이 올바르지 않습니다.' };
  var list = String(p.cnty || '').split(',').filter(function (c) { return /^[A-Za-z]{2}$/.test(c); }).slice(0, 80);
  if (!list.length) return { error: '국가 코드가 없습니다.' };
  var cache = CacheService.getScriptCache();
  var results = {}, reqs = [], reqCodes = [];
  list.forEach(function (c) {
    var url = NATION_URL + '?serviceKey=' + k + '&strtYymm=' + from + '&endYymm=' + to + '&cntyCd=' + c.toUpperCase();
    var ck = 'n' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url.replace(k, 'K'))).slice(0, 40);
    var hit = cache.get(ck);
    if (hit) { try { results[c.toUpperCase()] = JSON.parse(hit); return; } catch (e) {} }
    reqs.push({ url: url, muteHttpExceptions: true });
    reqCodes.push({ c: c.toUpperCase(), ck: ck });
  });
  if (reqs.length) {
    UrlFetchApp.fetchAll(reqs).forEach(function (r, i) {
      var parsed = parseCustoms_(r.getContentText(), r.getResponseCode());
      results[reqCodes[i].c] = parsed;
      if (!parsed.error && parsed.code === '00') { try { cache.put(reqCodes[i].ck, JSON.stringify(parsed), 21600); } catch (e) {} }
    });
  }
  return { results: results };
}

function parseCustoms_(text, status) {
  if (status !== 200) return { error: 'HTTP ' + status, raw: text.slice(0, 300) };
  var doc;
  try { doc = XmlService.parse(text); } catch (e) { return { error: '응답을 읽지 못했습니다.', raw: text.slice(0, 300) }; }
  var root = doc.getRootElement();
  var code = '', msg = '', rows = [];
  (function walk(el) {
    var name = el.getName();
    if (name === 'resultCode') code = el.getText();
    else if (name === 'resultMsg') msg = el.getText();
    else if (name === 'item') {
      var row = {};
      el.getChildren().forEach(function (c) { row[c.getName()] = c.getText(); });
      rows.push(row);
      return;
    }
    el.getChildren().forEach(walk);
  })(root);
  // 인증 오류 등 표준 오류 응답 (OpenAPI_ServiceResponse)
  if (!code) {
    var errMsg = '';
    (function w2(el) { if (el.getName() === 'returnAuthMsg' || el.getName() === 'errMsg') errMsg = el.getText(); el.getChildren().forEach(w2); })(root);
    if (errMsg) return { error: errMsg };
  }
  return { code: code, msg: msg, rows: rows };
}

/* ---------- UN Comtrade ---------- */
function comtrade_(p) {
  var qs = COMTRADE_PARAMS.filter(function (k) { return p[k] !== undefined && p[k] !== ''; })
    .map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
  var url = COMTRADE_URL + '?' + qs;
  var cache = CacheService.getScriptCache();
  var ck = 'u' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url)).slice(0, 40);
  var hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var text = r.getContentText();
  if (r.getResponseCode() !== 200) return { error: 'Comtrade HTTP ' + r.getResponseCode(), raw: text.slice(0, 300) };
  var json = JSON.parse(text);
  try { cache.put(ck, JSON.stringify(json), 21600); } catch (e) {}   // 100KB 초과면 저장 생략
  return json;
}

function ref_(p) {
  if (REF_NAMES.indexOf(p.name) < 0) return { error: '허용되지 않은 참조표입니다.' };
  var r = UrlFetchApp.fetch(REF_BASE + p.name + '.json', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { error: 'HTTP ' + r.getResponseCode() };
  return JSON.parse(r.getContentText());
}

/* ---------- UNI-PASS ---------- */
function unipass_(p) {
  var op = UNIPASS_OPS[p.op];
  if (!op) return { error: '허용되지 않은 UNI-PASS 서비스입니다.' };
  var key = prop_(op.prop) || prop_('UNIPASS_KEY');   // UNI-PASS 인증키는 API별로 따로 발급된다
  if (!key) return { error: '스크립트 속성 ' + op.prop + '(UNI-PASS 인증키)가 없습니다.' };
  var qs = 'crkyCn=' + encodeURIComponent(key);
  op.allow.forEach(function (k) {
    if (p[k] !== undefined && String(p[k]) !== '') qs += '&' + k + '=' + encodeURIComponent(String(p[k]).slice(0, 200));
  });
  var url = UNIPASS_BASE + op.path + '?' + qs;
  var cache = CacheService.getScriptCache();
  var ck = 'p' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url.replace(encodeURIComponent(key), 'K'))).slice(0, 40);
  var hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var r;
  try { r = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch (e) { return { error: 'UNI-PASS에 연결하지 못했습니다: ' + String(e.message || e) }; }
  var text = r.getContentText();
  if (r.getResponseCode() !== 200) return { error: 'UNI-PASS HTTP ' + r.getResponseCode(), raw: text.slice(0, 300) };
  var out = parseUnipass_(text);
  if (!out.error) { try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) {} }
  return out;
}

function parseUnipass_(text) {
  var doc;
  try { doc = XmlService.parse(text); } catch (e) { return { error: '응답을 읽지 못했습니다.', raw: text.slice(0, 300) }; }
  var root = doc.getRootElement();
  var ntce = '', tcnt = '', rows = [];
  root.getChildren().forEach(function (c) {
    var n = c.getName();
    if (n === 'ntceInfo') ntce = c.getText();
    else if (n === 'tCnt') tcnt = c.getText();
    else if (/RsltVo$/.test(n)) {
      var row = {};
      c.getChildren().forEach(function (f) { row[f.getName()] = f.getText(); });
      rows.push(row);
    }
  });
  if (tcnt === '-1') return { error: ntce || 'UNI-PASS 오류' };
  return { tCnt: tcnt, ntce: ntce, rows: rows };
}

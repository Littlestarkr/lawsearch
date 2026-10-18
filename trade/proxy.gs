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
var COMTRADE_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
var REF_BASE = 'https://comtradeapi.un.org/files/v1/app/reference/';
var COMTRADE_PARAMS = ['reporterCode', 'partnerCode', 'partner2Code', 'cmdCode', 'flowCode', 'period', 'motCode', 'customsCode', 'maxRecords'];
var REF_NAMES = ['Reporters', 'partnerAreas', 'HS'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.a === 'customs') out = customs_(p);
    else if (p.a === 'comtrade') out = comtrade_(p);
    else if (p.a === 'ref') out = ref_(p);
    else if (p.a === 'ping') out = { ok: true, key: !!prop_('DATA_GO_KEY') };
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

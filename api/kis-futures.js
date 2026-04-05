// KIS API — 달러선물 현재월물 호가 조회
// 토큰은 Vercel warm instance에서 메모리 캐시 (최대 24h)
let tokenCache = { token: null, exp: 0 };

function kisBase() {
  return process.env.KIS_MOCK === 'true'
    ? 'https://openapivts.koreainvestment.com:9443'
    : 'https://openapi.koreainvestment.com:9443';
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp) return tokenCache.token;

  const r = await fetch(`${kisBase()}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET
    })
  });
  const rawText = await r.text();
  let d;
  try { d = JSON.parse(rawText); } catch { throw new Error(`토큰 응답 파싱 실패 (HTTP ${r.status}): ${rawText.slice(0,300)}`); }
  if (!d.access_token) throw new Error(`토큰 발급 실패 (HTTP ${r.status}): ${JSON.stringify(d)}`);
  const ttl = parseInt(d.expires_in || '86400', 10);
  tokenCache = { token: d.access_token, exp: now + (ttl - 300) * 1000 };
  return tokenCache.token;
}

// KRX 달러선물 현재월물 종목코드 생성
// 규칙: 175 + 연도끝자리 + 월코드(A=1월, B=2월, ..., L=12월) + 000
function getUsdFuturesCode() {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;

  // KRX 달러선물 만기: 매월 세 번째 화요일 15:45
  function thirdTuesday(yr, mo) {
    const d = new Date(yr, mo - 1, 1);
    let cnt = 0;
    while (cnt < 3) {
      if (d.getDay() === 2) cnt++;
      if (cnt < 3) d.setDate(d.getDate() + 1);
    }
    d.setHours(15, 45, 0, 0);
    return d;
  }

  if (now >= thirdTuesday(y, m)) {
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const yc = y % 10;
  const mc = String.fromCharCode(64 + m); // A=1, B=2, ..., L=12
  return `175${yc}${mc}000`;
}

// 시장 세션 판단
function getSession() {
  const now = new Date();
  const day = now.getDay(); // 0=일, 1=월~5=금, 6=토
  const t = now.getHours() * 60 + now.getMinutes();

  const D_S = 8 * 60 + 45, D_E = 15 * 60 + 45;
  const N_S = 18 * 60, N_E = 6 * 60;

  const isWeekday = day >= 1 && day <= 5;
  // 야간 장중: 평일 18:00 이후 / 화~토 06:00 이전(어제가 평일)
  const nightOpen = (t >= N_S && isWeekday) || (t < N_E && day >= 2 && day <= 6);

  if (isWeekday && t >= D_S && t < D_E) return 'day';
  if (isWeekday && t >= D_E && t < N_S) return 'day-closed';
  if (nightOpen) return 'night';
  return 'night-closed';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 진단: 환경변수 로드 여부 확인 (?debug=1 로 호출 시)
  if (req.url && req.url.includes('debug=1')) {
    return res.json({
      KIS_APP_KEY_length:    process.env.KIS_APP_KEY    ? process.env.KIS_APP_KEY.length    : 'MISSING',
      KIS_APP_SECRET_length: process.env.KIS_APP_SECRET ? process.env.KIS_APP_SECRET.length : 'MISSING',
      KIS_MOCK:              process.env.KIS_MOCK        ?? 'MISSING',
      base:                  kisBase()
    });
  }

  const session = getSession();
  const iscd = getUsdFuturesCode();
  const isNightOpen = session === 'night';

  // 마감 시간대라도 마지막 호가는 조회 (주간 tr_id 사용)
  const trId = isNightOpen ? 'FHMIF10020000' : 'FHMIF10010000';
  const mktDiv = isNightOpen ? 'NF' : 'F';

  try {
    const token = await getToken();
    const obUrl = `${kisBase()}/uapi/domestic-futureoption/v1/quotations/asking-price` +
      `?FID_COND_MRKT_DIV_CODE=${mktDiv}&FID_INPUT_ISCD=${iscd}`;
    const r = await fetch(obUrl, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: trId,
        custtype: 'P'
      }
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { return res.status(500).json({ error: `호가 응답 파싱 실패 (HTTP ${r.status})`, raw: raw.slice(0, 500), iscd, trId, mktDiv }); }
    return res.json({ iscd, session, trId, mktDiv, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

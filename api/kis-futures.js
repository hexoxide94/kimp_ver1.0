// KIS API — 달러선물 현재월물 호가 조회
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
  try { d = JSON.parse(rawText); }
  catch { throw new Error(`토큰 파싱 실패 (HTTP ${r.status}): ${rawText.slice(0, 200)}`); }

  if (d.error_code === 'EGW00133') {
    if (tokenCache.token) return tokenCache.token;
    throw new Error('토큰 발급 한도 초과 (1분 1회). 잠시 후 자동 재시도됩니다.');
  }
  if (!d.access_token) throw new Error(`토큰 발급 실패 (HTTP ${r.status}): ${JSON.stringify(d)}`);

  const ttl = parseInt(d.expires_in || '86400', 10);
  tokenCache = { token: d.access_token, exp: now + (ttl - 300) * 1000 };
  return tokenCache.token;
}

// KRX 달러선물 현재월물 종목코드: 175 + 연도끝자리 + 월코드(A=1..L=12) + 000
function getUsdFuturesCode() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;

  function thirdTuesday(yr, mo) {
    const d = new Date(Date.UTC(yr, mo - 1, 1));
    let cnt = 0;
    while (cnt < 3) {
      if (d.getUTCDay() === 2) cnt++;
      if (cnt < 3) d.setUTCDate(d.getUTCDate() + 1);
    }
    d.setUTCHours(6, 45, 0, 0); // KST 15:45 = UTC 06:45
    return d;
  }

  if (now.getTime() >= thirdTuesday(y, m).getTime()) {
    m++; if (m > 12) { m = 1; y++; }
  }
  return `175${y % 10}${String.fromCharCode(64 + m)}000`;
}

function getSession() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST
  const day = now.getUTCDay();
  const t = now.getUTCHours() * 60 + now.getUTCMinutes();
  const D_S = 8 * 60 + 45, D_E = 15 * 60 + 45, N_S = 18 * 60, N_E = 6 * 60;
  const isWeekday = day >= 1 && day <= 5;
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

  if (req.url && req.url.includes('debug=1')) {
    return res.json({
      KIS_APP_KEY_length:    process.env.KIS_APP_KEY    ? process.env.KIS_APP_KEY.length    : 'MISSING',
      KIS_APP_SECRET_length: process.env.KIS_APP_SECRET ? process.env.KIS_APP_SECRET.length : 'MISSING',
      KIS_MOCK: process.env.KIS_MOCK ?? 'MISSING',
      base: kisBase()
    });
  }

  const session = getSession();
  const iscd    = getUsdFuturesCode();
  const isNight = session === 'night';
  const trId    = isNight ? 'FHMIF10020000' : 'FHMIF10010000';
  const mktDiv  = isNight ? 'NF' : 'F';

  try {
    const token = await getToken();
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey:    process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      custtype:  'P'
    };

    // ① 호가 조회
    const obRes  = await fetch(
      `${kisBase()}/uapi/domestic-futureoption/v1/quotations/inquire-asking-price` +
      `?FID_COND_MRKT_DIV_CODE=${mktDiv}&FID_INPUT_ISCD=${iscd}`,
      { headers: { ...headers, tr_id: trId } }
    );
    const obText = await obRes.text();
    let obData;
    try { obData = JSON.parse(obText); }
    catch { return res.status(500).json({ error: `호가 파싱 실패 (HTTP ${obRes.status})`, raw: obText.slice(0,300) }); }

    // ② 현재가(종가) 조회 — 장 마감 시에도 종가 표시용
    // 주간 tr_id 사용 (마감 포함)
    const prRes  = await fetch(
      `${kisBase()}/uapi/domestic-futureoption/v1/quotations/inquire-price` +
      `?FID_COND_MRKT_DIV_CODE=F&FID_INPUT_ISCD=${iscd}`,
      { headers: { ...headers, tr_id: 'FHMIF10000000' } }
    );
    const prText = await prRes.text();
    let prData;
    try { prData = JSON.parse(prText); } catch { prData = null; }

    return res.json({ iscd, session, trId, mktDiv, data: obData, price: prData });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

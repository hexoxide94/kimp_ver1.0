// 로컬 개발 서버 — 추가 npm 패키지 불필요 (Node 18+ 내장 fetch 사용)
// 실행: node --env-file=.env server.js
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// API 핸들러 로드
const kisHandler = require('./api/kis-futures');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── API 라우팅 ──
  if (url.pathname === '/api/kis-futures') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      await kisHandler(req, res);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 정적 파일 서빙 (public/) ──
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(__dirname, 'public', file);

  try {
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  } catch {
    // SPA fallback
    try {
      const data = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ 로컬 서버 실행 중 → http://localhost:${PORT}\n`);
  console.log('   종료: Ctrl+C\n');
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 8000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.exr': 'image/x-exr',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.wav': 'audio/wav',
};

function serveLocalFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stats = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stats.size,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  });
  fs.createReadStream(filePath).pipe(res);
}

function proxyToNetlify(res, pathname, search) {
  const liveUrl = `https://hubtown.co.in${pathname}${search || ''}`;
  console.log(`  -> PROXYING (not found locally) to: ${liveUrl}`);
  https.get(liveUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hubtown.co.in/' }
  }, (proxyRes) => {
    const ext = path.extname(pathname).toLowerCase();
    const contentType = MIME_TYPES[ext] || proxyRes.headers['content-type'] || 'application/octet-stream';
    const headers = {
      ...proxyRes.headers,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  }).on('error', (e) => {
    console.error(`  -> PROXY ERROR: ${e.message}`);
    res.writeHead(500);
    res.end('Proxy Error');
  });
}

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

  let rawUrl = req.url;
  if (rawUrl.toLowerCase().includes('%3f')) rawUrl = decodeURIComponent(rawUrl);

  const parsed = new URL(rawUrl, 'http://localhost');
  let pathname = parsed.pathname;

  // Intercept Netlify Image CDN -> redirect to Sanity CDN
  if (pathname.includes('/.netlify/images')) {
    const targetUrl = parsed.searchParams.get('url');
    if (targetUrl) {
      const targetParams = new URLSearchParams();
      parsed.searchParams.forEach((val, key) => { if (key !== 'url') targetParams.append(key, val); });
      let redirectUrl = targetUrl;
      if (targetParams.toString()) redirectUrl += (redirectUrl.includes('?') ? '&' : '?') + targetParams.toString();
      console.log(`  -> REDIRECTING to: ${redirectUrl}`);
      res.writeHead(302, { 'Location': redirectUrl });
      res.end();
      return;
    }
  }

  // Resolve index.html for directory roots
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Map to local file
  let filePath = path.join(PUBLIC_DIR, pathname);

  // Safety check
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Try to serve locally first (ALWAYS check local disk before any proxy)
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      console.log(`  -> LOCAL: ${filePath} (${stats.size} bytes)`);
      serveLocalFile(res, filePath);
      return;
    }

    // Not found locally - proxy to live site for webgl assets
    if (pathname.startsWith('/webgl/') || pathname.startsWith('/draco/') || pathname.startsWith('/basis/')) {
      proxyToNetlify(res, pathname, parsed.search);
      return;
    }

    // 404 for everything else
    console.log(`  -> NOT FOUND: ${filePath}`);
    res.writeHead(404);
    res.end('404 Not Found');
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`======================================================`);
  console.log(`Strategy: Serve ALL local files first, only proxy what's missing.\n`);
});

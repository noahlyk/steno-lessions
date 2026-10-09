// Local server for steno-lessons. Serves the page, the hardcoded layout/dictionary bundle,
// and saves lesson progress to a file. No external process or dictionary install needed.
//
// Environment:
//   STENO_LESSONS_DATA  file that stores progress (default: ~/.config/steno-lessons/progress.json)
//   PORT                port to listen on (default: 4321)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PUBLIC = path.join(__dirname, 'public');
const BUNDLE_FILE = path.join(PUBLIC, 'data', 'bundle.json');
const DATA_FILE =
  process.env.STENO_LESSONS_DATA || path.join(os.homedir(), '.config', 'steno-lessons', 'progress.json');
const PORT = Number(process.env.PORT) || 4321;
const MAX_BODY = 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let cache;
function data() {
  if (!cache) cache = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8'));
  return cache;
}

function readProgress() {
  if (!fs.existsSync(DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeProgress(body) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(body, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.normalize(path.join(PUBLIC, relative));
  if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/progress' && req.method === 'GET') {
    try {
      return sendJson(res, 200, readProgress() || {});
    } catch (error) {
      return sendJson(res, 500, { error: `progress file is unreadable: ${error.message}` });
    }
  }

  if (pathname === '/api/progress' && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      writeProgress(body);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end();
  }
  return serveStatic(req, res, pathname);
}

if (require.main === module) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
    });
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`steno-lessons at http://127.0.0.1:${PORT}`);
  });
}

module.exports = { handle };

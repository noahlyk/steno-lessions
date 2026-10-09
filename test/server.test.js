const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// The server reads its settings when it loads, so point them at a fixture first.
const dir = fs.mkdtempSync(path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir(), 'steno-lessons-test-'));
fs.mkdirSync(dir, { recursive: true });
process.env.STENO_LESSONS_DATA = path.join(dir, 'progress.json');

const { handle } = require('../server.js');

let server;
let base;

test.before(async () => {
  server = http.createServer((req, res) => handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('serves the hardcoded layout and dictionary bundle as a plain static file', async () => {
  const response = await fetch(`${base}/data/bundle.json`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.layout.slots.length, 23);
  assert.ok(Array.isArray(body.words) && body.words.length > 0);
  assert.ok(body.words.every((word) => typeof word.text === 'string' && Array.isArray(word.shown)));
});

test('progress round-trips through PUT and GET', async () => {
  const progress = { unlocked: 7, lessons: 3, keys: { 'S-': { samples: 5, ewmaMs: 800, misses: 0 } } };
  const put = await fetch(`${base}/api/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(progress),
  });
  assert.equal(put.status, 200);
  const get = await fetch(`${base}/api/progress`);
  assert.deepEqual(await get.json(), progress);
});

test('PUT /api/progress rejects bad JSON', async () => {
  const response = await fetch(`${base}/api/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(response.status, 400);
});

test('serves the page and refuses paths outside public/', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /steno-lessons/);

  const escape = await fetch(`${base}/..%2Fserver.js`);
  assert.equal(escape.status, 404);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// The server reads its settings when it loads, so point them at fixtures first.
const dir = fs.mkdtempSync(path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir(), 'steno-lessons-test-'));
fs.mkdirSync(dir, { recursive: true });
const layoutFile = path.join(__dirname, 'fixtures', 'layout.txt');
const fakeKeymux = path.join(dir, 'keymux');
fs.writeFileSync(fakeKeymux, `#!/bin/sh\ncat "${layoutFile}"\n`);
fs.chmodSync(fakeKeymux, 0o755);
const stenoDir = path.join(dir, 'steno');
fs.mkdirSync(stenoDir);
fs.writeFileSync(path.join(stenoDir, 'main.json'), JSON.stringify({ KAT: 'cat', '-PB': 'and', 'TEFT': 'Test' }));
fs.writeFileSync(path.join(stenoDir, 'user.json'), JSON.stringify({ '-PB': 'an' }));
process.env.KEYMUX_BIN = fakeKeymux;
process.env.KEYMUX_STENO_DIR = stenoDir;
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

test('GET /api/data returns the layout and the words from the dictionary', async () => {
  const response = await fetch(`${base}/api/data`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.layout.slots.length, 23);
  const words = Object.fromEntries(body.words.map((word) => [word.text, word]));
  assert.deepEqual(words.cat.shown, ['KAT']);
  // user.json overrides main.json
  assert.deepEqual(words.an.shown, ['-PB']);
  assert.equal(words.and, undefined);
  // Capitalized entries are left out
  assert.equal(words.Test, undefined);
  assert.deepEqual(body.dictionaries, ['main.json', 'user.json']);
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

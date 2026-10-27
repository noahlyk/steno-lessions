const test = require('node:test');
const assert = require('node:assert');
const U = require('../public/lib/uni.js');
const S = require('../public/lib/steno.js');

// WebHID delivers the report id separately (event.reportId) and strips it from the data
// buffer, so the parser takes (reportId, payload) - the shape the browser actually gives.
test('parseHidState accepts report id 0x50 with an 8-byte big-endian payload', () => {
  assert.strictEqual(U.parseHidState(0x50, [0x80, 0, 0, 0, 0, 0, 0, 0]), 1n << 63n);
  assert.strictEqual(U.parseHidState(0x50, [0, 0, 0, 0, 0, 0, 0, 0x01]), 1n);
});

test('parseHidState rejects wrong report id and short payloads', () => {
  assert.strictEqual(U.parseHidState(0x51, [0x80, 0, 0, 0, 0, 0, 0, 0]), null);
  assert.strictEqual(U.parseHidState(0, [0x80, 0, 0, 0, 0, 0, 0, 0]), null);
  assert.strictEqual(U.parseHidState(0x50, [0x80, 0]), null);
  assert.strictEqual(U.parseHidState(0x50, null), null);
});

test('Plover HID constants match the protocol', () => {
  assert.strictEqual(U.USAGE_PAGE, 0xFF50);
  assert.strictEqual(U.USAGE, 0x4C56);
  assert.strictEqual(U.REPORT_ID, 0x50);
});

test('CHART is Plover HID STENO_KEY_CHART, verbatim', () => {
  assert.deepStrictEqual([...U.CHART], [
    'S1-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-',
    'O-', '*1', '-E', '-U', '-F', '-R', '-P', '-B',
    '-L', '-G', '-T', '-S', '-D', '-Z', '#1', 'S2-',
    '*2', '*3', '*4', '#2', '#3', '#4', '#5', '#6',
    '#7', '#8', '#9', '#A', '#B', '#C', 'X1', 'X2',
    'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10',
    'X11', 'X12', 'X13', 'X14', 'X15', 'X16', 'X17', 'X18',
    'X19', 'X20', 'X21', 'X22', 'X23', 'X24', 'X25', 'X26',
  ]);
});

test('chartKeys reads chart names from the MSB down', () => {
  assert.deepStrictEqual(U.chartKeys(1n << 63n), ['S1-']);
  assert.deepStrictEqual(U.chartKeys((1n << 63n) | (1n << 62n)), ['S1-', 'T-']);
  assert.deepStrictEqual(U.chartKeys(1n << 40n), ['S2-']);
  assert.deepStrictEqual(U.chartKeys(0n), []);
});

test('leverSlot maps split levers onto lesson slots and ignores X keys', () => {
  assert.strictEqual(U.leverSlot('S1-'), 'S-');
  assert.strictEqual(U.leverSlot('S2-'), 'S-');
  assert.strictEqual(U.leverSlot('*3'), '*');
  assert.strictEqual(U.leverSlot('#1'), '#');
  assert.strictEqual(U.leverSlot('#C'), '#');
  assert.strictEqual(U.leverSlot('X1'), null);
  assert.strictEqual(U.leverSlot('T-'), 'T-');
  assert.strictEqual(U.leverSlot('-Z'), '-Z');
});

test('strokeBits merges levers onto slot bits', () => {
  const sBit = 1 << S.SLOTS.findIndex(([, name]) => name === 'S-');
  const starBit = 1 << S.SLOTS.findIndex(([, name]) => name === '*');
  const hashBit = 1 << S.SLOTS.findIndex(([, name]) => name === '#');
  assert.strictEqual(U.strokeBits(['S1-', 'S2-']), sBit);
  assert.strictEqual(U.strokeBits(['*1', '*2', '*3', '*4']), starBit);
  assert.strictEqual(U.strokeBits(['#1', '#2']), hashBit);
  assert.strictEqual(U.strokeBits(['X1']), 0);
  assert.strictEqual(U.strokeBits(['S1-', 'T-']), sBit | (1 << 1));
});

test('UNI_KEYS is the 28-key Uni v4 grid covering every lesson slot', () => {
  assert.strictEqual(U.UNI_KEYS.length, 28);
  const positions = new Set(U.UNI_KEYS.map((k) => `${k.half}:${k.row}:${k.col}`));
  assert.strictEqual(positions.size, 28);
  const slots = new Set(U.UNI_KEYS.map((k) => k.slot));
  assert.strictEqual(slots.size, 23);
  for (const [, name] of S.SLOTS) assert.ok(slots.has(name), `missing slot ${name}`);
  assert.deepStrictEqual(U.UNI_KEYS.filter((k) => k.name === 'S1-'), [{ name: 'S1-', slot: 'S-', half: 'L', row: 0, col: 0 }]);
  assert.deepStrictEqual(U.UNI_KEYS.filter((k) => k.name === '#2'), [{ name: '#2', slot: '#', half: 'R', row: 2, col: 2 }]);
});

// Every position pinned, so a swapped pair anywhere on the board fails the suite, not just
// the two keys spot-checked above.
test('UNI_KEYS pins every key to its physical position', () => {
  assert.deepStrictEqual(U.UNI_KEYS.map((k) => [k.name, k.half, k.row, k.col]), [
    ['S1-', 'L', 0, 0], ['T-', 'L', 0, 1], ['P-', 'L', 0, 2], ['H-', 'L', 0, 3], ['*1', 'L', 0, 4],
    ['*3', 'R', 0, 0], ['-F', 'R', 0, 1], ['-P', 'R', 0, 2], ['-L', 'R', 0, 3], ['-T', 'R', 0, 4], ['-D', 'R', 0, 5],
    ['S2-', 'L', 1, 0], ['K-', 'L', 1, 1], ['W-', 'L', 1, 2], ['R-', 'L', 1, 3], ['*2', 'L', 1, 4],
    ['*4', 'R', 1, 0], ['-R', 'R', 1, 1], ['-B', 'R', 1, 2], ['-G', 'R', 1, 3], ['-S', 'R', 1, 4], ['-Z', 'R', 1, 5],
    ['#1', 'L', 2, 2], ['A-', 'L', 2, 3], ['O-', 'L', 2, 4],
    ['-E', 'R', 2, 0], ['-U', 'R', 2, 1], ['#2', 'R', 2, 2],
  ]);
});

// Every position pinned, so a swapped pair anywhere on the board fails the suite, not just
// the two keys spot-checked above.
test('hintNames renders steno display names in display order', () => {
  const aBit = 1 << S.SLOTS.findIndex(([, name]) => name === 'A-');
  const tBit = 1 << S.SLOTS.findIndex(([, name]) => name === '-T');
  assert.deepStrictEqual(U.hintNames(aBit | tBit), ['A', '-T']);
});

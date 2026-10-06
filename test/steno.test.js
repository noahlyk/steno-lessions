const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');

const layoutText = fs.readFileSync(path.join(__dirname, 'fixtures', 'layout.txt'), 'utf8');

test('parseStroke reads Plover strokes the way keymux does', () => {
  // K + A + right T = "cat"
  assert.equal(steno.parseStroke('KAT'), (1 << 2) | (1 << 7) | (1 << 18));
  // Right-only strokes need the dash
  assert.equal(steno.parseStroke('-PB'), (1 << 14) | (1 << 15));
  // Numbers start with #
  assert.equal(steno.parseStroke('#T'), (1 << 22) | (1 << 1));
});

test('parseStroke rejects anything that is not a single stroke', () => {
  assert.equal(steno.parseStroke('xyz'), null);
  assert.equal(steno.parseStroke(''), null);
  // A left-hand letter after a vowel needs a dash
  assert.equal(steno.parseStroke('AK'), null);
});

test('parseLayout reads keymux layout output into keys and combined keys', () => {
  const layout = steno.parseLayout(layoutText);
  assert.equal(layout.slots.length, 23);
  const s = layout.slots.find((slot) => slot.name === 'S-');
  assert.equal(s.label, 'A');
  assert.equal(s.sound, 's');
  assert.equal(s.index, 0);

  // Comma presses -E and -U together
  const comma = layout.keys.find((key) => key.label === ',');
  assert.equal(comma.combined, true);
  assert.equal(comma.bits, (1 << 10) | (1 << 11));
});

test('namesInBits lists the steno keys in a stroke in Plover order', () => {
  assert.deepEqual(steno.namesInBits(steno.parseStroke('KAT')), ['K-', 'A-', '-T']);
});

test('buildWords keeps plain words and the shortest stroke for each', () => {
  const words = steno.buildWords([
    ['KAT', 'cat'],
    ['KAT/-PB', 'cat'],
    ['-PB', 'and'],
    ['KPA/TKAOEU', 'example'],
    ['TEFT', 'Test'],
    ['1/THOEUB', '1,000'],
    ['{^ing}', '{^ing}'],
    ['bad/stroke/a/b', 'x'],
  ]);
  const byText = Object.fromEntries(words.map((word) => [word.text, word]));
  assert.deepEqual(Object.keys(byText).sort(), ['and', 'cat', 'example']);
  assert.equal(byText.cat.notation, 'KAT');
  assert.equal(byText.cat.strokes.length, 1);
  assert.equal(byText.example.strokes.length, 2);
});

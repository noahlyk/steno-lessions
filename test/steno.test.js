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
  assert.deepEqual(byText.cat.shown, ['KAT']);
  assert.deepEqual(byText.cat.variants[0], [steno.parseStroke('KAT')]);
  assert.equal(byText.cat.variants.length, 2, 'KAT and KAT/-PB both type "cat"');
  assert.deepEqual(byText.example.shown, ['KPA', 'TKAOEU']);
});

test('buildWords keeps every stroke for a word and shows the one with fewest keys', () => {
  const words = steno.buildWords([
    ['STK', 'and'],
    ['-PB', 'and'],
  ]);
  const and = words[0];
  assert.equal(and.variants.length, 2, 'both strokes are accepted');
  assert.deepEqual(and.shown, ['-PB'], 'the two-key stroke is shown first');
});

test('displayName keeps the dash only where a letter has a left and a right key', () => {
  const names = (list) => list.map(steno.displayName);
  assert.deepEqual(names(['-E', 'A-', 'K-', 'W-', '-F', '*', '#']), ['E', 'A', 'K', 'W', 'F', '*', '#']);
  assert.deepEqual(names(['S-', '-S', 'T-', '-T', 'R-', '-R', 'P-', '-P']), ['S', '-S', 'T', '-T', 'R', '-R', 'P', '-P']);
});

test('keyGroup puts left-hand keys, vowels and star, and right-hand keys in their own groups', () => {
  const groups = ['S-', 'R-', 'A-', '*', '-E', '-U', '-F', '-T', '#'].map(steno.keyGroup);
  assert.deepEqual(groups, ['left', 'left', 'middle', 'middle', 'middle', 'middle', 'right', 'right', '']);
});

test('renderStroke writes a stroke bitmask in Plover notation', () => {
  for (const text of ['KAT', '-PB', 'TEFT', '#T', 'STKPWHR', '-FRPBLGTSDZ', '*', 'TK-PB', 'R-R']) {
    assert.equal(steno.renderStroke(steno.parseStroke(text)), text);
  }
});

// Accuracy is judged per chord (the exact combination held together in the left hand, the
// vowels or the right hand), never per key: T, TH, TK and TPH are four separate records.
const test = require('node:test');
const assert = require('node:assert/strict');
const steno = require('../public/lib/steno.js');
const lessons = require('../public/lib/lessons.js');

const slotIndex = new Map(steno.SLOTS.map(([, name], index) => [name, index]));
const bits = (...names) => names.reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
const allUnlocked = () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = lessons.KEY_ORDER.length;
  return progress;
};
// 40 attempts on a chord, the first `right` of them correct
const practice = (progress, id, right, ms = 400) => {
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, [id], ms, i < right);
};

test('a stroke splits into number, left, vowel and right chord units, in steno order', () => {
  assert.deepEqual(
    lessons.chordUnits(['-B', 'A-', 'H-', '#', '-P', 'T-', '-E', 'P-']),
    ['#', 'T-+P-+H-', 'A-+-E', '-P+-B'],
  );
  assert.deepEqual(lessons.chordUnits(['T-']), ['T-'], 'a lone key is a unit named for itself');
  assert.deepEqual(lessons.chordUnits(['*', 'O-', 'A-']), ['A-+O-+*'], 'the star sits with the vowels');
  assert.deepEqual(lessons.chordUnits([]), []);
});

test('T, TH, TK and TPH are four different chords', () => {
  const ids = [['T-'], ['T-', 'H-'], ['T-', 'K-'], ['T-', 'P-', 'H-']].map((names) => lessons.chordUnits(names)[0]);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(lessons.unitKeys('T-+P-+H-'), ['T-', 'P-', 'H-']);
});

test('isChordId only accepts ids the engine could have made', () => {
  for (const good of ['T-', 'T-+P-+H-', 'A-+-E', '-P+-B+-L+-G', '#', '*']) assert.ok(lessons.isChordId(good), good);
  for (const bad of ['NOPE', 'P-+T-', 'T-+-T', 'T-+T-', '', 'T-+', 5, null]) assert.ok(!lessons.isChordId(bad), String(bad));
});

test('getting TPH right records TPH, and says nothing about T on its own', () => {
  const progress = lessons.emptyProgress();
  for (let i = 0; i < 10; i++) {
    lessons.recordStroke(progress, { used: ['T-', 'P-', 'H-', 'O-'], ms: 500, correct: true });
  }
  assert.equal(progress.chords['T-+P-+H-'].samples, 10);
  assert.equal(progress.chords['O-'].samples, 10);
  assert.equal(progress.chords['T-'], undefined, 'T alone has no record at all');
  assert.equal(lessons.chordAccuracy(progress, 'T-'), 1, 'and so nothing can drag it down');
});

test('a wrong stroke blames only the chord that came out wrong', () => {
  const progress = lessons.emptyProgress();
  // Needed n-sound + O + final -PB; typed TH instead of TPH, the rest right.
  lessons.recordStroke(progress, {
    target: ['T-', 'P-', 'H-', 'O-', '-P', '-B'],
    used: ['T-', 'H-', 'O-', '-P', '-B'],
    ms: 700,
    correct: false,
  });
  assert.equal(progress.chords['T-+P-+H-'].misses, 1);
  assert.equal(progress.chords['T-+H-'], undefined, 'what they typed instead is not scored');
  assert.equal(progress.chords['O-'], undefined, 'the vowel they got right is not blamed');
  assert.equal(progress.chords['-P+-B'], undefined, 'nor are the finals');
});

test('a stroke wrong only by an extra key blames the whole target, since no single chord is missing', () => {
  const progress = lessons.emptyProgress();
  lessons.recordStroke(progress, { target: ['T-', 'O-'], used: ['T-', 'O-', '-S'], ms: 500, correct: false });
  assert.equal(progress.chords['T-'].misses, 1);
  assert.equal(progress.chords['O-'].misses, 1);
  assert.equal(progress.chords['-S'], undefined);
});

test('a chord you keep missing blocks unlock even though every one of its keys is fine alone', () => {
  const progress = lessons.emptyProgress();
  for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms: 1000, strokes: 1, misses: 0 });
  for (const key of ['T-', 'P-', 'H-']) for (let i = 0; i < 30; i++) lessons.recordChord(progress, [key], 400, true);
  assert.equal(lessons.canUnlock(progress), true, 'T, P and H are each solid');
  for (let i = 0; i < 12; i++) lessons.recordChord(progress, ['T-+P-+H-'], 500, i % 2 === 0);
  assert.ok(lessons.chordAccuracy(progress, 'T-+P-+H-') < lessons.CHORD_ACCURACY_TARGET);
  assert.equal(lessons.canUnlock(progress), false, 'the n sound is the problem, and it gates the unlock');
});

test('the focus is a failing compound chord, not one of its keys', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) practice(progress, name, 40);
  for (let i = 0; i < 12; i++) lessons.recordChord(progress, ['T-+K-'], 500, i % 2 === 0);
  assert.equal(lessons.focusChord(progress), 'T-+K-');
  assert.deepEqual(lessons.weakChords(progress)[0].id, 'T-+K-');
});

test('a key is not solid while one of its chords is a weak spot, but its own chord stays untouched', () => {
  const progress = allUnlocked();
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['T-'], 400, true);
  assert.equal(lessons.keyTier(progress, 'T-'), 2);
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['T-+P-+H-'], 400, i % 2 === 0);
  assert.equal(lessons.chordAccuracy(progress, 'T-'), 1, 'T alone is still perfect');
  assert.equal(lessons.keyTier(progress, 'T-'), 0, 'but T is held back by the combination it is part of');
  assert.deepEqual(lessons.chordsWithKey(progress, 'H-'), ['T-+P-+H-']);
});

test('words with a weak compound chord come up far more than words with solid chords', () => {
  const progress = allUnlocked();
  for (const name of lessons.KEY_ORDER) practice(progress, name, 40);
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['T-+P-+H-'], 400, i % 2 === 0); // 50%
  const nWord = { text: 'zzz', variants: [[bits('T-', 'P-', 'H-', 'O-')]] };
  const tWord = { text: 'yyy', variants: [[bits('T-', 'O-')]] };
  const sWord = { text: 'xxx', variants: [[bits('S-', 'O-')]] };
  let n = 0;
  for (let i = 0; i < 300; i++) {
    if (lessons.nextWord([nWord, tWord, sWord], progress, slotIndex).text === 'zzz') n++;
  }
  assert.ok(n >= 210, `the n-sound word came up ${n}/300`);
});

test('a chord not yet met pulls words, but a chord being failed pulls harder', () => {
  const progress = allUnlocked();
  for (const name of lessons.KEY_ORDER) practice(progress, name, 40);
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['K-+W-+R-'], 400, i % 2 === 0); // failing
  const failing = lessons.weaknessBoost(progress, bits('K-', 'W-', 'R-'), slotIndex);
  const unseen = lessons.weaknessBoost(progress, bits('S-', 'T-'), slotIndex); // S-T- never typed
  const solid = lessons.weaknessBoost(progress, bits('T-'), slotIndex);
  assert.ok(failing > unseen && unseen > solid, `${failing} > ${unseen} > ${solid}`);
});

test('drilling never stops: with nothing under the bar it works the relatively weakest chord', () => {
  const progress = lessons.emptyProgress();
  assert.equal(lessons.drillOptions(progress), null, 'nothing practiced yet, nothing to drill');
  practice(progress, 'T-', 40, 300);
  practice(progress, '-S', 40, 3000); // perfectly accurate, but slow
  assert.deepEqual(lessons.weakChords(progress, 9).filter((c) => c.accuracy < lessons.DRILL_ACCURACY), []);
  const drill = lessons.drillOptions(progress);
  assert.equal(drill.target, '-S');
  assert.equal(drill.options.requireUnit, '-S');
  assert.equal(drill.share, lessons.STEADY_DRILL_SHARE);
});

test('a chord under the bar is drilled first, at the full share, in words free of other weak chords', () => {
  const progress = lessons.emptyProgress();
  practice(progress, 'T-', 40, 300);
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['T-+P-+H-'], 400, i % 2 === 0);
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['-S+-D'], 400, i % 3 === 0);
  const drill = lessons.drillOptions(progress);
  assert.equal(drill.target, '-S+-D', 'the worst of the two');
  assert.equal(drill.share, lessons.DRILL_SHARE);
  assert.deepEqual([...drill.options.excludeUnits], ['T-+P-+H-'], 'the other weak chord stays out of the drill words');
});

test('requireUnit only returns words that use that exact chord, and excludeUnits drops words that use another', () => {
  const progress = allUnlocked();
  const nWord = { text: 'zzz', variants: [[bits('T-', 'P-', 'H-', 'O-')]] };
  const tWord = { text: 'yyy', variants: [[bits('T-', 'O-')]] };
  const thWord = { text: 'xxx', variants: [[bits('T-', 'H-', 'O-')]] };
  const required = lessons.pickWords([nWord, tWord, thWord], progress, slotIndex, { count: 3, requireUnit: 'T-+P-+H-' });
  assert.deepEqual(required.map((word) => word.text), ['zzz'], 'TH and T are not TPH');
  const excluded = lessons.pickWords([nWord, tWord, thWord], progress, slotIndex, { count: 3, excludeUnits: new Set(['T-+P-+H-']) });
  assert.deepEqual(excluded.map((word) => word.text).sort(), ['xxx', 'yyy']);
});

test('stats saved per key before chords existed are dropped, not guessed at', () => {
  const progress = lessons.normalize({
    unlocked: 12,
    keys: { 'T-': { samples: 300, ewmaMs: 500, misses: 4, recent: [1, 1, 0] } },
    words: [{ ms: 800, strokes: 1, misses: 0 }],
  });
  assert.equal(progress.unlocked, 12, 'unlock progress is kept');
  assert.equal(progress.words.length, 1, 'and so is the word history');
  assert.deepEqual(progress.chords, {}, 'but the pooled per-key stats cannot be split into chords');
  assert.equal(progress.keys, undefined);
});

test('chord stats survive a save round-trip and level switching', () => {
  const progress = lessons.emptyProgress();
  lessons.recordStroke(progress, { used: ['T-', 'P-', 'H-', 'O-'], ms: 500, correct: true });
  const back = lessons.normalize(JSON.parse(JSON.stringify(progress)));
  assert.equal(back.chords['T-+P-+H-'].samples, 1);
  lessons.switchLevel(back, 2);
  assert.deepEqual(back.chords, {});
  lessons.switchLevel(back, 1);
  assert.equal(back.chords['T-+P-+H-'].samples, 1);
});

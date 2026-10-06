const test = require('node:test');
const assert = require('node:assert/strict');
const steno = require('../public/lib/steno.js');
const lessons = require('../public/lib/lessons.js');

const slotIndex = new Map(steno.SLOTS.map(([, name], index) => [name, index]));

const words = steno.buildWords([
  ['-E', 'e'],
  ['A-', 'a'],
  ['KAT', 'cat'],
  ['-T', 'at'],
  ['TEFT', 'test'],
  ['STKPWHR', 'strength'],
  ['-PB', 'and'],
  ['SA', 'sa'],
]);

function learnedProgress(names) {
  const progress = lessons.emptyProgress();
  for (const name of names) {
    for (let i = 0; i < 6; i++) {
      lessons.recordChord(progress, [name], 600, true);
    }
  }
  return progress;
}

test('KEY_ORDER covers every stroke key exactly once', () => {
  assert.equal(new Set(lessons.KEY_ORDER).size, lessons.KEY_ORDER.length);
  assert.equal(lessons.KEY_ORDER.length, steno.SLOTS.length);
  for (const name of lessons.KEY_ORDER) {
    assert.ok(slotIndex.has(name), `${name} is a steno key`);
  }
});

test('normalize keeps good fields and drops damaged ones', () => {
  assert.deepEqual(lessons.normalize(null), lessons.emptyProgress());
  assert.deepEqual(lessons.normalize('nonsense'), lessons.emptyProgress());
  const progress = lessons.normalize({
    unlocked: 999,
    lessons: -3,
    keys: { 'A-': { samples: 2, ewmaMs: 900, misses: 1 }, 'NOPE': { samples: 9 } },
  });
  assert.equal(progress.unlocked, lessons.KEY_ORDER.length);
  assert.equal(progress.lessons, 0);
  assert.deepEqual(progress.keys['A-'], { samples: 2, ewmaMs: 900, misses: 1 });
  assert.equal(progress.keys.NOPE, undefined);
});

test('confidence needs both enough samples and a fast enough time', () => {
  const progress = lessons.emptyProgress();
  assert.equal(lessons.confidence(progress, 'A-'), 0);
  lessons.recordChord(progress, ['A-'], 600, true);
  assert.ok(lessons.confidence(progress, 'A-') < 0.5, 'one sample is not enough');
  for (let i = 0; i < 10; i++) lessons.recordChord(progress, ['A-'], 600, true);
  assert.equal(lessons.confidence(progress, 'A-'), 1);
  for (let i = 0; i < 20; i++) lessons.recordChord(progress, ['A-'], 4000, true);
  assert.ok(lessons.confidence(progress, 'A-') < lessons.LEARNED, 'slow keys are not learned');
});

test('a miss slows a key down rather than counting as a sample', () => {
  const progress = lessons.emptyProgress();
  lessons.recordChord(progress, ['T-'], 500, false);
  assert.equal(progress.keys['T-'].samples, 0);
  assert.equal(progress.keys['T-'].misses, 1);
  assert.ok(progress.keys['T-'].ewmaMs > 500);
});

test('unlockIfReady adds one key only when every unlocked key is learned', () => {
  const progress = learnedProgress(lessons.unlockedNames(lessons.emptyProgress()).slice(0, 5));
  assert.equal(lessons.unlockIfReady(progress), false, 'the sixth key is not learned yet');

  const ready = learnedProgress(lessons.unlockedNames(lessons.emptyProgress()));
  assert.equal(lessons.unlockIfReady(ready), true);
  assert.equal(ready.unlocked, lessons.START_KEYS + 1);
});

test('focusKey is the unlocked key that needs the most practice', () => {
  const progress = learnedProgress(lessons.unlockedNames(lessons.emptyProgress()));
  lessons.recordChord(progress, ['S-'], 5000, false);
  assert.equal(lessons.focusKey(progress), 'S-');
});

test('pickLesson only uses words made from unlocked keys', () => {
  const progress = lessons.emptyProgress();
  const picked = lessons.pickLesson(words, progress, slotIndex, { random: () => 0.5, count: 10 });
  const mask = lessons.unlockedMask(progress, slotIndex);
  assert.ok(picked.length > 0);
  for (const word of picked) {
    for (const bits of word.strokes) {
      assert.equal(bits & ~mask, 0, `${word.text} only uses unlocked keys`);
    }
  }
  assert.ok(!picked.some((word) => word.text === 'strength'), 'needs keys not yet unlocked');
});

test('pickLesson returns distinct words and respects the count', () => {
  const progress = learnedProgress(lessons.KEY_ORDER);
  const picked = lessons.pickLesson(words, progress, slotIndex, { random: () => 0.3, count: 4 });
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked.map((word) => word.text)).size, 4);
});

test('pickLesson returns nothing when no word fits the unlocked keys', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 1;
  const strength = words.find((word) => word.text === 'strength');
  assert.deepEqual(lessons.pickLesson([strength], progress, slotIndex), []);
});

test('pickLesson skips the previous lesson words when it can', () => {
  const progress = learnedProgress(lessons.KEY_ORDER);
  const avoid = ['cat', 'test', 'and'];
  const picked = lessons.pickLesson(words, progress, slotIndex, { random: () => 0.1, count: 3, avoid });
  assert.ok(!picked.some((word) => avoid.includes(word.text)));
});

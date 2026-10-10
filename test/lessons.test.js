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
  ['STK', 'and'],
  ['SA', 'sa'],
]);

function typeWords(progress, count, { ms = 1000, misses = 0 } = {}) {
  for (let i = 0; i < count; i++) {
    lessons.recordWord(progress, { ms, strokes: 1, misses });
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
    keys: { 'A-': { samples: 2, ewmaMs: 900, misses: 1 }, NOPE: { samples: 9 } },
    words: [{ ms: 800, strokes: 2, misses: 0 }, { ms: 'x' }],
  });
  assert.equal(progress.unlocked, lessons.KEY_ORDER.length);
  assert.deepEqual(progress.keys['A-'], { samples: 2, ewmaMs: 900, misses: 1, recent: [] });
  assert.equal(progress.keys.NOPE, undefined);
  assert.deepEqual(progress.words, [{ ms: 800, strokes: 2, misses: 0 }]);
});

test('a miss slows a key down rather than counting as a sample', () => {
  const progress = lessons.emptyProgress();
  lessons.recordChord(progress, ['T-'], 500, false);
  assert.equal(progress.keys['T-'].samples, 0);
  assert.equal(progress.keys['T-'].misses, 1);
  assert.ok(progress.keys['T-'].ewmaMs > 500);
});

test('the words-per-minute target rises from 30 to 50 as keys are added', () => {
  assert.equal(lessons.wpmTarget(lessons.START_KEYS), 30);
  assert.equal(lessons.wpmTarget(lessons.START_KEYS + 5), 40);
  assert.equal(lessons.wpmTarget(lessons.KEY_ORDER.length), 50);
});

test('windowStats reports words per minute and accuracy over the newest words', () => {
  const progress = typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE, { ms: 1000 });
  const stats = lessons.windowStats(progress);
  assert.equal(stats.count, lessons.LESSON_SIZE);
  assert.equal(Math.round(stats.wpm), 60);
  assert.equal(stats.accuracy, 1);
});

test('scoreFor combines speed and accuracy into one number', () => {
  assert.equal(lessons.scoreFor({ wpm: 60, accuracy: 1 }), 1200);
  assert.equal(lessons.scoreFor({ wpm: 0, accuracy: 1 }), 0);
});

test('a key unlocks only with enough fast, accurate words', () => {
  // Too few words
  assert.equal(lessons.canUnlock(typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE - 1)), false);
  // Fast enough but not accurate enough
  assert.equal(lessons.canUnlock(typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE, { misses: 1 })), false);
  // Accurate but too slow: 12 words per minute
  assert.equal(lessons.canUnlock(typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE, { ms: 5000 })), false);
  // Fast and accurate
  assert.equal(lessons.canUnlock(typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE)), true);
});

test('a key with poor accuracy of its own blocks unlock even if the overall window looks fine', () => {
  const progress = typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE);
  // Overall accuracy is still 1 (misses are recorded on the key, not on recordWord here),
  // but the key itself has failed more than it has succeeded.
  for (let i = 0; i < 9; i++) lessons.recordChord(progress, ['T-'], 500, false);
  lessons.recordChord(progress, ['T-'], 500, true);
  assert.equal(lessons.keyAccuracy(progress, 'T-') < lessons.KEY_ACCURACY_TARGET, true);
  assert.equal(lessons.canUnlock(progress), false);
});

test('a rough patch on a key fades out once it is typed well consistently, unlike an all-time average', () => {
  const progress = typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE);
  for (let i = 0; i < 9; i++) lessons.recordChord(progress, ['T-'], 500, false);
  lessons.recordChord(progress, ['T-'], 500, true);
  assert.equal(lessons.canUnlock(progress), false);
  // Keep typing T- correctly: its recency-weighted accuracy should recover and stop
  // permanently blocking every future unlock, the way a lifetime average would.
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['T-'], 500, true);
  assert.equal(lessons.keyAccuracy(progress, 'T-') >= lessons.KEY_ACCURACY_TARGET, true);
  assert.equal(lessons.canUnlock(progress), true);
});

test('totalTyped only ever grows, even across unlocks that reset the judging window', () => {
  const progress = typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE);
  assert.equal(progress.totalTyped, lessons.LESSON_SIZE);
  lessons.unlockIfReady(progress);
  assert.equal(progress.words.length, 0);
  assert.equal(progress.totalTyped, lessons.LESSON_SIZE);
  typeWords(progress, 5);
  assert.equal(progress.totalTyped, lessons.LESSON_SIZE + 5);
});

test('isRewind flags a pasted save with less play than what is already here', () => {
  const ahead = typeWords(lessons.emptyProgress(), 50);
  const behind = typeWords(lessons.emptyProgress(), 10);
  assert.equal(lessons.isRewind(ahead, behind), true);
  assert.equal(lessons.isRewind(behind, ahead), false);
  assert.equal(lessons.isRewind(ahead, ahead), false);
});

test('unlockIfReady adds one key and starts the word count again', () => {
  const progress = typeWords(lessons.emptyProgress(), lessons.LESSON_SIZE);
  assert.equal(lessons.unlockIfReady(progress), true);
  assert.equal(progress.unlocked, lessons.START_KEYS + 1);
  assert.deepEqual(progress.words, []);
  assert.equal(lessons.unlockIfReady(progress), false);
});

test('recordLesson keeps a capped history of finished lessons for the streak summary', () => {
  const progress = lessons.emptyProgress();
  for (let i = 0; i < 15; i++) lessons.recordLesson(progress, { accuracy: 0.9, wpm: 40 });
  assert.equal(progress.lessonHistory.length, 10);
});

test('startLesson returns up to LESSON_SIZE words', () => {
  const progress = lessons.emptyProgress();
  for (let i = lessons.START_KEYS; i < lessons.KEY_ORDER.length; i++) progress.unlocked = i + 1;
  const lesson = lessons.startLesson(words, progress, slotIndex, { random: () => 0.3 });
  assert.ok(lesson.length > 0 && lesson.length <= lessons.LESSON_SIZE);
});

test('focusKey is the unlocked key that needs the most practice', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 6; i++) lessons.recordChord(progress, [name], 600, true);
  }
  lessons.recordChord(progress, ['S-'], 5000, false);
  assert.equal(lessons.focusKey(progress), 'S-');
});

test('focusKey picks a key that is fast but often wrong over one that is merely slower', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 6; i++) lessons.recordChord(progress, [name], 600, true);
  }
  // S- is fast (would read as fully confident on speed alone) but wrong often enough that
  // its own accuracy sits below the unlock gate: this is the real thing blocking unlock,
  // not a key that is merely a bit slower than the others.
  for (let i = 0; i < 10; i++) lessons.recordChord(progress, ['S-'], 400, i % 5 !== 0);
  assert.equal(lessons.keyAccuracy(progress, 'S-') < lessons.KEY_ACCURACY_TARGET, true);
  assert.equal(lessons.focusKey(progress), 'S-');
});

test('pickWords only uses words with a stroke made from unlocked keys', () => {
  const progress = lessons.emptyProgress();
  const picked = lessons.pickWords(words, progress, slotIndex, { random: () => 0.5 });
  const mask = lessons.unlockedMask(progress, slotIndex);
  assert.ok(picked.length > 0);
  for (const word of picked) {
    assert.ok(lessons.usableVariants(word, mask).length > 0, `${word.text} is typeable`);
  }
  assert.ok(!picked.some((word) => word.text === 'strength'), 'needs keys not yet unlocked');
});

test('a word counts if any of its strokes can be typed with unlocked keys', () => {
  const and = words.find((word) => word.text === 'and');
  assert.equal(and.variants.length, 2, 'Plover has two strokes for "and" here');
  const mask = lessons.unlockedMask(lessons.emptyProgress(), slotIndex);
  // STK uses only unlocked keys, -PB does not
  assert.equal(lessons.usableVariants(and, mask).length, 1);
});

test('displayVariants never shows a stroke with a locked key, and puts the fewest keys first', () => {
  const and = words.find((word) => word.text === 'and');
  const early = lessons.unlockedMask(lessons.emptyProgress(), slotIndex);
  const shown = lessons.displayVariants(and, early);
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], steno.parseStroke('STK'));

  const all = (2 ** steno.SLOTS.length) - 1;
  const late = lessons.displayVariants(and, all);
  assert.equal(late.length, 2);
  assert.equal(late[0][0], steno.parseStroke('-PB'), 'two keys beat three keys');

  for (const word of words) {
    for (const strokes of lessons.displayVariants(word, early)) {
      for (const bits of strokes) assert.equal(bits & ~early, 0, `${word.text} uses only unlocked keys`);
    }
  }
});

test('pickWords returns distinct words and respects the count', () => {
  const progress = lessons.emptyProgress();
  for (let i = lessons.START_KEYS; i < lessons.KEY_ORDER.length; i++) progress.unlocked = i + 1;
  const picked = lessons.pickWords(words, progress, slotIndex, { random: () => 0.3, count: 4 });
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked.map((word) => word.text)).size, 4);
});

test('pickWords returns nothing when no word fits the unlocked keys', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 1;
  const strength = words.find((word) => word.text === 'strength');
  assert.deepEqual(lessons.pickWords([strength], progress, slotIndex), []);
});

test('pickWords skips recently typed words when it can', () => {
  const progress = lessons.emptyProgress();
  for (let i = lessons.START_KEYS; i < lessons.KEY_ORDER.length; i++) progress.unlocked = i + 1;
  const avoid = ['cat', 'test', 'and'];
  const picked = lessons.pickWords(words, progress, slotIndex, { random: () => 0.1, count: 3, avoid });
  assert.ok(!picked.some((word) => avoid.includes(word.text)));
});

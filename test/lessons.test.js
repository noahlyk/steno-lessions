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
    chords: {
      'A-': { samples: 2, ewmaMs: 900, misses: 1 },
      'T-+P-+H-': { samples: 4, ewmaMs: 700, misses: 0 },
      NOPE: { samples: 9 },
      'P-+T-': { samples: 9 },
      'T-+-T': { samples: 9 },
    },
    words: [{ ms: 800, strokes: 2, misses: 0 }, { ms: 'x' }],
  });
  assert.equal(progress.unlocked, lessons.KEY_ORDER.length);
  assert.deepEqual(progress.chords['A-'], { samples: 2, ewmaMs: 900, misses: 1, recent: [], probeRecent: [] });
  assert.equal(progress.chords['T-+P-+H-'].samples, 4, 'a compound chord is kept');
  assert.deepEqual(Object.keys(progress.chords).sort(), ['A-', 'T-+P-+H-'], 'junk, out-of-order and mixed-hand ids are dropped');
  assert.deepEqual(progress.words, [{ ms: 800, strokes: 2, misses: 0 }]);
});

test('a miss slows a key down rather than counting as a sample', () => {
  const progress = lessons.emptyProgress();
  lessons.recordChord(progress, ['T-'], 500, false);
  assert.equal(progress.chords['T-'].samples, 0);
  assert.equal(progress.chords['T-'].misses, 1);
  assert.ok(progress.chords['T-'].ewmaMs > 500);
});

test('the words-per-minute target is 28 on every level', () => {
  for (const level of [1, 2, 3]) assert.equal(lessons.wpmTarget(level), 28);
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
  assert.equal(lessons.chordAccuracy(progress, 'T-') < lessons.CHORD_ACCURACY_TARGET, true);
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
  assert.equal(lessons.chordAccuracy(progress, 'T-') >= lessons.CHORD_ACCURACY_TARGET, true);
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

test('focusChord is the unlocked key that needs the most practice', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 6; i++) lessons.recordChord(progress, [name], 600, true);
  }
  lessons.recordChord(progress, ['S-'], 5000, false);
  assert.equal(lessons.focusChord(progress), 'S-');
});

test('focusChord picks a key that is fast but often wrong over one that is merely slower', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 6; i++) lessons.recordChord(progress, [name], 600, true);
  }
  // S- is fast (would read as fully confident on speed alone) but wrong often enough that
  // its own accuracy sits below the unlock gate: this is the real thing blocking unlock,
  // not a key that is merely a bit slower than the others.
  for (let i = 0; i < 10; i++) lessons.recordChord(progress, ['S-'], 400, i % 3 !== 0);
  assert.equal(lessons.chordAccuracy(progress, 'S-') < lessons.CHORD_ACCURACY_TARGET, true);
  assert.equal(lessons.focusChord(progress), 'S-');
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

test('chordWeakness treats an unseen chord as unknown, not failed, and keeps a young chord there during its grace period even if confidence already reads high', () => {
  const progress = lessons.emptyProgress();
  assert.equal(lessons.chordWeakness(progress, 'A-'), lessons.UNSEEN_WEAKNESS, 'never attempted');
  for (let i = 0; i < 5; i++) lessons.recordChord(progress, ['A-'], 400, true);
  assert.ok(lessons.confidence(progress, 'A-') > 0.9, 'confidence alone already reads as high');
  assert.equal(lessons.chordWeakness(progress, 'A-'), lessons.UNSEEN_WEAKNESS, 'still within its grace period');
  for (let i = 0; i < lessons.CHORD_GRACE_SAMPLES; i++) lessons.recordChord(progress, ['A-'], 400, true);
  assert.equal(lessons.chordWeakness(progress, 'A-'), 0, 'grace period has elapsed, real accuracy now counts');
});

test('a young chord that is already being missed reads as weaker than an unseen one', () => {
  const progress = lessons.emptyProgress();
  for (let i = 0; i < 6; i++) lessons.recordChord(progress, ['T-+P-+H-'], 500, i % 2 === 0);
  assert.ok(lessons.chordWeakness(progress, 'T-+P-+H-') > lessons.UNSEEN_WEAKNESS);
});

test('pickWords weighs every unlocked key\'s own weakness, not just a single focus key', () => {
  const progress = lessons.emptyProgress();
  // K- is long mastered; A- has never been attempted. Both are unlocked (within START_KEYS),
  // so neither is forced into the etude path - this is the plain weighting pickWords itself
  // does, which used to only ever boost the single globally-weakest ("focus") key by a flat
  // amount. Here two equally-weighted (length, stroke count, unknown-word frequency) made-up
  // words differ only in which key their stroke uses.
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['K-'], 400, true);
  const touchesUnknownKey = { text: 'zzzz', variants: [[1 << slotIndex.get('A-')]] };
  const touchesMasteredKey = { text: 'yyyy', variants: [[1 << slotIndex.get('K-')]] };
  const picked = lessons.pickWords([touchesUnknownKey, touchesMasteredKey], progress, slotIndex, {
    random: () => 0.5,
    count: 1,
  });
  assert.equal(picked[0].text, 'zzzz', 'the word touching the still-unknown key should win the tie');
});

test('chordWeakness reacts to the raw accuracy deficit, not the target-normalized/speed-coupled confidence metric', () => {
  const progress = lessons.emptyProgress();
  // 18 correct, 12 wrong, well past the grace period - a key reading as 60% recently accurate
  // while comfortably fast, mirroring a real "struggling but not catastrophic" key. confidence
  // would read this as 0.75 (accuracy capped at accuracy/CHORD_ACCURACY_TARGET); chordWeakness
  // should read the real 40% error rate instead.
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['-F'], 400, i % 5 !== 0 && i % 5 !== 1);
  assert.equal(lessons.chordAccuracy(progress, '-F'), 0.6);
  assert.ok(lessons.confidence(progress, '-F') > 0.7, 'confidence alone reads this as much healthier than it is');
  assert.equal(lessons.chordWeakness(progress, '-F'), 0.4);
});

test('a key at 60% accuracy pulls meaningfully more word-selection weight than one at 90%+, not just a token amount', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = lessons.KEY_ORDER.length; // both -F and A- need to be unlocked to be eligible
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['-F'], 400, i % 5 !== 0 && i % 5 !== 1); // 60%
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['A-'], 400, i !== 0 && i !== 1 && i !== 2); // 90%
  const touchesWeakKey = { text: 'zzzz', variants: [[1 << slotIndex.get('-F')]] };
  const touchesSolidKey = { text: 'yyyy', variants: [[1 << slotIndex.get('A-')]] };
  const picked = lessons.pickWords([touchesWeakKey, touchesSolidKey], progress, slotIndex, {
    random: () => 0.5,
    count: 1,
  });
  assert.equal(picked[0].text, 'zzzz', 'the clearly-weaker key should win the tie, not just edge it out');
});

test('weaknessBoost is keyed to a word\'s single weakest chord, not a product that compounds with how many chords it uses', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = lessons.KEY_ORDER.length;
  // -F is weak (60%); every other chord here is comfortably solid (90%+). A real word often
  // has several chords across its strokes - none of those extra solid chords being merely
  // "pretty good" should multiply the boost up just because there are more of them, which is
  // what a product-over-every-chord formula did (it flooded the stream with words that had
  // no actual relevance to any weak chord).
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['-F'], 400, i % 5 !== 0 && i % 5 !== 1); // 60%
  for (const id of ['S-', 'K-+W-+R-', 'A-', '-T', 'T-']) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [id], 400, i !== 0 && i !== 1 && i !== 2); // 90%
  }
  const bits = (...names) => names.reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
  const weakAlone = bits('-F');
  const weakAmongSolid = [bits('S-', 'A-', '-F'), bits('K-', 'W-', 'R-', '-T'), bits('T-')];
  assert.equal(
    lessons.weaknessBoost(progress, weakAmongSolid, slotIndex),
    lessons.weaknessBoost(progress, weakAlone, slotIndex),
    'adding several solid chords alongside the one weak chord must not change its boost',
  );
  const solidAlone = [bits('S-')];
  const manySolid = [bits('S-', 'A-'), bits('K-', 'W-', 'R-', '-T'), bits('T-')];
  assert.equal(
    lessons.weaknessBoost(progress, manySolid, slotIndex),
    lessons.weaknessBoost(progress, solidAlone, slotIndex),
    'several equally-solid chords together must not compound into a bigger boost than one alone',
  );
});

test('complexityScore/complexityBand read the focus key\'s own confidence as the etude<->concerto dial', () => {
  const progress = lessons.emptyProgress();
  // Fresh progress: no samples anywhere yet, so the focus key has 0 confidence - etude band.
  assert.equal(lessons.complexityScore(progress), 0);
  assert.equal(lessons.complexityBand(lessons.complexityScore(progress)), 'etude');
  assert.equal(lessons.complexityBand(lessons.ETUDE_MAX), 'study');
  assert.equal(lessons.complexityBand(lessons.CONCERTO_MIN), 'concerto');
});

test('nextWord in the etude band only uses the focus key plus already-mastered keys, and keeps it short', () => {
  const progress = lessons.emptyProgress();
  // Make every unlocked key but S- fully mastered, so S- is the lone, unmastered focus key.
  for (const name of lessons.unlockedNames(progress)) {
    if (name === 'S-') continue;
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 500, true);
  }
  assert.equal(lessons.focusChord(progress), 'S-');
  const word = lessons.nextWord(words, progress, slotIndex, { random: () => 0.2 });
  assert.equal(word.band, 'etude');
  assert.ok(word.text.length <= 3, `${word.text} should be short in the etude band`);
});

test('nextWord in the concerto band favors words that recombine the most-recently-unlocked keys', () => {
  const progress = lessons.emptyProgress();
  for (let i = lessons.START_KEYS; i < lessons.KEY_ORDER.length; i++) progress.unlocked = i + 1;
  // Every unlocked key fully mastered and fast, so the focus key's confidence sits in the
  // concerto band regardless of which key it lands on.
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  const word = lessons.nextWord(words, progress, slotIndex, { random: () => 0.1 });
  assert.equal(word.band, 'concerto');
});

test('nextWord forces the etude band on request, for scheduled diagnostic probes', () => {
  const progress = lessons.emptyProgress();
  for (let i = lessons.START_KEYS; i < lessons.KEY_ORDER.length; i++) progress.unlocked = i + 1;
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  const word = lessons.nextWord(words, progress, slotIndex, { random: () => 0.1, forceBand: 'etude', isProbe: true });
  assert.equal(word.band, 'etude');
  assert.equal(word.isProbe, true);
});

test('masteryTier needs the full rolling window and sustained confidence, not just a short streak', () => {
  const progress = lessons.emptyProgress();
  assert.equal(lessons.masteryTier(progress, 'T-'), 0);
  lessons.recordChord(progress, ['T-'], 500, true);
  assert.equal(lessons.masteryTier(progress, 'T-'), 0, 'a single rep is not sustained yet');
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['T-'], 500, true);
  assert.equal(lessons.masteryTier(progress, 'T-'), 2);
});

test('a handful of reps on a freshly unlocked key reads as 0, even surrounded by long-mastered keys', () => {
  // Regression test: confidence alone can read as high after only a few reps (its own
  // samples ramp tops out at SAMPLES_TO_LEARN), which used to let a scaffold fade within the
  // first few words after a new key unlocked for anyone with real history on the *other*
  // keys - masteryTier must require the newly-unlocked key's own full rolling window, not
  // just a high instantaneous confidence score.
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    if (name === 'S-') continue;
    for (let i = 0; i < 300; i++) lessons.recordChord(progress, [name], 400, true);
  }
  for (let i = 0; i < 6; i++) lessons.recordChord(progress, ['S-'], 400, true);
  assert.ok(lessons.confidence(progress, 'S-') > 0.6, 'confidence alone already reads as high');
  assert.equal(lessons.masteryTier(progress, 'S-'), 0, 'but the key itself is not actually sustained yet');
  assert.equal(lessons.scaffoldTier(progress), 0);
});

test('scaffoldVisible is exactly the checkbox, with no waiting on mastery', () => {
  const fresh = lessons.emptyProgress();
  assert.equal(lessons.scaffoldVisible(fresh, 'labels', false), false);
  assert.equal(lessons.scaffoldVisible(fresh, 'keyboard', false), false);
  assert.equal(lessons.scaffoldVisible(fresh, 'target', true), true);
});

test('levelFor: visual aids are 1, stroke helpers only are 2, nothing is 3', () => {
  const off = { labels: false, target: false, keyboard: false };
  assert.equal(lessons.levelFor(off, false), 3);
  assert.equal(lessons.levelFor(off, true), 1);
  assert.equal(lessons.levelFor({ ...off, keyboard: true }, false), 1);
  assert.equal(lessons.levelFor({ ...off, labels: true }, false), 2);
  assert.equal(lessons.levelFor({ ...off, target: true }, false), 2);
  assert.equal(lessons.levelFor({ labels: true, target: true, keyboard: true }, false), 1);
});

test('switchLevel starts the new level fresh and restores the old one when you return', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 12;
  lessons.recordChord(progress, ['T-'], 400, true);
  assert.equal(lessons.switchLevel(progress, 2), true);
  assert.equal(progress.level, 2);
  assert.equal(progress.unlocked, lessons.START_KEYS);
  assert.deepEqual(progress.chords, {});
  progress.unlocked = 8;
  assert.equal(lessons.switchLevel(progress, 2), false, 'already there');
  assert.equal(lessons.switchLevel(progress, 1), true);
  assert.equal(progress.unlocked, 12);
  assert.equal(progress.chords['T-'].samples, 1);
  assert.equal(lessons.switchLevel(progress, 2), true);
  assert.equal(progress.unlocked, 8, 'level 2 progress was kept too');
});

test('level and the other level\'s stash survive normalize', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 15;
  lessons.switchLevel(progress, 2);
  const back = lessons.normalize(JSON.parse(JSON.stringify(progress)));
  assert.equal(back.level, 2);
  assert.equal(back.stash[1].unlocked, 15);
  assert.equal(lessons.normalize({ level: 9 }).level, 1);
});

test('levelSummary reports every level: the active one live, the others from the stash', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = lessons.KEY_ORDER.length;
  lessons.switchLevel(progress, 2);
  progress.unlocked = 10;
  const [one, two, three] = lessons.levelSummary(progress);
  assert.deepEqual([one.wpm, two.wpm, three.wpm], [28, 28, 28]);
  assert.equal(one.allUnlocked, true);
  assert.equal(one.done, false, "unlocking every key is not completing the level");
  assert.equal(one.active, false);
  assert.equal(two.active, true);
  assert.equal(two.unlocked, 10);
  assert.equal(two.done, false);
  assert.equal(three.started, false);
  assert.equal(three.unlocked, lessons.START_KEYS);
});

test('a level is only complete after every key is unlocked and a fresh lesson hits the targets', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = lessons.KEY_ORDER.length - 1;
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 10; i++) lessons.recordChord(progress, [name], 400, true);
  }
  for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms: 1500, strokes: 1, misses: 0 });
  assert.equal(lessons.completeIfReady(progress), false, 'last key not unlocked yet');
  assert.equal(lessons.unlockIfReady(progress), true);
  assert.equal(progress.unlocked, lessons.KEY_ORDER.length);
  assert.equal(lessons.completeIfReady(progress), false, 'unlocking the last key does not complete the level');
  assert.equal(lessons.levelSummary(progress)[0].done, false);
  for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms: 3000, strokes: 1, misses: 0 });
  assert.equal(lessons.completeIfReady(progress), false, 'too slow');
  for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms: 1500, strokes: 1, misses: 0 });
  assert.equal(lessons.completeIfReady(progress), true);
  assert.equal(lessons.levelSummary(progress)[0].done, true);
  assert.equal(lessons.completeIfReady(progress), false, 'only reports the moment it is earned');
  const back = lessons.normalize(JSON.parse(JSON.stringify(progress)));
  assert.equal(back.completed[1], true);
  lessons.switchLevel(back, 2);
  assert.equal(lessons.levelSummary(back)[0].done, true, 'stays earned while on another level');
});

test('unlocking needs 28 wpm on every level', () => {
  const progress = lessons.emptyProgress();
  progress.level = 2;
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 10; i++) lessons.recordChord(progress, [name], 400, true);
  }
  for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms: 1800, strokes: 1, misses: 0 }); // ~33 wpm
  assert.equal(lessons.canUnlock(progress), true);
  for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms: 3000, strokes: 1, misses: 0 }); // ~20 wpm
  for (const level of [1, 2, 3]) {
    progress.level = level;
    assert.equal(lessons.canUnlock(progress), false);
  }
});

test('scaffolds default to on for a fresh profile and for an old save that predates the field', () => {
  assert.deepEqual(lessons.emptyProgress().scaffolds, { labels: true, target: true, keyboard: true });
  const oldSave = lessons.normalize({ unlocked: 10 });
  assert.deepEqual(oldSave.scaffolds, { labels: true, target: true, keyboard: true });
});

test('normalize round-trips scaffold preferences, ignoring garbage values', () => {
  const normalized = lessons.normalize({ scaffolds: { labels: false, target: 'nonsense', bogusField: false } });
  assert.deepEqual(normalized.scaffolds, { labels: false, target: true, keyboard: true });
});

test('scaffoldRedoMastered needs fresh practice since the mark, not just current mastery', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  assert.equal(lessons.scaffoldTier(progress), 2, 'already mastered before the scaffold ever goes off');
  lessons.recordScaffoldOff(progress, 'labels');
  assert.equal(
    lessons.scaffoldRedoMastered(progress, 'labels'),
    false,
    'mastered before the mark, not since it - must not count as an instant redo',
  );
  // Fresh reps on every key, enough to clear both the sample and attempt-window bars.
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  assert.equal(lessons.scaffoldRedoMastered(progress, 'labels'), true);
  // An unrelated stage's mark is untouched - redoing it for 'labels' doesn't grant 'target'.
  assert.equal(lessons.scaffoldRedoMastered(progress, 'target'), false);
});

test('scaffoldRedoMastered stays false if a key slips back under tier 2, even with enough fresh reps', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  lessons.recordScaffoldOff(progress, 'keyboard');
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  // One key goes bad after the fresh redo - a slow, missed rep on S- alone.
  for (let i = 0; i < 30; i++) lessons.recordChord(progress, ['S-'], 3000, false);
  assert.equal(lessons.masteryTier(progress, 'S-'), 0);
  assert.equal(lessons.scaffoldRedoMastered(progress, 'keyboard'), false);
});

test('recordScaffoldOff resets the baseline on every call; ensureScaffoldMark only fills a missing one', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  lessons.recordScaffoldOff(progress, 'target');
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 400, true);
  }
  assert.equal(lessons.scaffoldRedoMastered(progress, 'target'), true, 'first redo period earned it');
  // ensureScaffoldMark must not disturb an existing mark (it's for migrating old saves only).
  lessons.ensureScaffoldMark(progress, 'target');
  assert.equal(lessons.scaffoldRedoMastered(progress, 'target'), true, 'ensureScaffoldMark left the earned mark alone');
  // A genuine re-toggle (recordScaffoldOff again) must reset it - re-checking the box and
  // unchecking it again should require redoing the mastery, not grandfather the old one in.
  lessons.recordScaffoldOff(progress, 'target');
  assert.equal(lessons.scaffoldRedoMastered(progress, 'target'), false, 'a fresh toggle-off restarts the redo clock');
});

test('normalize round-trips scaffoldMarks, ignoring garbage values', () => {
  const normalized = lessons.normalize({
    scaffoldMarks: {
      labels: { 'A-': { samples: 5, misses: 2 }, bogus: { samples: 1, misses: 0 } },
      junkStage: { 'A-': { samples: 1, misses: 0 } },
      target: 'nonsense',
    },
  });
  assert.deepEqual(normalized.scaffoldMarks.labels, { 'A-': { samples: 5, misses: 2 } });
  assert.deepEqual(normalized.scaffoldMarks.junkStage, { 'A-': { samples: 1, misses: 0 } });
  assert.equal(normalized.scaffoldMarks.target, undefined);
});

test('scaffoldTier is the minimum mastery tier across every unlocked key', () => {
  const progress = lessons.emptyProgress();
  for (const name of lessons.unlockedNames(progress)) {
    for (let i = 0; i < 30; i++) lessons.recordChord(progress, [name], 500, true);
  }
  assert.equal(lessons.scaffoldTier(progress), 2);
  // One under-practiced key holds the whole fade back, even though every other key is sustained.
  progress.chords['S-'] = { samples: 1, ewmaMs: 2000, misses: 0, recent: [], probeRecent: [] };
  assert.equal(lessons.masteryTier(progress, 'S-'), 0);
  assert.equal(lessons.scaffoldTier(progress), 0);
});

test('kinematicGap flags a key whose isolated probe reps are not substantially faster than blended practice', () => {
  const progress = lessons.emptyProgress();
  for (let i = 0; i < 10; i++) lessons.recordChord(progress, ['T-'], 1000, true);
  // Healthy: probes comfortably faster than blended speed.
  for (let i = 0; i < 5; i++) lessons.recordProbe(progress, 'T-', 700);
  assert.equal(lessons.kinematicGap(progress, 'T-') > lessons.HEALTHY_PROBE_GAP, true);
  // Unhealthy: probes no faster (or slower) than blended speed - complexity isn't the
  // bottleneck, raw technique is.
  const stuck = lessons.emptyProgress();
  for (let i = 0; i < 10; i++) lessons.recordChord(stuck, ['T-'], 1000, true);
  for (let i = 0; i < 5; i++) lessons.recordProbe(stuck, 'T-', 980);
  assert.equal(lessons.kinematicGap(stuck, 'T-') <= lessons.HEALTHY_PROBE_GAP, true);
});

test('all three levels keep separate progress through any order of switching and a save round-trip', () => {
  let progress = lessons.emptyProgress();
  const set = (level, unlocked) => {
    lessons.switchLevel(progress, level);
    progress.unlocked = unlocked;
    lessons.recordChord(progress, ['T-'], 400, true);
  };
  set(1, 20);
  set(2, 10);
  set(3, 7);
  progress = lessons.normalize(JSON.parse(JSON.stringify(progress)));
  for (const [level, unlocked] of [[2, 10], [1, 20], [3, 7], [1, 20], [2, 10]]) {
    lessons.switchLevel(progress, level);
    assert.equal(progress.unlocked, unlocked, `level ${level} unlocked`);
    assert.equal(progress.chords['T-'].samples, 1, `level ${level} stats`);
  }
});

test('pickWords requireMask only returns words that use a masked key', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 6;
  const picked = lessons.pickWords(words, progress, slotIndex, { count: 5, requireMask: 1 << slotIndex.get('-T') });
  assert.ok(picked.length > 0);
  for (const word of picked) assert.ok(['cat', 'at'].includes(word.text), word.text);
});

test('nextWord drills a chord stuck below the accuracy bar', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 6;
  for (const name of lessons.KEY_ORDER.slice(0, 6)) {
    for (let i = 0; i < 40; i++) lessons.recordChord(progress, [name], 300, name === '-T' ? i % 3 !== 0 : true);
  }
  // STK is one chord (S-T-K-), so it has to have been practiced for the comparison to be fair.
  for (let i = 0; i < 40; i++) lessons.recordChord(progress, ['S-+T-+K-'], 300, true);
  let hits = 0;
  for (let i = 0; i < 200; i++) {
    if (['cat', 'at'].includes(lessons.nextWord(words, progress, slotIndex).text)) hits++;
  }
  assert.ok(hits >= 100, `drilled ${hits}/200`);
});

test('nextWord does not repeat the word just typed when the key set is tiny', () => {
  const progress = lessons.emptyProgress();
  progress.unlocked = 6;
  const recent = [];
  for (let i = 0; i < 30; i++) {
    const word = lessons.nextWord(words, progress, slotIndex, { avoid: recent });
    assert.notEqual(word.text, recent[recent.length - 1]);
    recent.push(word.text);
  }
});

test('a prestige personal best is one whole lesson, kept only while every key is unlocked', () => {
  const progress = lessons.emptyProgress();
  const lesson = (ms, misses = 0) => {
    for (let i = 0; i < lessons.LESSON_SIZE; i++) lessons.recordWord(progress, { ms, strokes: 1, misses });
    return lessons.windowStats(progress);
  };
  assert.equal(lessons.recordBestIfFaster(progress, lesson(1000)), null, 'keys still locked');
  progress.unlocked = lessons.KEY_ORDER.length;
  progress.words = [];
  assert.equal(lessons.recordBestIfFaster(progress, lesson(2000)), 30);
  assert.equal(lessons.recordBestIfFaster(progress, lesson(2000)), null, 'same speed is not a new best');
  assert.equal(lessons.recordBestIfFaster(progress, lesson(3000)), null, 'slower is not a new best');
  assert.equal(lessons.recordBestIfFaster(progress, lesson(1500)), 40);
  assert.equal(lessons.levelSummary(progress)[0].best, 40);
  const partial = { count: lessons.LESSON_SIZE - 1, wpm: 90, accuracy: 1 };
  assert.equal(lessons.recordBestIfFaster(progress, partial), null, 'not a whole lesson');
  assert.equal(lessons.recordBestIfFaster(progress, lesson(1000, 5)), null, 'below the accuracy bar');
  const back = lessons.normalize(JSON.parse(JSON.stringify(progress)));
  assert.equal(back.bests[1], 40);
  lessons.switchLevel(back, 2);
  assert.equal(lessons.levelSummary(back)[0].best, 40, 'kept while on another level');
  assert.equal(lessons.levelSummary(back)[1].best, null);
});

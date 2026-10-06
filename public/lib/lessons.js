// Lesson engine in the style of keybr: start with a few steno keys, practice words that
// use only those keys, and unlock one more key each lesson once the keys you have are
// typed fast and accurately. Pure functions only, so it runs in the page and in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StenoLessons = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Order keys are introduced in: the vowels and the most common consonant sounds
  // first, then the rest of the left hand, the right hand, and finally the star and
  // number keys. Names are keymux's config names.
  const KEY_ORDER = [
    '-E', 'A-', 'T-', 'S-', 'K-', '-T', '-S', 'R-', '-R', 'H-', 'O-', 'P-',
    'W-', '-U', '-L', '-D', '-P', '-B', '-G', '-F', '*', '-Z', '#',
  ];
  const START_KEYS = 6;
  const LESSON_WORDS = 10;
  // A stroke that takes this long or less is "fast" for one key (ms, from the first
  // key pressed to the last key released).
  const TARGET_MS = 1200;
  // Samples needed before a key can count as learned.
  const SAMPLES_TO_LEARN = 5;
  // A key counts as learned at this confidence, between 0 and 1.
  const LEARNED = 0.9;
  // Time added to a stroke's average for each miss on it.
  const MISS_PENALTY_MS = 800;
  // Longest word a lesson will use.
  const MAX_WORD_LENGTH = 9;

  function lengthWeight(length) {
    if (length <= 1) return 0.2;
    if (length === 2) return 0.6;
    if (length <= 6) return 1;
    return 0.6;
  }

  function strokeWeight(strokes) {
    if (strokes === 1) return 2;
    if (strokes === 2) return 1;
    return 0.3;
  }

  function emptyProgress() {
    return { unlocked: START_KEYS, keys: {}, lessons: 0 };
  }

  // Keeps only the fields the engine understands, so an old or damaged save still loads.
  function normalize(saved) {
    const progress = emptyProgress();
    if (!saved || typeof saved !== 'object') return progress;
    if (Number.isInteger(saved.unlocked)) {
      progress.unlocked = Math.min(Math.max(saved.unlocked, 1), KEY_ORDER.length);
    }
    if (Number.isInteger(saved.lessons) && saved.lessons >= 0) progress.lessons = saved.lessons;
    if (saved.keys && typeof saved.keys === 'object') {
      for (const name of KEY_ORDER) {
        const stat = saved.keys[name];
        if (!stat || typeof stat !== 'object') continue;
        progress.keys[name] = {
          samples: Math.max(0, Number(stat.samples) || 0),
          ewmaMs: typeof stat.ewmaMs === 'number' ? stat.ewmaMs : null,
          misses: Math.max(0, Number(stat.misses) || 0),
        };
      }
    }
    return progress;
  }

  function unlockedNames(progress) {
    return KEY_ORDER.slice(0, progress.unlocked);
  }

  // Records one chord: `names` are the steno keys it pressed, `ms` how long it took.
  // A miss adds a penalty to the average rather than counting as a sample.
  function recordChord(progress, names, ms, correct) {
    for (const name of names) {
      const stat = progress.keys[name] || { samples: 0, ewmaMs: null, misses: 0 };
      const cost = correct ? ms : ms + MISS_PENALTY_MS;
      stat.ewmaMs = stat.ewmaMs === null ? cost : stat.ewmaMs * 0.7 + cost * 0.3;
      if (correct) {
        stat.samples += 1;
      } else {
        stat.misses += 1;
      }
      progress.keys[name] = stat;
    }
    return progress;
  }

  // 0 to 1: how well a key is known. Needs samples as well as speed.
  function confidence(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.ewmaMs === null) return 0;
    const enough = Math.min(1, stat.samples / SAMPLES_TO_LEARN);
    const speed = Math.min(1, TARGET_MS / stat.ewmaMs);
    return enough * speed;
  }

  // Unlocks the next key if every unlocked key is learned. Returns true if one was added.
  function unlockIfReady(progress) {
    if (progress.unlocked >= KEY_ORDER.length) return false;
    const ready = unlockedNames(progress).every((name) => confidence(progress, name) >= LEARNED);
    if (!ready) return false;
    progress.unlocked += 1;
    return true;
  }

  // The unlocked key that needs the most practice. Ties go to the one introduced later.
  function focusKey(progress) {
    let focus = null;
    let weakest = Infinity;
    for (const name of unlockedNames(progress)) {
      const score = confidence(progress, name);
      if (score <= weakest) {
        weakest = score;
        focus = name;
      }
    }
    return focus;
  }

  // Bit mask of the unlocked keys, using the same bit order as keymux's slots.
  function unlockedMask(progress, slotIndex) {
    return unlockedNames(progress).reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
  }

  // Picks the words for one lesson. Only words whose every stroke uses unlocked keys are
  // eligible. Words that use the focus key are picked more often, and words the last lesson
  // used are skipped where possible. `random` returns a number in [0, 1).
  function pickLesson(words, progress, slotIndex, options = {}) {
    const random = options.random || Math.random;
    const count = options.count || LESSON_WORDS;
    const avoid = new Set(options.avoid || []);
    const mask = unlockedMask(progress, slotIndex);
    const focus = focusKey(progress);
    const focusBit = focus ? 1 << slotIndex.get(focus) : 0;

    const eligible = words.filter(
      (word) => word.text.length <= MAX_WORD_LENGTH && word.strokes.every((bits) => (bits & ~mask) === 0),
    );
    if (eligible.length === 0) return [];

    const pool = eligible.filter((word) => !avoid.has(word.text));
    const source = pool.length >= count ? pool : eligible;
    const weighted = source.map((word) => {
      // Plover's dictionary has no word frequencies, so prefer words that look common:
      // medium length and one stroke. Rare-looking words are the main thing to avoid.
      let weight = lengthWeight(word.text.length) * strokeWeight(word.strokes.length);
      if (word.strokes.some((bits) => bits & focusBit)) weight *= 4;
      return { word, weight };
    });

    const chosen = [];
    const taken = new Set();
    while (chosen.length < count && taken.size < weighted.length) {
      const open = weighted.filter(({ word }) => !taken.has(word.text));
      const total = open.reduce((sum, item) => sum + item.weight, 0);
      let roll = random() * total;
      let picked = open[open.length - 1];
      for (const item of open) {
        roll -= item.weight;
        if (roll < 0) {
          picked = item;
          break;
        }
      }
      taken.add(picked.word.text);
      chosen.push(picked.word);
    }
    return chosen;
  }

  return {
    KEY_ORDER,
    START_KEYS,
    LESSON_WORDS,
    TARGET_MS,
    LEARNED,
    emptyProgress,
    normalize,
    unlockedNames,
    recordChord,
    confidence,
    unlockIfReady,
    focusKey,
    unlockedMask,
    pickLesson,
  };
});

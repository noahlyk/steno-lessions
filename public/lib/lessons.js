// Lesson engine: start with a few steno keys, practice words that use only those keys, and
// unlock one more key once you type fast enough and accurately enough. Pure functions only,
// so it runs in the page and in tests.
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
  // Words added to the stream at a time.
  const BATCH_WORDS = 25;
  // Completed words used to judge speed and accuracy before a key can unlock.
  const WORD_WINDOW = 25;
  // Share of strokes that must be right on the first try.
  const ACCURACY_TARGET = 0.95;
  // Completed words kept in the history. Only the newest WORD_WINDOW matter for unlocking.
  const HISTORY_LIMIT = 100;
  // Time added to a stroke's average for each miss on it.
  const MISS_PENALTY_MS = 800;
  // A stroke that takes this long or less is "fast" for one key (ms).
  const TARGET_MS = 1200;
  // Samples needed before a key's speed bar reads as full.
  const SAMPLES_TO_LEARN = 5;
  // Longest word a lesson will use.
  const MAX_WORD_LENGTH = 9;

  // Words per minute needed to unlock the next key. It rises from 30 to 50 as keys are added.
  function wpmTarget(unlocked) {
    return Math.min(50, 30 + 2 * (unlocked - START_KEYS));
  }

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
    return { unlocked: START_KEYS, keys: {}, words: [] };
  }

  // Keeps only the fields the engine understands, so an old or damaged save still loads.
  function normalize(saved) {
    const progress = emptyProgress();
    if (!saved || typeof saved !== 'object') return progress;
    if (Number.isInteger(saved.unlocked)) {
      progress.unlocked = Math.min(Math.max(saved.unlocked, 1), KEY_ORDER.length);
    }
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
    if (Array.isArray(saved.words)) {
      progress.words = saved.words
        .filter((word) => word && Number.isFinite(word.ms) && Number.isFinite(word.strokes) && Number.isFinite(word.misses))
        .slice(-HISTORY_LIMIT);
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

  // Records one completed word: `ms` from its first key to its last, `strokes` strokes
  // typed correctly, `misses` strokes that needed another try.
  function recordWord(progress, { ms, strokes, misses }) {
    progress.words.push({ ms, strokes, misses });
    if (progress.words.length > HISTORY_LIMIT) {
      progress.words.splice(0, progress.words.length - HISTORY_LIMIT);
    }
    return progress;
  }

  // Speed and accuracy over the newest words, since the last unlock. `count` is how many
  // words were used, which can be fewer than WORD_WINDOW early on.
  function windowStats(progress) {
    const recent = progress.words.slice(-WORD_WINDOW);
    const count = recent.length;
    const ms = recent.reduce((sum, word) => sum + word.ms, 0);
    const strokes = recent.reduce((sum, word) => sum + word.strokes, 0);
    const misses = recent.reduce((sum, word) => sum + word.misses, 0);
    return {
      count,
      wpm: ms > 0 ? (count * 60000) / ms : 0,
      accuracy: strokes + misses > 0 ? (strokes + misses - misses) / (strokes + misses) : 1,
    };
  }

  // Whether the newest words are fast and accurate enough to unlock the next key.
  function canUnlock(progress) {
    if (progress.unlocked >= KEY_ORDER.length) return false;
    const stats = windowStats(progress);
    return stats.count >= WORD_WINDOW
      && stats.wpm >= wpmTarget(progress.unlocked)
      && stats.accuracy >= ACCURACY_TARGET;
  }

  // Unlocks the next key if canUnlock says so. Starts counting words again from zero.
  // Returns true if a key was added.
  function unlockIfReady(progress) {
    if (!canUnlock(progress)) return false;
    progress.unlocked += 1;
    progress.words = [];
    return true;
  }

  // 0 to 1: how well a key is known. Shown as the key's bar. Needs samples as well as speed.
  function confidence(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.ewmaMs === null) return 0;
    const enough = Math.min(1, stat.samples / SAMPLES_TO_LEARN);
    const speed = Math.min(1, TARGET_MS / stat.ewmaMs);
    return enough * speed;
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

  // The stroke sequences of a word that use only unlocked keys.
  function usableVariants(word, mask) {
    return word.variants.filter((strokes) => strokes.every((bits) => (bits & ~mask) === 0));
  }

  // Picks words for the stream. Only words with at least one stroke sequence that uses
  // unlocked keys are eligible. Words that use the focus key come up more often, and words
  // in `avoid` (recently typed) are skipped where possible. `random` returns [0, 1).
  function pickWords(words, progress, slotIndex, options = {}) {
    const random = options.random || Math.random;
    const count = options.count || BATCH_WORDS;
    const avoid = new Set(options.avoid || []);
    const mask = unlockedMask(progress, slotIndex);
    const focus = focusKey(progress);
    const focusBit = focus ? 1 << slotIndex.get(focus) : 0;

    const eligible = [];
    for (const word of words) {
      if (word.text.length > MAX_WORD_LENGTH) continue;
      const usable = usableVariants(word, mask);
      if (usable.length > 0) eligible.push({ word, usable });
    }
    if (eligible.length === 0) return [];

    const pool = eligible.filter(({ word }) => !avoid.has(word.text));
    const source = pool.length >= count ? pool : eligible;
    const weighted = source.map(({ word, usable }) => {
      // Plover's dictionary has no word frequencies, so prefer words that look common:
      // medium length and one stroke. Rare-looking words are the main thing to avoid.
      let weight = lengthWeight(word.text.length) * strokeWeight(usable[0].length);
      if (usable.some((strokes) => strokes.some((bits) => bits & focusBit))) weight *= 4;
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
    BATCH_WORDS,
    WORD_WINDOW,
    ACCURACY_TARGET,
    TARGET_MS,
    emptyProgress,
    normalize,
    unlockedNames,
    recordChord,
    recordWord,
    windowStats,
    canUnlock,
    wpmTarget,
    confidence,
    unlockIfReady,
    focusKey,
    unlockedMask,
    usableVariants,
    pickWords,
  };
});

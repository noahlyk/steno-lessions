// Lesson engine: start with a few steno keys, practice words that use only those keys, and
// unlock one more key once you type fast enough and accurately enough. Pure functions only,
// so it runs in the page and in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./word-frequency.js'));
  } else {
    root.StenoLessons = factory(root.StenoWordFreq);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (WordFreq) {
  // Order keys are introduced in: the vowels and the most common consonant sounds
  // first, then the rest of the left hand, the right hand, and finally the star and
  // number keys. Names are keymux's config names.
  const KEY_ORDER = [
    '-E', 'A-', 'T-', 'S-', 'K-', '-T', '-S', 'R-', '-R', 'H-', 'O-', 'P-',
    'W-', '-U', '-L', '-D', '-P', '-B', '-G', '-F', '*', '-Z', '#',
  ];
  const START_KEYS = 6;
  // Words in one lesson: the stream shows exactly this many, and the same count is used to
  // judge speed and accuracy before a key can unlock. The history is cleared on each unlock,
  // so a lesson's words line up exactly with the judging window.
  const LESSON_SIZE = 30;
  // Share of strokes that must be right on the first try.
  const ACCURACY_TARGET = 0.95;
  // Share of attempts on a single chord that must be right before it can gate an unlock.
  // Accuracy is judged per chord, not per key: see "Chord units" below.
  const CHORD_ACCURACY_TARGET = 0.8;
  // Completed words kept in the history. Only the newest LESSON_SIZE matter for unlocking.
  const HISTORY_LIMIT = 100;
  // Time added to a stroke's average for each miss on it.
  const MISS_PENALTY_MS = 800;
  // A stroke that takes this long or less is "fast" for one key (ms).
  const TARGET_MS = 1200;
  // Samples needed before a key's speed bar reads as full.
  const SAMPLES_TO_LEARN = 5;
  // Longest word a lesson will use.
  const MAX_WORD_LENGTH = 9;
  // Finished lessons' accuracy kept for the streak summary.
  const LESSON_HISTORY_LIMIT = 10;
  // Attempts on one chord kept for its rolling accuracy, so the unlock gate reflects recent
  // play (about one lesson's worth) instead of a lifetime total that's nearly impossible to
  // move once a chord has thousands of samples.
  const CHORD_ACCURACY_WINDOW = 30;
  // Chords under this recent accuracy get a reserved share of words that contain them, so a
  // chord stuck below CHORD_ACCURACY_TARGET still gets the reps it needs to climb out.
  const DRILL_ACCURACY = 0.85;
  const DRILL_SHARE = 0.2;
  // When no chord is under DRILL_ACCURACY there is still something to improve: this smaller
  // share goes to whichever practiced chord is relatively weakest (accuracy and speed), so the
  // stream keeps working a weak spot at every level instead of idling once things look fine.
  const STEADY_DRILL_SHARE = 0.15;
  // Attempts needed on a chord before its rolling accuracy can gate an unlock.
  const CHORD_ACCURACY_MIN_SAMPLES = 5;
  // The etude<->concerto complexity slider, 0-100. Below ETUDE_MAX: isolated, minimal-load
  // reps on the focus key alone (an "etude"). Above CONCERTO_MIN: full-length words that
  // deliberately recombine several recently-unlocked keys together (a "concerto"). Between
  // the two: today's normal word picking, unchanged.
  const ETUDE_MAX = 40;
  const CONCERTO_MIN = 75;
  // Longest word an etude-band pick will use - the point is an isolated, minimal-load rep.
  const ETUDE_MAX_LENGTH = 3;
  // How many of the most-recently-unlocked keys a concerto-band pick tries to recombine.
  const RECOMBINE_LAST = 3;
  // Attempts on a key's rolling window needed before its mastery tier can reach 2 (fully
  // sustained), so a lucky short streak can't fade a scaffold prematurely.
  const MASTERY_TIER_1_CONFIDENCE = 0.6;
  const MASTERY_TIER_2_CONFIDENCE = 0.9;
  // Recent probe reps kept per key, for comparing isolated-rep speed against blended speed.
  const PROBE_WINDOW = 10;
  const PROBE_MIN_SAMPLES = 3;
  // How much faster an isolated probe rep should be than blended practice, as a fraction of
  // blended speed. Isolated reps should always be comfortably faster; a gap below this means
  // word complexity is not the real bottleneck - raw chord-formation speed is.
  const HEALTHY_PROBE_GAP = 0.2;
  // How hard word weighting leans toward the single weakest chord unit in a word: at weakness 1
  // (always wrong) a word's weight multiplies by (1 + WEAKNESS_GAIN); at weakness 0 it's
  // untouched. Squared in `weaknessBoost` so the curve favors genuinely extreme weakness much
  // more than merely moderate weakness, instead of scaling linearly with it. Tuned
  // (empirically, against real play data) so a chord sitting around 60% accuracy while
  // everything else is 85%+ lands in roughly the 50% range of words it's eligible for.
  const WEAKNESS_GAIN = 150;
  // Correct reps (recordChord samples) during which a chord is treated as not yet known for
  // word selection, regardless of how fast its measured `confidence` happens to climb.
  // confidence can read near 1 after as few as SAMPLES_TO_LEARN good reps, which is not
  // enough real practice for the chord to have earned losing its selection priority.
  const CHORD_GRACE_SAMPLES = 8;
  // How weak a chord that has never been typed (or is still inside its grace period) counts
  // as: well short of "always wrong", so a chord you are actually failing outranks one you
  // simply have not met yet, but far above a chord that is known.
  const UNSEEN_WEAKNESS = 0.35;

  // Words per minute needed to unlock the next key. A flat bar for every key - per-key
  // accuracy gating (CHORD_ACCURACY_TARGET) is what actually proves a new key is mastered,
  // so a rising speed target on top of that only punished the lesson right after a brand
  // new, still-unfamiliar key was introduced.
  // Per prestige level. 1: any visual aid (keyboard diagram or key hints) may be on.
  // 2: no diagram or hints, but a stroke helper (stroke labels or target highlight) may be on.
  // 3: every helper off, typing from the word alone.
  const LEVEL_WPM = { 1: 28, 2: 28, 3: 28 };
  const MAX_LEVEL = 3;
  function wpmTarget(level = 1) {
    return LEVEL_WPM[level] || LEVEL_WPM[1];
  }

  // The prestige level the current settings put you on. `scaffolds` is progress.scaffolds.
  function levelFor(scaffolds, hintsOn) {
    if (scaffolds.keyboard || hintsOn) return 1;
    if (scaffolds.labels || scaffolds.target) return 2;
    return 3;
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

  // Scaffolds default ON (always shown) - fading is something a learner opts into by
  // unchecking a box, never a surprise sprung on a fresh or imported profile.
  function defaultScaffolds() {
    return { labels: true, target: true, keyboard: true };
  }

  function emptyProgress() {
    return {
      unlocked: START_KEYS,
      // Accuracy and speed per chord unit (see "Chord units"): chord id -> stat.
      chords: {},
      words: [],
      lessonHistory: [],
      totalTyped: 0,
      // Prestige levels finished (level -> true), shared across levels like totalTyped.
      completed: {},
      // Fastest wpm per prestige level (level -> wpm), set only while every key is unlocked.
      bests: {},
      scaffolds: defaultScaffolds(),
      scaffoldMarks: {},
      level: 1,
      // The saved progress of every level you are not on right now (level -> the fields in
      // LEVEL_FIELDS), so going up a level starts fresh and coming back restores it.
      stash: {},
    };
  }

  // The per-level fields of a progress object. Everything else (scaffold checkboxes,
  // totalTyped) is shared across levels.
  const LEVEL_FIELDS = ['unlocked', 'chords', 'words', 'lessonHistory', 'scaffoldMarks'];

  function pickLevelFields(progress) {
    const slice = {};
    for (const field of LEVEL_FIELDS) slice[field] = progress[field];
    return slice;
  }

  // One row per prestige level for the HUD: its wpm bar, how many keys you have unlocked on
  // it, whether you are on it now, and whether every key is unlocked there ("done").
  function levelSummary(progress) {
    const rows = [];
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const active = level === progress.level;
      const slice = active ? progress : progress.stash[level];
      const unlocked = slice ? slice.unlocked : START_KEYS;
      const started = active || Boolean(slice && (slice.unlocked > START_KEYS || Object.keys(slice.chords).length > 0));
      rows.push({
        level,
        wpm: LEVEL_WPM[level],
        unlocked,
        total: KEY_ORDER.length,
        active,
        started,
        allUnlocked: unlocked >= KEY_ORDER.length,
        done: Boolean(progress.completed[level]),
        best: progress.bests[level] || null,
      });
    }
    return rows;
  }

  // Moves to prestige `level`: the current level's progress is set aside and the target
  // level's is loaded (a brand new start if it has none yet). Returns true if it changed.
  function switchLevel(progress, level) {
    if (!LEVEL_WPM[level] || progress.level === level) return false;
    progress.stash[progress.level] = pickLevelFields(progress);
    const next = progress.stash[level] || pickLevelFields(emptyProgress());
    delete progress.stash[level];
    Object.assign(progress, next);
    progress.level = level;
    return true;
  }

  // Keeps only the fields the engine understands, so an old or damaged save still loads.
  function normalize(saved) {
    const progress = emptyProgress();
    if (!saved || typeof saved !== 'object') return progress;
    if (Number.isInteger(saved.unlocked)) {
      progress.unlocked = Math.min(Math.max(saved.unlocked, 1), KEY_ORDER.length);
    }
    // Stats saved before accuracy was judged per chord (`keys`) pooled every stroke a key was
    // part of, so they cannot be split back into chords: they are dropped, not guessed at.
    if (saved.chords && typeof saved.chords === 'object') {
      for (const id of Object.keys(saved.chords)) {
        const stat = saved.chords[id];
        if (!isChordId(id) || !stat || typeof stat !== 'object') continue;
        progress.chords[id] = {
          samples: Math.max(0, Number(stat.samples) || 0),
          ewmaMs: typeof stat.ewmaMs === 'number' ? stat.ewmaMs : null,
          misses: Math.max(0, Number(stat.misses) || 0),
          recent: Array.isArray(stat.recent)
            ? stat.recent.filter((hit) => hit === 0 || hit === 1).slice(-CHORD_ACCURACY_WINDOW)
            : [],
          probeRecent: Array.isArray(stat.probeRecent)
            ? stat.probeRecent.filter((ms) => Number.isFinite(ms) && ms > 0).slice(-PROBE_WINDOW)
            : [],
        };
      }
    }
    if (Array.isArray(saved.words)) {
      progress.words = saved.words
        .filter((word) => word && Number.isFinite(word.ms) && Number.isFinite(word.strokes) && Number.isFinite(word.misses))
        .slice(-HISTORY_LIMIT);
    }
    if (Array.isArray(saved.lessonHistory)) {
      progress.lessonHistory = saved.lessonHistory
        .filter((entry) => entry && Number.isFinite(entry.accuracy) && Number.isFinite(entry.wpm))
        .slice(-LESSON_HISTORY_LIMIT);
    }
    if (saved.scaffolds && typeof saved.scaffolds === 'object') {
      for (const stage of Object.keys(progress.scaffolds)) {
        if (typeof saved.scaffolds[stage] === 'boolean') progress.scaffolds[stage] = saved.scaffolds[stage];
      }
    }
    if (saved.scaffoldMarks && typeof saved.scaffoldMarks === 'object') {
      for (const stage of Object.keys(saved.scaffoldMarks)) {
        const mark = saved.scaffoldMarks[stage];
        if (!mark || typeof mark !== 'object') continue;
        const cleaned = {};
        for (const name of KEY_ORDER) {
          const entry = mark[name];
          if (!entry || typeof entry !== 'object') continue;
          cleaned[name] = { samples: Math.max(0, Number(entry.samples) || 0), misses: Math.max(0, Number(entry.misses) || 0) };
        }
        progress.scaffoldMarks[stage] = cleaned;
      }
    }
    if (Number.isFinite(saved.totalTyped)) {
      progress.totalTyped = Math.max(0, Math.floor(saved.totalTyped));
    }
    if (saved.completed && typeof saved.completed === 'object') {
      for (const level of Object.keys(LEVEL_WPM)) {
        if (saved.completed[level] === true) progress.completed[level] = true;
      }
    }
    if (saved.bests && typeof saved.bests === 'object') {
      for (const level of Object.keys(LEVEL_WPM)) {
        const best = Number(saved.bests[level]);
        if (Number.isFinite(best) && best > 0) progress.bests[level] = best;
      }
    }
    if (Number.isInteger(saved.level) && LEVEL_WPM[saved.level]) progress.level = saved.level;
    if (saved.stash && typeof saved.stash === 'object') {
      for (const level of Object.keys(LEVEL_WPM)) {
        const entry = saved.stash[level];
        if (Number(level) === progress.level || !entry || typeof entry !== 'object') continue;
        progress.stash[level] = pickLevelFields(normalize(entry));
      }
    }
    return progress;
  }

  function unlockedNames(progress) {
    return KEY_ORDER.slice(0, progress.unlocked);
  }

  // ---- Chord units ----
  // Accuracy is judged per chord, not per key. A stroke splits into up to four chord units: the
  // number bar, the left-hand initials, the vowels (with the star) and the right-hand finals. A
  // unit is the exact combination held together in one of those groups, so T-, T-P-H- (the n
  // sound), T-K- and T-H- are four different units with four separate records: how often you get
  // TPH right says nothing about T alone, and vice versa. A unit's id is its key names joined
  // with "+" in steno order; a unit of one key is simply that key's name.
  const LEFT_KEYS = ['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-'];
  const MIDDLE_KEYS = ['A-', 'O-', '*', '-E', '-U'];
  const RIGHT_KEYS = ['-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z'];
  const UNIT_GROUPS = [['#'], LEFT_KEYS, MIDDLE_KEYS, RIGHT_KEYS];
  const KEY_RANK = new Map();
  const KEY_GROUP = new Map();
  UNIT_GROUPS.forEach((group, groupIndex) => {
    for (const name of group) {
      KEY_RANK.set(name, KEY_RANK.size);
      KEY_GROUP.set(name, groupIndex);
    }
  });

  // The chord unit ids a set of key names makes, in steno order (number bar, left, vowels, right).
  function chordUnits(names) {
    const groups = UNIT_GROUPS.map(() => []);
    for (const name of new Set(names)) {
      if (KEY_GROUP.has(name)) groups[KEY_GROUP.get(name)].push(name);
    }
    return groups
      .filter((group) => group.length > 0)
      .map((group) => group.sort((a, b) => KEY_RANK.get(a) - KEY_RANK.get(b)).join('+'));
  }

  // The key names inside a chord unit id.
  function unitKeys(id) {
    return id.split('+');
  }

  // Whether `id` is a chord unit id this engine could have made: real keys, all from one group,
  // in steno order. A damaged save's junk ids are dropped by this.
  function isChordId(id) {
    if (typeof id !== 'string') return false;
    const parts = id.split('+');
    const group = KEY_GROUP.get(parts[0]);
    if (group === undefined) return false;
    return parts.every((name, i) => KEY_GROUP.get(name) === group && (i === 0 || KEY_RANK.get(name) > KEY_RANK.get(parts[i - 1])));
  }

  // The chord units of a stroke mask, cached per mask (a dictionary scan asks about the same
  // few thousand strokes again and again).
  const unitCaches = new WeakMap();
  function unitsOfBits(bits, slotIndex) {
    let cache = unitCaches.get(slotIndex);
    if (!cache) {
      cache = new Map();
      unitCaches.set(slotIndex, cache);
    }
    let ids = cache.get(bits);
    if (!ids) {
      const names = [];
      for (const [name, index] of slotIndex) {
        if (bits & (1 << index)) names.push(name);
      }
      ids = chordUnits(names);
      cache.set(bits, ids);
    }
    return ids;
  }

  function blankStat() {
    return { samples: 0, ewmaMs: null, misses: 0, recent: [], probeRecent: [] };
  }

  // Records one result for each chord unit id in `ids`, `ms` being how long the stroke took.
  // A miss adds a penalty to the average rather than counting as a sample.
  function recordChord(progress, ids, ms, correct) {
    for (const id of ids) {
      if (!isChordId(id)) continue;
      const stat = progress.chords[id] || blankStat();
      const cost = correct ? ms : ms + MISS_PENALTY_MS;
      stat.ewmaMs = stat.ewmaMs === null ? cost : stat.ewmaMs * 0.7 + cost * 0.3;
      // A plain rolling window (not an EWMA), so a single recent miss can't swing the gate by
      // itself and a bad patch from thousands of attempts ago can't keep it stuck either -
      // only the last CHORD_ACCURACY_WINDOW attempts on this chord count.
      stat.recent = [...(stat.recent || []), correct ? 1 : 0].slice(-CHORD_ACCURACY_WINDOW);
      if (correct) {
        stat.samples += 1;
      } else {
        stat.misses += 1;
      }
      progress.chords[id] = stat;
    }
    return progress;
  }

  // Records one stroke from the steno keys it pressed (`used`) against the keys it needed
  // (`target`). A right stroke counts for every chord unit in it. A wrong one counts against
  // only the chords the learner failed to produce, so a slip on the n sound (T-P-H-) does not
  // also count against the vowel or the final consonants they got right beside it. If every
  // needed chord is there and the stroke was wrong only by an extra key, the whole target is
  // blamed, since there is no single chord to point at.
  function recordStroke(progress, { target = [], used, ms, correct }) {
    const usedUnits = chordUnits(used);
    if (correct) return recordChord(progress, usedUnits, ms, true);
    const targetUnits = chordUnits(target);
    const wrong = targetUnits.filter((id) => !usedUnits.includes(id));
    return recordChord(progress, wrong.length > 0 ? wrong : targetUnits, ms, false);
  }

  // Records one completed word: `ms` from its first key to its last, `strokes` strokes
  // typed correctly, `misses` strokes that needed another try.
  function recordWord(progress, { ms, strokes, misses }) {
    progress.words.push({ ms, strokes, misses });
    if (progress.words.length > HISTORY_LIMIT) {
      progress.words.splice(0, progress.words.length - HISTORY_LIMIT);
    }
    // Counts every word ever finished, never trimmed or reset (unlike `words`, which is just
    // the current judging window). This is a forward-only fingerprint: real play only ever
    // increases it, so a pasted-in save with a lower count than what's already here can only
    // be older progress, not something earned since.
    progress.totalTyped += 1;
    return progress;
  }

  // Speed and accuracy over the newest words, since the last unlock. `count` is how many
  // words were used, which can be fewer than LESSON_SIZE early on.
  function windowStats(progress) {
    const recent = progress.words.slice(-LESSON_SIZE);
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

  // A single number combining speed and accuracy, for the HUD's Score metric.
  function scoreFor(stats) {
    return Math.round(stats.wpm * stats.accuracy * 20);
  }

  // Share of the last CHORD_ACCURACY_WINDOW attempts on one chord that were right. 1 (not a gate)
  // if the chord hasn't been attempted enough yet, so it doesn't block unlocking before there's
  // enough recent data, and so it can't trap you on a bad patch forever - it clears as soon as
  // enough recent attempts are good, no matter how many total attempts came before.
  function chordAccuracy(progress, id) {
    const stat = progress.chords[id];
    if (!stat || stat.recent.length < CHORD_ACCURACY_MIN_SAMPLES) return 1;
    return stat.recent.reduce((sum, hit) => sum + hit, 0) / stat.recent.length;
  }

  // Whether every chord you have practiced is individually accurate enough, not just the
  // overall average.
  function chordsAccurateEnough(progress) {
    return Object.keys(progress.chords).every((id) => chordAccuracy(progress, id) >= CHORD_ACCURACY_TARGET);
  }

  // Whether the newest words are fast and accurate enough to unlock the next key.
  function meetsTargets(progress) {
    const stats = windowStats(progress);
    return stats.count >= LESSON_SIZE
      && stats.wpm >= wpmTarget(progress.level)
      && stats.accuracy >= ACCURACY_TARGET
      && chordsAccurateEnough(progress);
  }

  function canUnlock(progress) {
    return progress.unlocked < KEY_ORDER.length && meetsTargets(progress);
  }

  // A prestige level is complete only once every key is unlocked AND a fresh lesson (the
  // window restarts when the last key unlocks) clears the same speed and accuracy bars as an
  // unlock. Merely unlocking the last key does not count. Once earned it stays earned.
  function completeIfReady(progress) {
    if (progress.completed[progress.level]) return false;
    if (progress.unlocked < KEY_ORDER.length) return false;
    // The per-key bar is for unlocking keys. Rare keys fill their rolling window slowly, so a
    // fresh lesson that clears speed and accuracy is proof enough to finish the level.
    const stats = windowStats(progress);
    if (stats.count < LESSON_SIZE || stats.wpm < wpmTarget(progress.level) || stats.accuracy < ACCURACY_TARGET) {
      return false;
    }
    progress.completed[progress.level] = true;
    return true;
  }

  // Personal best for the current prestige level, judged on one whole finished lesson (its
  // `stats`, all LESSON_SIZE words), never a rolling slice. Counts only while every key is
  // unlocked and the lesson clears the accuracy bar. Whole wpm, so a record is a visible gain.
  // Returns the new best, or null if this lesson did not set one.
  function recordBestIfFaster(progress, stats) {
    if (progress.unlocked < KEY_ORDER.length) return null;
    if (stats.count < LESSON_SIZE || stats.accuracy < ACCURACY_TARGET) return null;
    const wpm = Math.floor(stats.wpm);
    if (wpm <= (progress.bests[progress.level] || 0)) return null;
    progress.bests[progress.level] = wpm;
    return wpm;
  }

  // Unlocks the next key if canUnlock says so. Starts counting words again from zero.
  // Returns true if a key was added.
  function unlockIfReady(progress) {
    if (!canUnlock(progress)) return false;
    progress.unlocked += 1;
    progress.words = [];
    return true;
  }

  // Appends a finished lesson's accuracy to the short streak history shown on the HUD.
  function recordLesson(progress, stats) {
    progress.lessonHistory.push({ accuracy: stats.accuracy, wpm: stats.wpm });
    if (progress.lessonHistory.length > LESSON_HISTORY_LIMIT) {
      progress.lessonHistory.splice(0, progress.lessonHistory.length - LESSON_HISTORY_LIMIT);
    }
    return progress;
  }

  // 0 to 1: how well a chord is known. Needs samples and speed, and accuracy: a chord typed fast
  // but wrong a lot is not actually known, even though it would look full on speed alone.
  function confidence(progress, id) {
    const stat = progress.chords[id];
    if (!stat || stat.ewmaMs === null) return 0;
    const enough = Math.min(1, stat.samples / SAMPLES_TO_LEARN);
    const speed = Math.min(1, TARGET_MS / stat.ewmaMs);
    const accuracy = Math.min(1, chordAccuracy(progress, id) / CHORD_ACCURACY_TARGET);
    return enough * speed * accuracy;
  }

  // 0 (learning), 1 (solid), 2 (fully sustained): how settled a chord is, for fading scaffolds.
  // Both tiers need the whole rolling accuracy window full (CHORD_ACCURACY_WINDOW real recent
  // attempts on this exact chord), not just "enough samples to count" - confidence alone can
  // read as high after only a handful of reps (its own samples ramp tops out at just
  // SAMPLES_TO_LEARN), which let a scaffold fade within the first few words after something new
  // appeared and flicker as a live EWMA confidence bounced across the threshold.
  function masteryTier(progress, id) {
    const stat = progress.chords[id];
    if (!stat || stat.recent.length < CHORD_ACCURACY_WINDOW) return 0;
    const conf = confidence(progress, id);
    if (conf >= MASTERY_TIER_2_CONFIDENCE) return 2;
    if (conf >= MASTERY_TIER_1_CONFIDENCE) return 1;
    return 0;
  }

  // The chord ids you have practiced that include a given key.
  function chordsWithKey(progress, name) {
    return Object.keys(progress.chords).filter((id) => unitKeys(id).includes(name));
  }

  // Read-only views of a single key, rolled up from the chords it appears in. Nothing is stored
  // per key: these exist for the key chips, unlock-order decisions and the scaffold fade.
  //
  // How well a key is known: its best chord, since a key you have typed well in some
  // combination is not a stranger, and a key never typed at all reads 0.
  function keyConfidence(progress, name) {
    let best = 0;
    for (const id of chordsWithKey(progress, name)) best = Math.max(best, confidence(progress, id));
    return best;
  }

  // A key's settled tier: its best chord's, but 0 outright while any chord it is part of is
  // being failed - a key is not "solid" while one of its combinations is a weak spot.
  function keyTier(progress, name) {
    let best = 0;
    for (const id of chordsWithKey(progress, name)) {
      if (chordAccuracy(progress, id) < DRILL_ACCURACY) return 0;
      best = Math.max(best, masteryTier(progress, id));
    }
    return best;
  }

  // Total correct reps and misses across every chord a key is part of.
  function keyTotals(progress, name) {
    let samples = 0;
    let misses = 0;
    for (const id of chordsWithKey(progress, name)) {
      samples += progress.chords[id].samples;
      misses += progress.chords[id].misses;
    }
    return { samples, misses };
  }

  // Practiced chords failing right now: under DRILL_ACCURACY with enough recent attempts to say so.
  function weakChordIds(progress) {
    return Object.keys(progress.chords).filter((id) => chordAccuracy(progress, id) < DRILL_ACCURACY);
  }

  // What most needs practice: the unlocked key you know least (a brand new key reads 0), or a
  // chord you are failing, whichever is lowest. Ties go to the one introduced later. The id is a
  // chord unit id (a key's own name stands for that key alone). Young chords that are merely
  // new are not candidates - only ones actually being missed - so a fresh combination does not
  // hijack the focus before there is any evidence it is hard.
  function focusInfo(progress) {
    let focus = null;
    let weakest = Infinity;
    for (const name of unlockedNames(progress)) {
      const score = keyConfidence(progress, name);
      if (score <= weakest) {
        weakest = score;
        focus = { id: name, confidence: score };
      }
    }
    for (const id of weakChordIds(progress)) {
      const score = confidence(progress, id);
      if (score <= weakest) {
        weakest = score;
        focus = { id, confidence: score };
      }
    }
    return focus;
  }

  function focusChord(progress) {
    const focus = focusInfo(progress);
    return focus ? focus.id : null;
  }

  // The practiced chords in order of how much they need work: lowest recent accuracy first, then
  // lowest confidence. Only chords with enough recent attempts to judge. For the HUD.
  function weakChords(progress, count = 3) {
    return Object.keys(progress.chords)
      .filter((id) => progress.chords[id].recent.length >= CHORD_ACCURACY_MIN_SAMPLES)
      .map((id) => ({
        id,
        accuracy: chordAccuracy(progress, id),
        ms: progress.chords[id].ewmaMs,
        attempts: progress.chords[id].recent.length,
        confidence: confidence(progress, id),
      }))
      .sort((a, b) => a.accuracy - b.accuracy || a.confidence - b.confidence)
      .slice(0, count);
  }

  // The lowest settled tier among unlocked keys: a scaffold only fades once every unlocked
  // key, not just the newest one, is ready for less help.
  function scaffoldTier(progress) {
    const names = unlockedNames(progress);
    if (names.length === 0) return 0;
    return Math.min(...names.map((name) => keyTier(progress, name)));
  }

  // Whether a scaffold should be shown: exactly its checkbox. Unchecking hides it right away;
  // there is no waiting on mastery. (`progress` and `stage` stay in the signature for callers.)
  function scaffoldVisible(progress, stage, override) {
    return Boolean(override);
  }

  // Prestige level 3 has no helpers at all, so a learner stuck on one word gets its stroke
  // labels shown after LABEL_REVEAL_MISSES wrong chords on it. A per-word override only: it
  // never touches progress.scaffolds, and the caller resets the count when the next word starts.
  const LABEL_REVEAL_MISSES = 3;
  function labelsRevealed(progress, wordWrongChords) {
    return progress.level === 3 && wordWrongChords >= LABEL_REVEAL_MISSES;
  }

  // Snapshots every unlocked key's current samples/misses as the redo baseline for `stage`.
  // Called the moment a scaffold checkbox goes from checked to unchecked, so
  // `scaffoldRedoMastered` below has a clean "zero" to measure fresh practice from - without
  // this, unchecking a box after already mastering everything would satisfy a scaffold-off
  // badge instantly, with no actual redo. A key with no entry yet (unlocked after this mark is
  // taken) is treated as a 0 baseline wherever it's read, so it needs no entry of its own.
  function recordScaffoldOff(progress, stage) {
    progress.scaffoldMarks = progress.scaffoldMarks || {};
    const marks = {};
    for (const name of unlockedNames(progress)) {
      marks[name] = keyTotals(progress, name);
    }
    progress.scaffoldMarks[stage] = marks;
  }

  // Only for a save from before scaffold-redo badges existed: if `stage` is already off with
  // no mark on record, treat right now as the baseline rather than letting old mastery earned
  // before this feature shipped count as an instant, unearned redo. A no-op once a mark exists.
  function ensureScaffoldMark(progress, stage) {
    if (progress.scaffoldMarks && progress.scaffoldMarks[stage]) return;
    recordScaffoldOff(progress, stage);
  }

  // Whether every unlocked key has been mastered (tier 2) using only practice recorded since
  // `stage` last went off - not just mastered right now while it happens to be off. A key needs
  // `SAMPLES_TO_LEARN` fresh correct reps (confidence's own "enough practice" bar) and
  // `CHORD_ACCURACY_WINDOW` fresh attempts (enough to have fully displaced its pre-mark accuracy
  // window) since the mark, on top of currently reading as tier 2.
  function scaffoldRedoMastered(progress, stage) {
    const names = unlockedNames(progress);
    // No mark at all (as opposed to one with a missing entry for some key - see below) means
    // this stage was never actually recorded as going off, so there is no redo to measure -
    // without this, an un-marked stage would read as "baseline zero" and pass instantly off
    // of mastery earned long before it ever went off.
    if (names.length === 0 || !progress.scaffoldMarks || !progress.scaffoldMarks[stage]) return false;
    const marks = progress.scaffoldMarks[stage];
    return names.every((name) => {
      if (keyTier(progress, name) < 2) return false;
      const stat = keyTotals(progress, name);
      if (stat.samples + stat.misses === 0) return false;
      const mark = marks[name] || { samples: 0, misses: 0 };
      const freshSamples = stat.samples - mark.samples;
      const freshAttempts = stat.samples + stat.misses - (mark.samples + mark.misses);
      return freshSamples >= SAMPLES_TO_LEARN && freshAttempts >= CHORD_ACCURACY_WINDOW;
    });
  }

  // The etude<->concerto dial, 0-100: how ready the focus is, reusing the same signal that
  // already drives its HUD bar. Recomputed fresh every call, no state of its own.
  function complexityScore(progress) {
    const focus = focusInfo(progress);
    if (!focus) return 0;
    return focus.confidence * 100;
  }

  function complexityBand(score) {
    if (score < ETUDE_MAX) return 'etude';
    if (score >= CONCERTO_MIN) return 'concerto';
    return 'study';
  }

  // Appends one isolated-rep timing for chord `id`, kept apart from the normal blended ewmaMs so
  // probe (isolated) speed and everyday (blended) speed can be compared.
  function recordProbe(progress, id, ms) {
    if (!isChordId(id)) return progress;
    const stat = progress.chords[id] || blankStat();
    stat.probeRecent = [...(stat.probeRecent || []), ms].slice(-PROBE_WINDOW);
    progress.chords[id] = stat;
    return progress;
  }

  // How much faster a chord's isolated probe reps are than its everyday blended speed, as a
  // fraction of blended speed (0.2 = probes are 20% faster, as a healthy gap should be).
  // null if there is not enough probe data yet to judge. A gap at or below HEALTHY_PROBE_GAP
  // (including negative, i.e. probes no faster or even slower) means complexity is not the
  // real bottleneck for this key - raw chord-formation speed is.
  function kinematicGap(progress, id) {
    const stat = progress.chords[id];
    if (!stat || !stat.ewmaMs || !stat.probeRecent || stat.probeRecent.length < PROBE_MIN_SAMPLES) return null;
    const probeAvg = stat.probeRecent.reduce((sum, ms) => sum + ms, 0) / stat.probeRecent.length;
    return (stat.ewmaMs - probeAvg) / stat.ewmaMs;
  }

  // Bit mask of the unlocked keys, using the same bit order as keymux's slots.
  function unlockedMask(progress, slotIndex) {
    return unlockedNames(progress).reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
  }

  // The stroke sequences of a word that use only unlocked keys.
  function usableVariants(word, mask) {
    return word.variants.filter((strokes) => strokes.every((bits) => (bits & ~mask) === 0));
  }

  function bitCount(bits) {
    let count = 0;
    for (let rest = bits; rest; rest &= rest - 1) count += 1;
    return count;
  }

  // The stroke sequences to show for a word, using only unlocked keys. The first one is the
  // stroke to type: fewest strokes, then fewest keys.
  // What the faint preview above the current word shows. `done` are the strokes of this word
  // already typed right (they stay visible, in order), `held` is the stroke being held or just
  // let go (0 for none), `candidates` the spellings still possible and `strokeIdx` the stroke
  // being typed. A held stroke that finishes the word shows the word itself; any other (the
  // first or middle stroke of a longer spelling, or a wrong stroke) shows what it translates to
  // on its own, or its raw steno when that is unknown. `render` turns stroke bits into steno
  // text. Returns null when there is nothing to show, else { text, resolved } where resolved
  // is false if any part had to fall back to raw steno.
  function previewFor({ word, done, held, candidates, strokeIdx, strokeWord, render }) {
    const parts = done.map((bits) => strokeWord.get(bits) || null);
    const texts = done.map((bits, i) => parts[i] || render(bits));
    if (held) {
      const finishes = candidates.some((seq) => seq[strokeIdx] === held && strokeIdx === seq.length - 1);
      if (finishes) return { text: word.text, resolved: true };
      const known = strokeWord.get(held) || null;
      parts.push(known);
      texts.push(known || render(held));
    }
    if (texts.length === 0) return null;
    return { text: texts.join(' '), resolved: parts.every(Boolean) };
  }

  function displayVariants(word, mask) {
    const keyCount = (strokes) => strokes.reduce((total, bits) => total + bitCount(bits), 0);
    return usableVariants(word, mask)
      .map((strokes) => ({ strokes, keys: keyCount(strokes) }))
      .sort((a, b) => a.strokes.length - b.strokes.length || a.keys - b.keys)
      .map((item) => item.strokes);
  }

  // How a finished stroke fits a word. Optimistic by design: a stroke counts as a mistake only
  // when it fits nothing. `candidates` are the spellings still possible after the strokes typed
  // right so far, `all` is every spelling of the word, and `strokeIdx` is the next stroke due.
  // Returns one of:
  //   { type: 'next', matches }     the next stroke of some spelling
  //   { type: 'restart', matches }  the first stroke of a spelling: the word is being redone
  //   { type: 'partial' }           part of the next stroke (keys let go early): keep going
  //   null                          none of those: a real mistake
  function classifyStroke({ chord, candidates, all, strokeIdx }) {
    if (!chord) return null;
    const matches = candidates.filter((seq) => seq[strokeIdx] === chord);
    if (matches.length) return { type: 'next', matches };
    if (strokeIdx > 0) {
      const restart = all.filter((seq) => seq[0] === chord);
      if (restart.length) return { type: 'restart', matches: restart };
    }
    const partOfNext = candidates.some((seq) => seq[strokeIdx] !== undefined && (chord & ~seq[strokeIdx]) === 0);
    return partOfNext ? { type: 'partial' } : null;
  }

  // Every stroke that would be right now, shown once each: the next stroke of each spelling still
  // possible, then (once the word is under way) the first stroke of every spelling, since the
  // word can be started over with any of them.
  function nextOptions({ candidates, all, strokeIdx }) {
    const next = candidates.map((seq) => seq[strokeIdx]);
    const restart = strokeIdx > 0 ? all.map((seq) => seq[0]) : [];
    return [...new Set([...next, ...restart])].filter(Boolean);
  }

  // 0 (fully accurate) to 1 (always wrong): how much a chord's own weakness should pull word
  // selection toward it. Deliberately the *raw* accuracy deficit, not `confidence` - confidence
  // normalizes accuracy against CHORD_ACCURACY_TARGET (0.8) and multiplies in a speed term that
  // saturates to 1 almost immediately, which together compress a real, meaningful accuracy
  // problem (e.g. 60% when everything else is 85%+) down to a barely-there signal. Word
  // selection should react to the actual error rate, not that squashed mastery metric. A chord
  // that has never been typed, or is still inside its grace period (under CHORD_GRACE_SAMPLES
  // correct reps), reads as UNSEEN_WEAKNESS rather than trusting an early accuracy reading from
  // too few attempts - unless it is already being missed worse than that.
  function chordWeakness(progress, id) {
    const stat = progress.chords[id];
    if (!stat) return UNSEEN_WEAKNESS;
    const deficit = 1 - chordAccuracy(progress, id);
    return stat.samples < CHORD_GRACE_SAMPLES ? Math.max(UNSEEN_WEAKNESS, deficit) : deficit;
  }

  // How much a word's weight should scale up for its single weakest chord unit - the worst one
  // present in its strokes, not a product over every unit. A word with several strokes or
  // several units must not get a bigger boost just for having more of them: every real chord has
  // *some* nonzero weakness most of the time, so multiplying across them would compound into a
  // huge, meaningless boost. Using the max keeps the boost keyed to how bad the worst chord is,
  // independent of how many there are. `strokes` is a word's stroke masks (one mask also works).
  function weaknessBoost(progress, strokes, slotIndex) {
    let maxWeak = 0;
    for (const bits of Array.isArray(strokes) ? strokes : [strokes]) {
      for (const id of unitsOfBits(bits, slotIndex)) maxWeak = Math.max(maxWeak, chordWeakness(progress, id));
    }
    return 1 + WEAKNESS_GAIN * maxWeak * maxWeak;
  }

  // Picks words for the stream. Only words with at least one stroke sequence that uses
  // unlocked keys are eligible. Words using weaker chords come up more often (see
  // `weaknessBoost`), and words in `avoid` (recently typed) are skipped where possible.
  // `random` returns [0, 1). `options.allowMask`, if given, is used in place of the unlocked
  // mask to decide which words are eligible (but is expected to already be a subset of it) -
  // this is how an etude pick restricts itself to the focus plus only already-mastered
  // keys. `options.bonusFn`, if given, multiplies a word's weight by `bonusFn(usable)` - this
  // is how a concerto pick rewards words that recombine several recently-unlocked keys
  // together. `options.requireUnit` only allows words with a spelling that uses that chord
  // unit, and `options.excludeUnits` (a Set) drops spellings that use any of those units: this
  // is how a drill works one chord while keeping the rest of the word easy.
  function pickWords(words, progress, slotIndex, options = {}) {
    const random = options.random || Math.random;
    const count = options.count || LESSON_SIZE;
    const avoid = new Set(options.avoid || []);
    const maxLength = options.maxLength || MAX_WORD_LENGTH;
    const mask = unlockedMask(progress, slotIndex);
    const eligibilityMask = options.allowMask !== undefined ? options.allowMask & mask : mask;
    const bonusFn = options.bonusFn || (() => 1);
    const { requireUnit, excludeUnits } = options;
    const unitsFit = (strokes) => {
      let found = !requireUnit;
      for (const bits of strokes) {
        for (const id of unitsOfBits(bits, slotIndex)) {
          if (excludeUnits && excludeUnits.has(id)) return false;
          if (id === requireUnit) found = true;
        }
      }
      return found;
    };

    const eligible = [];
    for (const word of words) {
      if (word.text.length > maxLength) continue;
      let usable = usableVariants(word, eligibilityMask);
      if (usable.length === 0) continue;
      if (options.requireMask && !usable.some((variant) => variant.some((b) => b & options.requireMask))) continue;
      if (requireUnit || excludeUnits) {
        usable = usable.filter(unitsFit);
        if (usable.length === 0) continue;
      }
      eligible.push({ word, usable });
    }
    if (eligible.length === 0) return [];

    const pool = eligible.filter(({ word }) => !avoid.has(word.text));
    const source = pool.length >= count || options.strictAvoid ? pool : eligible;
    // A chord's weakness is the same across every word in this call, so look it up once.
    const weakness = new Map();
    const weakOf = (id) => {
      let value = weakness.get(id);
      if (value === undefined) {
        value = chordWeakness(progress, id);
        weakness.set(id, value);
      }
      return value;
    };
    const weighted = source.map(({ word, usable }) => {
      // Plover's dictionary has no word frequencies, so combine a real frequency list with
      // the length/stroke heuristics: medium length, one stroke, and actually common words win.
      let weight = lengthWeight(word.text.length) * strokeWeight(usable[0].length) * WordFreq.freqWeight(word.text);
      let maxWeak = 0;
      for (const bits of usable[0]) {
        for (const id of unitsOfBits(bits, slotIndex)) maxWeak = Math.max(maxWeak, weakOf(id));
      }
      weight *= 1 + WEAKNESS_GAIN * maxWeak * maxWeak;
      weight *= bonusFn(usable);
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

  // One full lesson's worth of words: exactly LESSON_SIZE words (fewer only if the unlocked
  // keys cannot make that many distinct eligible words).
  function startLesson(words, progress, slotIndex, options = {}) {
    return pickWords(words, progress, slotIndex, { ...options, count: LESSON_SIZE });
  }

  // Bitmask of unlocked keys at or above `tier` - the "already comfortable" keys an etude
  // pick is allowed to lean on besides the focus itself.
  function masteredMask(progress, slotIndex, tier) {
    let mask = 0;
    for (const name of unlockedNames(progress)) {
      if (keyTier(progress, name) >= tier) mask |= 1 << slotIndex.get(name);
    }
    return mask;
  }

  // Bitmask of the `n` most-recently-unlocked keys, for the concerto-band recombination bonus.
  function recentlyUnlockedMask(progress, slotIndex, n) {
    const names = unlockedNames(progress).slice(-n);
    return names.reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
  }

  // The live complexity band ('etude'/'study'/'concerto') plus the pickWords options that
  // enforce it, shared by `nextWord` and `nextWords` so a batch call picks the band once
  // instead of re-deriving the identical answer (it's a pure function of `progress`, which
  // neither picker mutates) on every word in the batch.
  function bandPickOptions(progress, slotIndex, options) {
    const focus = focusInfo(progress);
    const gap = focus ? kinematicGap(progress, focus.id) : null;
    const deficit = gap !== null && gap <= HEALTHY_PROBE_GAP;
    const band = options.forceBand || (deficit ? 'etude' : complexityBand(complexityScore(progress)));
    const pickOptions = { ...options };
    delete pickOptions.forceBand;
    delete pickOptions.isProbe;

    if (band === 'etude' && focus) {
      const focusBits = unitKeys(focus.id).reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
      pickOptions.allowMask = masteredMask(progress, slotIndex, 1) | focusBits;
      pickOptions.maxLength = ETUDE_MAX_LENGTH;
    } else if (band === 'concerto') {
      const recentMask = recentlyUnlockedMask(progress, slotIndex, RECOMBINE_LAST);
      pickOptions.bonusFn = (usable) => {
        if (!recentMask) return 1;
        const bits = usable[0].reduce((mask, b) => mask | b, 0);
        let count = 0;
        for (let rest = bits & recentMask; rest; rest &= rest - 1) count += 1;
        return 1 + count;
      };
    }
    return { band, focus: focus ? focus.id : null, pickOptions };
  }

  // The chord a drill word works, and how much of the stream it gets. Rare combinations (-Z,
  // #, -D, or a compound like T-P-H-) show up in few words, so left to the weighted pick alone
  // they never get enough reps to lift their accuracy past the unlock bar; this reserves a
  // share of words for the single worst chord, in short words whose other chords are not also
  // being failed, so a drill word stays easy apart from the one chord it is there for. With
  // nothing under DRILL_ACCURACY the drill does not stop: it works the practiced chord with the
  // lowest confidence (accuracy and speed together), at a smaller share, so there is always a
  // weak spot being worked at every level. null before any chord has enough attempts to judge.
  function drillOptions(progress) {
    const weak = weakChordIds(progress);
    let target = null;
    let steady = false;
    if (weak.length > 0) {
      target = weak.reduce((worst, id) => (chordAccuracy(progress, id) < chordAccuracy(progress, worst) ? id : worst));
    } else {
      let lowest = Infinity;
      for (const id of Object.keys(progress.chords)) {
        if (progress.chords[id].recent.length < CHORD_ACCURACY_MIN_SAMPLES) continue;
        const score = confidence(progress, id);
        if (score < lowest) {
          lowest = score;
          target = id;
        }
      }
      steady = true;
    }
    if (!target) return null;
    return {
      share: steady ? STEADY_DRILL_SHARE : DRILL_SHARE,
      target,
      options: {
        requireUnit: target,
        excludeUnits: new Set(weak.filter((id) => id !== target)),
        maxLength: ETUDE_MAX_LENGTH,
      },
    };
  }

  // One drill word, short first and any length if no short word has the chord. [] if none.
  function pickDrill(words, progress, slotIndex, options, drill, count) {
    const picked = pickWords(words, progress, slotIndex, { ...options, ...drill.options, count });
    if (picked.length >= count) return picked;
    const longer = pickWords(words, progress, slotIndex, {
      ...options,
      ...drill.options,
      maxLength: options.maxLength,
      avoid: [...(options.avoid || []), ...picked.map((word) => word.text)],
      strictAvoid: true,
      count: count - picked.length,
    });
    return [...picked, ...longer];
  }

  // One word, chosen for the live complexity band: 'etude' (isolated, minimal-load reps on
  // the focus), 'study' (today's normal picking, unchanged), or 'concerto' (full-length
  // words that deliberately recombine several recently-unlocked keys). The band is read from
  // `complexityScore` fresh every call, so it can move word to word, not just at a boundary -
  // unless `options.forceBand` overrides it (used for scheduled diagnostic probes) or a
  // `kinematicGap` deficit on the focus forces 'etude' regardless of its confidence score,
  // because a chord whose isolated reps are not substantially faster than its blended reps is
  // not actually being held back by word complexity.
  function nextWord(words, progress, slotIndex, options = {}) {
    const { band, focus, pickOptions } = bandPickOptions(progress, slotIndex, options);
    let picked;
    const drill = options.forceBand ? null : drillOptions(progress);
    if (drill && (options.random || Math.random)() < drill.share) {
      picked = pickDrill(words, progress, slotIndex, options, drill, 1)[0];
    }
    // strictAvoid: a band whose few eligible words were all just typed must not hand back the
    // same word again - it falls through to the plain pick instead.
    if (!picked) picked = pickWords(words, progress, slotIndex, { ...pickOptions, strictAvoid: true, count: 1 })[0];
    // An etude restriction (or any band option) can legitimately leave nothing eligible early
    // on, when few keys are mastered yet - fall back to a plain pick rather than return nothing.
    // With very few keys the whole vocabulary can be inside the avoid list, so the list is
    // shortened step by step (oldest dropped first) before a repeat is ever accepted.
    const avoid = options.avoid || [];
    for (const keep of [avoid.length, 20, 8, 3, 1]) {
      if (picked || keep > avoid.length) continue;
      picked = pickWords(words, progress, slotIndex, { ...options, avoid: avoid.slice(avoid.length - keep), strictAvoid: true, count: 1 })[0];
    }
    if (!picked) picked = pickWords(words, progress, slotIndex, { ...options, count: 1 })[0];
    if (!picked) return null;
    return { ...picked, band, isProbe: Boolean(options.isProbe), focusChordAtPick: focus };
  }

  // `count` words for the live band in one pass, for a caller that needs several at once (the
  // decorative ghost strip) and would otherwise call `nextWord` in a loop - which looks
  // harmless but reruns the exact same whole-dictionary scan, with the exact same band and
  // `avoid` set, once per word instead of once total, since nothing any of those calls read
  // (the band, the mask, `progress` itself) changes between them.
  function nextWords(words, progress, slotIndex, count, options = {}) {
    const { band, focus, pickOptions } = bandPickOptions(progress, slotIndex, options);
    const drill = options.forceBand ? null : drillOptions(progress);
    const drillCount = drill ? Math.round(count * drill.share) : 0;
    const picked = drillCount ? pickDrill(words, progress, slotIndex, options, drill, drillCount) : [];
    const normal = pickWords(words, progress, slotIndex, {
      ...pickOptions,
      avoid: [...(options.avoid || []), ...picked.map((word) => word.text)],
      strictAvoid: true,
      count: count - picked.length,
    });
    picked.push(...normal);
    // Same fallback as `nextWord`, applied to whatever's still missing after the band-
    // restricted pass, rather than one plain pick per missing word.
    if (picked.length < count) {
      const avoid = [...(options.avoid || []), ...picked.map((word) => word.text)];
      const rest = pickWords(words, progress, slotIndex, { ...options, avoid, count: count - picked.length });
      picked.push(...rest);
    }
    return picked.map((word) => ({ ...word, band, isProbe: Boolean(options.isProbe), focusChordAtPick: focus }));
  }

  // Whether loading `incoming` in place of `current` would erase real progress. totalTyped
  // only ever grows during real play, so a lower count can only mean older, replayed, or
  // tampered-with data, never progress earned since.
  function isRewind(current, incoming) {
    return (incoming.totalTyped || 0) < (current.totalTyped || 0);
  }

  return {
    KEY_ORDER,
    START_KEYS,
    classifyStroke,
    nextOptions,
    LESSON_SIZE,
    ACCURACY_TARGET,
    CHORD_ACCURACY_TARGET,
    DRILL_ACCURACY,
    DRILL_SHARE,
    STEADY_DRILL_SHARE,
    UNSEEN_WEAKNESS,
    drillOptions,
    TARGET_MS,
    ETUDE_MAX,
    CONCERTO_MIN,
    PROBE_WINDOW,
    HEALTHY_PROBE_GAP,
    WEAKNESS_GAIN,
    CHORD_GRACE_SAMPLES,
    emptyProgress,
    normalize,
    unlockedNames,
    chordUnits,
    unitKeys,
    isChordId,
    recordChord,
    recordStroke,
    recordWord,
    recordProbe,
    windowStats,
    scoreFor,
    chordAccuracy,
    weakChords,
    chordsWithKey,
    keyConfidence,
    keyTier,
    canUnlock,
    wpmTarget,
    confidence,
    chordWeakness,
    weaknessBoost,
    masteryTier,
    scaffoldTier,
    scaffoldVisible,
    LABEL_REVEAL_MISSES,
    labelsRevealed,
    recordScaffoldOff,
    ensureScaffoldMark,
    scaffoldRedoMastered,
    complexityScore,
    complexityBand,
    kinematicGap,
    unlockIfReady,
    recordLesson,
    focusChord,
    unlockedMask,
    usableVariants,
    displayVariants,
    previewFor,
    pickWords,
    nextWord,
    nextWords,
    startLesson,
    isRewind,
    LEVEL_WPM,
    MAX_LEVEL,
    levelFor,
    levelSummary,
    completeIfReady,
    recordBestIfFaster,
    switchLevel,
  };
});

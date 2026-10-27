// The practice page. You type on your normal keyboard, with no steno mode: hold every key
// for a stroke at once, then release. The chord is scored when the last key comes up, so the
// keys can land in any order. Any stroke Plover maps to the word is accepted.
(function () {
  const S = window.StenoData;
  const L = window.StenoLessons;
  const U = window.UniV4;

  // The full keyboard, row by row. `label` is the key's main character. `shift` is the
  // character shown when Shift is held. Keys with a `code` are named keys (Shift, Tab, ...).
  const letter = (label) => ({ label });
  const sym = (label, shift) => ({ label, shift });
  const named = (label, code, width) => ({ label, code, width });
  // Several physical keys drawn as one: they all press the same steno key. `span` is how many
  // key widths it covers, `tall` makes it two rows high (it sits in the upper row and the row
  // below leaves a `gap` where its lower half is), `bar` is the slim number bar. `letters` are
  // the key names shown on it; a tall key shows its sound and letter once per half, exactly
  // where the two single keys would have them.
  const merged = (codes, letters, { span, tall, bar, big } = {}) => ({ label: letters[0], codes, letters, span, tall, bar, big });
  const gap = { spacer: true };
  const NUMBER_CODES = [...'1234567890'].map((digit) => `Digit${digit}`);
  const ROWS = [
    [sym('`', '~'), merged(NUMBER_CODES, [...'1234567890'], { span: 10, bar: true }), sym('-', '_'),
      sym('=', '+'), named('Backspace', 'Backspace', 'w2')],
    // Q and A are both S-: one tall key, spanning both rows. T, Y, G and H are all *: one big
    // key covering two columns and both rows
    [named('Tab', 'Tab', 'w15'), merged(['KeyQ', 'KeyA'], ['Q', 'A'], { tall: true }),
      ...'WER'.split('').map(letter), merged(['KeyT', 'KeyY', 'KeyG', 'KeyH'], ['T', 'Y', 'G', 'H'], { span: 2, tall: true, big: true }),
      ...'UIOP'.split('').map(letter), sym('[', '{'), sym(']', '}'), sym('\\', '|', 'w15')],
    [named('Caps Lock', 'CapsLock', 'w15'), gap, ...'SDF'.split('').map(letter), gap, gap,
      ...'JKL'.split('').map(letter), sym(';', ':'), sym("'", '"'), named('Enter', 'Enter', 'w225')],
    [named('Shift', 'ShiftLeft', 'w225'), ...'ZXCVBNM'.split('').map(letter), sym(',', '<'),
      sym('.', '>'), sym('/', '?'), named('Shift', 'ShiftRight', 'w25')],
    [named('Ctrl', 'ControlLeft', 'w15'), named('Alt', 'AltLeft', 'w15'),
      named('Space', 'Space', 'w6'), named('Alt', 'AltRight', 'w15'), named('Ctrl', 'ControlRight', 'w15')],
  ];

  // Which finger presses each key, for coloring the steno keys.
  const FINGERS = {
    'left-pinky': ['Backquote', 'Digit1', 'Tab', 'KeyQ', 'CapsLock', 'KeyA', 'ShiftLeft', 'KeyZ', 'ControlLeft'],
    'left-ring': ['Digit2', 'KeyW', 'KeyS', 'KeyX', 'AltLeft'],
    'left-middle': ['Digit3', 'KeyE', 'KeyD', 'KeyC'],
    'left-index': ['Digit4', 'Digit5', 'KeyR', 'KeyT', 'KeyF', 'KeyG', 'KeyV', 'KeyB'],
    'right-index': ['Digit6', 'Digit7', 'KeyY', 'KeyU', 'KeyH', 'KeyJ', 'KeyN', 'KeyM'],
    'right-middle': ['Digit8', 'KeyI', 'KeyK', 'Comma'],
    'right-ring': ['Digit9', 'KeyO', 'KeyL', 'Period'],
    'right-pinky': ['Digit0', 'Minus', 'Equal', 'Backspace', 'KeyP', 'BracketLeft', 'BracketRight',
      'Backslash', 'Semicolon', 'Quote', 'Enter', 'Slash', 'ShiftRight', 'ControlRight', 'AltRight'],
    thumb: ['Space'],
  };
  const fingerByCode = new Map(
    Object.entries(FINGERS).flatMap(([finger, codes]) => codes.map((code) => [code, finger])),
  );
  const HOME_ROW = new Set(['KeyF', 'KeyJ']);
  const PUNCTUATION = {
    '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
    '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
  };

  function codeFor(label) {
    if (/^[A-Z]$/.test(label)) return `Key${label}`;
    if (/^[0-9]$/.test(label)) return `Digit${label}`;
    return PUNCTUATION[label];
  }

  const $ = (id) => document.getElementById(id);

  // "Key hints" on shows the key names and the keys to press. Off leaves only the sounds,
  // so you type from the sounds alone. Saved in this browser.
  const HINTS_KEY = "steno-lessions.hints";
  const OLD_HINTS_KEY = "steno-lessons.hints";
  function readHints() {
    try {
      const value = localStorage.getItem(HINTS_KEY) ?? localStorage.getItem(OLD_HINTS_KEY);
      return value === "on";
    } catch {
      return false;
    }
  }
  function applyHints() {
    document.body.classList.toggle("hints-off", !state.hints);
    $("hints").checked = state.hints;
  }

  // Which keyboard diagram the page shows: the QWERTY board or the Uni v4, drawn in its real
  // split-ortholinear shape. There is no setting for it: it follows the input. A stroke that
  // starts on a QWERTY key shows QWERTY, one that starts on the machine shows the Uni v4.

  // Which steno theory the lessons use. Each one has its own folder of data: Plover's sits at
  // data/, Lapwing's under data/lapwing/ (built by scripts/build-theory.js). Saved in this
  // browser; switching reloads the page so the lessons start from the new word list.
  const THEORY_KEY = "steno-lessions.theory";
  const THEORIES = {
    plover: { label: "Plover", dir: "data/" },
    lapwing: { label: "Lapwing", dir: "data/lapwing/" },
  };
  function readTheory() {
    try {
      const value = localStorage.getItem(THEORY_KEY);
      return value in THEORIES ? value : "plover";
    } catch {
      return "plover";
    }
  }
  let theory = readTheory();

  // Whether a theory's data is published here. Only the headers are read: the body is
  // cancelled, so the check costs no download. A theory that isn't published (Lapwing's data
  // is built locally, so GitHub Pages doesn't have it) is never loaded, and the page uses Plover.
  async function theoryReady(id) {
    try {
      const response = await fetch(THEORIES[id].dir + "bundle.json");
      response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  // [flag in progress.scaffolds, matching checkbox id], ordered least -> most consequential.
  const SCAFFOLD_BOXES = [
    ['labels', 'show-labels'],
    ['target', 'show-target'],
    ['keyboard', 'show-keyboard'],
  ];
  // Syncs the three scaffold checkboxes to state.progress.scaffolds - called on load and
  // again after a progress import, so a pasted-in profile's own preferences take over the UI
  // immediately instead of leaving the previous profile's checkboxes stale.
  function applyScaffoldBoxes() {
    for (const [flag, id] of SCAFFOLD_BOXES) {
      $(id).checked = state.progress.scaffolds[flag];
    }
  }

  // Puts progress on the prestige level the checkboxes and key hints call for. Going up starts
  // that level fresh and sets the other level's keys aside; ticking a box again brings them
  // back. Returns true if the level changed (so the word queue needs rebuilding).
  function syncLevel() {
    const target = L.levelFor(state.progress.scaffolds, state.hints);
    const previous = state.progress.level;
    if (!L.switchLevel(state.progress, target)) return false;
    // The words already on screen (current word, queue, ghosts) stay exactly as they are; the
    // new level only shapes the words generated after them.
    setFeedback(
      target < previous
        ? `Back on level ${target} (${L.wpmTarget(target)} wpm). Your keys are restored.`
        : `Level ${target} (${L.wpmTarget(target)} wpm). Keys start over; turn a helper back on to return.`,
      'good',
    );
    return true;
  }

  // The checkboxes and key hints a prestige level asks for, for the level cards' click-to-switch.
  const LEVEL_SETTINGS = {
    1: { scaffolds: { labels: true, target: true, keyboard: true }, hints: false },
    2: { scaffolds: { labels: true, target: true, keyboard: false }, hints: false },
    3: { scaffolds: { labels: false, target: false, keyboard: false }, hints: false },
  };

  // Three scaffolds, each its own checkbox: checked shows it, unchecked hides it right away.
  // The combination you leave on is your prestige level (see L.levelFor). Ordered least ->
  // most consequential to remove. These live in state.progress.scaffolds (not localStorage),
  // so they travel with the exported/imported progress blob like everything else.
  const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const state = {
    data: null,
    progress: L.emptyProgress(),
    slotIndex: new Map(S.SLOTS.map(([, name], index) => [name, index])),
    infoByCode: new Map(), // event.code -> { bits, sound, combined, label }
    slotByName: new Map(), // "S-" -> { name, sound, label }
    strokeWord: new Map(), // single-stroke chord bits -> the word it translates to
    hints: readHints(),
    keyEls: new Map(), // key element -> the event.codes it stands for (several for a merged key)
    done: [], // finished words, oldest first, kept in the stream in place behind the one being typed
    queue: [], // live, rolling buffer of upcoming words - queue[0] is the one being typed
    ghostWords: [], // decorative real words past the queue, never typed or recorded - see GHOST_COUNT
    recent: [], // words used lately, so the queue does not repeat them
    queuedCount: 0, // words pushed onto the queue this session, for the probe schedule
    lastLessonStats: null, // windowStats as of the last LESSON_SIZE-word milestone, for HUD deltas
    all: [], // every stroke sequence for the current word, so a redone word can start again
    partial: 0, // part of the next stroke (keys let go early), waiting for the rest
    candidates: [], // stroke sequences still possible for the current word
    strokeIdx: 0,
    wordMisses: 0,
    wordWrongChords: 0,
    wordMs: 0,
    lastChordEnd: null,
    failures: [], // the latest wrong attempt - tracked for retry/undo, not displayed
    doneStrokes: [], // strokes of the current word already typed right, kept in the preview
    previewBits: 0, // the last stroke's chord, kept after release so the preview survives it
    sinceBreak: 0, // words typed since the last break; session-only, so a reload restarts at 0/LESSON_SIZE
    onBreak: false, // true only during the blank pause right at a LESSON_SIZE milestone
    justResumed: false, // one-shot: true for the single render right after a break, so the
    // first word(s) of the next stretch get the slow entrance animation instead of just appearing
    breakTimer: null,
    releaseTimers: new Map(), // event.code -> pending debounced-release timeout id
    kbd: 'qwerty', // which keyboard diagram is shown: 'qwerty' or 'uni', following the last input
    uniKeyEls: new Map(), // Uni diagram key element -> the lever name it stands for
    uniPressed: new Set(), // Uni v4 lever names held right now (machine input, see Task 3)
    typed: 0, // words finished this session
    pressed: new Set(),
    chordBits: 0,
    chordStart: 0,
    paused: false,
  };

  // Words ahead kept generated at any time: small enough that the live complexity band can
  // actually move word to word instead of only at an old-style lesson boundary, big enough
  // that generating the next one never has to block typing.
  const LOOKAHEAD = 4;
  // Every this many words, one is a forced, out-of-band diagnostic probe on the focus key -
  // see lessons.js's kinematicGap for what it's checking.
  const PROBE_INTERVAL = 12;
  // How long the stream sits blank at a LESSON_SIZE milestone before the next stretch's first
  // word(s) fade in.
  const BREAK_PAUSE_MS = 200;
  // Decorative placeholders filling the rest of the stream past the LOOKAHEAD real words, so
  // the strip still reads as "a couple of lines of upcoming text" the way the old fixed-batch
  // view did - 26, to round the visible strip out to the old 30-word lesson batch's size
  // alongside LOOKAHEAD's 4 real words. They are not real upcoming words - we only ever
  // generate LOOKAHEAD ahead, on purpose, so the complexity band can keep adapting live - but
  // they ARE real dictionary entries with real strokes/sounds/keys, run through the exact same
  // non-current cell rendering as a real queued word (renderStream below), then just visually
  // faded out (see .cell.ghost in style.css). A fresh batch is only ever generated at the start
  // of a stretch (session start, import, or a LESSON_SIZE break) - in between, wordDone shifts
  // one off the front per completed word, same as the real queue, so the content itself never
  // reshuffles mid-stretch, it only ever shrinks from the front in lockstep with real progress.
  // Hidden entirely near a break, where the real, shrinking taper count is the honest thing to
  // show instead.
  const GHOST_COUNT = 26;
  // Finished words kept in the stream behind the one being typed (see state.done). Enough to
  // fill the strip several rows over; anything older is already scrolled out of view.
  const DONE_KEEP = 40;

  const currentWord = () => state.queue[0];
  // The stroke sequence to show: the first one that is still possible
  const shownStrokes = () => state.candidates[0] || [];
  // Every stroke that would be right now: continuing the spellings still possible, or starting the word over
  const nextStrokes = () => L.nextOptions({ candidates: state.candidates, all: state.all, strokeIdx: state.strokeIdx })
    .map((bits) => S.displayStroke(bits));
  const currentStroke = () => shownStrokes()[state.strokeIdx] || 0;
  const unlockedMask = () => L.unlockedMask(state.progress, state.slotIndex);
  // The steno keys held right now, as a stroke mask - from the QWERTY keys and, once a
  // machine is connected, from the Uni v4 levers held at the same moment.
  const heldBits = () => [...state.pressed].reduce((bits, code) => bits | (state.infoByCode.get(code)?.bits || 0), 0)
    | U.strokeBits([...state.uniPressed]);

  function setFeedback(text, kind) {
    const el = $('feedback');
    el.textContent = text;
    el.className = `feedback${kind ? ` ${kind}` : ''}`;
  }

  function buildIndexes(layout) {
    for (const key of layout.keys) {
      const code = codeFor(key.label);
      if (!code) continue;
      // A single key wins over a combined key that happens to share its label
      const existing = state.infoByCode.get(code);
      if (existing && !existing.combined) continue;
      state.infoByCode.set(code, { bits: key.bits, sound: key.sound, combined: key.combined, label: key.label });
    }
    for (const slot of layout.slots) {
      state.slotByName.set(slot.name, slot);
    }
  }

  // Every one-stroke word in the dictionary, keyed by its chord, so letting go can show what
  // steno would actually translate that exact chord to, not just the sounds it's built from.
  function buildStrokeIndex(words) {
    for (const word of words) {
      for (const strokes of word.variants) {
        if (strokes.length === 1 && !state.strokeWord.has(strokes[0])) {
          state.strokeWord.set(strokes[0], word.text);
        }
      }
    }
  }

  // The practice word list is filtered down to plain, typeable words, so on its own the
  // resolver only knows a fraction of real steno strokes. This fills in the rest from the
  // full raw dictionary (every stroke Plover defines, including names, numbers, punctuation
  // and briefs) so the letting-go preview resolves accurately for any stroke, not just the
  // ones the lessons use. It's additive only - entries already set by the curated word list
  // win, and loading happens in the background, after the practice words are ready, since a
  // slightly delayed preview for an obscure stroke is fine, but the practice words must not
  // wait on a 4MB dictionary fetch.
  async function loadFullResolver() {
    let dict;
    try {
      dict = await getJson(THEORIES[theory].dir + 'dictionary.json');
    } catch {
      return;
    }
    for (const notation in dict) {
      if (notation.includes('/')) continue;
      const bits = S.parseStroke(notation);
      if (bits === null || state.strokeWord.has(bits)) continue;
      state.strokeWord.set(bits, dict[notation]);
    }
    refresh();
  }

  // The physical keys to press for a stroke, using combined keys where they fit, so the
  // hint reads like the chord on the keyboard (e.g. "V" for A- and O-). In Uni v4 mode
  // the hint is the steno key names instead - on the machine, the key IS the steno key.
  function keysFor(bits) {
    if (state.kbd === 'uni') return U.hintNames(bits);
    const keys = state.data.layout.keys
      .filter((key) => key.bits && (key.bits & ~bits) === 0)
      .sort((a, b) => S.popcount(b.bits) - S.popcount(a.bits));
    let remaining = bits;
    const labels = [];
    for (const key of keys) {
      if (remaining & key.bits) {
        labels.push(key.label);
        remaining &= ~key.bits;
      }
    }
    return labels;
  }

  function buildKeyboard() {
    const keyboard = $('keyboard');
    keyboard.textContent = '';
    ROWS.forEach((keys, rowIndex) => {
      const row = document.createElement('div');
      // The number row is slim, so the wide # bar is a thin strip instead of a giant key
      row.className = `kb-row${rowIndex === 0 ? ' slim' : ''}`;
      for (const key of keys) {
        if (key.spacer) {
          // Where the lower half of a tall key above sits; nothing to draw
          const hole = document.createElement('div');
          hole.className = 'key spacer';
          row.appendChild(hole);
          continue;
        }
        const codes = key.codes || [key.code || codeFor(key.label)];
        const code = codes[0];
        const el = document.createElement('div');
        el.className = 'key';
        el.dataset.code = code;
        if (key.width) el.classList.add(key.width);
        if (key.tall) el.classList.add('tall');
        if (key.big) el.classList.add('big');
        if (key.bar) el.classList.add('bar');
        if (key.span) el.style.width = `calc(var(--u) * ${key.span} + var(--gap) * ${key.span - 1})`;
        if (fingerByCode.has(code)) el.dataset.finger = fingerByCode.get(code);
        if (HOME_ROW.has(code)) el.classList.add('home');
        const info = state.infoByCode.get(code);
        if (info) {
          // Steno keys show the sound big, and the letter small in the corner
          const addSound = (lower) => {
            const main = document.createElement('span');
            main.className = `main sound${lower ? ' lower' : ''}`;
            main.textContent = info.sound.replace(/ \+ /g, '+');
            el.appendChild(main);
          };
          if (key.bar) {
            // One # for the whole bar, with each digit small at its own key's column
            const digits = document.createElement('span');
            digits.className = 'digits';
            for (const digit of key.letters) {
              const cell = document.createElement('span');
              cell.textContent = digit;
              digits.appendChild(cell);
            }
            el.appendChild(digits);
            addSound(false);
          } else if (key.big) {
            // One big sound in the middle. Its letters are named in two lines: the upper
            // row's keys above, the lower row's keys below
            const letters = key.letters;
            [letters.slice(0, letters.length / 2), letters.slice(letters.length / 2)].forEach((names, half) => {
              const letterEl = document.createElement('span');
              letterEl.className = `letter${half ? ' lower' : ''}`;
              letterEl.textContent = names.join('  ');
              el.appendChild(letterEl);
            });
            addSound(false);
          } else {
            (key.letters || [info.label]).forEach((text, half) => {
              const letterEl = document.createElement('span');
              letterEl.className = `letter${half ? ' lower' : ''}`;
              letterEl.textContent = text;
              el.appendChild(letterEl);
              addSound(half > 0);
            });
          }
        } else {
          if (key.shift) {
            const shift = document.createElement('span');
            shift.className = 'shift';
            shift.textContent = key.shift;
            el.appendChild(shift);
          }
          const main = document.createElement('span');
          main.className = 'main';
          main.textContent = key.label;
          el.appendChild(main);
        }
        state.keyEls.set(el, codes);
        row.appendChild(el);
      }
      keyboard.appendChild(row);
    });
  }

  // The Uni v4 drawn as it physically is: a unibody split board, two key rows and a thumb
  // row, left half five columns and right half six. Keys are placed by U.UNI_KEYS, so the
  // diagram is the machine, not an approximation of one. Sounds and colors come from the
  // loaded theory bundle and the steno groups, like the stream's sound coloring.
  function buildUniKeyboard() {
    if (!state.data) return;
    const board = $('uni-keyboard');
    board.textContent = '';
    const soundOf = new Map(state.data.layout.slots.map((slot) => [slot.name, slot.sound]));
    for (const half of ['L', 'R']) {
      const halfEl = document.createElement('div');
      halfEl.className = `uni-half ${half === 'L' ? 'left' : 'right'}`;
      const columns = half === 'L' ? 5 : 6;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < columns; col++) {
          const key = U.UNI_KEYS.find((k) => k.half === half && k.row === row && k.col === col);
          const el = document.createElement('div');
          if (!key) {
            // A gap in the grid (the thumb row's empty corners) is a spacer, invisible
            el.className = 'key spacer';
            halfEl.appendChild(el);
            continue;
          }
          el.className = 'key steno';
          el.dataset.group = S.keyGroup(key.slot) || 'plain';
          const sound = document.createElement('span');
          sound.className = 'main sound';
          sound.textContent = soundOf.get(key.slot) || '';
          const letter = document.createElement('span');
          letter.className = 'letter';
          letter.textContent = S.displayName(key.slot);
          el.append(sound, letter);
          state.uniKeyEls.set(el, key.name);
          halfEl.appendChild(el);
        }
      }
      board.appendChild(halfEl);
    }
  }

  // Prestige scaffold fading: least-consequential first. Each stage only ever changes a
  // *default* - the matching checkbox (state.progress.scaffolds.{labels,target,keyboard}, on
  // by default) always wins, so nothing is ever taken away with no way to restore it.
  const labelsSetting = () => L.scaffoldVisible(state.progress, 'labels', state.progress.scaffolds.labels);

  function renderKeyboard() {
    const target = currentStroke();
    const mask = unlockedMask();
    const scaffolds = state.progress.scaffolds;
    const labelsOn = labelsSetting();
    const targetOn = L.scaffoldVisible(state.progress, 'target', scaffolds.target);
    const keyboardOn = L.scaffoldVisible(state.progress, 'keyboard', scaffolds.keyboard);
    // Least-consequential scaffold: the sound/key-name text line under each word in the
    // stream (renderStream's .snd/.kc spans) - a pure label. Off means gone, not dimmed.
    document.body.classList.toggle('scaffold-labels-off', !labelsOn);
    // Most consequential scaffold: off collapses the keyboard to an empty box (its rows
    // removed, not merely dimmed), so there's no half-visible crutch to lean on.
    // The active diagram - QWERTY or the Uni v4 - is the one that collapses; the other is
    // hidden whole ('off'), since only one keyboard is on the page at a time.
    const uniOn = state.kbd === 'uni';
    $('keyboard').classList.toggle('off', uniOn);
    $('uni-keyboard').classList.toggle('off', !uniOn);
    $('keyboard').classList.toggle('empty', !keyboardOn);
    $('uni-keyboard').classList.toggle('empty', !keyboardOn);
    for (const [el, codes] of state.keyEls) {
      const info = state.infoByCode.get(codes[0]);
      el.classList.toggle('steno', Boolean(info));
      el.classList.toggle('locked', Boolean(info) && (info.bits & ~mask) !== 0);
      el.classList.toggle('target', state.hints && targetOn && Boolean(info) && target !== 0 && (info.bits & target) === info.bits);
      el.classList.toggle('down', codes.some((code) => state.pressed.has(code)));
    }
    for (const [el, name] of state.uniKeyEls) {
      const bits = U.strokeBits([name]);
      el.classList.toggle('locked', (bits & ~mask) !== 0);
      el.classList.toggle('target', state.hints && targetOn && target !== 0 && (bits & target) === bits);
      el.classList.toggle('down', state.uniPressed.has(name));
    }
  }

  // Words left until the next cosmetic LESSON_SIZE milestone. Right after one (totalTyped a
  // clean multiple), that's a full LESSON_SIZE away again, not zero - the zero-ahead moment
  // is handled separately, by state.onBreak, not by this running purely off totalTyped.
  function wordsUntilBreak() {
    const pos = state.sinceBreak;
    return pos === 0 ? L.LESSON_SIZE : L.LESSON_SIZE - pos;
  }
  // The queue winds down to nothing right as a break approaches (so the stream visibly tapers
  // 4, 3, 2, 1 words ahead instead of jumping straight from a full lookahead to blank), and sits
  // at exactly 0 for the pause itself.
  function targetQueueDepth() {
    return state.onBreak ? 0 : Math.min(LOOKAHEAD, wordsUntilBreak());
  }
  // True once the taper toward a break has actually started (or we're sitting in the pause
  // itself) - the ghost placeholders below only make sense while we're genuinely LOOKAHEAD
  // words deep in a normal stretch; this close to a break the real, shrinking count is the
  // honest thing on screen, so no placeholders should paper over it.
  const nearBreak = () => state.onBreak || wordsUntilBreak() <= LOOKAHEAD;

  // Tops the live queue back up to its target depth, one word at a time, each read fresh off
  // the current complexity band - so a shift in the focus key's confidence (or a probe coming
  // due) can change the very next word, not just at an old-style lesson boundary.
  function refillQueue() {
    const target = targetQueueDepth();
    while (state.queue.length < target) {
      state.queuedCount += 1;
      const isProbe = state.queuedCount % PROBE_INTERVAL === 0;
      const word = L.nextWord(state.data.words, state.progress, state.slotIndex, {
        avoid: state.recent,
        ...(isProbe ? { forceBand: 'etude', isProbe: true } : {}),
      });
      if (!word) break;
      state.queue.push(word);
      state.recent.push(word.text);
      state.recent.splice(0, Math.max(0, state.recent.length - 60));
    }
  }

  // Fills state.ghostWords with a fresh batch of GHOST_COUNT real dictionary words for the
  // decorative strip past the real lookahead (see GHOST_COUNT above) - never pushed onto
  // state.queue or state.recent, never recorded as typed, since they're just a visual stand-in
  // for "more is coming" and must not affect real word selection or history. Called only at
  // the start of a stretch - session start (init), import (applyImport), or a LESSON_SIZE
  // break's resume - never from the normal per-word path in wordDone, which instead just
  // shifts one off the front to match the real queue shrinking. That split is what keeps the
  // content stable mid-stretch while still refreshing it, cleanly, lesson to lesson.
  function refillGhostWords() {
    const avoid = state.recent.concat(state.queue.map((word) => word.text));
    state.ghostWords = L.nextWords(state.data.words, state.progress, state.slotIndex, GHOST_COUNT, { avoid });
  }

  // Only stroke sequences that use unlocked keys are shown, so a word never asks for a locked key
  function startWord() {
    const word = currentWord();
    state.all = word ? L.displayVariants(word, unlockedMask()) : [];
    state.candidates = state.all;
    state.partial = 0;
    state.strokeIdx = 0;
    state.wordMisses = 0;
    state.wordWrongChords = 0;
    state.wordMs = 0;
    // The clock starts when the word appears, so finding and pressing the first chord counts
    // (otherwise a one-stroke word is timed only by how long the keys were held)
    state.lastChordEnd = performance.now();
    state.failures = [];
    state.previewBits = 0;
    state.doneStrokes = [];
  }

  // The word stream. Each word is a column, with its sounds and keys directly under it, so the
  // words, sounds and keys run as three parallel lines (two when Key hints are off, since the
  // keys line is hidden). The stroke being typed is highlighted. This is now a small live,
  // rolling buffer (LOOKAHEAD words) rather than a fixed lesson batch. Finished words stay in
  // the stream where they were typed, grayed out (state.done), so finishing a word only moves
  // the focus along - nothing before it jumps.
  function renderStream() {
    const stream = $('stream');
    stream.textContent = '';
    stream.classList.toggle('empty', state.queue.length === 0);
    // One-shot: only the render right after a break's blank pause gets the slow entrance -
    // every later re-render (every keystroke) must not keep replaying it.
    const entering = state.justResumed;
    state.justResumed = false;
    const mask = unlockedMask();
    let current = null;
    let lastDone = null;
    // The decorative ghost strip (see GHOST_COUNT/refillGhostWords above) is rendered through
    // this exact same loop, as real dictionary words - never real queued ones, never typed or
    // recorded - so a ghost cell's shape, coloring and spacing is pixel-identical to a real
    // upcoming (non-current) word. Only the 'ghost' class differs, which style.css uses to
    // fade the whole cell out - no separate rendering path to drift out of sync with this one.
    // Suppressed entirely near a break, where the real, shrinking taper count is the honest
    // thing to show instead.
    // Finished words come first, then the live queue, whose first word is the one being typed.
    const items = state.done.map((word) => ({ word, isDone: true, isGhost: false }));
    for (const word of state.queue) items.push({ word, isDone: false, isGhost: false });
    if (!nearBreak()) {
      for (const word of state.ghostWords) items.push({ word, isDone: false, isGhost: true });
    }
    const focusIndex = state.done.length;
    for (let i = 0; i < items.length; i++) {
      const { word, isDone, isGhost } = items[i];
      const isCurrent = !isDone && !isGhost && i === focusIndex;
      // A finished word shows the strokes it was actually typed with, not a dictionary guess.
      const strokes = isDone ? word.strokes : isCurrent ? shownStrokes() : L.displayVariants(word, mask)[0] || [];
      const cell = document.createElement('div');
      cell.className = `cell${isCurrent ? ' current' : ''}` +
        `${entering && !isGhost && !isDone ? ' entering' : ''}${isGhost ? ' ghost' : ''}` +
        `${isDone ? ' done' : ''}${isDone && word.missed ? ' missed' : ''}`;
      if (isDone) lastDone = cell;
      if (isGhost) cell.setAttribute('aria-hidden', 'true');
      cell.style.gridTemplateColumns = `repeat(${Math.max(1, strokes.length)}, auto)`;
      // After repeated misses the labels hidden by the level appear for just this word, as a
      // floating panel under it (.help-pop, out of the layout), so no cell moves or resizes.
      const helpPop = isCurrent && !labelsSetting() && L.labelsRevealed(state.progress, state.wordWrongChords)
        ? document.createElement('span') : null;
      if (helpPop) {
        helpPop.className = 'help-pop';
        helpPop.style.gridTemplateColumns = cell.style.gridTemplateColumns;
      }
      const labelHost = helpPop || cell;
      const wordEl = document.createElement('span');
      wordEl.className = 'w';
      wordEl.textContent = word.text;
      cell.appendChild(wordEl);
      // Every cell gets a preview row, even empty, so the current word's cell is not taller
      // than its neighbours - otherwise the row shifts down as soon as a word is selected,
      // which breaks reading left to right.
      const preview = document.createElement('span');
      preview.className = 'preview';
      if (isCurrent) {
        // A faint preview, above the word, of what letting go right now would actually
        // resolve to - steno's own translation of the chord, not just its sounds. While a
        // stroke is being held, it tracks the whole chord built up so far (state.chordBits),
        // not just the keys still held, so letting go of one key early mid-stroke doesn't drop
        // it. Once the whole stroke is let go, every other visual resets instantly - but the
        // preview keeps showing that stroke's resolution (state.previewBits) until the next
        // one starts replacing it, live, key by key.
        // A stroke still waiting for its rest (state.partial) stays in the preview while it is completed.
        // "Held" spans both input sources: a chord held only on the Uni v4 is just as live.
        const held = state.pressed.size > 0 || state.uniPressed.size > 0
          ? state.partial | state.chordBits
          : state.partial || state.previewBits;
        // Strokes of this word already typed right stay put, in order, ahead of the stroke
        // being held (TKAT then A reads "dat" and keeps "dat" once TKAT is let go).
        const shown = L.previewFor({
          word,
          done: state.doneStrokes,
          held,
          candidates: state.candidates,
          strokeIdx: state.strokeIdx,
          strokeWord: state.strokeWord,
          render: S.displayStroke,
        });
        if (shown) {
          // Green is a proper stroke that is right: a finished word, or a stroke that is the next
          // one (or a restart) of a spelling, even if the word is not finished yet. A stroke that
          // is only part of a stroke is not accurate yet, so it is pending, not green. A stroke that
          // fits nothing is red.
          const fit = held === 0 ? null : L.classifyStroke({
            chord: held,
            candidates: state.candidates,
            all: state.all,
            strokeIdx: state.strokeIdx,
          });
          if (fit && fit.type === 'partial') preview.classList.add('pending');
          else if (held !== 0 && !fit) preview.classList.add('unresolved');
          else if (shown.resolved || fit || state.doneStrokes.length > 0) preview.classList.add('resolved');
          preview.textContent = shown.text;
        }
      }
      cell.appendChild(preview);
      // Wrong keys used to be inserted into the sound sequence; they now go on their own row
      // below it instead, so a mistake never widens/narrows the stroke row it happened on and
      // shifts every cell after it. Collected here, across whichever column is current (there
      // is at most one), and rendered as its own grid row once the stroke loop is done.
      let errorEntries = [];
      strokes.forEach((bits, column) => {
        const status = !isCurrent ? '' : column < state.strokeIdx ? 'done' : column === state.strokeIdx ? 'current' : '';
        const sound = document.createElement('span');
        sound.className = `snd ${status}`;
        sound.style.gridColumn = column + 1;
        // `live` is keys held right now; `madeThisStroke` is every key pressed at any point
        // since this stroke started, live or already let go. Letting go of one key early,
        // mid-stroke, grays it out instead of dropping its colour entirely - the full chord
        // built so far stays visible until the whole stroke ends.
        const live = status === 'current' ? heldBits() : 0;
        const madeThisStroke = status === 'current' ? state.chordBits : 0;
        for (const name of S.displayOrder(S.namesInBits(bits))) {
          const ch = document.createElement('span');
          const bit = 1 << state.slotIndex.get(name);
          const isHeld = (live & bit) !== 0;
          // Once a correct key has been pressed in this stroke it stays green for the rest of
          // the stroke, held or not - only `released` (dimming) tracks whether it's still down.
          const wasPressed = isHeld || (madeThisStroke & bit) !== 0;
          const released = !isHeld && wasPressed;
          const group = S.keyGroup(name);
          const pair = S.keyPair(name, bits);
          ch.className = `ch${group ? ` ${group}` : ''}${wasPressed ? ' held' : ''}${released ? ' released' : ''}${pair ? ` pair-${pair}` : ''}`;
          ch.textContent = state.slotByName.get(name)?.sound || name;
          sound.appendChild(ch);
        }
        if (status === 'current') {
          // The instant the whole chord is let go, finishChord zeroes state.chordBits, so this
          // - like the green/red key colours above - clears completely and does not linger into
          // the next attempt or the gap before it.
          const soundOf = (name) => state.slotByName.get(name)?.sound || name;
          const liveWrongNames = new Set(S.namesInBits(live & ~bits));
          const wrongNames = S.displayOrder(S.namesInBits(madeThisStroke & ~bits));
          errorEntries = wrongNames
            .map((name) => ({
              text: soundOf(name),
              released: !liveWrongNames.has(name),
            }))
        }
        const keys = document.createElement('span');
        keys.className = `kc ${status}`;
        keys.style.gridColumn = column + 1;
        keys.textContent = keysFor(bits).join(' ');
        labelHost.append(sound, keys);
      });
      // Its own grid row below the strokes, between them and the keyhints row - empty and
      // taking no space until there's an actual mistake to show.
      const errors = document.createElement('span');
      errors.className = 'errors';
      for (const { text, released } of errorEntries) {
        const ch = document.createElement('span');
        ch.className = `ch wrong${released ? ' released' : ''}`;
        ch.textContent = text;
        errors.appendChild(ch);
      }
      labelHost.appendChild(errors);
      if (helpPop) cell.appendChild(helpPop);
      if (isCurrent) current = cell;
      stream.appendChild(cell);
    }
    const focus = current || lastDone;
    if (focus) keepFocusOnSecondRow(stream, focus);
  }

  // The stream wraps into rows, and the word being typed sits on its second row: the row above
  // it is scrolled to the top, so the words finished on that row stay in view. It is set on
  // every render; the stream animates the step when the focus moves down a row (style.css).
  function keepFocusOnSecondRow(stream, focus) {
    let rowTop = 0;
    for (const cell of stream.children) {
      if (cell.offsetTop < focus.offsetTop) rowTop = Math.max(rowTop, cell.offsetTop);
    }
    stream.scrollTop = rowTop;
  }

  // A green-up/red-down delta span, like keybr's metrics row. `fmt` formats the raw delta value.
  function deltaSpan(delta, fmt) {
    if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) return '';
    const kind = delta > 0 ? 'good' : 'bad';
    const arrow = delta > 0 ? '↑' : '↓';
    return ` <span class="delta ${kind}">(${arrow}${fmt(Math.abs(delta))})</span>`;
  }

  // Row 1: speed/accuracy/score for the live rolling window, with the delta against the
  // stats as of the last LESSON_SIZE-word milestone (a cosmetic checkpoint only - generation
  // and unlocking are judged continuously, every word, not at that or any other boundary).
  function renderMetrics() {
    const { progress } = state;
    const stats = L.windowStats(progress);
    const prev = state.lastLessonStats;
    const wpm = stats.count ? Math.round(stats.wpm) : 0;
    const accuracy = stats.count ? stats.accuracy * 100 : 100;
    const score = stats.count ? L.scoreFor(stats) : 0;
    const wpmDelta = prev ? wpm - Math.round(prev.wpm) : null;
    const accDelta = prev ? accuracy - prev.accuracy * 100 : null;
    const scoreDelta = prev ? score - L.scoreFor(prev) : null;
    $('metrics').innerHTML =
      `<span>Speed: <strong>${wpm}wpm</strong>${deltaSpan(wpmDelta, (v) => `${v.toFixed(1)}wpm`)}</span>` +
      `<span>Accuracy: <strong>${accuracy.toFixed(2)}%</strong>${deltaSpan(accDelta, (v) => `${v.toFixed(2)}%`)}</span>` +
      `<span>Score: <strong>${score.toLocaleString()}</strong>${deltaSpan(scoreDelta, (v) => v.toLocaleString())}</span>` +
      `<span>Level: <strong>${progress.level}</strong> <span class="muted">(${L.wpmTarget(progress.level)}wpm to unlock)</span></span>`;
    $('lesson-note').textContent = `Next break: ${state.sinceBreak}/${L.LESSON_SIZE}`;
  }

  // A single shared tooltip for the key chips, replacing the native `title` attribute - native
  // tooltips only ever show one line of plain text and pop up after a slow, browser-controlled
  // delay. This one shows a short labeled breakdown (accuracy/speed/confidence) almost
  // immediately, and tracks whichever chip is currently hovered or focused.
  let keyTooltipEl = null;
  let keyTooltipShowTimer = null;

  function keyTooltip() {
    if (!keyTooltipEl) {
      keyTooltipEl = document.createElement('div');
      keyTooltipEl.className = 'key-tooltip';
      keyTooltipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(keyTooltipEl);
    }
    return keyTooltipEl;
  }

  function hideKeyTooltip() {
    clearTimeout(keyTooltipShowTimer);
    keyTooltip().classList.remove('show');
  }

  function showKeyTooltip(anchor, html) {
    clearTimeout(keyTooltipShowTimer);
    keyTooltipShowTimer = setTimeout(() => {
      const tip = keyTooltip();
      tip.innerHTML = html;
      tip.classList.add('show');
      const rect = anchor.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
      let top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }, 80);
  }

  // Short delay (not zero) so brushing past several chips doesn't flash a tooltip per chip,
  // but far shorter than any native title delay. tabIndex makes the chip keyboard-focusable so
  // the same tooltip is reachable without a mouse.
  function bindKeyTooltip(el, html) {
    el.tabIndex = 0;
    el.addEventListener('mouseenter', () => showKeyTooltip(el, html));
    el.addEventListener('mouseleave', hideKeyTooltip);
    el.addEventListener('focus', () => showKeyTooltip(el, html));
    el.addEventListener('blur', hideKeyTooltip);
  }

  // What # is, for anyone who has never used a steno number bar.
  const NUMBER_KEY_NOTE = 'Number bar: hold # with S T P H A O (1 2 3 4 5 0) and -F -P -L -T (6 7 8 9) to type digits, like #ST for 12.';

  function keyTooltipHtml(progress, name) {
    const slot = state.slotByName.get(name);
    const header = `<strong>${escapeHtml(S.displayName(name))}</strong>` +
      (slot ? `<span class="kt-sound">${escapeHtml(slot.sound)}</span>` : '') +
      (name === '#' ? `<div class="kt-row note">${escapeHtml(NUMBER_KEY_NOTE)}</div>` : '');
    const stat = progress.keys[name];
    if (!stat || stat.ewmaMs === null || stat.samples < 5) {
      return `${header}<div class="kt-row muted">Not calibrated yet - needs more reps.</div>`;
    }
    const chordMs = Math.round(stat.ewmaMs);
    const accuracy = Math.round(L.keyAccuracy(progress, name) * 100);
    const confidence = Math.round(L.confidence(progress, name) * 100);
    const tierLabel = ['Learning', 'Solid', 'Mastered'][L.masteryTier(progress, name)];
    return `${header}` +
      `<div class="kt-row"><span>Accuracy</span><span>${accuracy}%</span></div>` +
      `<div class="kt-row"><span>Chord time</span><span>${chordMs} ms</span></div>` +
      `<div class="kt-row"><span>Confidence</span><span>${confidence}% (${tierLabel})</span></div>`;
  }

  // Row 2: one chip per key, unlocked keys tinted by confidence, the focus key outlined.
  function renderKeyChips() {
    const { progress } = state;
    const focus = L.focusKey(progress);
    const list = $('key-chips');
    list.textContent = '';
    // The chips are rebuilt from scratch below, which would otherwise leave a tooltip pointing
    // at a now-detached old chip if a refresh happens mid-hover.
    hideKeyTooltip();
    L.KEY_ORDER.forEach((name, index) => {
      const chip = document.createElement('li');
      const unlocked = index < progress.unlocked;
      chip.classList.toggle('locked', !unlocked);
      chip.classList.toggle('current', unlocked && name === focus);
      // Cubed so the chip reads as red/at-risk well before confidence actually bottoms out -
      // a key that's merely "pretty good" should still visibly warn, not look fully green.
      if (unlocked) chip.style.setProperty('--conf', (L.confidence(progress, name) ** 3).toFixed(2));
      if (unlocked) chip.classList.add(`tier-${L.masteryTier(progress, name)}`);
      chip.textContent = S.displayName(name);
      const tooltipHtml = unlocked
        ? keyTooltipHtml(progress, name)
        : `<strong>${escapeHtml(S.displayName(name))}</strong><div class="kt-row muted">Locked - unlock earlier keys first.</div>`;
      bindKeyTooltip(chip, tooltipHtml);
      list.appendChild(chip);
    });
  }

  // What each prestige level asks you to keep off, in plain words.
  const LEVEL_RULES = {
    1: 'Any help allowed: keyboard diagram or key hints',
    2: 'No diagram or hints. Stroke labels and target highlight still on',
    3: 'No help at all: just the word',
  };

  // Three stars after the key chips, one per prestige level: gold once the level is complete
  // (every key unlocked and the final lesson passed), outlined for the one you are on. Hover
  // for what the level asks, its speed bar and your progress; click to switch to it.
  function renderPrestige() {
    const list = $('key-chips');
    for (const row of L.levelSummary(state.progress)) {
      const star = document.createElement('li');
      star.className = `prestige-star${row.active ? ' active' : ''}${row.done ? ' done' : ''}`;
      star.textContent = '\u2605';
      let status = 'Not started';
      if (row.done) status = 'Complete';
      else if (row.allUnlocked) status = `All keys unlocked. Hit ${row.wpm} wpm at ${Math.round(L.ACCURACY_TARGET * 100)}%+ to finish`;
      else if (row.active || row.started) status = `${row.unlocked}/${row.total} keys unlocked${row.active ? ' - you are here' : ''}`;
      // Full only once complete: unlocking the last key is not finishing the level.
      const fill = row.done ? 100 : Math.round((Math.min(row.unlocked, row.total - 1) / row.total) * 100);
      bindKeyTooltip(star,
        `<strong>Prestige ${row.level}<span class="kt-sound">${row.wpm} wpm</span></strong>` +
        `<div class="kt-row note">${escapeHtml(LEVEL_RULES[row.level])}</div>` +
        `<div class="kt-bar"><span style="width:${fill}%"></span></div>` +
        `<div class="kt-row note">${escapeHtml(status)}</div>` +
        (row.best ? `<div class="kt-row note">Best: ${row.best} wpm</div>` : '') +
        (row.active ? '' : `<div class="kt-row note muted">Click to switch. Each level keeps its own keys.</div>`));
      star.addEventListener('click', () => chooseLevel(row.level));
      list.appendChild(star);
    }
  }

  // Sets the checkboxes and key hints a level asks for, which in turn moves progress to it.
  function chooseLevel(level) {
    if (level === state.progress.level) return;
    const settings = LEVEL_SETTINGS[level];
    Object.assign(state.progress.scaffolds, settings.scaffolds);
    state.hints = settings.hints;
    try {
      localStorage.setItem(HINTS_KEY, state.hints ? 'on' : 'off');
    } catch {
      // Saving is only a convenience; the setting still applies for this visit
    }
    applyHints();
    applyScaffoldBoxes();
    syncLevel();
    saveProgress();
    refresh();
  }

  // Row 3: the key most in need of practice right now, and what we know about it.
  function renderCurrentKey() {
    const { progress } = state;
    const name = L.focusKey(progress);
    const el = $('current-key');
    if (!name) {
      el.innerHTML = '<span class="muted">No key to focus on yet.</span>';
      return;
    }
    const stat = progress.keys[name];
    const slot = state.slotByName.get(name);
    const label = `<span class="chip-name">${escapeHtml(S.displayName(name))}</span>` +
      (name === '#' ? ` <span class="muted">${escapeHtml(NUMBER_KEY_NOTE)}</span><br>` : '');
    if (!stat || stat.ewmaMs === null || stat.samples < 5) {
      el.innerHTML = `${label} <span class="muted">Not calibrated, need more samples.</span>`;
      return;
    }
    const chordMs = Math.round(stat.ewmaMs);
    const accuracy = Math.round(L.keyAccuracy(progress, name) * 100);
    el.innerHTML =
      `${label} <span class="muted">${chordMs}ms per chord, ${accuracy}% accuracy${slot ? ` (${escapeHtml(slot.sound)})` : ''}.</span>`;
  }

  // The last 10 finished lessons, as two rows (Speed above Accuracy) in a grid, one column
  // per lesson, so the same lesson's two numbers line up vertically instead of being read
  // off two separate comma lists that don't visually pair up.
  function renderLessonHistory() {
    const history = (state.progress.lessonHistory || []).slice(-10);
    const el = $('lesson-history');
    el.textContent = '';
    if (history.length === 0) {
      el.innerHTML = '<span class="hud-label">Lessons:</span> <span class="muted">None finished yet.</span>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'lesson-history-grid';
    grid.style.gridTemplateColumns = `auto repeat(${history.length}, auto)`;
    const addRow = (label, cells, cls) => {
      const labelEl = document.createElement('span');
      labelEl.className = 'hud-label lh-row-label';
      labelEl.textContent = label;
      grid.appendChild(labelEl);
      for (const text of cells) {
        const cell = document.createElement('span');
        cell.className = `lh-cell${cls ? ` ${cls}` : ''}`;
        cell.textContent = text;
        grid.appendChild(cell);
      }
    };
    addRow('Speed:', history.map((entry) => `${Math.round(entry.wpm)}`));
    addRow('Accuracy:', history.map((entry) => `${Math.round(entry.accuracy * 100)}%`));
    el.appendChild(grid);
  }

  // Overall window stats (speed, accuracy, word count) can all clear their targets while one
  // specific unlocked key is still individually below KEY_ACCURACY_TARGET - that key alone
  // blocks the unlock, invisibly, unless called out here.
  function renderUnlockStatus() {
    const { progress } = state;
    const el = $('unlock-status');
    if (progress.completed[progress.level]) {
      el.textContent = '';
      return;
    }
    const stats = L.windowStats(progress);
    const overallReady = stats.count >= L.LESSON_SIZE
      && stats.wpm >= L.wpmTarget(progress.level)
      && stats.accuracy >= L.ACCURACY_TARGET;
    const blocking = L.unlockedNames(progress).filter((name) => L.keyAccuracy(progress, name) < L.KEY_ACCURACY_TARGET);
    if (overallReady && blocking.length > 0) {
      const names = blocking
        .map((name) => `${S.displayName(name)} (${Math.round(L.keyAccuracy(progress, name) * 100)}%)`)
        .join(', ');
      el.innerHTML = `<span class="hud-label">Blocking unlock:</span> <span class="bad">${escapeHtml(names)} - ` +
        `needs ${Math.round(L.KEY_ACCURACY_TARGET * 100)}%+ on each key, not just overall.</span>`;
    } else {
      el.textContent = '';
    }
  }

  function renderHud() {
    renderMetrics();
    renderKeyChips();
    renderPrestige();
    renderCurrentKey();
    renderUnlockStatus();
    renderLessonHistory();
  }

  // Keyboard and stream together, so held keys show on the word as well
  function renderChord() {
    renderKeyboard();
    renderStream();
  }

  function refresh() {
    renderStream();
    renderKeyboard();
    renderHud();
    updateAssistsCount();
  }

  // The server (public/api) is one way to run this app; a static host with no server, such
  // as GitHub Pages, is the other. `state.static` picks localStorage/the bundled data file
  // once the server's own endpoints turn out to be unavailable.
  const PROGRESS_KEY = 'steno-lessions-progress';
  const OLD_PROGRESS_KEY = 'steno-lessons-progress';

  async function saveProgress() {
    if (state.static) {
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
      } catch (error) {
        console.error('could not save progress', error);
        setFeedback('Progress could not be saved (browser storage unavailable).', 'bad');
      }
      return;
    }
    try {
      const response = await fetch('/api/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.progress),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.error('could not save progress', error);
      setFeedback('Progress could not be saved. Is the steno-lessions server still running?', 'bad');
    }
  }

  // A pause between chords longer than this is not typing, so it is left out of the word's time (ms)
  const IDLE_MS = 3000;
  // The * stroke, which is undo in Plover (the T key on this layout)
  const UNDO = S.parseStroke('*');

  function finishChord() {
    if (!currentWord()) return;
    const chord = state.chordBits;
    // The whole chord has just been let go. Every visual tied to holding it - the green/red
    // key colours, any wrong-key insert - resets instantly here, with nothing left lingering
    // until the next stroke. The preview is the one exception: it keeps showing what this
    // stroke resolved to (state.previewBits), so letting go doesn't blank it.
    state.previewBits = chord;
    state.chordBits = 0;
    const now = performance.now();
    const ms = now - state.chordStart;
    // Word time is the hold plus the wait before it (from the word appearing or the last
    // chord ending). A wait longer than IDLE_MS is capped, and time with the page unfocused
    // is not counted at all.
    if (state.lastChordEnd !== null) {
      const pause = state.chordStart - state.lastChordEnd;
      state.wordMs += Math.min(Math.max(pause, 0), IDLE_MS);
    }
    state.wordMs += ms;
    state.lastChordEnd = now;
    // Optimistic reading of the stroke, before it counts as a mistake. A chord let go early
    // (part of the next stroke) waits for the rest of it and is read together with it. If the
    // two together fit nothing, the new chord is read on its own.
    const fitOf = (value) => L.classifyStroke({
      chord: value,
      candidates: state.candidates,
      all: state.all,
      strokeIdx: state.strokeIdx,
    });
    let used = state.partial ? state.partial | chord : chord;
    let fitted = fitOf(used);
    if (!fitted && state.partial) {
      used = chord;
      fitted = fitOf(used);
    }
    state.partial = 0;
    // A wrong stroke (or an undo) is only previewed while it is held; once let go the preview
    // falls back to the strokes already typed right.
    if (!fitted || fitted.type === 'partial') state.previewBits = 0;

    if (chord === UNDO && (!fitted || fitted.type === 'partial')) {
      // As in Plover, * on its own is undo. It removes the last wrong attempt and nothing else,
      // so strokes already typed right are kept.
      if (state.failures.length === 0) {
        setFeedback('Nothing to undo. * only removes a wrong attempt.', 'bad');
      } else {
        state.failures.pop();
        setFeedback(
          state.failures.length ? `Undone. ${state.failures.length} wrong attempt(s) left.` : 'Undone. Back on track.',
          'good',
        );
      }
      refresh();
      return;
    }

    if (fitted && fitted.type === 'partial') {
      state.partial = used;
      setFeedback(`Keep going: ${S.displayStroke(used)} is part of ${nextStrokes().join(' or ')}.`, '');
      refresh();
      return;
    }

    if (fitted) {
      // The next stroke, or the first stroke of a spelling: the word is being redone from the start,
      // so the strokes typed before are replaced by this one.
      L.recordChord(state.progress, S.namesInBits(used), ms, true);
      state.failures = [];
      state.previewBits = 0;
      if (fitted.type === 'restart') {
        state.doneStrokes = [used];
        state.strokeIdx = 1;
        setFeedback('Starting the word again.', 'good');
      } else {
        state.doneStrokes.push(used);
        state.strokeIdx += 1;
        setFeedback('Good', 'good');
      }
      state.candidates = fitted.matches;
      if (state.candidates.some((strokes) => strokes.length === state.strokeIdx)) {
        wordDone();
      } else {
        refresh();
      }
      return;
    }

    // A real mistake: the stroke fits no spelling. It stays on screen as red text, listing every
    // stroke the word could need next, and the word waits until one of them is typed right.
    const target = currentStroke();
    // Accuracy is forgiving per word: however many wrong attempts a word takes, it counts
    // as one inaccuracy for the word, not one per attempt.
    state.wordMisses = 1;
    state.wordWrongChords += 1;
    // Blame only the keys that were wrong (missed or extra), not the whole stroke, so one
    // slip on a key doesn't also count against the keys pressed correctly beside it.
    L.recordChord(state.progress, S.namesInBits((target ^ used) & target || target), ms, false);
    // Only the latest mistake is ever shown or undoable - repeating the same wrong chord,
    // or making a different one, replaces it rather than piling on top of it. There is
    // never more than one live mistake to track at once.
    state.failures = [used];
    // Every full way to write the word, so the learner sees each spelling end to end, not just the next stroke
    const spellings = [...new Set(state.all.map((seq) => seq.map((bits) => S.displayStroke(bits)).join('/')))];
    const needed = spellings.map((spelling) => `- ${spelling}`).join('\n');
    setFeedback(
      `Needs\n${needed}\nYou pressed ${S.displayStroke(used)}\nPress * (T key) to undo.`,
      'bad',
    );
    refresh();
  }

  let unlockToastTimer = null;
  function showUnlockToast(text, allKeys, label) {
    const toast = $('unlock-toast');
    clearTimeout(unlockToastTimer);
    $('unlock-label').textContent = label || (allKeys ? 'All keys unlocked' : 'Key unlocked');
    $('unlock-name').textContent = text;
    toast.classList.toggle('all-keys', Boolean(allKeys));
    // Force a reflow so re-triggering the toast on back-to-back unlocks restarts the
    // transition instead of being a no-op (the class would already be set).
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    unlockToastTimer = setTimeout(() => toast.classList.remove('show'), allKeys ? 3200 : 2000);
  }

  function wordDone() {
    const finished = currentWord();
    L.recordWord(state.progress, { ms: state.wordMs, strokes: state.strokeIdx, misses: state.wordMisses });
    // A forced probe word's timing is also logged apart from the normal blended ewmaMs, so
    // kinematicGap can compare isolated-rep speed against everyday blended speed.
    if (finished.isProbe && finished.focusKeyAtPick) {
      L.recordProbe(state.progress, finished.focusKeyAtPick, state.wordMs);
    }
    state.typed += 1;
    // The finished word stays in the stream where it is, grayed out, instead of vanishing and
    // pulling everything after it along. Only the newest DONE_KEEP are kept, so the stream
    // stays small; the rest have already scrolled out of view.
    state.done.push({ text: finished.text, strokes: state.doneStrokes.slice(), missed: state.wordMisses > 0 });
    state.done.splice(0, Math.max(0, state.done.length - DONE_KEEP));
    state.queue.shift();
    // The ghost strip shrinks from the front in lockstep with the real queue - one consumed
    // per word, never refilled mid-stretch (see refillGhostWords) - so it reads as the same
    // fixed backdrop sliding by, not a list that's shuffled or topped back up every word.
    state.ghostWords.shift();

    // Unlocking is judged continuously - windowStats is already a rolling slice of the
    // newest LESSON_SIZE words, so there is no "boundary" to wait for; checking after every
    // word just means it fires the instant the window actually clears its targets.
    let toasted = false;
    if (L.unlockIfReady(state.progress)) {
      toasted = true;
      const name = L.KEY_ORDER[state.progress.unlocked - 1];
      const sound = state.slotByName.get(name)?.sound || '';
      const allKeys = state.progress.unlocked >= L.KEY_ORDER.length;
      setFeedback(
        `Unlocked ${S.displayName(name)} (${sound}). Next: ${L.wpmTarget(state.progress.level)} wpm.`,
        'good',
      );
      showUnlockToast(allKeys ? 'All Keys!' : `${S.displayName(name)} (${sound})`, allKeys);
    } else if (L.completeIfReady(state.progress)) {
      toasted = true;
      setFeedback(`Prestige ${state.progress.level} complete!`, 'good');
      showUnlockToast(`Prestige ${state.progress.level}`, true, 'Complete');
    }

    // Purely cosmetic break-reminder, every LESSON_SIZE words - a human milestone, not a
    // generation or judging boundary (both already run continuously, above). The queue has
    // already tapered itself down to nothing right on this word (targetQueueDepth), so the
    // stream is already blank below; this just holds it blank for a beat, then lets the next
    // stretch's first word(s) fade in, instead of refilling instantly.
    state.sinceBreak += 1;
    if (state.sinceBreak >= L.LESSON_SIZE) {
      state.sinceBreak = 0;
      // The finished words of the lesson just ended go too, so the stream wipes clean for the break
      state.done = [];
      state.lastLessonStats = L.windowStats(state.progress);
      L.recordLesson(state.progress, state.lastLessonStats);
      // The PB is the whole finished lesson's speed. A level-complete or unlock toast on this
      // same word wins; the record is still kept and shows in the star tooltip.
      const best = L.recordBestIfFaster(state.progress, state.lastLessonStats);
      if (best && !toasted) {
        setFeedback(`New prestige ${state.progress.level} best: ${best} wpm!`, 'good');
        showUnlockToast(`${best} wpm`, true, `Prestige ${state.progress.level} PB`);
      }
      state.onBreak = true;
      startWord();
      saveProgress();
      refresh();
      clearTimeout(state.breakTimer);
      state.breakTimer = setTimeout(() => {
        state.onBreak = false;
        state.justResumed = true;
        refillQueue();
        // The ghost strip has shrunk to nothing by now (one consumed per word, all stretch
        // long) - a fresh batch for the next stretch, same as a brand new "exercise" start.
        refillGhostWords();
        startWord();
        refresh();
      }, BREAK_PAUSE_MS);
      return;
    }

    refillQueue();
    startWord();
    saveProgress();
    refresh();
  }

  // Drops the chord being typed and stops the word clock, so time away from the page is not counted
  function clearChord() {
    state.pressed.clear();
    state.uniPressed.clear();
    state.chordBits = 0;
    state.lastChordEnd = null;
    for (const timer of state.releaseTimers.values()) clearTimeout(timer);
    state.releaseTimers.clear();
    renderChord();
  }

  // Blurs the practice screen as soon as the tab loses focus or is hidden, so time away from
  // the page is not counted as typing (clearChord already drops lastChordEnd for that).
  // Resuming happens on the tab becoming visible again, or on the next keypress.
  function pause() {
    if (state.paused) return;
    state.paused = true;
    clearChord();
    document.body.classList.add('paused');
    $('pause-overlay').classList.remove('hidden');
  }

  function resume() {
    if (!state.paused) return;
    state.paused = false;
    document.body.classList.remove('paused');
    $('pause-overlay').classList.add('hidden');
  }

  // Some setups (X11 without "detectable autorepeat", seen on this session's own OS) send a
  // held key as real repeated keyup/keydown pairs instead of one keydown with event.repeat -
  // so holding one key could otherwise look like typing the same stroke a dozen times. A
  // keyup is held for this long before it's believed; a keydown for the same code arriving
  // first cancels it, so the hold reads as one continuous press until the key truly comes up.
  const RELEASE_DEBOUNCE_MS = 25;

  // Keys are only taken over when they are steno keys. Everything else, and anything with
  // Ctrl, Alt or Meta held, passes through to the browser and the system untouched.
  document.addEventListener('keydown', (event) => {
    // Space scrolls the page by default; that's never wanted here, accidental or not.
    if (event.code === 'Space') event.preventDefault();
    if (state.paused) {
      resume();
      return;
    }
    const pendingRelease = state.releaseTimers.get(event.code);
    if (pendingRelease !== undefined) {
      // The OS repeating the key, not a new press - the key never really came up.
      clearTimeout(pendingRelease);
      state.releaseTimers.delete(event.code);
      event.preventDefault();
      return;
    }
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const info = state.infoByCode.get(event.code);
    if (!info) return;
    event.preventDefault();
    if (state.pressed.size === 0 && state.uniPressed.size === 0) {
      // A fresh stroke starts clean: finishChord already zeroed state.chordBits and cleared
      // every error visual the instant the last one was let go, so there is nothing left over
      // here to hide. The failures state is untouched, so undo (*)
      // still works and a wrong stroke still needs a correct retry.
      state.chordBits = 0;
      state.chordStart = performance.now();
      setKbd('qwerty');
    }
    state.pressed.add(event.code);
    state.chordBits |= info.bits;
    renderChord();
  });

  document.addEventListener('keyup', (event) => {
    if (!state.pressed.has(event.code)) return;
    const timer = setTimeout(() => {
      state.releaseTimers.delete(event.code);
      state.pressed.delete(event.code);
      // The chord is over only when both input sources are empty - a Uni chord still held
      // while the last QWERTY key comes up (or the reverse) keeps building.
      if (state.pressed.size === 0 && state.uniPressed.size === 0) finishChord();
      renderChord();
    }, RELEASE_DEBOUNCE_MS);
    state.releaseTimers.set(event.code, timer);
  });

  // The Uni v4 (Plover HID firmware) speaks its state over WebHID: every state change is
  // one report - report id 0x50, then 8 bytes of a 64-bit lever bitmask. A stroke is the
  // state going non-empty and then back to all-zero, which mirrors finishChord's
  // last-key-up model. Reports are snapshots, so each non-zero report is OR-ed into the
  // chord: a lever that went down and up mid-stroke is kept, exactly like Plover's own
  // accumulation. Plover itself keeps reading the same device - on Linux, hidraw hands a
  // copy of every report to each reader - so the machine can stay connected to both.
  let uniDevice = null;
  function setUniStatus(text) {
    const status = $('uni-status');
    status.textContent = text;
    status.classList.toggle('live', text === 'connected');
  }
  // Connected: the button has nothing left to do, so it gives way to the status.
  function showUniConnected(connected) {
    $('connect-uni').hidden = connected;
    setUniStatus(connected ? 'connected' : '');
  }

  // The diagram follows the input, so it only ever changes at the first key of a stroke (a
  // chord that mixes both sources keeps the board it started on).
  function setKbd(kind) {
    if (state.kbd === kind) return;
    state.kbd = kind;
    refresh();
  }

  const isPloverHid = (device) => device.collections.some((c) => c.usagePage === U.USAGE_PAGE && c.usage === U.USAGE);

  // Opens a granted device and starts reading its reports. Shared by the Connect button and
  // by the silent reconnect of a device the browser already has permission for.
  async function attachUni(device) {
    // Already connected: reopening would only invite a second open() rejection or a second
    // listener on the same device.
    if (uniDevice) return;
    if (!device.opened) await device.open();
    uniDevice = device;
    device.addEventListener('inputreport', onUniReport);
    device.addEventListener('disconnect', onUniDisconnect);
    showUniConnected(true);
    setKbd('uni');
  }

  // Chromium only opens its device chooser from a click or keypress, so a first connection
  // can't be prompted on page load - that is what the button is for. Once a device has been
  // granted, though, getDevices() hands it back with no prompt, and so does plugging it in.
  async function connectUni() {
    if (!navigator.hid || uniDevice) return;
    const button = $('connect-uni');
    button.disabled = true;
    try {
      const [device] = await navigator.hid.requestDevice({ filters: [{ usagePage: U.USAGE_PAGE, usage: U.USAGE }] });
      if (!device) { setFeedback('No keyboard selected.', 'bad'); return; }
      await attachUni(device);
      setFeedback('Plover HID keyboard connected. Its keys type here; QWERTY still works too.', 'good');
    } catch (error) {
      setFeedback(`Could not connect the keyboard: ${error.message}`, 'bad');
    } finally {
      button.disabled = false;
    }
  }

  async function reconnectUni() {
    try {
      const device = (await navigator.hid.getDevices()).find(isPloverHid);
      if (device) {
        await attachUni(device);
        setFeedback('Plover HID keyboard reconnected.', 'good');
      }
    } catch {
      // Another app has the device open, or it was unplugged mid-open: the button still works
    }
  }

  function onUniReport(event) {
    // WebHID strips the report id into event.reportId (Plover's hidapi reads keep it as
    // the first data byte) - pass both halves to the parser separately.
    const payload = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const state64 = U.parseHidState(event.reportId, payload);
    if (state64 === null) return;
    if (state.paused) { if (state64 !== 0n) resume(); else return; }
    const levers = U.chartKeys(state64);
    if (state64 === 0n) {
      state.uniPressed.clear();
      // The all-zero report is the chord's release. The chordBits guard keeps a stray or
      // repeated zero report (connect while keys rest half-pressed) from fabricating a
      // stroke out of nothing.
      if (state.pressed.size === 0 && state.chordBits !== 0) finishChord();
    } else {
      if (state.pressed.size === 0 && state.uniPressed.size === 0) {
        state.chordBits = 0;
        state.chordStart = performance.now();
        setKbd('uni');
      }
      for (const name of levers) state.uniPressed.add(name);
      state.chordBits |= U.strokeBits(levers);
    }
    renderChord();
  }

  function onUniDisconnect(event) {
    // With more than one device ever connected, an older device's goodbye must not end the
    // newer one's connection.
    if (uniDevice && event.device && event.device !== uniDevice) return;
    // The device object survives its own disconnect event, so take the listeners back off
    // it - a reconnected device would otherwise stack a second copy of each handler.
    event.device.removeEventListener('inputreport', onUniReport);
    event.device.removeEventListener('disconnect', onUniDisconnect);
    uniDevice = null;
    // The machine's half of a held chord can never finish now - take its bits back out of
    // the shared chord space, so a later QWERTY release doesn't score levers that are no
    // longer on the desk. Any QWERTY keys still held keep building their chord.
    state.chordBits &= ~U.strokeBits([...state.uniPressed]);
    state.uniPressed.clear();
    showUniConnected(false);
    setKbd('qwerty');
    setFeedback('Plover HID keyboard disconnected. QWERTY typing still works.', 'bad');
    renderChord();
  }

  const UNI_WARNING_KEY = 'steno-lessions.uni-warning-dismissed';
  function setupUni() {
    const button = $('connect-uni');
    if (!navigator.hid) {
      // Firefox and Safari have no WebHID, so there is no way to see a Plover HID keyboard
      // from here: say so up front, to anyone who has one, instead of a dead button.
      button.hidden = true;
      let dismissed = false;
      try { dismissed = localStorage.getItem(UNI_WARNING_KEY) === '1'; } catch { /* shown again next visit */ }
      $('uni-warning').hidden = dismissed;
      $('uni-warning-dismiss').addEventListener('click', () => {
        $('uni-warning').hidden = true;
        try { localStorage.setItem(UNI_WARNING_KEY, '1'); } catch { /* shown again next visit */ }
      });
      return;
    }
    button.addEventListener('click', connectUni);
    reconnectUni();
    navigator.hid.addEventListener('connect', (event) => {
      if (isPloverHid(event.device)) reconnectUni();
    });
  }

  window.addEventListener('blur', () => { clearChord(); pause(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearChord(); pause(); } else { resume(); }
  });

  async function getJson(url) {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  // The Assists popover on the nav: all the helper switches behind one button, with a count
  // of how many are on. Closes on an outside click or Escape. The switches keep their ids, so
  // the rest of the page reads and sets them exactly as before.
  const ASSIST_IDS = ['hints', 'show-labels', 'show-target', 'show-keyboard'];
  function updateAssistsCount() {
    const on = ASSIST_IDS.filter((id) => $(id).checked).length;
    $('assists-count').textContent = `${on}/${ASSIST_IDS.length}`;
  }
  function setupAssists() {
    const button = $('assists-btn');
    const panel = $('assists-panel');
    const setOpen = (open) => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => setOpen(panel.hidden));
    document.addEventListener('click', (event) => {
      if (!panel.hidden && !$('assists').contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        button.focus();
      }
    });
    panel.addEventListener('change', updateAssistsCount);
    updateAssistsCount();
  }

  async function init() {
    setupAssists();
    // Draw the board right away - the first data-driven render is only after the bundle fetches.
    renderKeyboard();
    // The Uni v4 connect button, also wired before the data load: connecting the machine
    // has no dependency on the bundle, and the button should say so even when it fails.
    setupUni();
    // The layout and dictionary are hardcoded data, the same on a plain static host (e.g.
    // GitHub Pages) as behind server.js, so there's exactly one place to load them from.
    const ready = Object.fromEntries(await Promise.all(
      Object.keys(THEORIES).map(async (id) => [id, await theoryReady(id)]),
    ));
    if (!ready[theory]) theory = "plover";
    try {
      state.data = await getJson(THEORIES[theory].dir + 'bundle.json');
    } catch (error) {
      $('error').hidden = false;
      $('error').textContent = `Could not load steno data: ${error.message}`;
      if (theory !== 'plover') {
        $('error').textContent += `. The ${THEORIES[theory].label} data is built locally: run node scripts/build-theory.js ${theory} <folder with its JSON files>, then reload. Until then, switch the Theory back to Plover.`;
      }
      return;
    }
    const theoryPicker = $('theory');
    theoryPicker.innerHTML = Object.entries(THEORIES)
      .filter(([id]) => ready[id])
      .map(([id, { label }]) => `<option value="${id}">${label}</option>`).join('');
    theoryPicker.value = theory;
    theoryPicker.addEventListener('change', (event) => {
      try {
        localStorage.setItem(THEORY_KEY, event.target.value);
      } catch {
        // Without storage the choice still applies, but the next visit starts on Plover
      }
      location.reload();
    });
    // Progress still has two homes: server.js's /api/progress when it's there to answer, or
    // this browser's localStorage on a static host with no server at all.
    try {
      state.progress = L.normalize(await getJson('/api/progress'));
      state.static = false;
    } catch (error) {
      state.static = true;
      try {
        const saved = localStorage.getItem(PROGRESS_KEY) ?? localStorage.getItem(OLD_PROGRESS_KEY);
        state.progress = L.normalize(saved ? JSON.parse(saved) : null);
      } catch (localError) {
        state.progress = L.emptyProgress();
      }
    }
    // The dictionary has no numbers, so add every one-stroke number: the only way to practice
    // the # key, which makes digits when held with other keys.
    state.data.words = state.data.words.concat(S.buildNumberWords());
    buildIndexes(state.data.layout);
    buildStrokeIndex(state.data.words);
    loadFullResolver();
    buildKeyboard();
    buildUniKeyboard();
    applyHints();
    $("hints").addEventListener("change", (event) => {
      state.hints = event.target.checked;
      try {
        localStorage.setItem(HINTS_KEY, state.hints ? "on" : "off");
      } catch {
        // Saving is only a convenience; the setting still applies for this visit
      }
      applyHints();
      syncLevel();
      saveProgress();
      refresh();
    });
    L.switchLevel(state.progress, L.levelFor(state.progress.scaffolds, state.hints));
    applyScaffoldBoxes();
    for (const [flag, id] of SCAFFOLD_BOXES) {
      $(id).addEventListener('change', (event) => {
        state.progress.scaffolds[flag] = event.target.checked;
        syncLevel();
        saveProgress();
        refresh();
      });
    }
    refillQueue();
    refillGhostWords();
    startWord();
    refresh();
    setupTransfer();
  }

  // Export: one click copies the whole progress object to the clipboard. Import: the box
  // looks like a normal text field, but every key is swallowed except paste, and a paste is
  // applied immediately (no separate submit step, as if it had also pressed enter for you).
  // The progress JSON is repetitive, so deflate + base64 shrinks it several times over. Imports
  // still accept plain JSON, so older exports keep working.
  const PACKED_PREFIX = 'SL1:';
  async function pipeBytes(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function packProgress(progress) {
    const bytes = await pipeBytes(new TextEncoder().encode(JSON.stringify(progress)), new CompressionStream('deflate-raw'));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return PACKED_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpackProgress(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith(PACKED_PREFIX)) return JSON.parse(trimmed);
    const b64 = trimmed.slice(PACKED_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(await pipeBytes(bytes, new DecompressionStream('deflate-raw'))));
  }

  function setupTransfer() {
    $('export-progress').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await packProgress(state.progress));
        setFeedback('Progress copied to clipboard.', 'good');
      } catch (error) {
        setFeedback(`Could not copy progress: ${error.message}`, 'bad');
      }
    });

    function applyImport(incoming) {
      state.progress = incoming;
      state.recent = [];
      state.queue = [];
      state.done = [];
      state.sinceBreak = 0;
      L.switchLevel(state.progress, L.levelFor(state.progress.scaffolds, state.hints));
      applyScaffoldBoxes();
      refillQueue();
      refillGhostWords();
      startWord();
      saveProgress();
      refresh();
      setFeedback('Progress imported from clipboard.', 'good');
    }

    const importBox = $('import-progress');
    importBox.addEventListener('keydown', (event) => {
      event.stopPropagation();
      const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
      if (!isPaste) event.preventDefault();
    });
    importBox.addEventListener('paste', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = event.clipboardData.getData('text');
      importBox.value = '';
      let incoming;
      try {
        incoming = L.normalize(await unpackProgress(text));
      } catch (error) {
        setFeedback(`Could not import progress: ${error.message}`, 'bad');
        return;
      }
      // Fast-forwarding (as much or more play than what's already here) applies instantly.
      // Rewinding (less play) can only be a mistake or outdated data, so it needs a
      // deliberate, slowed-down confirmation instead of silently erasing progress.
      if (L.isRewind(state.progress, incoming)) {
        confirmRewind(() => applyImport(incoming));
      } else {
        applyImport(incoming);
      }
    });
  }

  // A 3-second-locked confirmation modal, used only when an import would undo progress.
  function confirmRewind(onProceed) {
    const modal = $('rewind-modal');
    const proceedBtn = $('rewind-proceed');
    const cancelBtn = $('rewind-cancel');
    modal.classList.remove('hidden');
    let secondsLeft = 3;
    proceedBtn.disabled = true;
    proceedBtn.textContent = `Proceed with rewind (${secondsLeft})`;
    const tick = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(tick);
        proceedBtn.disabled = false;
        proceedBtn.textContent = 'Proceed with rewind';
      } else {
        proceedBtn.textContent = `Proceed with rewind (${secondsLeft})`;
      }
    }, 1000);

    function close() {
      clearInterval(tick);
      modal.classList.add('hidden');
      proceedBtn.removeEventListener('click', onProceedClick);
      cancelBtn.removeEventListener('click', onCancelClick);
    }
    function onProceedClick() {
      close();
      onProceed();
    }
    function onCancelClick() {
      close();
      setFeedback('Import cancelled.', 'bad');
    }
    proceedBtn.addEventListener('click', onProceedClick);
    cancelBtn.addEventListener('click', onCancelClick);
  }

  init();
})();

// The practice page. You type on your normal keyboard, with no steno mode: hold every key
// for a stroke at once, then release. The chord is scored when the last key comes up, so the
// keys can land in any order. Any stroke Plover maps to the word is accepted.
(function () {
  const S = window.StenoData;
  const L = window.StenoLessons;

  // The full keyboard, row by row. `label` is the key's main character. `shift` is the
  // character shown when Shift is held. Keys with a `code` are named keys (Shift, Tab, ...).
  const letter = (label) => ({ label });
  const sym = (label, shift) => ({ label, shift });
  const named = (label, code, width) => ({ label, code, width });
  const ROWS = [
    [sym('`', '~'), sym('1', '!'), sym('2', '@'), sym('3', '#'), sym('4', '$'), sym('5', '%'),
      sym('6', '^'), sym('7', '&'), sym('8', '*'), sym('9', '('), sym('0', ')'), sym('-', '_'),
      sym('=', '+'), named('Backspace', 'Backspace', 'w2')],
    [named('Tab', 'Tab', 'w15'), ...'QWERTYUIOP'.split('').map(letter), sym('[', '{'), sym(']', '}'),
      sym('\\', '|', 'w15')],
    [named('Caps Lock', 'CapsLock', 'w175'), ...'ASDFGHJKL'.split('').map(letter), sym(';', ':'),
      sym("'", '"'), named('Enter', 'Enter', 'w2')],
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
  const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const state = {
    data: null,
    progress: L.emptyProgress(),
    slotIndex: new Map(S.SLOTS.map(([, name], index) => [name, index])),
    infoByCode: new Map(), // event.code -> { bits, sound, combined, label }
    slotByName: new Map(), // "S-" -> { name, sound, label }
    strokeWord: new Map(), // single-stroke chord bits -> the word it translates to
    hints: readHints(),
    keyEls: new Map(), // event.code -> element
    lesson: [], // the current lesson's words, fixed size
    index: 0, // the word being typed, within the lesson
    recent: [], // words used lately, so lessons do not repeat them
    lastLessonStats: null, // previous lesson's windowStats, for the HUD deltas
    candidates: [], // stroke sequences still possible for the current word
    strokeIdx: 0,
    wordMisses: 0,
    wordMs: 0,
    lastChordEnd: null,
    failures: [], // wrong attempts still being drilled - tracked for retry/undo, not displayed
    previewBits: 0, // the last stroke's chord, kept after release so the preview survives it
    lessonTransitionTimer: null,
    releaseTimers: new Map(), // event.code -> pending debounced-release timeout id
    drill: 0,
    typed: 0, // words finished this session
    pressed: new Set(),
    chordBits: 0,
    chordStart: 0,
    paused: false,
  };

  const currentWord = () => state.lesson[state.index];
  // The stroke sequence to show: the first one that is still possible
  const shownStrokes = () => state.candidates[0] || [];
  const currentStroke = () => shownStrokes()[state.strokeIdx] || 0;
  const unlockedMask = () => L.unlockedMask(state.progress, state.slotIndex);
  const namesOf = (bits) => S.namesInBits(bits).map(S.displayName).join(' ') || 'nothing';
  // The steno keys held right now, as a stroke mask
  const heldBits = () => [...state.pressed].reduce((bits, code) => bits | (state.infoByCode.get(code)?.bits || 0), 0);

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
      dict = await getJson('data/dictionary.json');
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
  // hint reads like the chord on the keyboard (e.g. "V" for A- and O-).
  function keysFor(bits) {
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
    for (const keys of ROWS) {
      const row = document.createElement('div');
      row.className = 'kb-row';
      for (const key of keys) {
        const code = key.code || codeFor(key.label);
        const el = document.createElement('div');
        el.className = 'key';
        el.dataset.code = code;
        if (key.width) el.classList.add(key.width);
        if (fingerByCode.has(code)) el.dataset.finger = fingerByCode.get(code);
        if (HOME_ROW.has(code)) el.classList.add('home');
        const info = state.infoByCode.get(code);
        if (info) {
          // Steno keys show the sound big, and the letter small in the corner
          const letterEl = document.createElement('span');
          letterEl.className = 'letter';
          letterEl.textContent = info.label;
          el.appendChild(letterEl);
          const main = document.createElement('span');
          main.className = 'main sound';
          main.textContent = info.sound.replace(/ \+ /g, '+');
          el.appendChild(main);
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
        state.keyEls.set(code, el);
        row.appendChild(el);
      }
      keyboard.appendChild(row);
    }
  }

  function renderKeyboard() {
    const target = currentStroke();
    const mask = unlockedMask();
    for (const [code, el] of state.keyEls) {
      const info = state.infoByCode.get(code);
      el.classList.toggle('steno', Boolean(info));
      el.classList.toggle('locked', Boolean(info) && (info.bits & ~mask) !== 0);
      el.classList.toggle('target', state.hints && Boolean(info) && target !== 0 && (info.bits & target) === info.bits);
      el.classList.toggle('down', state.pressed.has(code));
    }
  }

  // Starts a new fixed-size lesson. Called on load and whenever the previous lesson finishes,
  // so a freshly unlocked key's words show up in the very next lesson with no special-casing.
  function nextLesson() {
    const picks = L.startLesson(state.data.words, state.progress, state.slotIndex, { avoid: state.recent });
    state.lesson = picks;
    state.index = 0;
    state.recent.push(...picks.map((word) => word.text));
    state.recent.splice(0, Math.max(0, state.recent.length - 60));
  }

  // Only stroke sequences that use unlocked keys are shown, so a word never asks for a locked key
  function startWord() {
    const word = currentWord();
    state.candidates = word ? L.displayVariants(word, unlockedMask()) : [];
    state.strokeIdx = 0;
    state.wordMisses = 0;
    state.wordMs = 0;
    state.lastChordEnd = null;
    state.failures = [];
    state.previewBits = 0;
    state.drill = 0;
  }

  // The word stream. Each word is a column, with its sounds and keys directly under it, so the
  // words, sounds and keys run as three parallel lines (two when Key hints are off, since the
  // keys line is hidden). The stroke being typed is highlighted.
  function renderStream() {
    const stream = $('stream');
    stream.textContent = '';
    const mask = unlockedMask();
    let current = null;
    for (let i = 0; i < state.lesson.length; i++) {
      const word = state.lesson[i];
      const isCurrent = i === state.index;
      const strokes = isCurrent ? shownStrokes() : L.displayVariants(word, mask)[0] || [];
      const cell = document.createElement('div');
      cell.className = `cell${i < state.index ? ' done' : ''}${isCurrent ? ' current' : ''}`;
      cell.style.gridTemplateColumns = `repeat(${Math.max(1, strokes.length)}, auto)`;
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
        const held = state.pressed.size > 0 ? state.chordBits : state.previewBits;
        if (held) {
          const continues = state.candidates.some((seq) => seq[state.strokeIdx] === held);
          if (continues) {
            preview.classList.add('resolved');
            preview.textContent = word.text;
          } else {
            const known = state.strokeWord.get(held);
            if (known) {
              preview.classList.add('resolved');
              preview.textContent = known;
            } else {
              preview.classList.add('unresolved');
              preview.textContent = S.renderStroke(held);
            }
          }
        }
      }
      cell.appendChild(preview);
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
        for (const name of S.namesInBits(bits)) {
          const ch = document.createElement('span');
          const bit = 1 << state.slotIndex.get(name);
          const isHeld = (live & bit) !== 0;
          // Once a correct key has been pressed in this stroke it stays green for the rest of
          // the stroke, held or not - only `released` (dimming) tracks whether it's still down.
          const wasPressed = isHeld || (madeThisStroke & bit) !== 0;
          const released = !isHeld && wasPressed;
          const group = S.keyGroup(name);
          const pair = S.keyPair(name);
          ch.className = `ch${group ? ` ${group}` : ''}${wasPressed ? ' held' : ''}${released ? ' released' : ''}${pair ? ` pair-${pair}` : ''}`;
          if (group) ch.style.setProperty('--shade', S.keyShade(name));
          ch.dataset.slot = String(state.slotIndex.get(name));
          ch.textContent = state.slotByName.get(name)?.sound || name;
          sound.appendChild(ch);
        }
        if (status === 'current') {
          // Wrong keys are inserted into the sound sequence at the slot position they'd
          // naturally fall in (left to right, same order as the correct sounds), instead of
          // being appended after it. The instant the whole chord is let go, finishChord zeroes
          // state.chordBits, so this - like the green/red key colours above - clears completely
          // and does not linger into the next attempt or the gap before it.
          const soundOf = (name) => state.slotByName.get(name)?.sound || name;
          const liveWrongNames = new Set(S.namesInBits(live & ~bits));
          const wrongNames = S.namesInBits(madeThisStroke & ~bits);
          const insertions = wrongNames.map((name) => ({
            at: state.slotIndex.get(name),
            text: soundOf(name),
            released: !liveWrongNames.has(name),
          }));
          for (const { at, text, released } of insertions) {
            const ch = document.createElement('span');
            ch.className = `ch wrong${released ? ' released' : ''}`;
            ch.textContent = text;
            // Find the correct-sound span already in this slot's position, if any, and insert
            // right after it, so wrong keys land among the sounds in the same left-to-right
            // order instead of all trailing at the end.
            const before = [...sound.children].find(
              (el) => el.dataset.slot !== undefined && Number(el.dataset.slot) > at,
            );
            sound.insertBefore(ch, before || null);
          }
        }
        const keys = document.createElement('span');
        keys.className = `kc ${status}`;
        keys.style.gridColumn = column + 1;
        keys.textContent = keysFor(bits).join(' ');
        cell.append(sound, keys);
      });
      if (isCurrent) current = cell;
      stream.appendChild(cell);
    }
    if (current) {
      // Keep the word being typed in view as the bounded lesson fills the box.
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  // A green-up/red-down delta span, like keybr's metrics row. `fmt` formats the raw delta value.
  function deltaSpan(delta, fmt) {
    if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) return '';
    const kind = delta > 0 ? 'good' : 'bad';
    const arrow = delta > 0 ? '↑' : '↓';
    return ` <span class="delta ${kind}">(${arrow}${fmt(Math.abs(delta))})</span>`;
  }

  // Row 1: speed/accuracy/score for the lesson in progress, with the delta against the
  // previous finished lesson.
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
      `<span>Score: <strong>${score.toLocaleString()}</strong>${deltaSpan(scoreDelta, (v) => v.toLocaleString())}</span>`;
    $('lesson-note').textContent = `Lesson: ${state.index}/${state.lesson.length}`;
  }

  // Row 2: one chip per key, unlocked keys tinted by confidence, the focus key outlined.
  function renderKeyChips() {
    const { progress } = state;
    const focus = L.focusKey(progress);
    const list = $('key-chips');
    list.textContent = '';
    L.KEY_ORDER.forEach((name, index) => {
      const chip = document.createElement('li');
      const unlocked = index < progress.unlocked;
      chip.classList.toggle('locked', !unlocked);
      chip.classList.toggle('current', unlocked && name === focus);
      if (unlocked) chip.style.setProperty('--conf', L.confidence(progress, name).toFixed(2));
      chip.textContent = S.displayName(name);
      chip.title = state.slotByName.get(name)?.sound || name;
      list.appendChild(chip);
    });
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
    const label = `<span class="chip-name">${escapeHtml(S.displayName(name))}</span>`;
    if (!stat || stat.ewmaMs === null || stat.samples < 5) {
      el.innerHTML = `${label} <span class="muted">Not calibrated, need more samples.</span>`;
      return;
    }
    const wpmLike = Math.round(60000 / stat.ewmaMs);
    const accuracy = Math.round(L.keyAccuracy(progress, name) * 100);
    el.innerHTML =
      `${label} <span class="muted">${wpmLike}wpm, ${accuracy}% accuracy${slot ? ` (${escapeHtml(slot.sound)})` : ''}.</span>`;
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
    if (progress.unlocked >= L.KEY_ORDER.length) {
      el.textContent = '';
      return;
    }
    const stats = L.windowStats(progress);
    const overallReady = stats.count >= L.LESSON_SIZE
      && stats.wpm >= L.wpmTarget(progress.unlocked)
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
  // After a mistake, the stroke must be typed right this many times in a row to go on
  const DRILL_REPEATS = 1;
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
    // Word time is active typing only: the hold, plus the pause before it if the pause was
    // short. A longer pause, or time with the page unfocused, is not counted.
    if (state.lastChordEnd !== null) {
      const pause = state.chordStart - state.lastChordEnd;
      if (pause <= IDLE_MS) state.wordMs += pause;
    }
    state.wordMs += ms;
    state.lastChordEnd = now;
    const matches = state.candidates.filter((strokes) => strokes[state.strokeIdx] === chord);

    if (matches.length === 0 && chord === UNDO) {
      // As in Plover, * on its own is undo. It removes the last wrong attempt and nothing else,
      // so strokes already typed right are kept.
      if (state.failures.length === 0) {
        setFeedback('Nothing to undo. * only removes a wrong attempt.', 'bad');
      } else {
        state.failures.pop();
        if (state.failures.length === 0) state.drill = 0;
        setFeedback(
          state.failures.length ? `Undone. ${state.failures.length} wrong attempt(s) left.` : 'Undone. Back on track.',
          'good',
        );
      }
      refresh();
      return;
    }

    if (matches.length === 0) {
      // The mistake stays on screen as red text. The word waits on this stroke until it is
      // typed right DRILL_REPEATS times in a row. Strokes already typed right are kept.
      const target = currentStroke();
      // Accuracy is forgiving per word: however many wrong attempts a word takes, it counts
      // as one inaccuracy for the word, not one per attempt.
      state.wordMisses = 1;
      L.recordChord(state.progress, S.namesInBits(target), ms, false);
      // Only the latest mistake is ever shown or undoable - repeating the same wrong chord,
      // or making a different one, replaces it rather than piling on top of it. DRILL_REPEATS
      // only ever asks for "1 more right in a row" regardless of how many tries it took to get
      // there, so there is never more than one live mistake to track at once.
      state.failures = [chord];
      state.drill = DRILL_REPEATS;
      setFeedback(
        `Needs ${S.renderStroke(target)} (${namesOf(target)}). You pressed ${namesOf(chord)}. ` +
          `Type it ${state.drill} more times in a row to go on, or press * (T key) to undo.`,
        'bad',
      );
      refresh();
      return;
    }

    L.recordChord(state.progress, S.namesInBits(chord), ms, true);
    if (state.drill > 0) {
      state.drill -= 1;
      if (state.drill > 0) {
        setFeedback(`Right. ${state.drill} more in a row.`, 'good');
        refresh();
        return;
      }
      state.failures = [];
    }
    state.candidates = matches;
    state.strokeIdx += 1;
    setFeedback('Good', 'good');
    if (matches.some((strokes) => strokes.length === state.strokeIdx)) {
      wordDone();
    } else {
      refresh();
    }
  }

  let unlockToastTimer = null;
  function showUnlockToast(text, allKeys) {
    const toast = $('unlock-toast');
    clearTimeout(unlockToastTimer);
    $('unlock-label').textContent = allKeys ? 'All keys unlocked' : 'Key unlocked';
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
    L.recordWord(state.progress, { ms: state.wordMs, strokes: state.strokeIdx, misses: state.wordMisses });
    state.typed += 1;
    state.index += 1;

    if (state.index >= state.lesson.length) {
      // Lesson boundary: this is the one point unlocks are decided, the stats window is
      // judged, and the word queue is reset, so a fresh lesson always reflects any new key.
      state.lastLessonStats = L.windowStats(state.progress);
      L.recordLesson(state.progress, state.lastLessonStats);
      if (L.unlockIfReady(state.progress)) {
        const name = L.KEY_ORDER[state.progress.unlocked - 1];
        const sound = state.slotByName.get(name)?.sound || '';
        const allKeys = state.progress.unlocked >= L.KEY_ORDER.length;
        setFeedback(
          `Unlocked ${S.displayName(name)} (${sound}). Next: ${L.wpmTarget(state.progress.unlocked)} wpm.`,
          'good',
        );
        showUnlockToast(allKeys ? 'All Keys!' : `${S.displayName(name)} (${sound})`, allKeys);
      }
      nextLesson();
      playLessonTransition();
    }

    startWord();
    saveProgress();
    refresh();
  }

  // A brief slide-down as a new lesson's words come in, so one lesson visibly ends and the
  // next begins instead of the word stream just silently swapping its contents.
  function playLessonTransition() {
    const stream = $('stream');
    stream.classList.remove('lesson-enter');
    void stream.offsetWidth; // restart the animation even if one is still finishing
    stream.classList.add('lesson-enter');
    clearTimeout(state.lessonTransitionTimer);
    state.lessonTransitionTimer = setTimeout(() => stream.classList.remove('lesson-enter'), 500);
  }

  // Drops the chord being typed and stops the word clock, so time away from the page is not counted
  function clearChord() {
    state.pressed.clear();
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
    if (state.pressed.size === 0) {
      // A fresh stroke starts clean: finishChord already zeroed state.chordBits and cleared
      // every error visual the instant the last one was let go, so there is nothing left over
      // here to hide. The failures state (and the drill count) are untouched, so undo (*)
      // still works and a wrong stroke still needs a correct retry.
      state.chordBits = 0;
      state.chordStart = performance.now();
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
      if (state.pressed.size === 0) finishChord();
      renderChord();
    }, RELEASE_DEBOUNCE_MS);
    state.releaseTimers.set(event.code, timer);
  });

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

  async function init() {
    // The layout and dictionary are hardcoded data, the same on a plain static host (e.g.
    // GitHub Pages) as behind server.js, so there's exactly one place to load them from.
    try {
      state.data = await getJson('data/bundle.json');
    } catch (error) {
      $('error').hidden = false;
      $('error').textContent = `Could not load steno data: ${error.message}`;
      return;
    }
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
    buildIndexes(state.data.layout);
    buildStrokeIndex(state.data.words);
    loadFullResolver();
    buildKeyboard();
    applyHints();
    $("hints").addEventListener("change", (event) => {
      state.hints = event.target.checked;
      try {
        localStorage.setItem(HINTS_KEY, state.hints ? "on" : "off");
      } catch {
        // Saving is only a convenience; the setting still applies for this visit
      }
      applyHints();
      refresh();
    });
    nextLesson();
    startWord();
    refresh();
    setupTransfer();
  }

  // Export: one click copies the whole progress object to the clipboard. Import: the box
  // looks like a normal text field, but every key is swallowed except paste, and a paste is
  // applied immediately (no separate submit step, as if it had also pressed enter for you).
  function setupTransfer() {
    $('export-progress').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(state.progress));
        setFeedback('Progress copied to clipboard.', 'good');
      } catch (error) {
        setFeedback(`Could not copy progress: ${error.message}`, 'bad');
      }
    });

    function applyImport(incoming) {
      state.progress = incoming;
      state.recent = [];
      nextLesson();
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
    importBox.addEventListener('paste', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = event.clipboardData.getData('text');
      importBox.value = '';
      let incoming;
      try {
        incoming = L.normalize(JSON.parse(text));
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

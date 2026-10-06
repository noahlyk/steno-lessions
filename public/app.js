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
  const HINTS_KEY = "steno-lessons.hints";
  function readHints() {
    try {
      return localStorage.getItem(HINTS_KEY) !== "off";
    } catch {
      return true;
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
    hints: readHints(),
    keyEls: new Map(), // event.code -> element
    queue: [], // words in the stream, oldest first
    index: 0, // the word being typed
    recent: [], // words used lately, so the stream does not repeat them
    candidates: [], // stroke sequences still possible for the current word
    strokeIdx: 0,
    wordMisses: 0,
    wordMs: 0,
    lastChordEnd: null,
    failures: [],
    drill: 0,
    typed: 0, // words finished this session
    pressed: new Set(),
    chordBits: 0,
    chordStart: 0,
  };

  const currentWord = () => state.queue[state.index];
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

  // The word stream: keep at least 20 words ahead of the word being typed.
  function ensureQueue() {
    while (state.queue.length - state.index < 20) {
      const picks = L.pickWords(state.data.words, state.progress, state.slotIndex, { avoid: state.recent });
      if (picks.length === 0) break;
      state.queue.push(...picks);
      state.recent.push(...picks.map((word) => word.text));
      state.recent.splice(0, Math.max(0, state.recent.length - 60));
    }
    // Forget words well behind, so the page stays light
    const drop = state.index - 40;
    if (drop > 0) {
      state.queue.splice(0, drop);
      state.index -= drop;
    }
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
    state.drill = 0;
  }

  // The word stream. Each word is a column, with its sounds and keys directly under it, so the
  // words, sounds and keys run as three parallel lines (two when Key hints are off, since the
  // keys line is hidden). The stroke being typed is highlighted.
  function renderStream() {
    const stream = $('stream');
    stream.textContent = '';
    const mask = unlockedMask();
    const from = Math.max(0, state.index - 30);
    const to = Math.min(state.queue.length, state.index + 25);
    let current = null;
    for (let i = from; i < to; i++) {
      const word = state.queue[i];
      const isCurrent = i === state.index;
      const strokes = isCurrent ? shownStrokes() : L.displayVariants(word, mask)[0] || [];
      const cell = document.createElement('div');
      cell.className = `cell${i < state.index ? ' done' : ''}${isCurrent ? ' current' : ''}`;
      cell.style.gridTemplateColumns = `repeat(${Math.max(1, strokes.length)}, auto)`;
      const wordEl = document.createElement('span');
      wordEl.className = 'w';
      wordEl.textContent = word.text;
      cell.appendChild(wordEl);
      strokes.forEach((bits, column) => {
        const status = !isCurrent ? '' : column < state.strokeIdx ? 'done' : column === state.strokeIdx ? 'current' : '';
        const sound = document.createElement('span');
        sound.className = `snd ${status}`;
        sound.style.gridColumn = column + 1;
        const held = status === 'current' ? heldBits() : 0;
        for (const name of S.namesInBits(bits)) {
          const ch = document.createElement('span');
          const isHeld = (held & (1 << state.slotIndex.get(name))) !== 0;
          const group = S.keyGroup(name);
          ch.className = `ch${group ? ` ${group}` : ''}${isHeld ? ' held' : ''}`;
          ch.textContent = state.slotByName.get(name)?.sound || name;
          sound.appendChild(ch);
        }
        if (status === 'current') {
          // Red text past the sounds: keys held that the stroke does not use, and the
          // mistakes still to be drilled. Neither changes the layout.
          const soundOf = (name) => state.slotByName.get(name)?.sound || name;
          const wrong = S.namesInBits(held & ~bits).map(soundOf);
          const failed = state.failures.map((chord) => S.namesInBits(chord).map(soundOf).join(''));
          if (wrong.length || failed.length) {
            const extra = document.createElement('span');
            extra.className = 'extra';
            extra.textContent = [...failed, ...wrong].join(' ');
            sound.appendChild(extra);
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
      // Scroll so the word being typed sits on the second row
      const rowGap = parseFloat(getComputedStyle(stream).rowGap) || 0;
      stream.scrollTop = Math.max(0, current.offsetTop - current.offsetHeight - rowGap);
    }
  }

  function renderKeyList() {
    const list = $('key-list');
    list.textContent = '';
    L.KEY_ORDER.forEach((name, index) => {
      const item = document.createElement('li');
      item.classList.toggle('locked', index >= state.progress.unlocked);
      const confidence = L.confidence(state.progress, name);
      const slot = state.slotByName.get(name);
      item.innerHTML =
        `<span class="name">${escapeHtml(S.displayName(name))}</span>` +
        `<span class="sound">${escapeHtml(slot.sound)}<span class="keyname"> · ${escapeHtml(slot.label)}</span></span>` +
        `<span class="bar"><i style="width:${Math.round(confidence * 100)}%"></i></span>`;
      list.appendChild(item);
    });
  }

  function renderStats() {
    const { progress } = state;
    const stats = L.windowStats(progress);
    const wpm = stats.count ? Math.round(stats.wpm) : '—';
    const accuracy = stats.count ? Math.round(stats.accuracy * 100) : 100;
    const target = L.wpmTarget(progress.unlocked);
    const need = Math.round(L.ACCURACY_TARGET * 100);
    $('stats').innerHTML =
      `<span>keys <strong>${progress.unlocked}</strong>/${L.KEY_ORDER.length}</span>` +
      `<span title="current / needed">wpm <strong>${wpm}</strong>/${target}</span>` +
      `<span title="current / needed">accuracy <strong>${accuracy}%</strong>/${need}%</span>` +
      `<span>words <strong>${state.typed}</strong></span>`;
    $('window-note').textContent =
      `${stats.count}/${L.WORD_WINDOW} words to the next key`;
  }

  // Keyboard and stream together, so held keys show on the word as well
  function renderChord() {
    renderKeyboard();
    renderStream();
  }

  function refresh() {
    renderStream();
    renderKeyboard();
    renderKeyList();
    renderStats();
  }

  async function saveProgress() {
    try {
      const response = await fetch('/api/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.progress),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.error('could not save progress', error);
      setFeedback('Progress could not be saved. Is the steno-lessons server still running?', 'bad');
    }
  }

  // A pause between chords longer than this is not typing, so it is left out of the word's time (ms)
  const IDLE_MS = 3000;
  // After a mistake, the stroke must be typed right this many times in a row to go on
  const DRILL_REPEATS = 3;

  function finishChord() {
    if (!currentWord()) return;
    const chord = state.chordBits;
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

    if (matches.length === 0) {
      // The mistake stays on screen as red text. The word waits on this stroke until it is
      // typed right DRILL_REPEATS times in a row. Strokes already typed right are kept.
      const target = currentStroke();
      state.wordMisses += 1;
      L.recordChord(state.progress, S.namesInBits(target), ms, false);
      state.failures.push(chord);
      state.drill = DRILL_REPEATS;
      setFeedback(
        `Needs ${S.renderStroke(target)} (${namesOf(target)}). You pressed ${namesOf(chord)}. ` +
          `Type it ${state.drill} more times in a row to go on.`,
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

  function wordDone() {
    L.recordWord(state.progress, { ms: state.wordMs, strokes: state.strokeIdx, misses: state.wordMisses });
    state.typed += 1;
    if (L.unlockIfReady(state.progress)) {
      const name = L.KEY_ORDER[state.progress.unlocked - 1];
      const sound = state.slotByName.get(name)?.sound || '';
      setFeedback(
        `Unlocked ${S.displayName(name)} (${sound}). Next: ${L.wpmTarget(state.progress.unlocked)} wpm.`,
        'good',
      );
    }
    state.index += 1;
    ensureQueue();
    startWord();
    saveProgress();
    refresh();
  }

  // Drops the chord being typed and stops the word clock, so time away from the page is not counted
  function clearChord() {
    state.pressed.clear();
    state.chordBits = 0;
    state.lastChordEnd = null;
    renderChord();
  }

  // Keys are only taken over when they are steno keys. Everything else, and anything with
  // Ctrl, Alt or Meta held, passes through to the browser and the system untouched.
  document.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const info = state.infoByCode.get(event.code);
    if (!info) return;
    event.preventDefault();
    if (state.pressed.size === 0) {
      state.chordBits = 0;
      state.chordStart = performance.now();
    }
    state.pressed.add(event.code);
    state.chordBits |= info.bits;
    renderChord();
  });

  document.addEventListener('keyup', (event) => {
    if (!state.pressed.delete(event.code)) return;
    if (state.pressed.size === 0) finishChord();
    renderChord();
  });

  window.addEventListener('blur', clearChord);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearChord(); });

  async function getJson(url) {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function init() {
    try {
      state.data = await getJson('/api/data');
    } catch (error) {
      $('error').hidden = false;
      $('error').textContent = `Could not load steno data: ${error.message}`;
      return;
    }
    try {
      state.progress = L.normalize(await getJson('/api/progress'));
    } catch (error) {
      $('error').hidden = false;
      $('error').textContent = `Progress not loaded (${error.message}). Starting fresh.`;
      state.progress = L.emptyProgress();
    }
    buildIndexes(state.data.layout);
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
    ensureQueue();
    startWord();
    refresh();
  }

  init();
})();

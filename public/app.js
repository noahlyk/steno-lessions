// The practice page. A stroke is a chord: hold every key for it at once, then release.
// The chord is scored when the last key comes up, so the keys can land in any order.
(function () {
  const S = window.StenoData;
  const L = window.StenoLessons;

  // The full keyboard, row by row. `label` is the key's main character, which is also the
  // label keymux's layout uses for steno keys. `shift` is the character shown when Shift is
  // held. Keys with a `code` are named keys (Shift, Tab, ...) with no steno meaning.
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

  // Which finger presses each key, for coloring the steno keys like the reference layout.
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
  const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const state = {
    data: null,
    progress: L.emptyProgress(),
    slotIndex: new Map(S.SLOTS.map(([, name], index) => [name, index])),
    infoByCode: new Map(), // event.code -> { bits, sound, combined, label }
    slotByName: new Map(), // "S-" -> { name, sound, label }
    keyEls: new Map(), // event.code -> element
    lesson: [],
    lessonNumber: 1,
    lastWords: [],
    wordIdx: 0,
    strokeIdx: 0,
    lessonStart: 0,
    lessonCorrect: 0,
    lessonMisses: 0,
    summaryOpen: false,
    pressed: new Set(),
    chordBits: 0,
    chordStart: 0,
  };

  function currentWord() {
    return state.lesson[state.wordIdx];
  }

  function currentStroke() {
    const word = currentWord();
    return word ? word.strokes[state.strokeIdx] : 0;
  }

  function unlockedMask() {
    return L.unlockedMask(state.progress, state.slotIndex);
  }

  function setFeedback(text, kind) {
    const el = $('feedback');
    el.textContent = text;
    el.className = `feedback${kind ? ` ${kind}` : ''}`;
  }

  function soundOfBits(bits) {
    return S.namesInBits(bits)
      .map((name) => ({ name, sound: state.slotByName.get(name)?.sound || '' }));
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
        if (fingerByCode.has(code)) el.dataset.finger = fingerByCode.get(code);
        if (HOME_ROW.has(code)) el.classList.add('home');
        const info = state.infoByCode.get(code);
        if (info) {
          const sound = document.createElement('span');
          sound.className = 'sound';
          sound.textContent = info.sound;
          el.appendChild(sound);
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
      el.classList.toggle('target', Boolean(info) && target !== 0 && (info.bits & target) === info.bits);
      el.classList.toggle('down', state.pressed.has(code));
    }
  }

  function renderWord() {
    const word = currentWord();
    $('word').textContent = word ? word.text : '';
    $('word-count').textContent = word ? `word ${state.wordIdx + 1} of ${state.lesson.length}` : '';
    $('lesson-label').textContent = `Lesson ${state.lessonNumber}`;

    const strokes = $('strokes');
    strokes.textContent = '';
    if (word) {
      word.notation.split('/').forEach((notation, index) => {
        const chip = document.createElement('span');
        chip.className = 'stroke-chip';
        if (index < state.strokeIdx) chip.classList.add('done');
        if (index === state.strokeIdx) chip.classList.add('current');
        chip.textContent = notation;
        strokes.appendChild(chip);
      });
    }

    const sounds = $('sounds');
    sounds.textContent = '';
    const target = currentStroke();
    if (target) {
      for (const { name, sound } of soundOfBits(target)) {
        const span = document.createElement('span');
        span.innerHTML = `<b>${escapeHtml(name)}</b> ${escapeHtml(sound)}`;
        sounds.appendChild(span);
      }
    }
  }

  function renderKeyList() {
    const list = $('key-list');
    list.textContent = '';
    L.KEY_ORDER.forEach((name, index) => {
      const item = document.createElement('li');
      const unlocked = index < state.progress.unlocked;
      item.classList.toggle('locked', !unlocked);
      const confidence = L.confidence(state.progress, name);
      const slot = state.slotByName.get(name);
      item.innerHTML =
        `<span class="name">${escapeHtml(name)}</span>` +
        `<span class="sound">${escapeHtml(slot.sound)} · key ${escapeHtml(slot.label)}</span>` +
        `<span class="bar"><i style="width:${Math.round(confidence * 100)}%"></i></span>`;
      list.appendChild(item);
    });
  }

  function renderStats() {
    const { progress } = state;
    const total = state.lessonCorrect + state.lessonMisses;
    const minutes = state.lessonStart ? (performance.now() - state.lessonStart) / 60000 : 0;
    const speed = minutes > 0.02 ? Math.round(state.lessonCorrect / minutes) : 0;
    const accuracy = total ? Math.round((state.lessonCorrect / total) * 100) : 100;
    $('stats').innerHTML =
      `<span>keys <strong>${progress.unlocked}</strong> of ${L.KEY_ORDER.length}</span>` +
      `<span>strokes/min <strong>${speed}</strong></span>` +
      `<span>accuracy <strong>${accuracy}%</strong></span>` +
      `<span>words <strong>${state.data.words.length}</strong></span>`;
  }

  function refresh() {
    renderWord();
    renderKeyboard();
    renderKeyList();
    renderStats();
  }

  function startLesson() {
    const words = L.pickLesson(state.data.words, state.progress, state.slotIndex, {
      avoid: state.lastWords,
    });
    if (words.length === 0) {
      setFeedback('No words can be made from the keys so far. Check the dictionary in your keymux config.', 'bad');
      return;
    }
    state.lesson = words;
    state.lastWords = words.map((word) => word.text);
    state.wordIdx = 0;
    state.strokeIdx = 0;
    state.lessonStart = performance.now();
    state.lessonCorrect = 0;
    state.lessonMisses = 0;
    state.lessonNumber = state.progress.lessons + 1;
    state.summaryOpen = false;
    $('summary').hidden = true;
    setFeedback('Hold every key for the stroke at once, then release.');
    refresh();
  }

  function finishChord() {
    const word = currentWord();
    if (!word) return;
    const target = word.strokes[state.strokeIdx];
    const ms = performance.now() - state.chordStart;
    const correct = state.chordBits === target;
    L.recordChord(state.progress, S.namesInBits(target), ms, correct);

    if (correct) {
      state.lessonCorrect += 1;
      state.strokeIdx += 1;
      setFeedback(`Good, ${Math.round(ms)} ms`, 'good');
      if (state.strokeIdx >= word.strokes.length) {
        wordDone();
        return;
      }
    } else {
      state.lessonMisses += 1;
      const typed = S.namesInBits(state.chordBits).join(' ') || 'nothing';
      const wanted = S.namesInBits(target).join(' ');
      setFeedback(`You pressed ${typed}. The stroke needs ${wanted}.`, 'bad');
    }
    refresh();
  }

  function wordDone() {
    state.wordIdx += 1;
    state.strokeIdx = 0;
    if (state.wordIdx >= state.lesson.length) {
      lessonDone();
      return;
    }
    saveProgress();
    refresh();
  }

  function lessonDone() {
    const { progress } = state;
    progress.lessons += 1;
    const unlockedNow = L.unlockIfReady(progress);
    const total = state.lessonCorrect + state.lessonMisses;
    const minutes = (performance.now() - state.lessonStart) / 60000;
    const speed = minutes > 0 ? Math.round(state.lessonCorrect / minutes) : 0;
    const accuracy = total ? Math.round((state.lessonCorrect / total) * 100) : 100;

    let unlockText = 'Keep practicing these keys to unlock the next one.';
    if (unlockedNow) {
      const name = L.KEY_ORDER[progress.unlocked - 1];
      const sound = state.slotByName.get(name)?.sound || '';
      unlockText = `New key unlocked: ${name} (sound ${sound}).`;
    }

    $('summary-title').textContent = `Lesson ${state.lessonNumber} complete`;
    $('summary-body').textContent =
      `${speed} strokes per minute, ${accuracy}% accurate. ${unlockText}`;
    $('summary').hidden = false;
    state.summaryOpen = true;
    saveProgress();
    refresh();
  }

  function skipWord() {
    state.wordIdx += 1;
    state.strokeIdx = 0;
    if (state.wordIdx >= state.lesson.length) {
      lessonDone();
      return;
    }
    refresh();
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

  function clearChord() {
    state.pressed.clear();
    state.chordBits = 0;
    renderKeyboard();
  }

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (state.summaryOpen) {
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault();
        state.summaryOpen = false;
        startLesson();
      }
      return;
    }
    if (event.code === 'Escape') {
      skipWord();
      return;
    }
    const info = state.infoByCode.get(event.code);
    if (!info) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    event.preventDefault();
    if (state.pressed.size === 0) {
      state.chordBits = 0;
      state.chordStart = performance.now();
    }
    state.pressed.add(event.code);
    state.chordBits |= info.bits;
    renderKeyboard();
  });

  document.addEventListener('keyup', (event) => {
    if (!state.pressed.delete(event.code)) return;
    if (state.pressed.size === 0) finishChord();
    renderKeyboard();
  });

  window.addEventListener('blur', clearChord);

  $('next-lesson').addEventListener('click', () => {
    state.summaryOpen = false;
    startLesson();
  });

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
      $('word').textContent = '—';
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
    startLesson();
  }

  init();
})();

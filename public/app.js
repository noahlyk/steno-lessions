// The practice page. A stroke is a chord: hold every key for it at once, then release.
// The chord is scored when the last key comes up, so the keys can land in any order.
(function () {
  const S = window.StenoData;
  const L = window.StenoLessons;

  // The physical keys drawn on the keyboard, row by row, using the labels keymux's layout uses.
  const ROWS = [
    { keys: ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], offset: 0 },
    { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'], offset: 1 },
    { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"], offset: 2 },
    { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'], offset: 0 },
  ];
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
    const addRow = (keys, offset) => {
      const row = document.createElement('div');
      row.className = `kb-row${offset ? ` offset-${offset}` : ''}`;
      for (const key of keys) {
        const { label, code = codeFor(label), width } = typeof key === 'string' ? { label: key } : key;
        const el = document.createElement('div');
        el.className = 'key';
        el.dataset.code = code;
        el.textContent = label;
        const info = state.infoByCode.get(code);
        if (info) {
          const sound = document.createElement('span');
          sound.className = 'sound';
          sound.textContent = info.sound;
          el.appendChild(sound);
        }
        if (width) el.classList.add(width);
        state.keyEls.set(code, el);
        row.appendChild(el);
      }
      keyboard.appendChild(row);
    };
    for (const row of ROWS) {
      addRow(row.keys, row.offset);
    }
    addRow([{ label: 'Space', code: 'Space', width: 'space' }], 0);
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

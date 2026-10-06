// Steno data: parses keymux's layout and Plover's dictionary into stroke bitmasks.
// Shared by the server (Node) and the page (browser), so it has no dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StenoData = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Mirrors SLOTS in keymux's src/steno/layout.rs: bit i is slot i, and the letter
  // is how the slot appears in Plover's stroke strings.
  const SLOTS = [
    ['S', 'S-'], ['T', 'T-'], ['K', 'K-'], ['P', 'P-'], ['W', 'W-'], ['H', 'H-'],
    ['R', 'R-'], ['A', 'A-'], ['O', 'O-'], ['*', '*'], ['E', '-E'], ['U', '-U'],
    ['F', '-F'], ['R', '-R'], ['P', '-P'], ['B', '-B'], ['L', '-L'], ['G', '-G'],
    ['T', '-T'], ['S', '-S'], ['D', '-D'], ['Z', '-Z'], ['#', '#'],
  ];
  const NUMBER_SLOT = 22;
  const LEFT_END = 7;

  const slotIndex = new Map(SLOTS.map(([, name], index) => [name, index]));

  // Port of parse_stroke in keymux. Returns null for anything that is not one stroke.
  function parseStroke(text) {
    let bits = 0;
    let cursor = 0;
    for (const ch of text) {
      if (ch === '#') {
        bits |= 1 << NUMBER_SLOT;
      } else if (ch === '-') {
        cursor = Math.max(cursor, LEFT_END);
      } else {
        let slot = -1;
        for (let i = cursor; i < NUMBER_SLOT; i++) {
          if (SLOTS[i][0] === ch) {
            slot = i;
            break;
          }
        }
        if (slot < 0) return null;
        bits |= 1 << slot;
        cursor = slot + 1;
      }
    }
    return bits === 0 ? null : bits;
  }

  // Parses `keymux steno layout` output. Each row is a steno key, the physical key that
  // presses it, and its sound. Rows with a `+` are combined keys.
  function parseLayout(text) {
    const rows = text
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(1)
      .map((line) => line.split(/\s{2,}/));
    const slots = [];
    const keys = [];
    for (const [name, label, sound] of rows) {
      if (!label || !sound) throw new Error(`unexpected layout row: "${name}"`);
      const parts = name.split('+');
      let bits = 0;
      for (const part of parts) {
        if (!slotIndex.has(part)) throw new Error(`unknown steno key "${part}" in layout`);
        bits |= 1 << slotIndex.get(part);
      }
      if (parts.length === 1) {
        slots.push({ name, index: slotIndex.get(name), sound, label });
      }
      keys.push({ label, bits, combined: parts.length > 1, name, sound });
    }
    return { slots, keys };
  }

  // The steno key names in one stroke mask, in Plover's order.
  function namesInBits(bits) {
    const names = [];
    SLOTS.forEach(([, name], index) => {
      if (bits & (1 << index)) names.push(name);
    });
    return names;
  }

  // Builds one entry per English word from Plover-style `{stroke: text}` pairs. Keeps the
  // shortest stroke sequence for each word. Only plain lowercase words are kept, so
  // proper nouns, punctuation and {^suffix} entries are left out.
  function buildWords(entries) {
    const best = new Map();
    for (const [key, text] of entries) {
      if (typeof text !== 'string' || !/^[a-z]{1,12}$/.test(text)) continue;
      const parts = key.split('/');
      const strokes = parts.map(parseStroke);
      if (strokes.some((bits) => bits === null)) continue;
      const previous = best.get(text);
      if (!previous || strokes.length < previous.strokes.length) {
        best.set(text, { text, strokes, notation: parts.join('/') });
      }
    }
    return [...best.values()].sort((a, b) => a.text.localeCompare(b.text));
  }

  return { SLOTS, parseStroke, parseLayout, namesInBits, buildWords };
});

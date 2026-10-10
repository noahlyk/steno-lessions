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

  const MAX_STROKES = 3;

  function popcount(bits) {
    let count = 0;
    for (let rest = bits; rest; rest &= rest - 1) count += 1;
    return count;
  }

  // Builds one entry per English word from Plover-style `{stroke: text}` pairs. Plover
  // usually has several strokes for one word, and any of them should count, so every
  // stroke sequence is kept in `variants`. `shown` is the one to display: fewest strokes,
  // then fewest keys, the same choice `keymux steno keys` makes. Only plain lowercase
  // words are kept, so proper nouns, punctuation and {^suffix} entries are left out.
  function buildWords(entries) {
    const byText = new Map();
    for (const [key, text] of entries) {
      if (typeof text !== 'string' || !/^[a-z]{1,12}$/.test(text)) continue;
      const parts = key.split('/');
      if (parts.length > MAX_STROKES) continue;
      const strokes = parts.map(parseStroke);
      if (strokes.some((bits) => bits === null)) continue;
      if (!byText.has(text)) byText.set(text, new Map());
      byText.get(text).set(key, strokes);
    }
    return [...byText]
      .map(([text, sequences]) => {
        const ranked = [...sequences].map(([notation, strokes]) => ({
          notation,
          strokes,
          keys: strokes.reduce((total, bits) => total + popcount(bits), 0),
        })).sort((a, b) =>
          a.strokes.length - b.strokes.length || a.keys - b.keys || (a.notation < b.notation ? -1 : 1));
        return {
          text,
          shown: ranked[0].notation.split('/'),
          variants: ranked.map((item) => item.strokes),
        };
      })
      .sort((a, b) => a.text.localeCompare(b.text));
  }

  // Plover notation for a stroke mask, the reverse of parseStroke. Mirrors render_stroke in
  // keymux: a dash marks right-hand keys when there is no vowel or star before them.
  function renderStroke(bits) {
    const letters = (from, to) =>
      SLOTS.slice(from, to).map(([letter], i) => (bits & (1 << (from + i)) ? letter : '')).join('');
    const left = letters(0, LEFT_END);
    const middle = letters(LEFT_END, 12);
    const right = letters(12, NUMBER_SLOT);
    const number = bits & (1 << NUMBER_SLOT) ? '#' : '';
    return `${number}${left}${!middle && right ? '-' : ''}${middle}${right}`;
  }

  // The name shown for a steno key, as in traditional steno: left-side keys are bare (S, T) and
  // right-side keys take a leading dash (-S, -T). The exception is a letter with only one key,
  // which is always bare, like the vowels and -F.
  function displayName(name) {
    const letter = name.replace(/-/g, '');
    const keys = SLOTS.filter(([slotLetter]) => slotLetter === letter).length;
    const rightSide = name.startsWith('-') && letter !== '*' && letter !== '#';
    return rightSide && keys > 1 ? name : letter;
  }

  // Which part of the steno layout a key is in, so the page can colour the left-hand keys,
  // the vowels and star, and the right-hand keys differently. '#' is none of them.
  function keyGroup(name) {
    const index = slotIndex.get(name);
    if (index === undefined || index === NUMBER_SLOT) return '';
    if (index < LEFT_END) return 'left';
    if (index < 12) return 'middle';
    return 'right';
  }

  // Slot-index pairs that sit in the same physical column (top row over home row, e.g. the
  // W/S or E/D keys on the left, or Y/H, U/J, I/K, O/L, P/; on the right) or side-by-side on
  // the same row (the vowel pairs C/V and N/M) and so get fingered together as a unit rather
  // than as two separate keys. Keyed both ways for O(1) lookup of a slot's partner. S- (the
  // lone "A" key) and * (the lone "T" key) have no column partner on this keyboard and stay
  // unpaired.
  const PAIRS = [
    [1, 2], [3, 4], [5, 6], // left: W/S, E/D, R/F
    [7, 8], [10, 11], // vowels: C/V, N/M
    [12, 13], [14, 15], [16, 17], [18, 19], [20, 21], // right: Y/H, U/J, I/K, O/L, P/;
  ];
  const pairOf = new Map();
  PAIRS.forEach(([a, b], pair) => {
    pairOf.set(a, { pair, pos: 'a', with: b });
    pairOf.set(b, { pair, pos: 'b', with: a });
  });

  // Splits a group's slot-index range into columns, merging each fingered-together pair into
  // one column so they always land in the same column (and so get the same shade).
  function columnsOf(start, end) {
    const cols = [];
    for (let i = start; i < end; i++) {
      const p = pairOf.get(i);
      if (p && p.pos === 'b') continue; // already folded into its partner's column
      cols.push(p && p.pos === 'a' ? [i, p.with] : [i]);
    }
    return cols;
  }

  // Where a key sits within its own group (left/middle/right), as a fraction from 0 (first
  // column in the group) to 1 (last). Slot order follows the physical key columns, so two keys
  // close in this fraction are easy mistakes to make with one finger - shading by it lets the
  // page tint each key in a group slightly differently without leaving the group's colour.
  // Keys fingered together as a pair share one column, so they always get the same shade.
  function keyShade(name) {
    const index = slotIndex.get(name);
    if (index === undefined || index === NUMBER_SLOT) return 0;
    const [start, end] = index < LEFT_END ? [0, LEFT_END] : index < 12 ? [LEFT_END, 12] : [12, NUMBER_SLOT];
    const cols = columnsOf(start, end);
    const colIndex = cols.findIndex((col) => col.includes(index));
    return cols.length > 1 ? colIndex / (cols.length - 1) : 0;
  }

  // 'a'/'b' if this key is the first/second half of a fingered-together pair (see PAIRS) AND
  // its partner is also in `bits` - a single key with no partner in this stroke is never part
  // of a pair, even if it has one on the keyboard - '' otherwise.
  function keyPair(name, bits) {
    const index = slotIndex.get(name);
    if (index === undefined) return '';
    const p = pairOf.get(index);
    if (!p || !(bits & (1 << p.with))) return '';
    return p.pos;
  }

  return {
    SLOTS, parseStroke, parseLayout, namesInBits, buildWords, popcount, renderStroke, displayName,
    keyGroup, keyShade, keyPair,
  };
});

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
      // A steno key can list a second physical key later (an extra key, like Q for S-). The
      // first row is the key's own; the extra rows only add to `keys`.
      if (parts.length === 1 && !slots.some((slot) => slot.name === name)) {
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

  // The same names, in the order the page shows them: the star sits at the end of the left-hand
  // (orange) keys, just before the vowels, rather than between O and E where Plover writes it.
  // Display only - bit positions, Plover notation and renderStroke are untouched.
  // Sounds are read in this order: #STKPWHRAO*EUFRPBLGTSDZ (the number key first).
  function displayOrder(names) {
    const rank = (name) => (name === '#' ? -1 : slotIndex.get(name));
    return names.slice().sort((a, b) => rank(a) - rank(b));
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

  // The single-stroke suffixes in a Plover-style dictionary ({^ing} on -G, {^s} on -S ...), as
  // { text: [notation, ...] } with the simplest strokes first. buildWords drops these entries
  // (they are not words), so they are kept here for suffixComposer.
  const MAX_SUFFIX_STROKES = 4;
  function buildSuffixes(entries) {
    const found = new Map();
    for (const [key, text] of entries) {
      const match = typeof text === 'string' ? /^\{\^([a-z]{1,8})\}$/.exec(text) : null;
      if (!match || key.includes('/')) continue;
      const bits = parseStroke(key);
      if (bits === null) continue;
      if (!found.has(match[1])) found.set(match[1], []);
      found.get(match[1]).push({ key, keys: popcount(bits) });
    }
    const suffixes = {};
    for (const [text, strokes] of [...found].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      strokes.sort((a, b) => a.keys - b.keys || (a.key < b.key ? -1 : 1));
      suffixes[text] = strokes.slice(0, MAX_SUFFIX_STROKES).map((stroke) => stroke.key);
    }
    return suffixes;
  }

  // The words a word could be built from by adding `suffix`: the text without it, with the usual
  // spelling changes undone (make+ing = making, stop+ing = stopping, carry+es = carries).
  function stemCandidates(text, suffix) {
    const base = text.slice(0, text.length - suffix.length);
    const stems = [base];
    if (/^[aeiouy]/.test(suffix)) {
      stems.push(`${base}e`);
      if (base.length > 1 && base[base.length - 1] === base[base.length - 2]) stems.push(base.slice(0, -1));
    }
    if (base.endsWith('i')) stems.push(`${base.slice(0, -1)}y`);
    return stems.filter((stem) => stem.length >= 3);
  }

  // A word is also typed as another word plus a suffix stroke: filming is film (TPEUPL) then
  // {^ing} (-G), as Plover itself writes it, even when the dictionary only lists filming as a
  // whole-word outline. `suffixComposer` returns a function that adds those spellings to one
  // word's `variants`, after the ones the dictionary has (once per word; calling it again does
  // nothing). Doing it a word at a time, when the word is about to be typed, costs nothing at
  // startup, and it leaves word choice alone: words are still picked by their dictionary
  // spellings, these only widen what is accepted. Only words already in the list gain spellings,
  // a spelling never goes over MAX_STROKES, and a word takes at most MAX_COMPOSED of them
  // (fewest strokes, then keys).
  const MAX_COMPOSED = 6;
  function suffixComposer(words, suffixes) {
    const byText = new Map(words.map((word) => [word.text, word]));
    // Bucketed by last letter, so a word is only compared against the few suffixes that could end it.
    const byLastLetter = new Map();
    for (const [text, notations] of Object.entries(suffixes || {})) {
      const strokes = notations.map(parseStroke).filter((bits) => bits !== null);
      if (strokes.length === 0) continue;
      const last = text[text.length - 1];
      if (!byLastLetter.has(last)) byLastLetter.set(last, []);
      byLastLetter.get(last).push([text, strokes]);
    }
    const done = new WeakSet();
    const keyCount = (strokes) => strokes.reduce((total, bits) => total + popcount(bits), 0);
    return function compose(word) {
      if (done.has(word)) return word;
      done.add(word);
      const list = word.isNumber ? null : byLastLetter.get(word.text[word.text.length - 1]);
      if (!list) return word;
      const seen = new Set(word.variants.map((strokes) => strokes.join(',')));
      const added = [];
      for (const [suffix, suffixStrokes] of list) {
        if (word.text.length <= suffix.length || !word.text.endsWith(suffix)) continue;
        for (const stemText of stemCandidates(word.text, suffix)) {
          const stem = byText.get(stemText);
          if (!stem || stem === word) continue;
          for (const stemStrokes of stem.variants.slice(0, 2)) {
            for (const suffixBits of suffixStrokes) {
              const strokes = [...stemStrokes, suffixBits];
              const id = strokes.join(',');
              if (strokes.length > MAX_STROKES || seen.has(id)) continue;
              seen.add(id);
              added.push(strokes);
            }
          }
        }
      }
      added.sort((a, b) => a.length - b.length || keyCount(a) - keyCount(b));
      word.variants = word.variants.concat(added.slice(0, MAX_COMPOSED));
      return word;
    };
  }

  // Every word at once, for tests and tools.
  function addSuffixVariants(words, suffixes) {
    const compose = suffixComposer(words, suffixes);
    words.forEach(compose);
    return words;
  }

  // With the number key (#) held, these keys type digits instead of letters. Listed in steno
  // order, which is also the order digits come out of a single stroke.
  const DIGIT_KEYS = [['S-', '1'], ['T-', '2'], ['P-', '3'], ['H-', '4'], ['A-', '5'], ['O-', '0'],
    ['-F', '6'], ['-P', '7'], ['-L', '8'], ['-T', '9']];

  // Every number that fits in one # stroke: any combination of digit keys, written in steno
  // order (so 1, 12, 150, 1230 ... but not 21 or 11, which need more than one stroke). The
  // dictionary build keeps only plain lowercase words, so none of these are in it otherwise.
  function buildNumberWords() {
    const words = [];
    for (let mask = 1; mask < 1 << DIGIT_KEYS.length; mask++) {
      let bits = 1 << NUMBER_SLOT;
      let text = '';
      DIGIT_KEYS.forEach(([name, digit], i) => {
        if (mask & (1 << i)) {
          bits |= 1 << slotIndex.get(name);
          text += digit;
        }
      });
      words.push({ text, shown: [renderStroke(bits)], variants: [[bits]], isNumber: true });
    }
    return words;
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

  // What the learner sees for a stroke: Plover notation, the same text renderStroke gives (a
  // stroke is written as one run of keys, with a dash only where Plover needs one, like -TS).
  // Strokes in an outline are joined by "/" elsewhere. The number key is a plain "#" prefix.
  function displayStroke(bits) {
    return renderStroke(bits);
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
  // the vowels and the right-hand keys differently. '#' is none of them. The star counts as a
  // left-hand key: it's an index-finger key, usually hit with the left, not a thumb key like the vowels.
  function keyGroup(name) {
    const index = slotIndex.get(name);
    if (index === undefined || index === NUMBER_SLOT) return '';
    if (name === '*') return 'left';
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
    SLOTS, parseStroke, parseLayout, namesInBits, displayOrder, buildWords, buildSuffixes, suffixComposer, addSuffixVariants, buildNumberWords, popcount, renderStroke, displayStroke, displayName,
    keyGroup, keyPair,
  };
});

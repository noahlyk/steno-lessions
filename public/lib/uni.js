// The Uni v4 steno machine: its 28-key board grid, and the Plover HID protocol the board
// speaks (verified against plover/machine/plover_hid.py and the QMK the_uni keymap).
// Data and pure functions only, shared by the page (browser) and the tests (Node), so it
// has no dependencies beyond steno.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./steno.js'));
  } else {
    root.UniV4 = factory(root.StenoData);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  // The USB HID usage the firmware exposes; Plover's machine scans for exactly this pair.
  const USAGE_PAGE = 0xff50;
  const USAGE = 0x4c56;
  // Every report starts with the report id; Plover forces compliant devices to use 'P'.
  const REPORT_ID = 0x50;

  // Plover HID's 64 "levers", most significant bit first. The Uni's 28 keys are the first
  // 28 entries: S1-/S2- are the split S, *1-*4 the split asterisks, #1/#2 the thumb number
  // keys. The rest exist for other boards on the same protocol and never fire on a Uni.
  const CHART = [
    'S1-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-', 'A-',
    'O-', '*1', '-E', '-U', '-F', '-R', '-P', '-B',
    '-L', '-G', '-T', '-S', '-D', '-Z', '#1', 'S2-',
    '*2', '*3', '*4', '#2', '#3', '#4', '#5', '#6',
    '#7', '#8', '#9', '#A', '#B', '#C', 'X1', 'X2',
    'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10',
    'X11', 'X12', 'X13', 'X14', 'X15', 'X16', 'X17', 'X18',
    'X19', 'X20', 'X21', 'X22', 'X23', 'X24', 'X25', 'X26',
  ];

  // The report carries the whole lever state as one 8-byte big-endian number. It is a
  // snapshot sent on every state change, not a stream of down/up events, so 64 bits need
  // BigInt. The report id arrives separately - Plover's hidapi reads include it as the
  // first byte, but a browser's WebHID strips it into event.reportId - so the caller
  // passes the id it saw and the payload it got, and this checks the pairing.
  function parseHidState(reportId, payload) {
    if (reportId !== REPORT_ID || !payload || payload.length < 8) return null;
    let state = 0n;
    for (let i = 0; i < 8; i++) state = (state << 8n) | BigInt(payload[i] & 0xff);
    return state;
  }

  // The chart names of every lever held in a state snapshot, in chart order.
  function chartKeys(state) {
    const keys = [];
    for (let i = 0; i < CHART.length; i++) {
      if ((state >> BigInt(CHART.length - 1 - i)) & 1n) keys.push(CHART[i]);
    }
    return keys;
  }

  // Which lesson slot a lever presses. The Uni's split keys collapse onto one slot: both
  // S levers are S-, all four asterisks are *, both thumb numbers are #. X keys are extras
  // this app has no meaning for.
  function leverSlot(name) {
    if (name === 'S1-' || name === 'S2-') return 'S-';
    if (name.startsWith('*')) return '*';
    if (name.startsWith('#')) return '#';
    if (/^X\d+$/.test(name)) return null;
    return name;
  }

  const slotIndex = new Map(S.SLOTS.map(([, name], index) => [name, index]));

  // The stroke bitmask (steno.js slot order) a set of lever names presses together.
  function strokeBits(names) {
    let bits = 0;
    for (const name of names) {
      const slot = leverSlot(name);
      if (slot === null) continue;
      const index = slotIndex.get(slot);
      if (index === undefined) continue;
      bits |= 1 << index;
    }
    return bits;
  }

  // The board's physical grid, from the QMK `the_uni` LAYOUT and StenoKeyboards' own
  // layout drawing: a unibody split ortholinear board, two key rows and a thumb row.
  // The left half has 5 columns (the inner star column), the right half 6. Sounds and
  // colors are resolved by the page from the loaded theory bundle - this stays data-only.
  // [name, half, row, col]
  const GRID = [
    ['S1-', 'L', 0, 0], ['T-', 'L', 0, 1], ['P-', 'L', 0, 2], ['H-', 'L', 0, 3], ['*1', 'L', 0, 4],
    ['*3', 'R', 0, 0], ['-F', 'R', 0, 1], ['-P', 'R', 0, 2], ['-L', 'R', 0, 3], ['-T', 'R', 0, 4], ['-D', 'R', 0, 5],
    ['S2-', 'L', 1, 0], ['K-', 'L', 1, 1], ['W-', 'L', 1, 2], ['R-', 'L', 1, 3], ['*2', 'L', 1, 4],
    ['*4', 'R', 1, 0], ['-R', 'R', 1, 1], ['-B', 'R', 1, 2], ['-G', 'R', 1, 3], ['-S', 'R', 1, 4], ['-Z', 'R', 1, 5],
    ['#1', 'L', 2, 2], ['A-', 'L', 2, 3], ['O-', 'L', 2, 4],
    ['-E', 'R', 2, 0], ['-U', 'R', 2, 1], ['#2', 'R', 2, 2],
  ];
  const UNI_KEYS = GRID.map(([name, half, row, col]) => ({ name, slot: leverSlot(name), half, row, col }));

  // The key names for the "keys to press" line under a word, in the order the page shows
  // sounds. On the machine the key IS the steno key, so the hint is the steno name itself.
  function hintNames(bits) {
    return S.displayOrder(S.namesInBits(bits)).map((name) => S.displayName(name));
  }

  return { USAGE_PAGE, USAGE, REPORT_ID, CHART, parseHidState, chartKeys, leverSlot, strokeBits, UNI_KEYS, hintNames };
});

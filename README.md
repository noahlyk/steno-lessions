Learn steno one key at a time, the way keybr and monkeytype teach typing. You type on your normal keyboard. The page turns your key presses into steno strokes, and the keyboard shows which keys are steno keys and what sound each one makes.

It reads the layout and the Plover dictionary from keymux, so the lessons match what keymux types.

## Run it

Needs Node 18 or newer, and keymux on your `PATH` with its steno dictionary installed (`keymux steno setup`).

```sh
npm start
```

Then open http://127.0.0.1:4321.

Settings come from environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `KEYMUX_BIN` | `keymux` | The keymux binary to run for `keymux steno layout` |
| `KEYMUX_STENO_DIR` | `~/.config/keymux/steno` | Folder with `main.json` and `user.json` (`user.json` wins) |
| `STENO_LESSONS_DATA` | `~/.config/steno-lessons/progress.json` | Where progress is saved |
| `PORT` | `4321` | Port to listen on |

## No steno mode needed

Keep your keyboard in its normal mode. The page reads the keys as you press them, so there is nothing to switch. Steno mode only matters for typing into other apps.

Keys are taken over only when they are steno keys. Ctrl, Alt and Meta combos, and every other key, go to the browser and the system as usual.

## How to practice

- A stroke is a chord. Hold every key for it at once, then release them all. The stroke is scored when the last key comes up, so the keys can land in any order.
- Each word has its sounds and keys directly under it, as parallel lines: the words, then the sounds to listen for, then the keys to press. The stroke being typed is highlighted. Its sounds turn green while their keys are held. A key the stroke does not use appears in red after the sounds.
- Key hints (checkbox at the top) hides the keys line and the key names, so you type from the sounds alone. The layout stays the same. The setting is remembered in this browser.
- Key names are short. Only `S`, `T`, `R` and `P` have a left and a right key, so they keep keymux's dash: `S-` on the left and `-S` on the right. Every other key is just its letter (`E`, `A`, `K`), and `*` and `#` are as they are.
- Any stroke Plover maps to the word counts. For example, `and` can be typed as `STK` or `-PB`.
- A wrong chord says which keys you pressed and which stroke the word needs. The same word stays up until you get it.
- The stream shows about 25 words. The word being typed is on the second row, and the stream scrolls as you finish words. Only strokes made from unlocked keys are shown.

Steno keys show the sound big, with the letter you press small in the corner. Keys without a steno meaning are light gray. Steno keys you have not unlocked yet are darker gray, and show no sound until they unlock.

## How keys unlock

- You start with 6 keys: `E`, `A`, `T-`, `S-`, `K` and `-T`. Keys are then introduced in the order in `public/lib/lessons.js` (`KEY_ORDER`).
- The next key unlocks when your newest 25 words are both fast and accurate:
  - Speed starts at 30 words per minute and rises to 50 as keys are added.
  - Accuracy must be at least 95% of strokes on the first try.
- After a key unlocks, the word count starts again from zero.

## Limitations

- The word list is every plain lowercase word in the dictionary. Plover's dictionary has no frequency data, so the picker favors medium-length, single-stroke words instead of common words. A frequency list would make lessons better.
- Only the built-in QWERTY layout is supported. Your `layout_overrides` in keymux are not read yet. Your steno layer has none, so the layout shown is your keymux layout.
- Chords are read from your browser's key events, so keyboards that can't register all the keys at once will not work for every stroke.

## Development

```sh
npm test
```

The tests use the real keymux layout output saved in `test/fixtures/layout.txt`. Regenerate it with `keymux steno layout > test/fixtures/layout.txt` if the layout changes.

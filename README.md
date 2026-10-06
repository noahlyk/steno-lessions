Learn steno one key at a time, the way keybr teaches typing. The keyboard shows which keys are steno keys and what sound each one makes, and the words you practice only use the keys you have unlocked.

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

## How to practice

- A stroke is a chord. Hold every key that is highlighted in blue at once, then release them all. The stroke is scored when the last key comes up, so the keys can land in any order.
- A wrong chord says which keys you pressed and which the stroke needs. The same stroke stays up until you get it.
- Each lesson has 10 words. When one is done, the summary shows your speed and accuracy, and whether a new key unlocked.
- `Esc` skips the current word. `Enter` starts the next lesson after the summary.

Steno keys are colored, keys without a steno meaning are gray, and keys you have not unlocked yet are dashed.

## How lessons work

- You start with 6 keys: `E`, `A`, `T`, `S`, `K` and `-T`. Keys are then introduced in the order in `public/lib/lessons.js` (`KEY_ORDER`).
- Each key's speed is tracked as a running average of how long its strokes take. A key counts as learned once you have 5 correct strokes with it and it is fast enough (about 1.2 seconds per chord).
- When every unlocked key is learned, the next one unlocks at the end of the lesson.
- Words are picked only if every stroke uses unlocked keys. Words that use the key you need most practice on come up more often.

## Limitations

- The word list is every plain lowercase word in the dictionary. Plover's dictionary has no frequency data, so the picker favors medium-length, single-stroke words instead of common words. A frequency list would make lessons better.
- Only the built-in QWERTY layout is supported. Your `layout_overrides` in keymux are not read yet.
- Chords are read from your browser's key events, so keyboards that can't register all the keys at once will not work for every stroke.

## Development

```sh
npm test
```

The tests use the real keymux layout output saved in `test/fixtures/layout.txt`. Regenerate it with `keymux steno layout > test/fixtures/layout.txt` if the layout changes.

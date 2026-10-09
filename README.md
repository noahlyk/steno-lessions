# [▶ Open steno-lessons](https://noahlyk.github.io/steno-lessions/)

Learn steno one key at a time, the way keybr and monkeytype teach typing. You type on your normal keyboard. The page turns your key presses into steno strokes, and the keyboard shows which keys are steno keys and what sound each one makes.

The layout and dictionary are hardcoded into `public/data/bundle.json` — no external program or dictionary install needed, and the same data is used whether you run the page through `server.js` or open it as plain static files (e.g. GitHub Pages).

## Run it

Needs Node 18 or newer.

```sh
npm start
```

Then open http://127.0.0.1:4321.

Settings come from environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `STENO_LESSONS_DATA` | `~/.config/steno-lessons/progress.json` | Where progress is saved |
| `PORT` | `4321` | Port to listen on |

## Hosting it statically (e.g. GitHub Pages)

`public/` is already a complete static site — `server.js` only adds a place to save progress
to a file. Serve `public/` as-is (or just open `public/index.html`) and the page falls back to
keeping progress in that browser's `localStorage` instead, so it's per-browser rather than
shared across devices. `.github/workflows/pages.yml` publishes `public/` to GitHub Pages on
every push to `main`.

## No steno mode needed

Keep your keyboard in its normal mode. The page reads the keys as you press them, so there is nothing to switch. Steno mode only matters for typing into other apps.

Keys are taken over only when they are steno keys. Ctrl, Alt and Meta combos, and every other key, go to the browser and the system as usual.

## How to practice

- A stroke is a chord. Hold every key for it at once, then release them all. The stroke is scored when the last key comes up, so the keys can land in any order.
- Each word has its sounds and keys directly under it, as parallel lines: the words, then the sounds to listen for, then the keys to press. Sounds are coloured by where their key is: left-hand orange, vowels and star blue, right-hand purple. Their sounds turn green while their keys are held. A key the stroke does not use appears in red after the sounds.
- Key hints (checkbox at the top) hides the keys line and the key names, so you type from the sounds alone. The layout stays the same. The setting is remembered in this browser.
- Key names follow traditional steno. Left-side keys have no dash (`S`, `T`, `K`), and right-side keys take one (`-S`, `-T`, `-R`). A letter with only one key has no dash, like the vowels (`A`, `O`, `E`, `U`) and `-F`.
- Any stroke Plover maps to the word counts. For example, `and` can be typed as `STK` or `-PB`.
- A wrong chord stays on screen in red, and the message says which keys you pressed and which stroke the word needs. The word waits on that stroke until you type it right 3 times in a row. Strokes you already got right are kept. As in Plover, the `*` stroke is undo, and it is the T key on this layout: pressing it alone removes the last wrong attempt.
- The stream shows about 25 words. The word being typed is on the second row, and the stream scrolls as you finish words. Only strokes made from unlocked keys are shown.

Steno keys show the sound big, with the letter you press small in the corner. Keys without a steno meaning are light gray. Steno keys you have not unlocked yet are darker gray, and show no sound until they unlock.

## Lessons and how keys unlock

Words come in fixed-size lessons (30 words). Finishing a lesson is the one moment stats get
judged, a key either unlocks or doesn't, and the next lesson's words are picked — so a lesson
is always exactly the window a key's unlock is judged on, following keybr's own approach.

- You start with 6 keys: `E`, `A`, `T`, `S`, `K` and `-T`. Keys are then introduced in the order in `public/lib/lessons.js` (`KEY_ORDER`).
- The next key unlocks when the lesson you just finished was fast and accurate enough, and every unlocked key is currently (not all-time) solid:
  - Speed starts at 30 words per minute and rises to 50 as keys are added. Each word's time counts only active typing: pauses longer than 3 seconds, and time with the page hidden or unfocused, are left out.
  - Overall accuracy must be at least 95% of strokes on the first try across the lesson.
  - Each already-unlocked key also needs its own recent accuracy at or above 90%. This is recency-weighted (like a key's speed average), so a rough patch while a key was still new fades out once you're typing it well — it doesn't permanently block every future unlock the way an all-time average would.
- After a key unlocks, the word count starts again from zero for the new lesson.

## Limitations

- The word list is every plain lowercase word in the dictionary, weighted by length, stroke count, and a bundled common-word frequency list (`public/lib/word-frequency.js`).
- Only the one hardcoded QWERTY layout is supported. To change it, edit `public/data/bundle.json` directly (or regenerate it from whatever produced it originally) and commit the new file.
- Chords are read from your browser's key events, so keyboards that can't register all the keys at once will not work for every stroke.

## Development

```sh
npm test
```

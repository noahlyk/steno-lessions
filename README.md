# [▶ Open steno-lessions](https://noahlyk.github.io/steno-lessions/)

*A fork of [steno-lessions](https://github.com/noahlyk/steno-lessions) by noahlyk — this fork adds [Uni v4](https://stenokeyboards.com/products/the-uni-v4) machine support: a diagram of the board and real input over WebHID (Plover HID), alongside the original QWERTY typing. See [the design doc](docs/superpowers/specs/2026-10-26-uni-v4-design.md).*

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
| `STENO_LESSIONS_DATA` | `progress.json` in the project folder (git-ignored) | Where progress is saved |
| `PORT` | `4321` | Port to listen on |

## Theories: Plover and Lapwing

The header has a Theory dropdown. Plover is the default; Lapwing uses the same keys and layout
with its own dictionary. The choice is saved in this browser, and switching reloads the page.

Lapwing's data is built from its JSON dictionaries, which you download from
[plover-lapwing-aio](https://github.com/aerickt/plover-lapwing-aio/tree/main/plover_lapwing/dictionaries):

```sh
node scripts/build-theory.js lapwing <folder with the downloaded .json files>
```

This writes `public/data/lapwing/`, which is git-ignored (it's about 8 MB and generated). The GitHub
Pages workflow builds it on every deploy, downloading the same JSON files, so the hosted site
offers Lapwing too. Lapwing's inflected forms (such as `accorded` and `arranging`) live in its
`.modal` rule files, which this app can't read, so those words aren't in the Lapwing word list.
About 11% of the words Plover covers are missing from it.

## Hosting it statically (e.g. GitHub Pages)

`public/` is already a complete static site — `server.js` only adds a place to save progress
to a file. Serve `public/` as-is (or just open `public/index.html`) and the page falls back to
keeping progress in that browser's `localStorage` instead, so it's per-browser rather than
shared across devices. `.github/workflows/pages.yml` publishes `public/` to GitHub Pages on
every push to `main`.

## No steno mode needed

Keep your keyboard in its normal mode. The page reads the keys as you press them, so there is nothing to switch. Steno mode only matters for typing into other apps.

Keys are taken over only when they are steno keys. Ctrl, Alt and Meta combos, and every other key, go to the browser and the system as usual.

## The Uni v4

The Keyboard picker in the header switches the diagram between your QWERTY keyboard and the Uni v4, drawn as the machine really is: a unibody split board, two key rows and a thumb row, all 28 keys in their real places (`S- T- P- H- ★ ★ -F -P -L -T -D` over `S- K- W- R- ★ ★ -R -B -G -S -Z` over `# A- O- -E -U #`). Everything else works the same on it: keys unlock in the same order, locked keys sit dark with no sound, the target stroke is highlighted, and held keys light up — the exact physical key, including which of the split S or star keys you pressed. In Uni v4 mode the "keys to press" line under each word shows steno key names (`A -T`) instead of QWERTY letters (`C P`), because on the machine the key *is* the steno key.

To type on the machine itself, click **Connect Uni v4** under the keyboard. The board speaks the Plover HID protocol, and the page reads it over WebHID, so:

- Use a Chromium browser (Chrome, Edge, Chromium — Firefox and Safari have no WebHID; the button tells you).
- Plover can stay connected to the board the whole time — on Linux every reader of the device gets a copy of each report. You do not have to disconnect anything.
- Consider turning Plover's Output off while practicing: with it on, Plover types its translations into whatever window has focus.
- QWERTY typing keeps working exactly as before, alongside machine input.

If the board is unplugged mid-lesson the page says so and carries on on the keyboard. Your progress is unaffected either way: the lesson engine tracks steno keys, not physical keys, so the same progress counts on both inputs.

## How to practice

- A stroke is a chord. Hold every key for it at once, then release them all. The stroke is scored when the last key comes up, so the keys can land in any order.
- Each word has its sounds and keys directly under it, as parallel lines: the words, then the sounds to listen for, then the keys to press. Sounds are coloured by where their key is: left-hand orange, vowels and star blue, right-hand purple. Their sounds turn green while their keys are held. A key the stroke does not use appears in red after the sounds.
- Key hints (checkbox at the top) hides the keys line and the key names, so you type from the sounds alone. The layout stays the same. The setting is remembered in this browser.
- Key names follow traditional steno. Left-side keys have no dash (`S`, `T`, `K`), and right-side keys take one (`-S`, `-T`, `-R`). A letter with only one key has no dash, like the vowels (`A`, `O`, `E`, `U`) and `-F`.
- Any stroke Plover maps to the word counts. For example, `and` can be typed as `STK` or `-PB`.
- A wrong chord stays on screen in red. The message lists every stroke the word could need next, one per spelling, and says which keys you pressed. The word waits until one of them is typed right. Strokes you already got right are kept.
- Strokes are read generously before they count as a mistake. Letting go of part of a stroke early is held until the rest comes in. Typing the first stroke of a spelling again starts the word over, with no mistake counted. As in Plover, the `*` stroke is undo, and it is the T key on this layout: pressing it alone removes the last wrong attempt.
- The stream shows about 25 words. The word being typed is on the second row. Finished words stay in place, grayed out, and turn faintly red if the word needed a retry, so the focus moves along the line as in monkeytype. When the focus moves down a row, the stream scrolls one row. Only strokes made from unlocked keys are shown.

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

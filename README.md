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

The keyboard diagram swaps itself to match what you type on: start a stroke on a QWERTY key and it shows your QWERTY keyboard, start one on the machine and it shows the Uni v4, drawn as the machine really is: a unibody split board, two key rows and a thumb row, all 28 keys in their real places (`S- T- P- H- ★ ★ -F -P -L -T -D` over `S- K- W- R- ★ ★ -R -B -G -S -Z` over `# A- O- -E -U #`). Everything else works the same on it: keys unlock in the same order, locked keys sit dark with no sound, the target stroke is highlighted, and held keys light up — the exact physical key, including which of the split S or star keys you pressed. In Uni v4 mode the "keys to press" line under each word shows steno key names (`A -T`) instead of QWERTY letters (`C P`), because on the machine the key *is* the steno key.

To type on the machine itself, click **Connect Plover HID keyboard** under the keyboard the first time. After that the browser remembers the permission and reconnects on its own (also when you plug the board back in). The board speaks the Plover HID protocol, and the page reads it over WebHID, so:

- Use a Chromium browser (Chrome, Edge, Chromium). Firefox and Safari have no WebHID, so the page cannot see the board there and shows a note saying to switch browsers.
- Plover can stay connected to the board the whole time — on Linux every reader of the device gets a copy of each report. You do not have to disconnect anything.
- Consider turning Plover's Output off while practicing: with it on, Plover types its translations into whatever window has focus.
- QWERTY typing keeps working exactly as before, alongside machine input.

If the board is unplugged mid-lesson the page says so and carries on on the keyboard. Your progress is unaffected either way: the lesson engine tracks steno keys, not physical keys, so the same progress counts on both inputs.

## How to practice

- A stroke is a chord. Hold every key for it at once, then release them all. The stroke is scored when the last key comes up, so the keys can land in any order.
- Each word has its sounds and keys directly under it, as parallel lines: the words, then the sounds to listen for, then the keys to press. Sounds are coloured by where their key is: left-hand orange, vowels and star blue, right-hand purple. Their sounds turn green while their keys are held. A key the stroke does not use appears in red after the sounds.
- Key hints (in the Assists menu at the top) hides the keys line and the key names, so you type from the sounds alone. The layout stays the same. The setting is remembered in this browser.
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
  - Speed must reach 28 words per minute, on every level. Each word's time counts only active typing: pauses longer than 3 seconds, and time with the page hidden or unfocused, are left out.
  - Overall accuracy must be at least 95% of strokes on the first try across the lesson.
  - Each chord you have practiced also needs its own recent accuracy at or above 80%. This is a rolling window of your last 30 attempts, so a rough patch while a chord was still new fades out once you're typing it well — it doesn't permanently block every future unlock the way an all-time average would.
- After a key unlocks, the word count starts again from zero for the new lesson.

## Accuracy is per chord, not per key

A stroke is made of up to four chords: the number bar, the left-hand initials, the vowels (with the star) and the right-hand finals. Each exact combination held together in one of those groups is its own chord with its own record, so `T`, `TH`, `TK` and `TPH` (the n sound) are four separate things. Being good at `T` says nothing about `TPH`, and a bad day on `TPH` never counts against `T`.

- **Scoring:** a right stroke counts for every chord in it. A wrong stroke counts only against the chord that came out wrong, so typing `TH` for `TPH` costs you `TPH`, not the vowel or the final consonants you got right beside it.
- **Word choice:** words that use a chord you are missing come up much more often, and a chord you have not met yet gets a smaller boost of its own. If the n sound is wrong a lot, you get n sounds.
- **Drills:** the weakest chord under 85% gets a reserved fifth of the stream, in short words whose other chords are not also weak. When nothing is under 85% it keeps going: a smaller share works whichever chord is relatively weakest (accuracy and speed together), so there is always a weak spot being practiced at every level.
- **The key chips** are read-only summaries. Hover one to see the chords it appears in, weakest first. The Focus line under them names the chord to work on and any others that are weak.
- Saves from before this change tracked accuracy per key. Those numbers mix every stroke a key was part of, so they can't be split back into chords and are dropped when the save loads. Your unlocked keys and word history are kept.

## A word plus a suffix

A word is also accepted as another word followed by a suffix stroke, the way Plover writes it, even when the dictionary only lists the word as one outline. `filming` is listed as `TPEUL/-PLG`, and `TPEUPL/-G` (film, then `{^ing}`) works too. Spelling changes are handled (`make` + `-G` is `making`, `stop` + `-G` is `stopping`), a stem needs at least three letters, and a spelling is never longer than three strokes. Only words already in the list gain spellings, and which words you are given is unchanged: these only widen what counts as right. The suffix strokes live in `public/data/suffixes.json` (Plover's is made by `node scripts/build-suffixes.js`; Lapwing's by `scripts/build-theory.js`). Prefixes are not covered yet.

## Limitations

- The word list is every plain lowercase word in the dictionary, weighted by length, stroke count, and a bundled common-word frequency list (`public/lib/word-frequency.js`).
- Only the one hardcoded QWERTY layout is supported. To change it, edit `public/data/bundle.json` directly (or regenerate it from whatever produced it originally) and commit the new file.
- Chords are read from your browser's key events, so keyboards that can't register all the keys at once will not work for every stroke.

## Development

```sh
npm test
```

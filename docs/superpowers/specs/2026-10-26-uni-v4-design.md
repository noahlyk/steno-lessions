# Uni v4 support in steno-lessions — design

Date: 2026-10-26
Status: approved pending final sign-off

## Intent

Practice steno-lessions on the real machine: the site shows the Uni v4's actual key
layout and accepts strokes straight from the board, while the existing QWERTY-keyboard
way of using the site stays exactly as it is.

Why: the user owns a Uni v4 running Plover HID firmware and uses Lapwing in Plover.
Learning the key positions on the machine they actually hold is the point of the
diagram; typing real chords on it is the point of the input.

## Goals

- A **Uni v4 diagram**: all 28 keys in the board's real split-ortholinear arrangement
  (top row `S- T- P- H- ★ ★ | -F -P -L -T -D`, home row `S- K- W- R- ★ ★ | -R -B -G -S -Z`,
  thumb row `# A- O- -E -U #`), styled like the current diagram: unlocked keys colored,
  locked keys dark with no sound, target highlight, held state — including lighting the
  *exact physical key* (upper vs lower S, which star) that a report came from.
- **Machine input** via WebHID speaking the Plover HID protocol. A "Connect Uni v4"
  button; strokes flow into the same chord pipeline QWERTY key presses use.
- **Traditional key presses remain fully operational**, in both diagram modes: QWERTY
  keydown/keyup input is untouched and stays active alongside machine input.
- In Uni v4 diagram mode, the "keys to press" hint line under words shows steno key
  names (A -T) instead of QWERTY letters (C P).

## Non-goals and anti-goals

- No Gemini PR / serial support (the board is on HID firmware; don't build for serial).
- No auto-switching of the diagram — the user explicitly chose a manual toggle after
  considering auto-switch.
- No firmware changes or reflashing guidance.
- The static-host story must not regress: without a machine connected (or on a browser
  without WebHID), the page behaves exactly as today. WebHID is progressive enhancement.
- The lesson engine, unlock order, and progress format are not redesigned — they key on
  steno slots, so progress carries across both inputs untouched.

## Constraints

- WebHID: Chromium browsers only, secure context (http://127.0.0.1:4321 and GitHub Pages
  both qualify), device access needs a user gesture (the connect button).
- Plover HID protocol (verified against `plover/machine/plover_hid.py`):
  - Device filter: usage page `0xFF50`, usage `0x4C56`; input reports with report id
    `0x50` carry 8 bytes = big-endian 64-bit lever state.
  - Bit i (from the most significant bit) selects `STENO_KEY_CHART[i]`:
    `S1- T- K- P- W- H- R- A- O- *1 -E -U -F -R -P -B -L -G -T -S -D -Z #1 S2- *2 *3 *4 #2 … #C X1 … X26`.
  - Reports are state snapshots sent on every state change. Plover's default semantics:
    OR-accumulate each non-zero report; when a report arrives all-zero, the accumulated
    chord is the stroke and the accumulator resets. This mirrors the app's existing
    "score the chord when the last key comes up" model.
- Linux hidraw broadcasts reports to every open reader, so **Plover can stay connected**
  to the machine while the page listens. No disconnect dance.
- Caveat to document: with Plover's *output* enabled, Plover types translations into the
  focused window; on this page that mostly lands nowhere, but it's polite to suggest
  disabling output while practicing.
- The Uni's 28 levers map onto the 23 lesson slots: `S1-/S2- → S-`, `*1-*4 → *`,
  `#1/#2 (and any other #n) → #`, X-keys ignored. Lever-level detail is kept for the
  diagram highlight.

## Approaches considered

- **Gemini PR over Web Serial** — works with stock firmware but requires Plover to
  release the serial port while practicing, plus serial-port permission setup. Rejected:
  the user is on Plover HID.
- **QWERTY-event mapping (qwerty firmware)** — zero browser permissions, but requires
  flashing different firmware and a matching Plover keymap; rejects the user's actual
  setup. Rejected as the input path (the map is still useful as documentation of the
  board's grid).
- **Plover HID over WebHID** — chosen. Works with the user's firmware as-is, coexists
  with Plover, lever-level detail for free.
- Diagram arrangement: **toggle (chosen)** vs stacked vs auto-switch. Toggle keeps the
  page compact and avoids self-changing UI; the user picked it deliberately.

## Decided

- One diagram visible at a time; a small QWERTY ↔ Uni v4 switch in the HUD next to the
  existing "Keyboard diagram" scaffold checkbox. Diagram choice persists in this browser.
- "Connect Uni v4" button near the keyboard area with connected / disconnected state and
  a plain-language error when WebHID is unavailable or the board isn't found.
- Both inputs can be live at once; whichever keys arrive feed the same chord logic.
- Uni diagram keys are colored by steno group (left orange, vowels blue, right purple),
  consistent with the stream's sound coloring; stars follow the code's grouping (left).

## Left to the builder

- Exact DOM/CSS for the Uni diagram (reusing `.key` styling where sensible).
- Reconnect handling: board unplugged mid-lesson → drop to QWERTY with a message.
- Unit tests for the new pure pieces: lever-bits → slot-bits mapping, stroke assembly
  from state-report sequences (including early-release behavior), hint-name rendering.
- README notes: what the Uni v4 mode is, browser requirements, Plover output caveat.

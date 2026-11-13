# Design

Hadjitron 3000 should look like a small music utility from 1998 that somebody loved and kept on their desktop: Windows 98 structure, warm putty-coloured plastic, a teal title bar, and amber phosphor displays. It is cosy because the colours are warm and the contrast is soft, and because small things are alive (lamps blink, the scope wiggles, the status bar talks to you). It is never modern: no rounded corners, no soft shadows, no fading or sliding.

All colours, fonts and bevels live in `src/ui/theme/tokens.css`. Components use those tokens and never write a colour or a font by hand.

## The pixel grid

One CSS pixel is one pixel of the artwork. Everything sits on whole pixels: sizes, paddings and positions are integers, and nothing is scaled, rotated or translated by fractions. On a Retina screen the browser doubles every pixel, which is exactly the chunky look we want.

There is no `border-radius`, no `box-shadow` blur, no `opacity` for state, no `transition` and no `animation`. State changes are instant. The only gradient is the title bar, and the only glow is the amber phosphor on displays.

Canvases are drawn at CSS-pixel resolution (a 150 by 30 pixel scope has `width=150 height=30`) and shown with `image-rendering: pixelated`. They are never multiplied by `devicePixelRatio`. Drawing uses whole coordinates and `fillRect` so that lines stay hard-edged; no anti-aliased strokes.

## Type

There are three fonts and each is used only at its design size, where every glyph lands on the pixel grid.

| Token | Font | Use |
| --- | --- | --- |
| `--font-ui` | Fusion Pixel 12, 12px on a 16px line | menus, buttons, lists, labels, dialogs |
| `--font-small` | Fusion Pixel 10, 10px on a 12px line | captions under knobs, section headers, text inside grid cells |
| `--font-mono` | Departure Mono, 11px on a 14px line | values, readouts, note names in displays |
| `--font-lcd` | Departure Mono, 22px on a 24px line | the tempo display |

Text is never anti-aliased (`-webkit-font-smoothing: none`). Bold does not exist as a font weight; emphasis is a one-pixel smear, `text-shadow: 1px 0 0 currentColor`, used for the title bar and the selected tab. Captions under controls are upper case in `--font-small` with the value on the line below. Disabled text is `--lo` with a `1px 1px 0 var(--hi)` shadow so it looks engraved.

## Surfaces

Every surface is putty (`--face`) with a two-pixel bevel drawn by inset shadows.

| Token | Looks like | Use |
| --- | --- | --- |
| `--bevel-raised` | sticks out | buttons, rack units, channel headers, scrollbar thumbs |
| `--bevel-window` | sticks out, lighter edge | windows and dialogs |
| `--bevel-pressed` | pushed in | a button while held, a toggle that is on (together with the `--dither` fill) |
| `--bevel-sunken` | deep recess | text fields, lists, displays, the step grid |
| `--bevel-well` | shallow recess | status bar fields, grid cells |
| `--bevel-ridge` | a groove | group boxes and separators |

Lists and text fields are paper (`--paper`). A selected row is `--sel` with `--sel-ink` text. Keyboard focus is a one-pixel dotted `--ink` rectangle inside the control.

The area behind the window, which shows when the app runs in a browser, is the desk: `--desk` with a 2 by 2 checker of `--desk-2`.

## Displays

Anything that shows a signal or a number that matters is an amber display: `--crt` background in a sunken bevel, `--amber` for the trace or the digits, `--amber-mid` for secondary marks, `--amber-dim` for the grid dots and unlit segments. Text on a display gets `text-shadow: var(--amber-glow)`. The scope, the level meter, envelope shapes and sample waveforms are all displays. Meter segments above 0 dB are `--red`.

The Factory's scope is a bench scope: a dotted `--amber-dim` graticule, a sweep that starts on a rising zero crossing so the wave stands still, and a range and timebase that step in 1-2-5 like a real one. When the sound falls quiet its last trace holds in `--amber-mid`, steps down to `--amber-dim` and then clears to a resting line; it never fades smoothly.

## Controls

Buttons are 23px high with 10px of side padding; small square buttons are 19 to 25px. The menu bar, the title bar and the status bar are 20px high. The cursor is always the plain arrow; buttons do not get a hand.

A knob is a 36px canvas: a round putty cap with a light upper-left edge and a shaded lower-right edge, a short ink pointer, and a ring of eleven dots around it that light up in amber up to the current value. Under it sits the caption and the value. Knobs are dragged up and down (about 150px for the full range, Shift for a tenth of that), reset to their default on double-click, follow the scroll wheel, and take arrow keys when focused.

Every control has a hint: one plain sentence shown in the status bar while the pointer is over it, and its live value while it is being dragged. There are no tooltips.

Scrollbars are the Windows 98 kind: a dithered track, a raised thumb, and raised arrow buttons.

## Rack units

In the Factory each module of a sound is a rack unit: a raised putty strip the full width of the rack, with an ink nameplate running up its left edge (upper case, `--font-small`, light text), two small screws at the right, and its controls in a row. Effects and modulators carry a lamp at the left that shows whether they are on (click to bypass), and small buttons at the right to move them up or down or to remove them. Signal flows from the top unit to the bottom one.

## The step grid

The grid sits in a sunken panel. A cell is 24 by 22 pixels with a shallow well bevel; cells on the beat are slightly darker (`--face-lo`), and there is a wider gap after every beat. A step that is on is filled with its channel colour, with a light upper-left and dark lower-right edge and a one-pixel ink outline, so it looks like a lit key. Longer notes stretch across their cells. Note names inside cells use `--font-small`. The play position is an amber-on-ink marker in the ruler above the grid and a light column through the cells.

Channel colours come from `--c0` to `--c7` and are used for the chip in lists, the lamp in the channel header and the steps.

## Icons

Icons are 1-bit pixel drawings on a 16 by 16 or 12 by 12 grid, written as rows of characters in the source and drawn in `currentColor`. There are no icon fonts and no anti-aliased SVG paths.

## Words

Labels are short and plain. Menu commands that open a dialog end in an ellipsis. The status bar says "Ready." when nothing else is going on. Errors say what happened and what to do, in one or two sentences, in a dialog with an OK button.

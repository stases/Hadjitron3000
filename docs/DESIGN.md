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

Anything that shows a signal or a number that matters is an amber display: `--crt` background in a sunken bevel, `--amber` for the trace or the digits, `--amber-mid` for secondary marks, `--amber-dim` for the grid dots and unlit segments. Text on a display gets `text-shadow: var(--amber-glow)`. The scope, the level meter, envelope shapes and sample waveforms are all displays. Meter segments above 0 dB are `--red`; a meter lies along the transport bar and stands upright in a mixer strip. The compressor's gain reduction meter is a row of twelve segments of 2 dB that light from the left, over a scale with a longer tick every 6 dB, with its caption and value under it like a knob's.

The Factory's scope is a bench scope: a dotted `--amber-dim` graticule, a sweep that starts on a rising zero crossing so the wave stands still, and a range and timebase that step in 1-2-5 like a real one. When the sound falls quiet its last trace holds in `--amber-mid`, steps down to `--amber-dim` and then clears to a resting line; it never fades smoothly.

A row of automation in the Song is a display too, 40 pixels high with its bevel, running under the lanes bar for bar with them: dotted `--amber-dim` bar lines (closer dots every fourth bar) and centre line, the curve as a one-pixel `--amber` trace, and its points as 3-pixel squares, the one last touched a hollow 5-pixel square. A row without points shows the control's own value as a dashed `--amber-dim` line, since it moves nothing. The parameter's name stays at the left edge of the row as the timeline scrolls, in `--amber` small type on the display's own ground, and the remove button sits in the lane header column.

A display you draw on, the drawn wave, has no handles: the pointer is the pen, and the line, a one-pixel `--amber` trace over a dotted `--amber-dim` centre line and quarter marks, follows it at once. The buttons that act on the drawing stand beside the display, not on it.

A sample waveform is drawn in columns of one pixel under a strip that carries the file's name. What plays is `--amber` and the rest `--amber-dim`. The sampler's region has a one-pixel `--amber` line at each end with a small flag pointing inwards, and with Slices a dotted `--amber` line at every cut. While a note plays a slice, that slice stays `--amber` and the rest of the region drops to `--amber-mid`, so the light moves along the waveform as a sliced loop plays. On a Grains waveform Position is a line with a flag on the strip, and the stretch that Spray reaches around it is `--amber` between two short ticks, against the rest of the sample in `--amber-dim`. Dragging on a waveform moves the nearest marker; the pointer stays the plain arrow.

## Controls

Buttons are 23px high with 10px of side padding; small square buttons are 19 to 25px. The menu bar, the title bar and the status bar are 20px high. The cursor is always the plain arrow; buttons do not get a hand.

A knob is a 36px canvas: a round putty cap with a light upper-left edge and a shaded lower-right edge, a short ink pointer, and a ring of eleven dots around it that light up in amber up to the current value. Under it sits the caption and the value. Knobs are dragged up and down (about 150px for the full range, Shift for a tenth of that), reset to their default on double-click, follow the scroll wheel, and take arrow keys when focused.

A knob or a fader that a row of automation moves is marked as automated: its ring lights in `--amber` instead of `--amber-mid` and the dots beyond the value stay `--amber-dim` instead of going dark, so the ring reads as a small display, and its value sits on a `--crt` plate in `--amber` (a fader's groove turns `--amber-mid`). While the song plays it shows the value it is moved to, and turning it does nothing; the status bar says why.

A toggle with a lamp, such as Record, is a button with a `Led` beside its label: red for Record, lit while recording and blinking on the beats of a count-in. The MIDI lamp is a green `Led` over a small caption that lights for a moment with every note.

Every control has a hint: one plain sentence shown in the status bar while the pointer is over it, and its live value while it is being dragged. There are no tooltips.

Scrollbars are the Windows 98 kind: a dithered track, a raised thumb, and raised arrow buttons.

## Rack units

In the Factory each module of a sound is a rack unit: a raised putty strip the full width of the rack, with an ink nameplate running up its left edge (upper case, `--font-small`, light text), two small screws at the right, and its controls in a row. A name that ends in a part in brackets, such as Filter (whole sound), puts that part on a second line of the plate. Controls that belong together inside a row, such as the second oscillator's, stand under a small caption with a groove down their left edge, like a section in miniature. Effects and modulators carry a lamp at the left that shows whether they are on (click to bypass), and small buttons at the right to move them up or down or to remove them. Signal flows from the top unit to the bottom one.

Controls come in three levels, Basics, Shaping and Deep. In beginner mode a unit shows its Basics in the row and has a small toggle for each higher level it holds, stacked at the top of its right edge above the move and remove buttons and as wide as they are. A toggle carries the level name in upper case `--font-small` and an amber lamp that is lit while any control of that level differs from its default. Pressed, the toggle opens its section beside the Basics: a groove down its left edge, the level name at the top as a caption, and the controls below on the same grid; sections that do not fit wrap onto the next line. In add lists and the source list the levels are headings in the same caption style, and Deep modules wait in a Deep submenu or behind a More… row. In pro mode none of this is drawn.

## The step grid

The grid sits in a sunken panel. A cell is 24 by 22 pixels with a shallow well bevel; cells on the beat are slightly darker (`--face-lo`), and there is a wider gap after every beat and a wider one still after every bar, wherever the time signature puts them. A step that is on is filled with its channel colour, with a light upper-left and dark lower-right edge and a one-pixel ink outline, so it looks like a lit key. Longer notes stretch across their cells. Note names inside cells use `--font-small`. A note's extras are marked in hard pixels of ink, the same on a step and on a note of the roll: a note that plays only sometimes is dithered with `--dither`, a ratchet is a row of one-pixel ticks along the bottom that divide the key, a slide is a small slanted line at its left, and a held note has a small arrow at its right and a thin key of its colour running on to the end of the row. A note that locks a control has a small padlock at its top right, left of the arrow when it is also held. The play position is an amber-on-ink marker in the ruler above the grid and a light column through the cells.

A row of its own length ends at a marker: an ink bar three pixels wide down the gap after its last step with a small flag at its top, which the pointer drags. The cells after it are `--face-lo`, darker still on the beat, and hold the row's keys again where they play, flat in the pale tint of the channel colour with a `--lo` outline and `--ink-soft` names; notes kept there unheard are an `--ink-soft` outline with a line struck through. The roll draws its row the same way: a dither of `--lo` over the sheet after an ink line at the loop's end, the loop's notes again flat and pale, and the same marker in its ruler.

The piano roll is the same sheet turned on its side: the grid's columns with their gaps as step, beat and bar lines, one pixel per tick, and a 12-pixel row per semitone, putty for white keys and `--face-lo` for black ones. Keys are drawn at the left on `--paper` with `--ink` black keys, and only the Cs are named. A note is a lit key in its channel colour, shaded towards `--face` the softer it plays, with its name inside when it is at least a step long; a selected note turns `--ink` with a line of its colour inside, so it stands out on any colour. Snap positions that fall inside a cell are one-pixel `--face-hi` lines. Velocities are an amber display along the bottom, a stalk with a small head per note, brighter and wider for the selection. The rubber band is a dotted `--ink` rectangle and the paste mark a small `--sel` triangle in the ruler; a stretch chosen on the ruler is a `--sel` bar along its foot. With a scale, the rows of its notes are putty, the others `--face-lo`, and the root's `--face-hi`, and the root's keys carry a three-pixel `--sel` strip at their right edge.

Channel colours come from `--c0` to `--c7` and are used for the chip in lists, the lamp in the channel header and the steps.

## The mixer

The Mixer is a small desk in a sunken panel: one raised putty strip per sound, about 100 pixels wide, then the two buses and the master, each group set a little apart. Every strip has the same rows, top to bottom: the name with its colour chip (the bus letter on an ink plate for a bus; the picked sound's name on `--sel`), the send knobs, the ducking, the pan knob, the fader beside its meter, and mute and solo; a strip that has nothing for a row leaves it empty, so the rows line up across the desk. The captions of the rows stand in a column at the left, in the caption style, and stay there while the strips scroll. A strip's meter is the level meter turned upright: twelve segments per side from the bottom up, the top two red. The fader is the Windows 98 trackbar on its side, its value under it. In beginner mode the Shaping row (ducking, and the master's Rack button) folds away behind a toggle in the caption column, with the lamp of a rack unit. The rack of the chosen bus or the master sits under the desk, drawn exactly like the Factory's rack.

## Icons

Icons are 1-bit pixel drawings on a 16 by 16 or 12 by 12 grid, written as rows of characters in the source and drawn in `currentColor`. There are no icon fonts and no anti-aliased SVG paths.

## Words

Labels are short and plain. Menu commands that open a dialog end in an ellipsis. The status bar says "Ready." when nothing else is going on. Errors say what happened and what to do, in one or two sentences, in a dialog with an OK button.

# Architecture

Hadjitron 3000 is a web app (TypeScript, React, the Web Audio API) inside a thin Electron shell. Everything that makes sound runs in Chromium's audio engine, so the app behaves the same in Electron on a Mac and in a Chromium browser, which is also where the tests run.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/core` | The document model, the module table, the sequencer and the file formats. Pure TypeScript, no DOM and no audio. |
| `src/audio` | The Web Audio engine, the transport, offline rendering and MP3 encoding. |
| `src/state` | The app store and its actions, including undo. |
| `src/platform` | Files, the sound and block library folders and the window, once for Electron and once for the browser. |
| `src/app` | The window chrome, dialogs, keyboard shortcuts, the stored session, the tutorials, and the glue between store, engine and platform. |
| `src/ui/kit` | The retro widgets. `src/ui/theme` holds the tokens and fonts. |
| `src/ui/factory`, `src/ui/track`, `src/ui/song` | The three views. |
| `src/presets` | Factory sounds in the app's own file format, the demo project, and the factory blocks taken from it. |
| `electron` | The main process, the preload script and the updater, plain CommonJS with no build step. |
| `tests` | `unit` runs in Node, `browser` runs in headless Chromium (the engine needs real Web Audio), `e2e` drives the built app. |

Dependencies point one way: `core` knows nothing else; `audio` and `state` use `core`; `app` and `ui` use everything. The views never talk to the engine directly; they read the store, call actions, and use the small audio controller in `src/app/audio.ts` to audition notes.

## The document

A project (`Project` in `src/core/types.ts`) has a tempo, a swing amount, a time signature, a master level, a list of channels, a list of blocks, a song and the audio files it uses. A channel is one row of the Track grid: a sound plus mute and solo. The Factory and the Track are two views of the same channels, so a sound made in the Factory is immediately a row on the grid.

What the user sees as a block is a `Pattern` in the code, and the store keeps that word in its names (`patternId`, `addPattern`, `renamePattern` and so on). A block has a name, a colour, one to thirty-two bars, and for each channel a list of notes (`Pattern.notes`); a project holds up to 26 blocks. A note (`Note`) has an id that is unique within its block, a start and a length in ticks, a pitch and a velocity, and four optional extras that are absent while they have their default value: `chance` (1 to 99, the percent of passes it plays on), `ratchet` (2, 3, 4, 6 or 8 repeats inside its length), `slide` (the pitch glides in from the row's previous note) and `hold` (a drone to the end of its placement). `noteExtras` in `src/core/notes.ts` keeps them valid, and `cleanNotes`, the file reader and the store's note edits all go through it, so a default value is never stored or written.

The time signature (`Project.meter`) is `[beats, unit]`, one of 2/4, 3/4, 4/4, 5/4, 6/4, 7/4, 5/8, 6/8, 7/8, 9/8 and 12/8, and holds for every bar of every block. `barOf` in `src/core/meter.ts` is the one place that turns it into a bar: `beats * 16 / unit` steps, their ticks, and the steps on which its beats start (four steps to a beat in x/4, six in 6/8, 9/8 and 12/8, and in 5/8 and 7/8 four with a beat of six last). Block lengths, the sequencer, the grid's and the roll's columns and backgrounds, positions as bar.beat.sixteenth, the Song's bar width and the status bar all ask it. Changing the meter (`setMeter`) keeps every note at its tick and gives each block the fewest bars of the new meter that hold its old length and the notes that start in it; placements keep their bars. A step has 24 ticks (`TICKS_PER_STEP`, 96 to a quarter note), so a 32nd is 12 ticks and a sixteenth triplet 16. A row's notes are kept sorted by start and then pitch; they may overlap, and several may start together as a chord, but no two share both start and pitch. Note 60 is C3 and plays a sound at its own pitch.

The Track's step grid shows a row's notes by the step they start in. A cell with more than one note shows the lowest one and how many more; a note that starts between grid lines gets a small mark at its place in the step. The grid and the roll mark a note's extras the same way (`src/ui/track/marks.tsx`), and the inspector under them sets extras on every selected note at once; in beginner mode it folds them by level with the Factory's fold toggles (`FoldToggles` in the kit and `useShown` in `src/ui/factory/levels.tsx`). The grid's gestures act on all the notes that start in a cell, so material the grid cannot draw on its own survives ordinary editing.

The piano roll (`src/ui/track/PianoRoll.tsx`) shows one row of the block over pitch and time in the grid's own columns at one pixel per tick, so every note is exactly where it plays; its geometry, snapping, hit-testing, drags and clipboard are pure functions in `roll.ts`, and its open state, selection, snap and paste mark live in a small store of its own (`rollState.ts`) that the global key handler also uses. Notes and velocity bars are plain absolutely placed elements and the sheet's rows and columns are one repeating CSS background, which stays cheap for a few hundred notes. A drag keeps its result as a local draft and writes it once on release with `updateNotes`, so a selection dragged over another note never stops halfway, and paste and repeat add their notes in one change with `addNotes`.

The song is a list of placements (`Placement`): a block put on one of four lanes at a bar, for a number of bars. Placements in different lanes play together; in one lane they never overlap. A placement longer than its block repeats it, and a shorter one cuts it off. The Track edits one block and the Song arranges them.

A placement has three optional fields that are absent while they have their default value: `fadeIn` and `fadeOut`, whole bars that together fit inside it, and `mutes`, the ids of the channels that are silent in it, in channel order. `fitFades` in `src/core/arrangement.ts` keeps the fades inside their placement, the fade-in first; the store goes through it when fades are set, when a placement is made longer or shorter and when it is duplicated, and the file reader does too. A resize drag hands the fades it started with back to the store after every step, so a tile dragged shorter and longer again in one gesture keeps them. `Project.lanes` holds one `Lane` per lane of the song, a level in dB from -48, which is silence as in the Output unit, to +6, and a mute. Lane levels, fades and mutes apply only to the song; the block on repeat plays as it is. A lane's level and mute are Basics; a placement's fades and mutes are Shaping, which beginner mode folds behind a toggle in the placement bar (`useShown` and `toggleFold` with the type `placement`).

A block can also stand on its own outside a project (`Block`): its notes together with the sounds that play them and their samples. It has no time signature of its own; its bars count in the meter of the project it is in. `extractBlock` in `src/core/block.ts` lifts one out of a project, and the store's `insertBlock` adds one to a project, reusing a channel when the project already has the same sound. The Block Library offers the blocks of the demo song this way and the user's own blocks from the block library folder.

A sound is a source, a filter, an amp envelope, a chain of effects, a set of modulators and an output, together with how its notes follow each other (`play`: Poly, Mono or Legato, and a glide time):

```
     inside every note                         shared by all notes
source -> filter -> amp envelope  ---+--> effect -> effect -> ... -> output (level, pan)
                                     |
modulators (envelopes, LFOs, drifts) -> any parameter marked as a target
```

Source, filter and amp envelope are built for every note; the effects and the output exist once per sound. The filter (`sound.filter`, the `FILTER` definition) is part of every sound and off by default; its lamp is the parameter `on`, which the Factory draws as the unit's lamp rather than as a control. A modulator (`ModInst`) has `per`: with `'note'` it is built inside every note as well and may only move parameters that live there, the source's and the filter's (`perNote` in `src/core/modules.ts` decides); with `'sound'` it exists once and may move anything. Files without the field read as `'sound'`, which is how modulators worked before.

A drawn wave is one cycle of 64 points in -1..1 (`src/core/shape.ts`), kept in the source's parameters `shape` and `shape2` as a string of two base-64 digits per point, so the parameter model (number, string or boolean) stays as it is; the choice Draw of `wave` or `wave2` plays it. Parameters that a file lacks read as their defaults, so sounds from before keep their meaning: LFOs run free without fade or retrigger, and each oscillator has a sine to draw from.

Every module is described once in `src/core/modules.ts`: its parameters with ranges, units, knob tapers and defaults. The engine, the file format and the generic module panel in the Factory are all driven by that table. Every module and parameter also has a level from `src/core/levels.ts` (Basics when absent), which the Factory uses in beginner mode to fold Shaping and Deep controls into sections and to group the add lists; it is a property of the table only and never reaches the file format or the engine. The beginner/pro switch is a user preference in `src/app/prefs.ts`, kept in localStorage rather than in the project. Parameter values are stored in real units (hertz, seconds, semitones, decibels).

## Files

Sounds are saved as `.h3s`, blocks as `.h3b` and projects as `.h3k`. All three are JSON text with a `format` tag and a `version`. Audio files used by a sampler are embedded as base64 in their original encoding and are keyed by a hash of their content, so the same file is stored once however many sounds use it. `src/core/fileformat.ts` reads and writes the three formats and refuses files it does not understand with a readable message. The current version is 3. Projects of version 1, whose song was a list of patterns played one after another, open with that list laid out in the first lane. Versions 1 and 2 kept one step per row and step index (`cells` in a project, `steps` in a block) with a length in steps; reading them, and a stored session of that age, turns step i into a note at tick 24 i and its length into ticks, so nothing is lost. Only version 3 is written. A project always carries its `meter`; one without it, from before time signatures, opens in 4/4. Notes carry their extras only when they are set, in projects and blocks alike. A project always carries its `lanes`; one without them opens with every lane at 0 dB and playing. Placements carry `fadeIn`, `fadeOut` and `mutes` only when they are set; mutes of channels the project does not have are dropped. Blocks carry none of these.

## The engine

`Engine` (`src/audio`) owns one audio graph per channel:

```
voices: source -> filter (stage, drive, stage) -> [gain curve] -> voice gain (amp envelope x velocity) --+
                                                                                        +--> effect chain -> output
                                                                                        |      -> channel gain (mute/solo) -> master
per-note modulators -> (fade) -> depth gains -> parameters of their own voice
modulators of the whole sound -> (fade) -> depth gains -> audio parameters, those inside the voices included
master -> master level -> soft clip -> destination and analyser
```

Each channel also has a tap of its own output ahead of mute and solo, made the first time the Factory's scope reads it.

Each note is a voice with its own source, filter, amp envelope and per-note modulators; nothing is built for a part that is switched off (the filter off, the sub or the second oscillator at 0, no per-note modulators), so a sound made before the voice path plays bit for bit as it did.

A note can bring a gain curve (`NoteEvent.gain`, passed on by `Engine.play`): breakpoints in seconds from the note's start with a linear gain, which the voice follows with a gain stage of its own in straight lines from point to point (`follow` in `src/audio/automation.ts`), holding the last value through the release. The stage starts with the amp envelope, after the filter's drive delay. When a slide or Legato ties a new note into a sounding voice that has such a stage, the stage takes over the new note's curve from that moment, or goes back to full gain when the new note has none. A note without a curve builds no stage, so a song without fades and with every lane at 0 dB renders exactly as before. The effect chain and the modulators of the whole sound are shared by all voices of a channel; such a modulation envelope restarts on every note and follows the most recent one.

What a modulator plays before its depth comes from `src/audio/modules/modulators.ts`. An envelope is a constant source whose level the channel schedules, as before. An LFO is an oscillator followed by a gain for its fade-in. With Sync its frequency is one cycle per note value at the tempo (`lfoRate`), and `ChannelGraph.update`, which gets every change of tempo, moves it, in the LFOs of the whole sound and of the sounding notes alike. The fade gain rises in a straight line from 0 to 1 from the start of a note; for an LFO of the whole sound every new note dips it to 0 in 5 ms and starts the rise again, and Retrigger replaces its oscillator with a new one started at the note, since an oscillator's phase cannot be reset. An LFO in every note is built with its note, so it always starts there.

Drift is a looping buffer of 4096 random values in -1..1, 64 samples each at a nominal 3 kHz, read by an `AudioBufferSourceNode` at a speed that passes `rate` values a second. Smooth decides the buffer: every value holds for the first (1 - smooth) of its cell and glides along half a cosine to the next in the rest, so 0 is sample-and-hold and 1 glides all the time. All settings share the same values, so a change of Smooth crossfades over 30 ms to the other buffer at the same place, which the drift computes from where and how fast it has been reading. Each drift starts at its own place in the loop, from the engine's voice counter (`serial`) times the golden ratio, so notes wander differently, a render is the same every time, and at the fastest rate the loop takes nearly seven minutes to come round. The buffers are built once per setting and shared by every context.

A drawn wave is a `PeriodicWave` of 512 harmonics. Joining the points with straight lines gives the points' own spectrum, repeated every 64 harmonics and multiplied by sinc² (`shapeHarmonics`); the oscillator leaves out whatever would lie above Nyquist at the note's pitch, as it does for the stock waves, and plays the drawing at the level it was drawn, without its constant. The last few waves are cached per context by their string. A drawn wave plays on two oscillators started together, one of them silent; a new drawing goes into the silent one, which then takes over with a 5 ms crossfade, so a held note follows the drawing without a click. The Factory sends a drawing to the store, and so to the engine, at most every 100 ms while the mouse moves, and once more when it is let go.

The oscillator's pulse width is a sawtooth minus the same sawtooth delayed by the width's share of a period (`pulse` in `src/audio/modules/sources.ts`). Both are band-limited, the delay moves smoothly when the width is modulated, and at 50 % the result is the square wave harmonic for harmonic. A square at 50 % that no modulator moves is still the plain square oscillator.

Glide is a straight line in cents on the parameters that follow the voice's pitch (`Follower`): the oscillators' detune, the filter's detune as far as key tracking says, and the pulse delay, whose period changes by the matching exponential ramp. In Mono a new note starts a new voice and releases the old one within 5 ms; in Legato, and for a note played with `slide` (`Engine.play`), the sounding voice is moved to the new note instead, and its envelopes go on as if the key had stayed down (`envelopeSegments` with a starting time). The channel keeps the live keys that are down, so in Mono and Legato letting go of the newer key goes back to the older one. The filter's drive is an oversampled wave shaper that delays the sound by 128 samples; the amp envelope of such a voice starts as much later, so the attack is not lost.

`engine.setProject(project)` is called on every change of the document. The store is immutable, so the engine compares object identities, applies parameter changes smoothly, and rebuilds only the channels whose structure changed.

The engine takes any `BaseAudioContext`. The same code plays live through an `AudioContext` and renders an export through an `OfflineAudioContext`. An export that rings out renders on after its last note for `ringOut` in `src/audio/render.ts`: for every sound 1.25 times its release (when the release reaches silence), then each reverb's size and each delay's time multiplied by the repeats its feedback takes to fall by 80 dB, the longest of the sounds, at least 6 s and at most 60 s. The silence at the end is trimmed off afterwards, so a long estimate costs only rendering time.

## Time

The sequencer in `src/core/sequencer.ts` is a pure function from a project, a play scope (one block on repeat, or the song) and a range of ticks to a list of note events with times in seconds; every note that starts in the range is in it once. `heardAt` tells which blocks are heard at a tick, which is also how the views place their play markers. The transport calls it a little ahead of the audio clock (a look-ahead scheduler), one step's window of ticks at a time, and hands the events to the engine through `playEvent` in `src/audio/transport.ts`; the offline renderer calls it once for the whole export. A step is a sixteenth note, and a bar has as many as the meter says. Swing delays every second sixteenth by up to half a step: `tickTime` stretches the first step of each pair and squeezes the second, and moves the ticks inside them in proportion, so notes on the grid play exactly where the swung steps fall and notes between grid lines keep their relative place. Every meter has an even number of steps to the bar, so the pairs start again with each bar. A note's end is placed the same way as its start.

The extras are played here too. Whether a note with a chance plays on a pass is `plays`, a hash of the note's id, the block's id and the pass, so every play and every export sound the same: in the block on repeat the pass counts how often the block has started since playback began, in the song it is the bar where that repeat of the placement starts. A ratchet becomes that many events evenly inside the note's length, at fractional ticks that go through the same swing; repeats past the end of the block or the placement are left out, and with a chance the whole ratchet plays or none of it. A held note is started only by the first repeat of the block in its placement and lasts to the placement's end, or to the end of the block on repeat; its length is worked out in ticks and turned into seconds like any other. A slide is passed on as `NoteEvent.slide` on the first event of the note; the engine decides what to do with it.

The mix of the song is played here as well. A muted lane, or one at the bottom of its range, gives no events, and neither do the channels a placement mutes. Every note of a placement that has a fade, or that sits in a lane not at 0 dB, gets a gain curve from `noteCurve` in `src/core/arrangement.ts`: the fades are equal-power curves (the sine of a quarter turn), sampled at seventeen points each, multiplied together and by the lane's gain, and turned into seconds through the same swing as the notes. A note's curve runs from its start to its end, and on to the end of a fade it ends inside, so its release rises or falls with the fade; a note still sounding when a fade-out ends is silent from there. Notes that meet no fade get a single point. Everything happens before the engine, so live playback and export sound the same, and a change of lane level or fade reaches the notes scheduled after it, not those already sounding.

## Undo

The store keeps up to 100 earlier projects. A change normally is one undo step; changes with the same key less than 800 ms apart (a knob being turned, a name being typed) are merged. A pointer gesture in the views (painting cells, dragging a note or a placement) calls `beginGesture` when the button goes down and `commitGesture` when it comes up, and everything the store changes in between is one undo step however long the gesture takes. Actions that are one gesture on their own, such as `duplicatePlacement`, change the document once.

## The shell

The Electron main process creates a frameless window (the retro title bar in the page is the real one), serves the built app from an `app://` origin, and answers a small set of requests from the page: open and save dialogs, the sound and block library folders (`Documents/Hadjitron 3000/Sounds` and `Blocks`), window controls. The page only sees the `Platform` interface in `src/platform/api.ts`; in a browser the same interface is backed by file pickers, downloads and IndexedDB.

The open project and the view it was shown in are kept in IndexedDB a second after every change (`src/app/session.ts`) and restored on the next launch. The first launch opens the demo song in the Song view.

The tutorials live in `src/app/tour`. `lessons.ts` holds both lessons as plain data: the words of each step, the control it points at (by the `data-tour` attribute the views put on their controls, which the kit's Button, TextField, RackUnit, Tabs and MenuBar pass through), the view it opens, and a predicate over the store that says when the user has done it. `tourStore.ts` keeps the running lesson, and `Tour.tsx` draws the coach window and the frame around the target, measuring the target on every animation frame so that both follow it. On the very first launch `restoreSession` reports that no session was ever stored, remembers that in the session store, and the app shows a welcome window once.

A library block is auditioned by rendering it offline on its own, at the tempo of the open project, and playing the result once (`auditionBlock` in `src/app/audio.ts`); it never enters the live engine or the project.

## Adding a module

1. Add its definition to `SOURCES`, `EFFECTS` or `MODS` in `src/core/modules.ts`.
2. Add its audio in `src/audio/modules` and register it there.
3. Add a preset that uses it and a test in `tests/browser`.

The Factory shows the new module with a generic panel built from its parameter list. A custom panel is only needed when the module wants a special display.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Build and open the app in Electron. |
| `npm run dev` | The same with live reload. |
| `npm run web` | Serve the app for a browser. |
| `npm test` | Unit tests. |
| `npm run test:browser` | Engine and platform tests in headless Chromium. |
| `npm run test:e2e` | End-to-end tests of the built app. |
| `npm run typecheck` | TypeScript. |
| `npm run dist` | Package a macOS app into `release/`. |
| `npm run app` | Build `Hadjitron 3000.app` and copy it to Applications. |

## Updates

`npm run app` (`scripts/install-app.mjs`) writes `electron/install.json` before packaging: the checkout's path, the shell's PATH and the commit being built. The file is packed into the application and removed from the checkout afterwards. Only a packaged application on macOS that carries this file offers Help, Check for Updates. `electron/update.cjs` compares the built commit with the checkout's upstream after a `git fetch`, and to update runs `git pull --ff-only`, `npm install` and `install-app.mjs --build-only` in the checkout. On restart a detached shell waits for the old process to exit, moves the new bundle over the old one and opens it. Nothing under Documents or Application Support is part of the application, so updates never touch the user's files.

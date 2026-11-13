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

A project (`Project` in `src/core/types.ts`) has a tempo, a swing amount, a master level, a list of channels, a list of blocks, a song and the audio files it uses. A channel is one row of the Track grid: a sound plus mute and solo. The Factory and the Track are two views of the same channels, so a sound made in the Factory is immediately a row on the grid.

What the user sees as a block is a `Pattern` in the code, and the store keeps that word in its names (`patternId`, `addPattern`, `renamePattern` and so on). A block has a name, a colour, one to thirty-two bars of sixteen steps, and for each channel a list of notes (`Pattern.notes`); a project holds up to 26 blocks. A note (`Note`) has an id that is unique within its block, a start and a length in ticks, a pitch and a velocity. A step has 24 ticks (`TICKS_PER_STEP`, 96 to a quarter note), so a 32nd is 12 ticks and a sixteenth triplet 16. A row's notes are kept sorted by start and then pitch; they may overlap, and several may start together as a chord, but no two share both start and pitch. Note 60 is C3 and plays a sound at its own pitch.

The Track's step grid shows a row's notes by the step they start in. A cell with more than one note shows the lowest one and how many more; a note that starts between grid lines gets a small mark at its place in the step. The grid's gestures act on all the notes that start in a cell, so material the grid cannot draw on its own survives ordinary editing.

The piano roll (`src/ui/track/PianoRoll.tsx`) shows one row of the block over pitch and time in the grid's own columns at one pixel per tick, so every note is exactly where it plays; its geometry, snapping, hit-testing, drags and clipboard are pure functions in `roll.ts`, and its open state, selection, snap and paste mark live in a small store of its own (`rollState.ts`) that the global key handler also uses. Notes and velocity bars are plain absolutely placed elements and the sheet's rows and columns are one repeating CSS background, which stays cheap for a few hundred notes. A drag keeps its result as a local draft and writes it once on release with `updateNotes`, so a selection dragged over another note never stops halfway, and paste and repeat add their notes in one change with `addNotes`.

The song is a list of placements (`Placement`): a block put on one of four lanes at a bar, for a number of bars. Placements in different lanes play together; in one lane they never overlap. A placement longer than its block repeats it, and a shorter one cuts it off. The Track edits one block and the Song arranges them.

A block can also stand on its own outside a project (`Block`): its notes together with the sounds that play them and their samples. `extractBlock` in `src/core/block.ts` lifts one out of a project, and the store's `insertBlock` adds one to a project, reusing a channel when the project already has the same sound. The Block Library offers the blocks of the demo song this way and the user's own blocks from the block library folder.

A sound is a source, an amp envelope, a chain of effects, a set of modulators and an output:

```
source -> amp envelope -> effect -> effect -> ... -> output (level, pan)
              modulators (envelopes, LFOs) -> any parameter marked as a target
```

Every module is described once in `src/core/modules.ts`: its parameters with ranges, units, knob tapers and defaults. The engine, the file format and the generic module panel in the Factory are all driven by that table. Every module and parameter also has a level from `src/core/levels.ts` (Basics when absent), which the Factory uses in beginner mode to fold Shaping and Deep controls into sections and to group the add lists; it is a property of the table only and never reaches the file format or the engine. The beginner/pro switch is a user preference in `src/app/prefs.ts`, kept in localStorage rather than in the project. Parameter values are stored in real units (hertz, seconds, semitones, decibels).

## Files

Sounds are saved as `.h3s`, blocks as `.h3b` and projects as `.h3k`. All three are JSON text with a `format` tag and a `version`. Audio files used by a sampler are embedded as base64 in their original encoding and are keyed by a hash of their content, so the same file is stored once however many sounds use it. `src/core/fileformat.ts` reads and writes the three formats and refuses files it does not understand with a readable message. The current version is 3. Projects of version 1, whose song was a list of patterns played one after another, open with that list laid out in the first lane. Versions 1 and 2 kept one step per row and step index (`cells` in a project, `steps` in a block) with a length in steps; reading them, and a stored session of that age, turns step i into a note at tick 24 i and its length into ticks, so nothing is lost. Only version 3 is written.

## The engine

`Engine` (`src/audio`) owns one audio graph per channel:

```
voices: source -> voice gain (amp envelope x velocity) --+
                                                         +--> effect chain -> output -> channel gain (mute/solo) -> master
modulators -> depth gains -> audio parameters
master -> master level -> soft clip -> destination and analyser
```

Each channel also has a tap of its own output ahead of mute and solo, made the first time the Factory's scope reads it.

Each note is a voice with its own source and amp envelope. The effect chain and the modulators are shared by all voices of a channel; a modulation envelope restarts on every note and follows the most recent one. This keeps the processing cost per channel fixed no matter how many notes overlap.

`engine.setProject(project)` is called on every change of the document. The store is immutable, so the engine compares object identities, applies parameter changes smoothly, and rebuilds only the channels whose structure changed.

The engine takes any `BaseAudioContext`. The same code plays live through an `AudioContext` and renders an export through an `OfflineAudioContext`.

## Time

The sequencer in `src/core/sequencer.ts` is a pure function from a project, a play scope (one block on repeat, or the song) and a range of ticks to a list of note events with times in seconds; every note that starts in the range is in it once. `heardAt` tells which blocks are heard at a tick, which is also how the views place their play markers. The transport calls it a little ahead of the audio clock (a look-ahead scheduler), one step's window of ticks at a time, and hands the events to the engine; the offline renderer calls it once for the whole export. A step is a sixteenth note. Swing delays every second sixteenth by up to half a step: `tickTime` stretches the first step of each pair and squeezes the second, and moves the ticks inside them in proportion, so notes on the grid play exactly where the swung steps fall and notes between grid lines keep their relative place. A note's end is placed the same way as its start.

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

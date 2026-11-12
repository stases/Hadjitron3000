# Architecture

Hadjitron 3000 is a web app (TypeScript, React, the Web Audio API) inside a thin Electron shell. Everything that makes sound runs in Chromium's audio engine, so the app behaves the same in Electron on a Mac and in a Chromium browser, which is also where the tests run.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/core` | The document model, the module table, the sequencer and the file formats. Pure TypeScript, no DOM and no audio. |
| `src/audio` | The Web Audio engine, the transport, offline rendering and MP3 encoding. |
| `src/state` | The app store and its actions, including undo. |
| `src/platform` | Files, the sound library folder and the window, once for Electron and once for the browser. |
| `src/app` | The window chrome, dialogs, keyboard shortcuts, and the glue between store, engine and platform. |
| `src/ui/kit` | The retro widgets. `src/ui/theme` holds the tokens and fonts. |
| `src/ui/factory`, `src/ui/track` | The two views. |
| `src/presets` | Factory sounds and the demo project, in the app's own file formats. |
| `electron` | The main process and the preload script, plain CommonJS with no build step. |
| `tests` | `unit` runs in Node, `browser` runs in headless Chromium (the engine needs real Web Audio), `e2e` drives the built app. |

Dependencies point one way: `core` knows nothing else; `audio` and `state` use `core`; `app` and `ui` use everything. The views never talk to the engine directly; they read the store, call actions, and use the small audio controller in `src/app/audio.ts` to audition notes.

## The document

A project (`Project` in `src/core/types.ts`) has a tempo, a swing amount, a master level, a list of channels, a list of patterns, a song (pattern ids in play order) and the audio files it uses. A channel is one row of the Track grid: a sound plus mute and solo. The Factory and the Track are two views of the same channels, so a sound made in the Factory is immediately a row on the grid.

A sound is a source, an amp envelope, a chain of effects, a set of modulators and an output:

```
source -> amp envelope -> effect -> effect -> ... -> output (level, pan)
              modulators (envelopes, LFOs) -> any parameter marked as a target
```

Every module is described once in `src/core/modules.ts`: its parameters with ranges, units, knob tapers and defaults. The engine, the file format and the generic module panel in the Factory are all driven by that table. Parameter values are stored in real units (hertz, seconds, semitones, decibels).

A pattern has one to eight bars of sixteen steps. A step holds a note, a velocity and a length in steps. Note 60 is C3 and plays a sound at its own pitch.

## Files

Sounds are saved as `.h3s` and projects as `.h3k`. Both are JSON text with a `format` tag and a `version`. Audio files used by a sampler are embedded as base64 in their original encoding and are keyed by a hash of their content, so the same file is stored once however many sounds use it. `src/core/fileformat.ts` reads and writes both formats and refuses files it does not understand with a readable message.

## The engine

`Engine` (`src/audio`) owns one audio graph per channel:

```
voices: source -> voice gain (amp envelope x velocity) --+
                                                         +--> effect chain -> output -> channel gain (mute/solo) -> master
modulators -> depth gains -> audio parameters
master -> master level -> soft clip -> destination and analyser
```

Each note is a voice with its own source and amp envelope. The effect chain and the modulators are shared by all voices of a channel; a modulation envelope restarts on every note and follows the most recent one. This keeps the processing cost per channel fixed no matter how many notes overlap.

`engine.setProject(project)` is called on every change of the document. The store is immutable, so the engine compares object identities, applies parameter changes smoothly, and rebuilds only the channels whose structure changed.

The engine takes any `BaseAudioContext`. The same code plays live through an `AudioContext` and renders an export through an `OfflineAudioContext`.

## Time

The sequencer in `src/core/sequencer.ts` is a pure function from a project and a range of steps to a list of note events with times in seconds. The transport calls it a little ahead of the audio clock (a look-ahead scheduler) and hands the events to the engine; the offline renderer calls it once for the whole export. A step is a sixteenth note. Swing delays every second sixteenth by up to half a step.

## The shell

The Electron main process creates a frameless window (the retro title bar in the page is the real one), serves the built app from an `app://` origin, and answers a small set of requests from the page: open and save dialogs, the sound library folder, window controls. The page only sees the `Platform` interface in `src/platform/api.ts`; in a browser the same interface is backed by file pickers, downloads and IndexedDB.

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

```
+==========================================================================+
|                                                                          |
|   H   H   AAA   DDDD      J  III  TTTTT  RRRR    OOO   N   N             |
|   H   H  A   A  D   D     J   I     T    R   R  O   O  NN  N             |
|   HHHHH  AAAAA  D   D     J   I     T    RRRR   O   O  N N N             |
|   H   H  A   A  D   D  J  J   I     T    R  R   O   O  N  NN             |
|   H   H  A   A  DDDD    JJ   III    T    R   R   OOO   N   N   3 0 0 0   |
|                                                                          |
|   a small music machine                                 version 0.1.0    |
|                                                                          |
+==========================================================================+
```

Hadjitron 3000 is a small music machine for electronic and experimental music. You build sounds in the Factory, write short blocks of steps with them on the Track, arrange the blocks into a song in the Song, press Space, and export what you made. It looks and behaves like a program from 1998 on purpose.

![The Song](docs/img/song.png)

![The Track](docs/img/track.png)

![The Factory](docs/img/factory.png)

```
+--------------------------------------------------------------------------+
|  1. INSTALLATION ON A MACINTOSH                                          |
+--------------------------------------------------------------------------+
```

You need Node.js 22 or newer and the GitHub command line tool. If you use Homebrew:

```
brew install node gh
gh auth login
```

Answer yes when `gh auth login` asks whether to log in Git with your GitHub credentials; that is how the program later fetches its updates. Then fetch the program and put it in your Applications folder:

```
gh repo clone stases/Hadjitron3000
cd Hadjitron3000
npm install
npm run app
```

The first `npm install` downloads Electron and takes a minute or two. `npm run app` builds Hadjitron 3000.app and copies it to Applications, from where it opens like any other program: from Launchpad, Spotlight or the Dock. A demo called Welcome is loaded the first time; press Space to hear it.

The first time, a small window also offers two tutorials, Make a Sound and Make a Song. Each one walks you through the program a step at a time: a little window points at the control it talks about, ticks the step off when you have done it, and waits for you to press Next. A tutorial starts on a fresh project after offering to save yours, you can close it whenever you like, and both stay in the Help menu.

The application remembers the Hadjitron3000 folder it was built from, so leave that folder where it is. To update, choose Check for Updates in the Help menu. It asks GitHub what is new and lists the changes; Update and Restart fetches them into that folder, builds the new application, offers to save your project and opens the new version in place of the old one. Your sounds and blocks in Documents/Hadjitron 3000 and your saved projects are never touched. If something goes wrong on the way, the old version keeps working and the full story is in `update.log` in `~/Library/Application Support/Hadjitron 3000`.

The application is not signed by Apple. A copy you built yourself opens normally; a copy that was downloaded or sent to you has to be opened once with a right-click and Open. `npm run dist` makes a disk image in the `release` folder for giving the program to someone else.

```
+--------------------------------------------------------------------------+
|  2. THE TRACK                                                            |
+--------------------------------------------------------------------------+
```

Every sound of the project is a row, and every column is a sixteenth note. Click a cell to put a step there and click it again to remove it. Hold the button and move sideways to paint several steps. Drag a step up or down to change its note, drag its right edge to make it longer, and turn the scroll wheel over it to make it louder or softer. A right-click selects a step without changing it, and the bar at the bottom then shows its note, velocity and length.

The grid shows one block: one to thirty-two bars of steps for any of the project's sounds. The bar above the grid chooses the block to work on and gives it a colour and a name. Next to that are buttons to add a new block, copy the current one to start a variation, clear it and delete it, and the length of the block in bars. At the right end a quiet line tells you how often the block is used in the song.

Tempo, swing and the master volume are in the bar at the top of the window. The Block and Song buttons next to them choose what Play plays: the current block over and over, or the whole song. The Track plays the block and the Song plays the song, so you rarely need to touch them.

Each row has a mute button, a solo button and a level slider. Double-click the name of a row to open that sound in the Factory. Drop audio files anywhere on the window to add them as new rows.

For chords, pads and notes between the steps, open a row in the piano roll with the small keyboard button on its header, or double-click a step that holds a chord. The roll takes the place of the grid, with a thin strip of every row above it so you can see the rest of the block and click another sound to switch to it. Pitch runs up the keys at the left (click one to hear it) and time runs across in the same columns as the grid. Click empty space to add a note and keep the button down to drag out its length; click on the same beat at another pitch to build a chord. Drag a note to move it, drag either end to make it start earlier or later or to change its length, and drag the bars in the amber lane at the bottom to set how hard each note plays. A click selects a note, Shift-click adds more, and dragging with Shift or the right button selects everything inside the rectangle; moving, the arrow keys, Delete and the bar at the bottom act on the whole selection. Snap sets the grid the notes stick to (sixteenths, thirty-seconds, two kinds of triplets, or off), and holding Alt while you drag ignores it. Copy puts a small teal mark in the ruler right after the copied notes and Paste puts them there, moving the mark on, so pasting again lays the copies end to end; click the ruler to put the mark somewhere else. Repeat (Cmd+D) copies the selection directly after itself. The Grid button or Esc goes back to the step grid, which shows the same notes.

```
+--------------------------------------------------------------------------+
|  3. THE SONG                                                             |
+--------------------------------------------------------------------------+
```

The Song arranges blocks on a timeline of four lanes, counted in bars. Blocks in different lanes play at the same time, so the beat, the bass line, the keys and a pad can each have a lane of their own, and a block in one lane can start while another is still going.

The list at the left holds the blocks of the project. Pick one and click an empty bar of a lane to place it there. Drag a placed block to move it along its lane or into another lane, and drag its right edge to stretch it: a block placed longer than it is plays again from the start, and one placed shorter is cut off. Double-click a placed block to edit its steps on the Track, and right-click it for a small menu. With the timeline selected, Delete removes the selected block and the arrow keys move it.

A project holds up to twenty-six blocks. A block can also travel to other projects. Save Block to Library in the Block menu keeps a block, together with the sounds it plays, in the folder `Documents/Hadjitron 3000/Blocks`, and the Block Library window lists it next to the eight blocks of the demo song. Audition plays a block once, and Add to Project brings it into the project with any of its sounds the project does not have yet.

```
+--------------------------------------------------------------------------+
|  4. THE FACTORY                                                          |
+--------------------------------------------------------------------------+
```

A sound is a rack of units, read from top to bottom. The source makes the tone: an oscillator, an FM pair, noise, or a sampler that plays an audio file. The amp envelope shapes its loudness over time. After that come as many effects as you like, in any order: filter, drive, delay and reverb. Modulators (envelopes and LFOs) move a knob of your choice for you, for example the filter cutoff or the pitch. The output unit sets level and pan.

Every control and every unit has a level: Basics, Shaping or Deep. Basics is what you need for a sound that works, Shaping changes its character, and Deep is for the controls that take some explaining. The program starts in beginner mode, where each unit shows its Basics and keeps the rest behind small Shaping and Deep buttons at its right edge; press one to open that section beside the others. A lamp on the button lights when a control inside is no longer at its default, so nothing you hear is hidden. The Effect and Modulator lists and the source type are grouped by level too. Beginner Mode in the View menu turns all of this off and shows every control at once, and the program remembers your choice.

Drag a knob up or down to turn it, hold Shift for fine steps, and double-click it to put it back. The status bar at the bottom of the window explains whatever is under the pointer.

Play the sound on the piano at the bottom with the mouse, or on the computer keyboard: the row A S D F G H J K L plays the white keys and W E T Y U O P the black ones. Z and X change the octave.

The scope beside the piano shows the wave of the selected sound as you play it, standing still like on an old oscilloscope, so you can watch the shape change while you turn a knob. The number in its corner is the time per division; it follows the note you play, so a few cycles always fit.

Save to Library keeps a sound for other projects. The library is the folder `Documents/Hadjitron 3000/Sounds`, and the Sound Library window lists it together with the seventeen factory sounds.

```
+--------------------------------------------------------------------------+
|  5. FILES                                                                |
+--------------------------------------------------------------------------+
```

| File   | What it is                                                              |
| ------ | ----------------------------------------------------------------------- |
| `.h3k` | A project: its sounds, blocks, song, tempo and any samples it uses.     |
| `.h3s` | One sound, with its sample if it has one.                               |
| `.h3b` | One block, with the sounds it plays and their samples.                  |
| `.wav` | Export Audio, 16-bit stereo.                                            |
| `.mp3` | Export Audio, 128 to 320 kbit/s.                                        |

Projects, sounds and blocks are plain JSON, so they are safe to keep in git or to send by mail. Samples travel inside the file. Sounds in the library are kept in `Documents/Hadjitron 3000/Sounds` and blocks in `Documents/Hadjitron 3000/Blocks`. Dropping a `.h3s` or `.h3b` file on the window adds the sound or the block to the project. Export Audio in the File menu renders the current block or the whole song, and Export in the Factory renders a single sound. WAV, MP3, AIFF, FLAC, Ogg and M4A files can be imported.

```
+--------------------------------------------------------------------------+
|  6. KEYS                                                                 |
+--------------------------------------------------------------------------+
```

| Key                    | What it does                              |
| ---------------------- | ----------------------------------------- |
| Space                  | Play or stop                              |
| Cmd+1, Cmd+2, Cmd+3    | Factory, Track, Song                      |
| Cmd+N, Cmd+O, Cmd+S    | New, open, save                           |
| Shift+Cmd+S            | Save as                                   |
| Cmd+E                  | Export audio                              |
| Cmd+Z, Shift+Cmd+Z     | Undo, redo                                |
| A to L, W to P         | Play the selected sound like a piano      |
| Z, X                   | Octave down, octave up                    |
| Arrow keys             | Move the selected step, or change its note |
| Delete                 | Remove the selected step                  |
| Cmd+C, Cmd+X, Cmd+V    | Copy, cut, paste notes in the piano roll  |
| Cmd+D, Cmd+A           | Repeat or select notes in the piano roll  |

The full list is under Help, Keyboard Shortcuts.

```
+--------------------------------------------------------------------------+
|  7. FOR THE TINKERER                                                     |
+--------------------------------------------------------------------------+
```

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run app`          | Build the application and copy it to Applications         |
| `npm start`            | Build and open the program from this folder               |
| `npm run dev`          | Open the program with live reload                         |
| `npm run web`          | Run it in a browser, without Electron                     |
| `npm run typecheck`    | Check the types                                           |
| `npm test`             | Unit tests                                                |
| `npm run test:browser` | Interface and audio tests in headless Chromium            |
| `npm run test:e2e`     | End-to-end tests of the whole program                     |
| `npm run dist`         | Build a disk image of the application into `release`      |

The browser tests need `npx playwright install chromium` once. The macOS workflow under Actions runs all of the above on a Mac and attaches the disk image; start it by hand from the Actions tab.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes how the code is laid out and [docs/DESIGN.md](docs/DESIGN.md) the rules of the look. Every widget is on show at `kit.html` when `npm run web` is running.

The pixel fonts are Fusion Pixel by TakWolf and Departure Mono by Helena Zhang, both under the SIL Open Font License.

// The menu bar, built from the current state so that enabled and checked items follow the store.

import { PATTERN_NAMES } from '../core/defaults';
import { platform } from '../platform';
import { EXAMPLES } from '../presets/examples';
import {
  addPattern, clearPattern, duplicateChannel, duplicatePattern, redo, removeChannel, removePattern, setPlaying,
  setScope, setView, undo,
} from '../state/store';
import type { AppState } from '../state/store';
import type { MenuItem } from '../ui/kit';
import {
  addBlock, addSound, checkForUpdates, exportAudio, exportSound, importAudio, newProject, openExample, openProject,
  replaceSound, saveBlockAs, saveBlockToLibrary, saveProject, saveProjectAs, saveSoundAs, saveSoundToLibrary, showAbout,
  showShortcuts,
} from './commands';
import { fitSelectionToScale, openRandomise } from '../ui/track/tools';
import { setPrefs, toggleMetronome, toggleScaleSnap } from './prefs';
import type { Prefs } from './prefs';
import { toggleRecord } from './record';
import { modKey } from './shortcuts';
import { startLesson } from './tour/tourStore';

export function buildMenus(
  state: AppState, prefs: Prefs, record: boolean,
): { label: string; tour?: string; items: MenuItem[] }[] {
  const channel = state.channelId;
  const onChannel = (run: (id: string) => unknown) => ({
    disabled: !channel,
    onSelect: () => channel && void run(channel),
  });
  const { reveal } = platform.library;
  const revealBlocks = platform.blocks.reveal;
  const block = state.patternId;
  const win = platform.window;
  const full = state.project.patterns.length >= PATTERN_NAMES.length;
  const { scale } = state.project;
  return [
    {
      label: 'File',
      tour: 'menu-file',
      items: [
        { label: 'New Project', shortcut: modKey('N'), onSelect: () => void newProject() },
        { label: 'Open Project…', shortcut: modKey('O'), onSelect: () => void openProject() },
        {
          label: 'Open Example',
          hint: 'Opens a short song of one kind of music as a new project, to listen to and take apart.',
          items: EXAMPLES.map(({ name, project }) => ({ label: name, onSelect: () => void openExample(project) })),
        },
        { label: 'Save Project', shortcut: modKey('S'), onSelect: () => void saveProject() },
        { label: 'Save Project As…', shortcut: modKey('S', true), onSelect: () => void saveProjectAs() },
        'separator',
        { label: 'Import Audio…', onSelect: () => void importAudio() },
        { label: 'Export Audio…', shortcut: modKey('E'), onSelect: exportAudio },
        ...(win ? ['separator' as const, { label: 'Quit', onSelect: () => win.close() }] : []),
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: modKey('Z'), disabled: state.past.length === 0, onSelect: undo },
        { label: 'Redo', shortcut: modKey('Z', true), disabled: state.future.length === 0, onSelect: redo },
      ],
    },
    {
      label: 'Sound',
      items: [
        { label: 'New Sound…', onSelect: addSound },
        { label: 'Replace from Library…', ...onChannel(replaceSound) },
        { label: 'Duplicate', ...onChannel(duplicateChannel) },
        { label: 'Remove', ...onChannel(removeChannel) },
        'separator',
        { label: 'Save to Library', ...onChannel(saveSoundToLibrary) },
        { label: 'Save Sound As…', ...onChannel(saveSoundAs) },
        { label: 'Export Sound as WAV…', ...onChannel(exportSound) },
        ...(reveal ? ['separator' as const, { label: 'Show Library Folder', onSelect: reveal }] : []),
      ],
    },
    {
      label: 'Track',
      items: [
        { label: 'Play / Stop', shortcut: 'Space', onSelect: () => setPlaying(!state.playing) },
        {
          label: 'Record', shortcut: 'R', checked: record, disabled: state.scope === 'song', onSelect: toggleRecord,
        },
        { label: 'Metronome', shortcut: 'C', checked: prefs.metronome, onSelect: toggleMetronome },
        'separator',
        {
          label: 'Snap to Scale',
          checked: prefs.scaleSnap && !!scale,
          disabled: !scale,
          hint: 'New, dragged, recorded and typed notes land on the scale of the song; the roll sets the scale.',
          onSelect: toggleScaleSnap,
        },
        {
          label: 'Fit to Scale',
          disabled: !scale || !channel,
          hint: 'Moves the notes of the row, or those selected in the roll, that are out of the scale onto it.',
          onSelect: fitSelectionToScale,
        },
        {
          label: 'Randomise…',
          disabled: !channel,
          hint: 'Fills the row of the selected sound with notes drawn at random, in the scale when the song has one.',
          onSelect: openRandomise,
        },
      ],
    },
    {
      label: 'Block',
      items: [
        { label: 'New Block', disabled: full, onSelect: addPattern },
        { label: 'Duplicate Block', disabled: full, onSelect: () => duplicatePattern(block) },
        { label: 'Clear Block', onSelect: () => clearPattern(block) },
        { label: 'Delete Block', disabled: state.project.patterns.length <= 1, onSelect: () => removePattern(block) },
        'separator',
        { label: 'Block Library…', onSelect: addBlock },
        { label: 'Save Block to Library', onSelect: () => void saveBlockToLibrary(block) },
        { label: 'Save Block As…', onSelect: () => void saveBlockAs(block) },
        ...(revealBlocks ? [{ label: 'Show Library Folder', onSelect: revealBlocks }] : []),
        'separator',
        { label: 'Play Block', checked: state.scope === 'pattern', onSelect: () => setScope('pattern') },
        { label: 'Play Song', checked: state.scope === 'song', onSelect: () => setScope('song') },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Factory', shortcut: modKey('1'), checked: state.view === 'factory', onSelect: () => setView('factory') },
        { label: 'Track', shortcut: modKey('2'), checked: state.view === 'track', onSelect: () => setView('track') },
        { label: 'Song', shortcut: modKey('3'), checked: state.view === 'song', onSelect: () => setView('song') },
        { label: 'Mixer', shortcut: modKey('4'), checked: state.view === 'mixer', onSelect: () => setView('mixer') },
        'separator',
        {
          label: 'Beginner Mode',
          checked: prefs.beginner,
          hint: 'Folds the Shaping and Deep controls away (in the Factory, the Track, the Mixer and the time '
            + 'signature) and groups the add lists by level.',
          onSelect: () => setPrefs({ beginner: !prefs.beginner }),
        },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Tutorial: Make a Sound', onSelect: () => void startLesson('sound') },
        { label: 'Tutorial: Make a Song', onSelect: () => void startLesson('song') },
        'separator',
        { label: 'Keyboard Shortcuts…', onSelect: showShortcuts },
        ...(platform.updates ? [{ label: 'Check for Updates…', onSelect: checkForUpdates }] : []),
        { label: 'About Hadjitron 3000…', onSelect: showAbout },
      ],
    },
  ];
}

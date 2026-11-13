// The menu bar, built from the current state so that enabled and checked items follow the store.

import { PATTERN_NAMES } from '../core/defaults';
import { platform } from '../platform';
import {
  addPattern, clearPattern, duplicateChannel, duplicatePattern, redo, removeChannel, removePattern, setPlaying,
  setScope, setView, undo,
} from '../state/store';
import type { AppState } from '../state/store';
import type { MenuItem } from '../ui/kit';
import {
  addSound, exportAudio, exportSound, importAudio, newProject, openProject, replaceSound, saveProject, saveProjectAs,
  saveSoundAs, saveSoundToLibrary, showAbout, showShortcuts,
} from './commands';
import { modKey } from './shortcuts';

export function buildMenus(state: AppState): { label: string; items: MenuItem[] }[] {
  const channel = state.channelId;
  const onChannel = (run: (id: string) => unknown) => ({
    disabled: !channel,
    onSelect: () => channel && void run(channel),
  });
  const { reveal } = platform.library;
  const win = platform.window;
  const full = state.project.patterns.length >= PATTERN_NAMES.length;
  return [
    {
      label: 'File',
      items: [
        { label: 'New Project', shortcut: modKey('N'), onSelect: () => void newProject() },
        { label: 'Open Project…', shortcut: modKey('O'), onSelect: () => void openProject() },
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
        'separator',
        { label: 'New Pattern', disabled: full, onSelect: addPattern },
        { label: 'Duplicate Pattern', disabled: full, onSelect: () => duplicatePattern(state.patternId) },
        { label: 'Clear Pattern', onSelect: () => clearPattern(state.patternId) },
        {
          label: 'Delete Pattern',
          disabled: state.project.patterns.length <= 1,
          onSelect: () => removePattern(state.patternId),
        },
        'separator',
        { label: 'Play Pattern', checked: state.scope === 'pattern', onSelect: () => setScope('pattern') },
        { label: 'Play Song', checked: state.scope === 'song', onSelect: () => setScope('song') },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Factory', shortcut: modKey('1'), checked: state.view === 'factory', onSelect: () => setView('factory') },
        { label: 'Track', shortcut: modKey('2'), checked: state.view === 'track', onSelect: () => setView('track') },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts…', onSelect: showShortcuts },
        { label: 'About Hadjitron 3000…', onSelect: showAbout },
      ],
    },
  ];
}

// Shortcut labels as the platform writes them, and the list the Keyboard Shortcuts dialog shows.

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** The label of Cmd/Ctrl plus a key, e.g. "⇧⌘S" on a Mac and "Ctrl+Shift+S" elsewhere. */
export function modKey(key: string, shift = false): string {
  return IS_MAC ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

const SHIFT = IS_MAC ? '⇧' : 'Shift+';

export const SHORTCUT_GROUPS: { label: string; keys: [string, string][] }[] = [
  {
    label: 'Project',
    keys: [
      [modKey('N'), 'New project'],
      [modKey('O'), 'Open a project'],
      [modKey('S'), 'Save the project'],
      [modKey('S', true), 'Save the project as a new file'],
      [modKey('E'), 'Export audio'],
      [modKey('Z'), 'Undo'],
      [`${modKey('Z', true)}, ${modKey('Y')}`, 'Redo'],
      [`${modKey('1')}, ${modKey('2')}`, 'Factory, Track'],
    ],
  },
  {
    label: 'Playing',
    keys: [
      ['Space', 'Play or stop'],
      ['A W S E D F T G Y H U J K O L P', 'Play the selected sound like a piano'],
      ['Z, X', 'Octave down, up'],
    ],
  },
  {
    label: 'Track, with a step selected',
    keys: [
      ['Piano keys', 'Write the note and go to the next step'],
      ['← →', 'Select the step before or after'],
      ['↑ ↓', 'Note up or down a semitone'],
      [`${SHIFT}↑ ${SHIFT}↓`, 'Note up or down an octave'],
      ['Delete, Backspace', 'Remove the step'],
      ['Esc', 'Clear the selection'],
    ],
  },
];

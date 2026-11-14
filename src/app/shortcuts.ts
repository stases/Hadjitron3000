// Shortcut labels as the platform writes them, and the list the Keyboard Shortcuts dialog shows. The labels are pure
// functions of whether the keyboard is a Mac's, so both kinds can be tested anywhere.

export const isMacPlatform = (platform: string) => /Mac|iPhone|iPad/.test(platform);

export const IS_MAC = isMacPlatform(navigator.platform);

/** The label of Cmd/Ctrl plus a key, e.g. "⇧⌘S" on a Mac and "Ctrl+Shift+S" elsewhere. */
export function modKey(key: string, shift = false, mac = IS_MAC): string {
  return mac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** File, Quit on a Mac and File, Exit on Windows, with the system's own key for it outside the Mac's menu. */
export const quitItem = (mac = IS_MAC) => (mac ? { label: 'Quit' } : { label: 'Exit', shortcut: 'Alt+F4' });

export function shortcutGroups(mac: boolean): { label: string; keys: [string, string][] }[] {
  const mod = (key: string, shift = false) => modKey(key, shift, mac);
  const shift = mac ? '⇧' : 'Shift+';
  const alt = mac ? '⌥' : 'Alt';
  return [
    {
      label: 'Project',
      keys: [
        [mod('N'), 'New project'],
        [mod('O'), 'Open a project'],
        [mod('S'), 'Save the project'],
        [mod('S', true), 'Save the project as a new file'],
        [mod('E'), 'Export audio'],
        [mod('Z'), 'Undo'],
        [`${mod('Z', true)}, ${mod('Y')}`, 'Redo'],
        [`${mod('1')}, ${mod('2')}, ${mod('3')}, ${mod('4')}`, 'Factory, Track, Song, Mixer'],
      ],
    },
    {
      label: 'Playing',
      keys: [
        ['Space', 'Play or stop'],
        ['A W S E D F T G Y H U J K O L P', 'Play the selected sound like a piano'],
        ['Z, X', 'Octave down, up'],
        ['R', 'Record into the block; when stopped, after a bar of clicks'],
        ['C', 'Metronome on or off'],
      ],
    },
    {
      label: 'Track, with a step selected',
      keys: [
        ['Piano keys', 'Write the note and go to the next step'],
        ['← →', 'Select the step before or after'],
        ['↑ ↓', 'Note up or down a semitone'],
        [`${shift}↑ ${shift}↓`, 'Note up or down an octave'],
        ['Delete, Backspace', 'Remove the step'],
        ['Esc', 'Clear the selection'],
      ],
    },
    {
      label: 'Track, in the piano roll',
      keys: [
        [mod('A'), 'Select all notes of the row'],
        [`${mod('C')}, ${mod('X')}`, 'Copy, cut the selected notes'],
        [mod('V'), 'Paste at the paste mark in the ruler'],
        [mod('D'), 'Repeat the selected notes right after themselves'],
        ['← →', 'Move the selected notes by the snap'],
        [`${shift}← ${shift}→`, 'Move the selected notes by a bar'],
        ['↑ ↓', 'Selected notes up or down a semitone'],
        [`${shift}↑ ${shift}↓`, 'Selected notes up or down an octave'],
        ['Delete, Backspace', 'Remove the selected notes'],
        ['Esc', 'Clear the selection, then back to the grid'],
        [`${alt} while dragging`, 'Place notes without snapping'],
      ],
    },
  ];
}

export const SHORTCUT_GROUPS = shortcutGroups(IS_MAC);

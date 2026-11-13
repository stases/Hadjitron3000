import { useEffect, useState } from 'react';
import { newSound } from '../core/defaults';
import { parseSound } from '../core/fileformat';
import { SOURCES } from '../core/modules';
import type { SampleData, Sound } from '../core/types';
import { platform } from '../platform';
import { PRESET_GROUPS, preset } from '../presets';
import { addChannel, replaceSound } from '../state/store';
import { Button, Dialog, ListBox } from '../ui/kit';
import type { IconName, ListItem } from '../ui/kit';
import { audition, endAudition } from './audio';
import { fileProblem, importAudio, loadSample } from './commands';
import { ask, closeDialog, fail, reason } from './dialogStore';

const SOURCE_ICONS: Record<string, IconName> = {
  osc: 'wave-sawtooth', fm: 'wave-sine', noise: 'noise', sample: 'sample',
};
const NEW_SAMPLER = 'new:sample';

function listItems(mine: string[]): ListItem[] {
  return [
    { header: 'New' },
    ...SOURCES.map((s) => ({ id: `new:${s.type}`, label: s.label, icon: SOURCE_ICONS[s.type] })),
    ...PRESET_GROUPS.flatMap((g) => [
      { header: `Factory · ${g.label}` },
      ...g.names.map((name) => ({ id: `preset:${name}`, label: name, icon: 'note' as const })),
    ]),
    { header: 'My Sounds' },
    ...mine.map((name) => ({ id: `user:${name}`, label: name, icon: 'floppy' as const })),
  ];
}

async function loadSound(id: string): Promise<{ sound: Sound; samples: Record<string, SampleData> } | null> {
  const [kind, name] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (kind === 'new') return { sound: newSound(name, SOURCES.find((s) => s.type === name)!.label), samples: {} };
  if (kind === 'preset') return { sound: preset(name), samples: {} };
  try {
    return parseSound(new TextDecoder().decode(await platform.library.read(name)));
  } catch (error) {
    await fail(`The sound ${name} could not be opened. ${fileProblem(error)}`);
    return null;
  }
}

/** The Sound Library: pick a new, factory or saved sound to add to the track or to replace a channel's sound. */
export function LibraryDialog({ replace }: { replace: string | null }) {
  const [mine, setMine] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>('new:osc');

  const refresh = async () => {
    try {
      setMine(await platform.library.list());
    } catch (error) {
      await fail(`Your sound library could not be read${reason(error)}.`);
    }
  };
  useEffect(() => {
    void refresh();
    return endAudition;
  }, []);

  const play = async (id: string) => {
    if (id === NEW_SAMPLER) return;
    const loaded = await loadSound(id);
    if (loaded) await audition(loaded.sound, loaded.samples);
  };

  const choose = async () => {
    if (!selected) return;
    if (selected === NEW_SAMPLER) {
      closeDialog();
      if (replace === null) return importAudio();
      replaceSound(replace, newSound('sample', 'Sampler'));
      return loadSample(replace);
    }
    const loaded = await loadSound(selected);
    if (!loaded) return;
    if (replace === null) addChannel(loaded.sound, loaded.samples);
    else replaceSound(replace, loaded.sound, loaded.samples);
    closeDialog();
  };

  const remove = async () => {
    if (!selected?.startsWith('user:')) return;
    const name = selected.slice('user:'.length);
    const answer = await ask({
      title: 'Delete Sound',
      icon: 'question',
      text: `Delete ${name} from your library? This cannot be undone.`,
      buttons: [
        { label: 'Delete', value: 'delete' },
        { label: 'Cancel', value: 'cancel', primary: true },
      ],
    });
    if (answer !== 'delete') return;
    try {
      await platform.library.remove(name);
      setSelected(null);
    } catch (error) {
      await fail(`${name} could not be deleted${reason(error)}.`);
    }
    await refresh();
  };

  return (
    <Dialog title="Sound Library" onClose={closeDialog}>
      <div className="h-app-library">
        <div className="h-app-library-list">
          <ListBox
            items={listItems(mine)}
            value={selected}
            onChange={setSelected}
            onActivate={(id) => void play(id)}
            height={318}
          />
        </div>
        <div className="h-app-library-buttons">
          <Button primary disabled={!selected} onClick={() => void choose()}>
            {replace === null ? 'Add to Track' : 'Replace'}
          </Button>
          <Button disabled={!selected || selected === NEW_SAMPLER} onClick={() => selected && void play(selected)}>
            Audition
          </Button>
          <Button disabled={!selected?.startsWith('user:')} onClick={() => void remove()}>
            Delete
          </Button>
          <div className="h-app-spacer" />
          <Button onClick={closeDialog}>Close</Button>
        </div>
      </div>
      <p className="h-app-library-note">
        {mine.length === 0
          ? 'Sounds you save to the library are listed under My Sounds.'
          : 'Double-click a sound to hear it.'}
      </p>
    </Dialog>
  );
}

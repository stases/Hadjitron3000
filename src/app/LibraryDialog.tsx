import { useEffect, useState } from 'react';
import { newSound } from '../core/defaults';
import { parseBlock, parseSound } from '../core/fileformat';
import { SOURCES } from '../core/modules';
import type { Block, SampleData, Sound } from '../core/types';
import { platform } from '../platform';
import type { Library } from '../platform/api';
import { PRESET_GROUPS, preset, presetSamples } from '../presets';
import { factorySample } from '../presets/samples';
import { factoryBlocks } from '../presets/projects';
import { addChannel, replaceSound } from '../state/store';
import { Button, Dialog, ListBox, Select } from '../ui/kit';
import type { IconName, ListItem } from '../ui/kit';
import { audition, auditionBlock, endAudition } from './audio';
import { addBlockToProject, fileProblem, importAudio, loadSample } from './commands';
import { ask, closeDialog, fail, reason } from './dialogStore';

const USER = 'user:';
const ALL = '';

/** A list cut at its headers: each header with the rows under it. */
function sections(items: ListItem[]): ListItem[][] {
  return items.reduce<ListItem[][]>((out, item) => {
    if ('header' in item || out.length === 0) out.push([item]);
    else out[out.length - 1].push(item);
    return out;
  }, []);
}

const headerOf = (section: ListItem[]) => ('header' in section[0] ? section[0].header : ALL);

interface LibraryProps {
  title: string;
  noun: 'sound' | 'block';
  library: Library;
  factory: ListItem[]; // everything listed above the user's own files
  initial: string;
  action: string; // the primary button
  canPlay: (id: string) => boolean;
  play: (id: string) => Promise<void>;
  choose: (id: string) => Promise<void>;
}

/** A library window: factory items, then the user's own files (ids "user:<name>"), which can also be deleted. */
function LibraryDialog({ title, noun, library, factory, initial, action, canPlay, play, choose }: LibraryProps) {
  const [mine, setMine] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(initial);
  const [show, setShow] = useState(ALL);
  const Noun = noun === 'sound' ? 'Sound' : 'Block';

  const refresh = async () => {
    try {
      setMine(await library.list());
    } catch (error) {
      await fail(`Your ${noun} library could not be read${reason(error)}.`);
    }
  };
  useEffect(() => {
    void refresh();
    return endAudition;
  }, []);

  const remove = async () => {
    if (!selected?.startsWith(USER)) return;
    const name = selected.slice(USER.length);
    const answer = await ask({
      title: `Delete ${Noun}`,
      icon: 'question',
      text: `Delete ${name} from your library? This cannot be undone.`,
      buttons: [
        { label: 'Delete', value: 'delete' },
        { label: 'Cancel', value: 'cancel', primary: true },
      ],
    });
    if (answer !== 'delete') return;
    try {
      await library.remove(name);
      setSelected(null);
    } catch (error) {
      await fail(`${name} could not be deleted${reason(error)}.`);
    }
    await refresh();
  };

  const groups = sections([
    ...factory,
    { header: `My ${Noun}s` },
    ...mine.map((name) => ({ id: USER + name, label: name, icon: 'floppy' as const })),
  ]);
  const shown = (header: string) => groups.filter((g) => header === ALL || headerOf(g) === header).flat();
  const ids = (items: ListItem[]) => items.flatMap((item) => ('id' in item ? [item.id] : []));
  const showGroup = (header: string) => {
    setShow(header);
    const rows = ids(shown(header));
    if (!rows.includes(selected ?? '')) setSelected(rows[0] ?? null);
  };
  return (
    <Dialog title={title} onClose={closeDialog}>
      <div className="h-app-library">
        <div className="h-app-library-list">
          <div className="h-app-library-show">
            <span>Show:</span>
            <Select
              value={show}
              options={[
                { value: ALL, label: `All ${noun}s` },
                ...groups.map((g) => ({ value: headerOf(g), label: headerOf(g) })),
              ]}
              onChange={showGroup}
              width={186}
              hint={`Lists one group of ${noun}s, or all of them.`}
            />
          </div>
          <ListBox
            items={shown(show)}
            value={selected}
            onChange={setSelected}
            onActivate={(id) => canPlay(id) && void play(id)}
            height={290}
          />
        </div>
        <div className="h-app-library-buttons">
          <Button primary disabled={!selected} onClick={() => selected && void choose(selected)}>
            {action}
          </Button>
          <Button disabled={!selected || !canPlay(selected)} onClick={() => selected && void play(selected)}>
            Audition
          </Button>
          <Button disabled={!selected?.startsWith(USER)} onClick={() => void remove()}>
            Delete
          </Button>
          <div className="h-app-spacer" />
          <Button onClick={closeDialog}>Close</Button>
        </div>
      </div>
      <p className="h-app-library-note">
        {mine.length === 0
          ? `${Noun}s you save to the library are listed under My ${Noun}s.`
          : `Double-click a ${noun} to hear it.`}
      </p>
    </Dialog>
  );
}

const SOURCE_ICONS: Record<string, IconName> = {
  osc: 'wave-sawtooth', fm: 'wave-sine', noise: 'noise', sample: 'sample', grains: 'grains',
};
const NEW_SAMPLER = 'new:sample';

const SOUND_ITEMS: ListItem[] = [
  { header: 'New' },
  ...SOURCES.map((s) => ({ id: `new:${s.type}`, label: s.label, icon: SOURCE_ICONS[s.type] })),
  ...PRESET_GROUPS.flatMap((g) => [
    { header: `Factory · ${g.label}` },
    ...g.names.map((name) => ({ id: `preset:${name}`, label: name, icon: 'note' as const })),
  ]),
];

async function loadSound(id: string): Promise<{ sound: Sound; samples: Record<string, SampleData> } | null> {
  const [kind, name] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (kind === 'new') {
    const sound = newSound(name, SOURCES.find((s) => s.type === name)!.label);
    if (name !== 'grains') return { sound, samples: {} };
    // A new cloud starts on the factory pad, so it plays at once; Load... swaps in another sample.
    const { id, sample } = factorySample('pad');
    sound.source.params.sample = id;
    return { sound, samples: { [id]: sample } };
  }
  if (kind === 'preset') return { sound: preset(name), samples: presetSamples(name) };
  try {
    return parseSound(new TextDecoder().decode(await platform.library.read(name)));
  } catch (error) {
    await fail(`The sound ${name} could not be opened. ${fileProblem(error)}`);
    return null;
  }
}

/** The Sound Library: pick a new, factory or saved sound to add to the track or to replace a channel's sound. */
export function SoundLibraryDialog({ replace }: { replace: string | null }) {
  const play = async (id: string) => {
    const loaded = await loadSound(id);
    if (loaded) await audition(loaded.sound, loaded.samples);
  };

  const choose = async (id: string) => {
    if (id === NEW_SAMPLER) {
      closeDialog();
      if (replace === null) return importAudio();
      replaceSound(replace, newSound('sample', 'Sampler'));
      return loadSample(replace);
    }
    const loaded = await loadSound(id);
    if (!loaded) return;
    if (replace === null) addChannel(loaded.sound, loaded.samples);
    else replaceSound(replace, loaded.sound, loaded.samples);
    closeDialog();
  };

  return (
    <LibraryDialog
      title="Sound Library"
      noun="sound"
      library={platform.library}
      factory={SOUND_ITEMS}
      initial="new:osc"
      action={replace === null ? 'Add to Track' : 'Replace'}
      canPlay={(id) => id !== NEW_SAMPLER}
      play={play}
      choose={choose}
    />
  );
}

/** The Block Library: pick a factory or saved block, with the sounds it plays, to add to the project. */
export function BlockLibraryDialog() {
  const [factory] = useState(factoryBlocks);

  const load = async (id: string): Promise<Block | null> => {
    if (!id.startsWith(USER)) {
      const [group, index] = id.slice('factory:'.length).split(':').map(Number);
      return factory[group].blocks[index];
    }
    const name = id.slice(USER.length);
    try {
      return parseBlock(new TextDecoder().decode(await platform.blocks.read(name)));
    } catch (error) {
      await fail(`The block ${name} could not be opened. ${fileProblem(error)}`);
      return null;
    }
  };

  const play = async (id: string) => {
    const block = await load(id);
    if (block) await auditionBlock(block);
  };

  const choose = async (id: string) => {
    const block = await load(id);
    if (block && (await addBlockToProject(block))) closeDialog();
  };

  return (
    <LibraryDialog
      title="Block Library"
      noun="block"
      library={platform.blocks}
      factory={factory.flatMap((group, g) => [
        { header: `Factory · ${group.label}` },
        ...group.blocks.map((block, i) => ({ id: `factory:${g}:${i}`, label: block.name, color: block.color })),
      ])}
      initial="factory:0:0"
      action="Add to Project"
      canPlay={() => true}
      play={play}
      choose={choose}
    />
  );
}

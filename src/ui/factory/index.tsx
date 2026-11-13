import { addSound, exportSound, replaceSound, saveSoundToLibrary } from '../../app/commands';
import { CHANNEL_COLORS } from '../../core/defaults';
import type { Channel } from '../../core/types';
import { duplicateChannel, removeChannel, renameSound, selectChannel, setChannel, useApp } from '../../state/store';
import { Button, ListBox, TextField } from '../kit';
import { Keyboard } from './Keyboard';
import { Rack } from './Rack';
import './factory.css';

function Header({ channel }: { channel: Channel }) {
  const id = channel.id;
  return (
    <div className="h-factory-header">
      <Button
        square
        onClick={() => setChannel(id, { color: (channel.color + 1) % CHANNEL_COLORS })}
        hint="The colour of this sound on the Track; click for the next one."
      >
        <i className="h-factory-swatch" style={{ background: `var(--c${channel.color})` }} />
      </Button>
      <TextField
        value={channel.sound.name}
        onChange={(name) => renameSound(id, name)}
        width={240}
        hint="The name of this sound, as the list and the Track show it."
      />
      <span className="h-factory-spacer" />
      <Button onClick={() => replaceSound(id)} hint="Swaps this sound for another one from the Sound Library.">
        Library...
      </Button>
      <Button onClick={() => void saveSoundToLibrary(id)} hint="Keeps a copy of this sound in your Sound Library.">
        Save to Library
      </Button>
      <Button onClick={() => void exportSound(id)} hint="Saves one note of this sound as a WAV file.">
        Export...
      </Button>
    </div>
  );
}

export function FactoryView() {
  const channels = useApp((s) => s.project.channels);
  const channelId = useApp((s) => s.channelId);
  const channel = channels.find((c) => c.id === channelId);
  return (
    <div className="h-factory">
      <span className="h-factory-caption">Sounds</span>
      {channel ? <Header channel={channel} /> : <span />}
      <div className="h-factory-sounds">
        <ListBox
          items={channels.map((c) => ({ id: c.id, label: c.sound.name, color: c.color }))}
          value={channel?.id ?? null}
          onChange={selectChannel}
          hint="The sounds of this project; pick one to build it in the rack."
        />
        <Button onClick={addSound} hint="Adds a new sound from the Sound Library.">
          New...
        </Button>
        <Button disabled={!channel} onClick={() => duplicateChannel(channel!.id)} hint="Adds a copy of this sound.">
          Duplicate
        </Button>
        <Button
          disabled={!channel}
          onClick={() => removeChannel(channel!.id)}
          hint="Takes this sound out of the project; Undo brings it back."
        >
          Remove
        </Button>
      </div>
      <div className="h-factory-well">
        <div className="h-factory-scroll">
          {channel ? (
            <Rack channelId={channel.id} sound={channel.sound} />
          ) : (
            <p className="h-factory-empty">
              {channels.length
                ? 'Pick a sound in the list to build it here.'
                : 'There are no sounds yet. Press New... to pick one from the Sound Library.'}
            </p>
          )}
        </div>
      </div>
      <Keyboard channelId={channel?.id ?? null} />
    </div>
  );
}

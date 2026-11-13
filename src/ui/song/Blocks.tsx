import { useState } from 'react';
import { addBlock, saveBlockToLibrary } from '../../app/commands';
import { CHANNEL_COLORS, PATTERN_NAMES } from '../../core/defaults';
import type { Pattern } from '../../core/types';
import {
  addPattern, duplicatePattern, removePattern, renamePattern, selectPattern, setPatternColor, useApp,
} from '../../state/store';
import { Button, ListBox, TextField } from '../kit';
import { openInTrack } from './song';

/** The colour and name of the current block. The field keeps what is typed until it is committed. */
function Header({ pattern }: { pattern: Pattern }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="h-song-header">
      <Button
        square
        onClick={() => setPatternColor(pattern.id, (pattern.color + 1) % CHANNEL_COLORS)}
        hint="The colour of this block on the timeline; click for the next one."
      >
        <i className="h-song-swatch" style={{ background: `var(--c${pattern.color})` }} />
      </Button>
      <TextField
        value={draft ?? pattern.name}
        onChange={(name) => {
          setDraft(name);
          renamePattern(pattern.id, name);
        }}
        onCommit={() => setDraft(null)}
        hint="The name of this block, as its tiles on the timeline show it."
      />
    </div>
  );
}

export function Blocks() {
  const patterns = useApp((s) => s.project.patterns);
  const patternId = useApp((s) => s.patternId);
  const pattern = patterns.find((p) => p.id === patternId)!;
  const full = patterns.length >= PATTERN_NAMES.length;
  return (
    <div className="h-song-blocks">
      <span className="h-song-caption">Blocks</span>
      <Header key={pattern.id} pattern={pattern} />
      <ListBox
        items={patterns.map((p) => ({ id: p.id, label: p.name, color: p.color, detail: String(p.bars) }))}
        value={patternId}
        onChange={selectPattern}
        onActivate={openInTrack}
        hint="The blocks of this project and their length in bars. Pick one to place it; double-click to edit it."
      />
      <div className="h-song-pair">
        <Button onClick={addPattern} disabled={full} hint="Adds a new, empty block.">
          New
        </Button>
        <Button
          onClick={() => duplicatePattern(patternId)}
          disabled={full}
          hint="Adds a copy of this block to start a variation from."
        >
          Copy
        </Button>
      </div>
      <Button
        onClick={() => removePattern(patternId)}
        disabled={patterns.length === 1}
        hint="Deletes this block and takes it out of the song; Undo brings it back."
      >
        Delete
      </Button>
      <Button onClick={addBlock} hint="Adds a block from your Block Library, with the sounds it plays.">
        Library...
      </Button>
      <Button
        onClick={() => void saveBlockToLibrary(patternId)}
        hint="Keeps a copy of this block, with its sounds, in your Block Library."
      >
        Save to Library
      </Button>
    </div>
  );
}

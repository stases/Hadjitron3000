import { renameBlock } from '../../app/commands';
import { usePrefs } from '../../app/prefs';
import { CHANNEL_COLORS, MAX_BARS, PATTERN_NAMES } from '../../core/defaults';
import { LEVEL_NAMES } from '../../core/levels';
import {
  addPattern, clearPattern, duplicatePattern, removePattern, selectPattern, setPatternBars, setPatternColor, useApp,
} from '../../state/store';
import { toggleFold, useShown } from '../factory/levels';
import { Button, FoldToggles, Icon, Select, Separator, Stepper, useHint } from '../kit';

function usedText(times: number): string {
  if (times === 0) return 'Not in the song yet';
  return times === 1 ? 'In the song once' : `In the song ${times} times`;
}

/**
 * The block on the grid: choose, recolour, rename, add, copy, clear and delete blocks, and set its length. In
 * beginner mode a Deep toggle at the right end shows the end markers of the rows, which give a row a length of its
 * own; its lamp lights while a row of the block has one.
 */
export function PatternBar() {
  const patterns = useApp((s) => s.project.patterns);
  const patternId = useApp((s) => s.patternId);
  const used = useApp((s) => s.project.song.filter((p) => p.pattern === s.patternId).length);
  const usedHint = useHint('How often this block is placed in the song. The Song view arranges the blocks.');
  const pattern = patterns.find((p) => p.id === patternId)!;
  const full = patterns.length >= PATTERN_NAMES.length;
  const beginner = usePrefs((p) => p.beginner);
  const deep = useShown()('grid', 3);
  return (
    <div className="h-track-bar">
      <span className="h-track-label">Block</span>
      <Button
        square
        onClick={() => setPatternColor(patternId, (pattern.color + 1) % CHANNEL_COLORS)}
        hint="The colour of this block in the song; click for the next one."
      >
        <i className="h-track-swatch" style={{ background: `var(--c${pattern.color})` }} />
      </Button>
      <Select
        value={patternId}
        options={patterns.map((p) => ({ value: p.id, label: p.name }))}
        onChange={selectPattern}
        width={196}
        hint="The block on the grid; pick another one to edit it."
      />
      <Button onClick={() => renameBlock(patternId)} hint="Give this block a new name.">
        Rename…
      </Button>
      <Button square onClick={addPattern} disabled={full} hint="Add a new, empty block.">
        <Icon name="plus" />
      </Button>
      <Button
        onClick={() => duplicatePattern(patternId)}
        disabled={full}
        data-tour="copy-block"
        hint="Make a copy of this block to start a variation from."
      >
        Copy
      </Button>
      <Button onClick={() => clearPattern(patternId)} hint="Take every note out of this block.">
        Clear
      </Button>
      <Button
        onClick={() => removePattern(patternId)}
        disabled={patterns.length === 1}
        hint="Delete this block; it also leaves the song."
      >
        Delete
      </Button>
      <Separator vertical />
      <span className="h-track-label">Bars</span>
      <Stepper
        value={pattern.bars}
        min={1}
        max={MAX_BARS}
        onChange={(bars) => setPatternBars(patternId, bars)}
        width={40}
        hint="How long this block is, in bars of the song's time signature."
      />
      <span className="h-track-used" {...usedHint.props}>
        {usedText(used)}
      </span>
      {beginner && (
        <FoldToggles
          row
          folds={[{
            label: LEVEL_NAMES[3],
            open: deep,
            lit: !!pattern.loops,
            hint: 'Shows a marker at the end of each row to give it a length of its own; the lamp lights when one has.',
            onToggle: () => toggleFold('grid', 3),
          }]}
        />
      )}
    </div>
  );
}

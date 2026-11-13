import { MAX_BARS, PATTERN_NAMES } from '../../core/defaults';
import {
  addPattern, clearPattern, duplicatePattern, removePattern, selectPattern, setPatternBars, useApp,
} from '../../state/store';
import { Button, Icon, Separator, Stepper } from '../kit';

export function PatternBar() {
  const patterns = useApp((s) => s.project.patterns);
  const patternId = useApp((s) => s.patternId);
  const pattern = patterns.find((p) => p.id === patternId)!;
  const full = patterns.length >= PATTERN_NAMES.length;
  return (
    <div className="h-track-bar">
      <span className="h-track-label">Pattern</span>
      <span className="h-track-joined">
        {patterns.map((p) => (
          <Button
            key={p.id}
            pressed={p.id === patternId}
            onClick={() => selectPattern(p.id)}
            hint={`Show pattern ${p.name} on the grid.`}
          >
            {p.name}
          </Button>
        ))}
      </span>
      <Button square onClick={addPattern} disabled={full} hint="Add a new, empty pattern.">
        <Icon name="plus" />
      </Button>
      <Button
        onClick={() => duplicatePattern(patternId)}
        disabled={full}
        hint="Make a copy of this pattern to start a variation from."
      >
        Copy
      </Button>
      <Button onClick={() => clearPattern(patternId)} hint="Take every step out of this pattern.">
        Clear
      </Button>
      <Button
        onClick={() => removePattern(patternId)}
        disabled={patterns.length === 1}
        hint="Delete this pattern; it also leaves the song."
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
        hint="How long this pattern is, in bars of sixteen steps."
      />
    </div>
  );
}

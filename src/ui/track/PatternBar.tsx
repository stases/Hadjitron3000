import { MAX_BARS, PATTERN_NAMES } from '../../core/defaults';
import {
  addPattern, clearPattern, duplicatePattern, removePattern, selectPattern, setPatternBars, setSong, useApp,
} from '../../state/store';
import { Button, Icon, Separator, Stepper } from '../kit';
import { cx } from '../kit/cx';
import { useHeard } from './playhead';

const MAX_SONG = 64;

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
      <Separator vertical />
      <SongStrip />
    </div>
  );
}

function SongStrip() {
  const song = useApp((s) => s.project.song);
  const patterns = useApp((s) => s.project.patterns);
  const patternId = useApp((s) => s.patternId);
  const inSong = useApp((s) => s.scope === 'song');
  const now = useHeard((heard) => (heard && inSong ? heard.index : -1));
  const name = (id: string) => patterns.find((p) => p.id === id)?.name ?? '?';
  return (
    <>
      <span className="h-track-label">Song</span>
      <span className="h-track-song">
        {song.map((id, i) => (
          <span key={i} className={cx('h-track-slot', i === now && 'is-now')}>
            <Button
              small
              onClick={() => setSong(song.filter((_, j) => j !== i))}
              hint={`Pattern ${name(id)}, number ${i + 1} in the song. Click to take it out.`}
            >
              {name(id)}
            </Button>
          </span>
        ))}
        {song.length === 0 && <span className="h-engraved">The song is empty: + adds pattern {name(patternId)}.</span>}
      </span>
      <Button
        square
        onClick={() => setSong([...song, patternId])}
        disabled={song.length >= MAX_SONG}
        hint={`Add pattern ${name(patternId)} to the end of the song.`}
      >
        <Icon name="plus" />
      </Button>
    </>
  );
}

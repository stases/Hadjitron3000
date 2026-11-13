import { dropFiles } from '../../app/commands';
import { useApp } from '../../state/store';
import { Grid } from './Grid';
import { Inspector } from './Inspector';
import { PatternBar } from './PatternBar';
import { PianoRoll, RollBar } from './PianoRoll';
import { usePlayhead } from './playhead';
import { useRoll } from './rollState';
import './track.css';

export function TrackView() {
  usePlayhead();
  const open = useRoll((s) => s.open);
  const hasSound = useApp((s) => s.channelId !== null);
  const roll = open && hasSound;
  return (
    <div
      className="h-track"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) void dropFiles([...e.dataTransfer.files]);
      }}
    >
      <PatternBar />
      {roll && <RollBar />}
      {roll ? <PianoRoll /> : <Grid />}
      <Inspector roll={roll} />
    </div>
  );
}

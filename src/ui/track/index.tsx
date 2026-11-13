import { dropFiles } from '../../app/commands';
import { Grid } from './Grid';
import { Inspector } from './Inspector';
import { PatternBar } from './PatternBar';
import { usePlayhead } from './playhead';
import './track.css';

export function TrackView() {
  usePlayhead();
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
      <Grid />
      <Inspector />
    </div>
  );
}

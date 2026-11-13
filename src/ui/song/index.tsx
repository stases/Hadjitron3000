import { dropFiles } from '../../app/commands';
import { Blocks } from './Blocks';
import { PlacementBar } from './PlacementBar';
import { Timeline } from './Timeline';
import './song.css';

export function SongView() {
  return (
    <div
      className="h-song"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) void dropFiles([...e.dataTransfer.files]);
      }}
    >
      <Blocks />
      <Timeline />
      <PlacementBar />
    </div>
  );
}

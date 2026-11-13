import { removePlacement, resizePlacement, useApp } from '../../state/store';
import { Button, Stepper } from '../kit';
import { openInTrack, placementText, room } from './song';

/** The selected placement: where it sits, its length, and what can be done with it. */
export function PlacementBar() {
  const song = useApp((s) => s.project.song);
  const placement = useApp((s) => s.project.song.find((p) => p.id === s.placementId));
  const name = useApp((s) => s.project.patterns.find((p) => p.id === placement?.pattern)?.name);
  return (
    <div className="h-song-bar">
      <span className="h-song-which">
        {placement && name ? placementText(name, placement) : 'No block selected on the timeline'}
      </span>
      <span className="h-song-label">Length</span>
      <Stepper
        value={placement?.bars ?? 1}
        min={1}
        max={placement ? room(song, placement) : 1}
        width={44}
        disabled={!placement}
        onChange={(bars) => resizePlacement(placement!.id, bars)}
        hint="How many bars this tile plays; a block shorter than that starts again from the top."
      />
      <Button
        disabled={!placement}
        onClick={() => openInTrack(placement!.pattern)}
        hint="Opens this block in the Track to change its steps."
      >
        Edit in Track
      </Button>
      <Button
        disabled={!placement}
        onClick={() => removePlacement(placement!.id)}
        hint="Takes this tile off the timeline; the block itself stays in the list."
      >
        Remove
      </Button>
      {!placement && (
        <span className="h-song-help">
          Click a bar: place the block · Drag: move · Drag the edge: length · Double-click: edit · Right-click: more
        </span>
      )}
    </div>
  );
}

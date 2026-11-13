import { openDialog } from '../../app/dialogStore';
import { usePrefs } from '../../app/prefs';
import { LEVEL_NAMES } from '../../core/levels';
import { removePlacement, resizePlacement, setPlacementFades, useApp } from '../../state/store';
import { toggleFold, useShown } from '../factory/levels';
import { Button, FoldToggles, Separator, Stepper } from '../kit';
import { openInTrack, placementText, room } from './song';

const bars = (n: number) => `${n} ${n === 1 ? 'bar' : 'bars'}`;

/**
 * The selected placement: where it sits, its length, and what can be done with it. Its fades and the sounds it
 * plays are Shaping; in beginner mode they wait behind a toggle at the right end, as in the Track's inspector.
 */
export function PlacementBar() {
  const song = useApp((s) => s.project.song);
  const placement = useApp((s) => s.project.song.find((p) => p.id === s.placementId));
  const name = useApp((s) => s.project.patterns.find((p) => p.id === placement?.pattern)?.name);
  const beginner = usePrefs((p) => p.beginner);
  const shaping = useShown()('placement', 2);
  const off = !placement;
  const fadeIn = placement?.fadeIn ?? 0;
  const fadeOut = placement?.fadeOut ?? 0;
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
        disabled={off}
        onChange={(bars) => resizePlacement(placement!.id, bars)}
        hint="How many bars this tile plays; a block shorter than that starts again from the top."
      />
      <Button
        disabled={off}
        onClick={() => openInTrack(placement!.pattern)}
        hint="Opens this block in the Track to change its steps."
      >
        Edit in Track
      </Button>
      <Button
        disabled={off}
        onClick={() => removePlacement(placement!.id)}
        hint="Takes this tile off the timeline; the block itself stays in the list."
      >
        Remove
      </Button>
      {shaping && (
        <span className="h-song-group" role="group" aria-label={LEVEL_NAMES[2]}>
          <Separator vertical />
          <span className="h-song-label">Fade in</span>
          <Stepper
            value={fadeIn}
            min={0}
            max={placement ? placement.bars - fadeOut : 0}
            width={44}
            disabled={off}
            onChange={(n) => setPlacementFades(placement!.id, n, fadeOut)}
            hint={`How many bars this tile takes to rise from silence (${bars(fadeIn)}); 0 starts it at once.`}
          />
          <span className="h-song-label">Fade out</span>
          <Stepper
            value={fadeOut}
            min={0}
            max={placement ? placement.bars - fadeIn : 0}
            width={44}
            disabled={off}
            onChange={(n) => setPlacementFades(placement!.id, fadeIn, n)}
            hint={`How many bars this tile takes to fall to silence at its end (${bars(fadeOut)}); 0 stops it as is.`}
          />
          <Button
            disabled={off}
            onClick={() => openDialog({ kind: 'sounds', placementId: placement!.id })}
            hint="Chooses which of the block's sounds play in this tile, so one block can play without its hi-hat."
          >
            Sounds...
          </Button>
        </span>
      )}
      {off && (
        <span className="h-song-help">
          Click a bar: place the block · Drag: move · Drag the edge: length · Double-click: edit · Right-click: more
        </span>
      )}
      {beginner && (
        <FoldToggles
          row
          folds={[{
            label: LEVEL_NAMES[2],
            open: shaping,
            lit: fadeIn > 0 || fadeOut > 0 || !!placement?.mutes,
            hint: 'Shows the fades of the selected tile and the sounds it plays; the lamp lights when it has any.',
            onToggle: () => toggleFold('placement', 2),
          }]}
        />
      )}
    </div>
  );
}

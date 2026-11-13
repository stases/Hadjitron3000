import { useEffect } from 'react';
import { closeDialog } from '../../app/dialogStore';
import { barOf } from '../../core/meter';
import { setPlacementMute, useApp } from '../../state/store';
import { Button, Checkbox, ColorChip, Dialog, DialogButtons } from '../kit';
import { placementText } from './song';

/** The sounds a placement's block plays, each with a box for whether it plays in this placement. */
export function SoundsDialog({ placementId }: { placementId: string }) {
  const placement = useApp((s) => s.project.song.find((p) => p.id === placementId));
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === placement?.pattern));
  const channels = useApp((s) => s.project.channels);
  const bar = useApp((s) => barOf(s.project.meter));
  useEffect(() => {
    if (!placement) closeDialog();
  }, [placement]);
  if (!placement || !pattern) return null;
  const ticks = pattern.bars * bar.ticks;
  const used = channels.filter((c) => pattern.notes[c.id]?.some((n) => n.start < ticks));
  return (
    <Dialog title="Sounds" onClose={closeDialog} width={280}>
      <p className="h-song-sounds-text">
        {used.length > 0
          ? `${placementText(pattern.name, placement)}. The ticked sounds play here.`
          : `${pattern.name} has no notes yet.`}
      </p>
      <div className="h-song-sounds">
        {used.map((c) => (
          <span key={c.id} className="h-song-sound">
            <ColorChip color={c.color} />
            <Checkbox
              label={c.sound.name}
              checked={!placement.mutes?.includes(c.id)}
              onChange={(plays) => setPlacementMute(placement.id, c.id, !plays)}
              hint={`Untick to silence ${c.sound.name} in this tile only; the block and its other tiles keep it.`}
            />
          </span>
        ))}
      </div>
      <DialogButtons>
        <Button primary onClick={closeDialog}>
          OK
        </Button>
      </DialogButtons>
    </Dialog>
  );
}

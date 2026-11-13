// Track commands on the row being edited, for the menu and the roll's toolbar: Fit to Scale and Randomise.

import { openDialog } from '../../app/dialogStore';
import { fitToScale, useApp } from '../../state/store';
import { useRoll } from './rollState';

/** Move the notes out of the scale onto it: the notes selected in the roll, or else the whole row. */
export function fitSelectionToScale(): void {
  const { project, patternId, channelId } = useApp.getState();
  if (!channelId) return;
  const { open, selected } = useRoll.getState();
  const row = project.patterns.find((p) => p.id === patternId)?.notes[channelId] ?? [];
  fitToScale(patternId, channelId, open && selected.length > 0 ? selected : row.map((n) => n.id));
}

/** Open the Randomise dialog for the selected sound's row of the current block. */
export function openRandomise(): void {
  if (useApp.getState().channelId) openDialog({ kind: 'randomise' });
}

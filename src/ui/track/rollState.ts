// The piano roll's own state (whether it is open, the selected notes of its row, the snap, the paste mark, the
// length of the next note) and the commands the keyboard and the inspector run on the selection.

import { create } from 'zustand';
import { tap } from '../../app/audio';
import { MAX_NOTE, MIN_NOTE } from '../../core/notes';
import type { Note } from '../../core/types';
import { addNotes, moveNotes, removeNotes, selectChannel, selectStep, useApp } from '../../state/store';
import { BAR_TICKS, makeClip, placeClip } from './roll';
import type { Clip } from './roll';

interface RollState {
  open: boolean;
  selected: readonly string[]; // ids of notes of the roll's row
  snap: number; // ticks
  mark: number; // the tick Paste puts notes at
  length: number; // ticks, the length a clicked note gets
}

export const useRoll = create<RollState>(() => ({ open: false, selected: [], snap: 24, mark: 0, length: 24 }));

// Notes copied or cut, for pasting into any row of any block.
let clip: Clip | null = null;

// The selection belongs to one row of one block. Opening a project (which starts a fresh history) or losing the
// last sound goes back to the grid.
useApp.subscribe((state, prev) => {
  const opened = state.project !== prev.project && state.past.length === 0 && state.future.length === 0;
  if ((opened || state.channelId === null) && useRoll.getState().open) closeRoll();
  else if (state.patternId !== prev.patternId || state.channelId !== prev.channelId) useRoll.setState({ selected: [] });
});

/** The block and row the roll edits: its ids, its length in ticks and the row's notes inside it. */
export function rollRow(): { patternId: string; channelId: string | null; ticks: number; notes: Note[] } {
  const { project, patternId, channelId } = useApp.getState();
  const pattern = project.patterns.find((p) => p.id === patternId)!;
  const ticks = pattern.bars * BAR_TICKS;
  const notes = channelId ? (pattern.notes[channelId] ?? []).filter((n) => n.start < ticks) : [];
  return { patternId, channelId, ticks, notes };
}

/** The selected notes, in the row's order. */
export function selectedNotes(): Note[] {
  const { selected } = useRoll.getState();
  return rollRow().notes.filter((n) => selected.includes(n.id));
}

/** Show one row of the current block in the roll, with some of its notes selected. */
export function openRoll(channelId: string, ids: readonly string[] = []): void {
  selectChannel(channelId);
  selectStep(null);
  useRoll.setState({ open: true, selected: ids });
}

export function closeRoll(): void {
  useRoll.setState({ open: false, selected: [] });
}

export function selectNotes(ids: readonly string[]): void {
  useRoll.setState({ selected: ids });
}

export function selectAll(): void {
  selectNotes(rollRow().notes.map((n) => n.id));
}

export function deleteSelection(): void {
  const { patternId, channelId } = rollRow();
  const notes = selectedNotes();
  if (!channelId || notes.length === 0) return;
  removeNotes(patternId, channelId, notes.map((n) => n.id));
  selectNotes([]);
}

/** Move the selection later and higher, as far as the block and the note range allow; a new pitch is heard. */
export function nudgeSelection(ticks: number, semitones: number): void {
  const { patternId, channelId, ticks: end } = rollRow();
  const notes = selectedNotes();
  if (!channelId || notes.length === 0) return;
  const last = Math.max(...notes.map((n) => n.start + n.len));
  const dt = Math.min(Math.max(ticks, -Math.min(...notes.map((n) => n.start))), Math.max(0, end - last));
  const pitches = notes.map((n) => n.note);
  const dn = Math.min(Math.max(semitones, MIN_NOTE - Math.min(...pitches)), MAX_NOTE - Math.max(...pitches));
  moveNotes(patternId, channelId, notes.map((n) => n.id), dt, dn);
  if (dn !== 0) tap(channelId, notes[0].note + dn, notes[0].vel);
}

/** Copy the selection and put the paste mark right after it. False when nothing is selected. */
export function copySelection(): boolean {
  const notes = selectedNotes();
  if (notes.length === 0) return false;
  const lifted = makeClip(notes, useRoll.getState().snap);
  clip = lifted.clip;
  useRoll.setState({ mark: lifted.origin + lifted.clip.span });
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection();
}

/** Put the copied notes at the paste mark, select them, and move the mark past them. */
export function paste(): void {
  const { patternId, channelId, ticks } = rollRow();
  const { mark } = useRoll.getState();
  if (!clip || !channelId || mark >= ticks) return;
  const ids = addNotes(patternId, channelId, placeClip(clip, mark, ticks));
  useRoll.setState({ selected: ids, mark: mark + clip.span });
}

/** Repeat the selection directly after itself and select the copy, so that pressing again goes on. */
export function repeatSelection(): void {
  const { patternId, channelId, ticks } = rollRow();
  const notes = selectedNotes();
  if (!channelId || notes.length === 0) return;
  const { clip: copy, origin } = makeClip(notes, useRoll.getState().snap);
  const ids = addNotes(patternId, channelId, placeClip(copy, origin + copy.span, ticks));
  if (ids.length > 0) selectNotes(ids);
}

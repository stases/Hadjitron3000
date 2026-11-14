// The one global keyboard handler: menu shortcuts, the computer-keyboard piano, step entry, the piano roll, Record
// and the metronome.

import { TICKS_PER_STEP, newNote } from '../core/defaults';
import { barOf } from '../core/meter';
import { KEY_SEMITONES, MAX_NOTE, MIN_NOTE } from '../core/notes';
import {
  addNote, moveNotes, redo, removeNotes, selectStep, setOctave, setPlaying, setView, undo, useApp,
} from '../state/store';
import {
  closeRoll, copySelection, cutSelection, deleteSelection, nudgeSelection, paste, repeatSelection, selectAll,
  selectNotes, selectedNotes, useRoll,
} from '../ui/track/rollState';
import { rowCells } from '../ui/track/steps';
import { noteOff, noteOn, tap } from './audio';
import { exportAudio, newProject, openProject, saveProject, saveProjectAs } from './commands';
import { toggleMetronome } from './prefs';
import { recording, toggleRecord } from './record';
import { snapPitch, stepPitch } from './snap';
import { IS_MAC } from './shortcuts';

// Notes sounding because a key is down, by KeyboardEvent.code.
const held = new Map<string, { channelId: string; note: number }>();

const clampNote = (note: number) => Math.min(MAX_NOTE, Math.max(MIN_NOTE, note));

/**
 * A text field or the like has the keyboard. Asked by tag name: a key pressed in the Guide Book's own window comes
 * from that window's elements, which are not instances of this window's element classes.
 */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** A dialog or an open menu has the keyboard. */
const busy = () => !!document.querySelector('.h-dialog, .h-menu');

function command(e: KeyboardEvent): (() => unknown) | null {
  const key = e.key.toLowerCase();
  if (key === 'n' && !e.shiftKey) return newProject;
  if (key === 'o' && !e.shiftKey) return openProject;
  if (key === 's') return e.shiftKey ? saveProjectAs : saveProject;
  if (key === 'e' && !e.shiftKey) return exportAudio;
  if (key === 'z') return e.shiftKey ? redo : undo;
  if (key === 'y' && !e.shiftKey) return redo;
  if (e.code === 'Digit1') return () => setView('factory');
  if (e.code === 'Digit2') return () => setView('track');
  if (e.code === 'Digit3') return () => setView('song');
  if (e.code === 'Digit4') return () => setView('mixer');
  return null;
}

const rollOpen = () => useApp.getState().view === 'track' && useRoll.getState().open;

/** Cmd/Ctrl with A, C, X, V or D in the piano roll. */
function rollCommand(e: KeyboardEvent): (() => unknown) | null {
  if (!rollOpen() || e.shiftKey) return null;
  const commands: Record<string, () => unknown> = {
    a: selectAll, c: copySelection, x: cutSelection, v: paste, d: repeatSelection,
  };
  return commands[e.key.toLowerCase()] ?? null;
}

/** Arrows, Delete and Escape in the piano roll. True when the key was used. */
function rollKey(e: KeyboardEvent): boolean {
  if (!rollOpen()) return false;
  const { snap, selected } = useRoll.getState();
  const bar = barOf(useApp.getState().project.meter);
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      nudgeSelection((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? bar.ticks : snap), 0);
      return true;
    case 'ArrowUp':
    case 'ArrowDown': {
      const dir = e.key === 'ArrowDown' ? -1 : 1;
      const [lead] = selectedNotes();
      if (lead) nudgeSelection(0, e.shiftKey ? 12 * dir : stepPitch(lead.note, dir) - lead.note);
      return true;
    }
    case 'Backspace':
    case 'Delete':
      deleteSelection();
      return true;
    case 'Escape':
      if (selected.length > 0) selectNotes([]);
      else closeRoll();
      return true;
  }
  return false;
}

/** Arrows, Delete and Escape on the selected step of the Track view. True when the key was used. */
function stepKey(e: KeyboardEvent): boolean {
  const state = useApp.getState();
  const { step } = state;
  if (state.view !== 'track' || !step) return false;
  const pattern = state.project.patterns.find((p) => p.id === state.patternId);
  if (!pattern) return false;
  const length = pattern.bars * barOf(state.project.meter).steps;
  const cell = rowCells(pattern.notes[step.channelId]).get(step.index);
  const ids = cell?.notes.map((n) => n.id) ?? [];
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      selectStep({ ...step, index: (step.index + dir + length) % length });
      return true;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!cell) return true;
      const [lead] = cell.notes;
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const note = e.shiftKey ? clampNote(lead.note + 12 * dir) : stepPitch(lead.note, dir);
      moveNotes(pattern.id, step.channelId, ids, 0, note - lead.note);
      tap(step.channelId, note, lead.vel);
      return true;
    }
    case 'Backspace':
    case 'Delete':
      removeNotes(pattern.id, step.channelId, ids);
      return true;
    case 'Escape':
      selectStep(null);
      return true;
  }
  return false;
}

/**
 * A piano key: play the note and, with a step selected in the Track view, write it there and move on, unless a
 * recording pass is writing what is played. A note written into a step lands on the scale while Snap to Scale is on,
 * and plays as written.
 */
function pianoKey(e: KeyboardEvent, semitone: number): void {
  if (e.repeat || held.has(e.code)) return;
  const state = useApp.getState();
  let note = clampNote((state.octave + 2) * 12 + semitone);
  const { step } = state;
  const pattern = state.project.patterns.find((p) => p.id === state.patternId);
  if (state.view === 'track' && step && pattern && !recording()) {
    note = snapPitch(note);
    const cell = rowCells(pattern.notes[step.channelId]).get(step.index);
    if (cell) moveNotes(pattern.id, step.channelId, cell.notes.map((n) => n.id), 0, note - cell.notes[0].note);
    else addNote(pattern.id, step.channelId, newNote(step.index * TICKS_PER_STEP, note));
    selectStep({ ...step, index: (step.index + 1) % (pattern.bars * barOf(state.project.meter).steps) });
  }
  const { channelId } = state;
  if (!channelId) return;
  held.set(e.code, { channelId, note });
  noteOn(channelId, note);
}

function release(code: string): void {
  const n = held.get(code);
  if (!n) return;
  held.delete(code);
  noteOff(n.channelId, n.note);
}

function releaseAll(): void {
  for (const code of [...held.keys()]) release(code);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || typing(e.target) || busy()) return;
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod && !e.altKey) {
    const run = command(e) ?? rollCommand(e);
    if (!run) return;
    e.preventDefault();
    if (!e.repeat) void run();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === ' ') {
    if (!e.repeat) setPlaying(!useApp.getState().playing);
  } else if (key === 'z' || key === 'x') {
    if (!e.repeat) setOctave(useApp.getState().octave + (key === 'z' ? -1 : 1));
  } else if (key === 'r') {
    if (!e.repeat) toggleRecord();
  } else if (key === 'c') {
    if (!e.repeat) toggleMetronome();
  } else if (Object.hasOwn(KEY_SEMITONES, key)) {
    pianoKey(e, KEY_SEMITONES[key]);
  } else if (!rollKey(e) && !stepKey(e)) {
    return;
  }
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent): void {
  release(e.code);
}

/** Install the handler on a window, the app's or the Guide Book's own. Returns the function that removes it again. */
export function installKeys(target: Window = window): () => void {
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', releaseAll);
  return () => {
    releaseAll();
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', releaseAll);
  };
}

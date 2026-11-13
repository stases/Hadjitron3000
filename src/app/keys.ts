// The one global keyboard handler: menu shortcuts, the computer-keyboard piano and step entry.

import { STEPS_PER_BAR, TICKS_PER_STEP, newNote } from '../core/defaults';
import { KEY_SEMITONES, MAX_NOTE, MIN_NOTE } from '../core/notes';
import {
  addNote, moveNotes, redo, removeNotes, selectStep, setOctave, setPlaying, setView, undo, useApp,
} from '../state/store';
import { rowCells } from '../ui/track/steps';
import { noteOff, noteOn, tap } from './audio';
import { exportAudio, newProject, openProject, saveProject, saveProjectAs } from './commands';
import { IS_MAC } from './shortcuts';

// Notes sounding because a key is down, by KeyboardEvent.code.
const held = new Map<string, { channelId: string; note: number }>();

const clampNote = (note: number) => Math.min(MAX_NOTE, Math.max(MIN_NOTE, note));

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement);
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
  return null;
}

/** Arrows, Delete and Escape on the selected step of the Track view. True when the key was used. */
function stepKey(e: KeyboardEvent): boolean {
  const state = useApp.getState();
  const { step } = state;
  if (state.view !== 'track' || !step) return false;
  const pattern = state.project.patterns.find((p) => p.id === state.patternId);
  if (!pattern) return false;
  const length = pattern.bars * STEPS_PER_BAR;
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
      const note = clampNote(lead.note + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
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

/** A piano key: play the note and, with a step selected in the Track view, write it there and move on. */
function pianoKey(e: KeyboardEvent, semitone: number): void {
  if (e.repeat || held.has(e.code)) return;
  const state = useApp.getState();
  const note = clampNote((state.octave + 2) * 12 + semitone);
  const { step } = state;
  const pattern = state.project.patterns.find((p) => p.id === state.patternId);
  if (state.view === 'track' && step && pattern) {
    const cell = rowCells(pattern.notes[step.channelId]).get(step.index);
    if (cell) moveNotes(pattern.id, step.channelId, cell.notes.map((n) => n.id), 0, note - cell.notes[0].note);
    else addNote(pattern.id, step.channelId, newNote(step.index * TICKS_PER_STEP, note));
    selectStep({ ...step, index: (step.index + 1) % (pattern.bars * STEPS_PER_BAR) });
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
    const run = command(e);
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
  } else if (Object.hasOwn(KEY_SEMITONES, key)) {
    pianoKey(e, KEY_SEMITONES[key]);
  } else if (!stepKey(e)) {
    return;
  }
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent): void {
  release(e.code);
}

/** Install the handler on the window. Returns the function that removes it again. */
export function installKeys(): () => void {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  return () => {
    releaseAll();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', releaseAll);
  };
}

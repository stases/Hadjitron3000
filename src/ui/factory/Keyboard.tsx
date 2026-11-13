import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { JSX, PointerEvent } from 'react';
import { isHeld, noteOff, noteOn, onHeldChange } from '../../app/audio';
import { KEY_SEMITONES, isBlackKey, noteName } from '../../core/notes';
import { setOctave, useApp } from '../../state/store';
import { Button, Icon, Lcd, useHint } from '../kit';

const MIN_WHITE = 24;
const HINT_OCTAVE = 'Moves the keyboard an octave';
const LETTERS: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(KEY_SEMITONES).map(([key, semi]) => [semi, key.toUpperCase()]),
);

/** The piano keys, as many whole octaves as fit, spread over the full width with whole-pixel key widths. */
export function Piano({ channelId }: { channelId: string | null }) {
  const low = (useApp((s) => s.octave) + 2) * 12;
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const pressed = useRef<{ channelId: string; note: number | null } | null>(null);
  const hover = useHint('Click or drag across the keys to play the sound; the lettered keys play from your keyboard.');

  const whites = 7 * Math.max(1, Math.floor(width / (7 * MIN_WHITE)));
  const notes = Array.from({ length: (whites / 7) * 12 }, (_, i) => low + i);
  const left = (white: number) => Math.floor((white * width) / whites);
  const blackW = 2 * Math.floor((0.3 * width) / whites) + 1;
  const held = useSyncExternalStore(onHeldChange, () =>
    channelId ? notes.filter((n) => isHeld(channelId, n)).join(',') : '',
  );
  const down = new Set(held.split(',').map(Number));

  const play = (note: number | null) => {
    const p = pressed.current;
    if (!p || p.note === note) return;
    if (p.note !== null) noteOff(p.channelId, p.note);
    p.note = note;
    if (note !== null) noteOn(p.channelId, note);
  };
  const noteAt = (e: PointerEvent) => {
    const key = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-note]');
    return key && root.current!.contains(key) ? Number(key.dataset.note) : null;
  };
  const release = () => {
    play(null);
    pressed.current = null;
  };

  useLayoutEffect(() => {
    const el = root.current!;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => {
      observer.disconnect();
      release();
    };
  }, []);

  let white = 0;
  const keys: { white: JSX.Element[]; black: JSX.Element[] } = { white: [], black: [] };
  notes.forEach((note) => {
    const black = isBlackKey(note);
    const x = black ? left(white) - Math.floor(blackW / 2) : left(white);
    const w = black ? blackW : left(white + 1) - x;
    if (!black) white++;
    const semi = note - low;
    keys[black ? 'black' : 'white'].push(
      <div
        key={note}
        data-note={note}
        className={`h-factory-key ${black ? 'is-black' : 'is-white'}${down.has(note) ? ' is-down' : ''}`}
        style={{ left: x, width: w }}
      >
        {semi % 12 === 0 && <span className="h-factory-key-name">{noteName(note)}</span>}
        {(LETTERS[semi] || !black) && <span className="h-factory-key-letter">{LETTERS[semi]}</span>}
      </div>,
    );
  });

  return (
    <div className="h-factory-piano" data-tour="keyboard">
      <div
        ref={root}
        className="h-factory-keys"
        role="group"
        aria-label="Keyboard"
        onPointerDown={(e) => {
          const note = noteAt(e);
          if (!channelId || e.button !== 0 || note === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pressed.current = { channelId, note: null };
          play(note);
        }}
        onPointerMove={(e) => pressed.current && play(noteAt(e))}
        onPointerUp={release}
        onLostPointerCapture={release}
        {...hover.props}
      >
        {keys.white}
        {keys.black}
      </div>
    </div>
  );
}

/** The octave the keyboard starts at. */
export function OctaveSwitch() {
  const octave = useApp((s) => s.octave);
  return (
    <div className="h-factory-octave">
      <Button square disabled={octave <= 0} onClick={() => setOctave(octave - 1)} hint={`${HINT_OCTAVE} down.`}>
        <Icon name="left" />
      </Button>
      <Lcd>{noteName((octave + 2) * 12)}</Lcd>
      <Button square disabled={octave >= 6} onClick={() => setOctave(octave + 1)} hint={`${HINT_OCTAVE} up.`}>
        <Icon name="right" />
      </Button>
    </div>
  );
}

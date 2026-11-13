// The arpeggiator: the notes a sound holds at the same time, played one after another at a rate, in an order. The
// sequencer runs it over the notes of a row and the app over the keys held by hand, so both play alike.

import { hash } from './hash';
import { MAX_NOTE } from './notes';
import { SYNC_BEATS } from './modules';
import type { Params } from './types';

const TICKS_PER_BEAT = 96;

export interface ArpSettings {
  mode: string; // 'up', 'down', 'updown', 'random' or 'played'
  rate: number; // ticks between notes
  octaves: number; // 1..4
  gate: number; // 0.1..1 of the rate
}

/** A sound's arpeggiator from its play settings, or null when it is off. */
export function arpOf(play: Params): ArpSettings | null {
  if (typeof play.arp !== 'string' || play.arp === 'off') return null;
  return {
    mode: play.arp,
    rate: Math.round((SYNC_BEATS[play.rate as string] ?? 0.25) * TICKS_PER_BEAT),
    octaves: Math.round(play.octaves as number),
    gate: play.gate as number,
  };
}

/** A pitch held from tick `start` until `end` (Infinity while a key is still down). `key` names it for Random. */
export interface Held {
  start: number;
  end: number;
  pitch: number;
  key: string;
}

/** One note the arpeggiator plays: from tick `tick` to `end`, at a pitch, for one of the held notes. */
export interface ArpNote<T extends Held> {
  tick: number;
  end: number;
  note: number;
  held: T;
}

/** The order of one turn through the held notes: lowest first, or as they were played, over the octaves. */
export function arpOrder<T extends Held>(held: readonly T[], arp: ArpSettings): { note: number; held: T }[] {
  const base = [...held].sort((a, b) =>
    arp.mode === 'played' ? a.start - b.start || a.pitch - b.pitch : a.pitch - b.pitch || a.start - b.start);
  const up = Array.from({ length: arp.octaves }, (_, o) => base.map((h) => ({ note: h.pitch + 12 * o, held: h })))
    .flat()
    .filter((n, i) => i < base.length || n.note <= MAX_NOTE);
  if (arp.mode === 'down') return up.reverse();
  if (arp.mode === 'updown') return [...up, ...up.slice(1, -1).reverse()];
  return up;
}

/**
 * The notes the arpeggiator plays from `from` until `to`. Whenever the set of held notes changes (a note starts or
 * ends) the order starts again from that tick, with a note every `rate` ticks for as long as the set stays; a single
 * held note repeats. Each note lasts `gate` of the rate, and never past the end of the note it plays. Random picks
 * each note by a hash of the held notes' keys, where the set started and the step, so it is the same every time.
 * The answer for a window depends only on the held notes, so windows that meet give each note once.
 */
export function arpeggiate<T extends Held>(
  held: readonly T[], arp: ArpSettings, from: number, to: number,
): ArpNote<T>[] {
  const changes = [...new Set(held.flatMap((h) => [h.start, h.end]))].filter((t) => t < to).sort((a, b) => a - b);
  const out: ArpNote<T>[] = [];
  changes.forEach((c, i) => {
    const until = Math.min(changes[i + 1] ?? to, to);
    if (until <= from) return;
    const set = held.filter((h) => h.start <= c && c < h.end);
    if (set.length === 0) return;
    const order = arpOrder(set, arp);
    const first = Math.min(...set.map((h) => h.start));
    const name = `${set.map((h) => h.key).sort().join(',')}/${c - first}`;
    for (let k = Math.max(0, Math.ceil((from - c) / arp.rate)); c + k * arp.rate < until; k++) {
      const tick = c + k * arp.rate;
      const pick = order[arp.mode === 'random' ? hash(`${name}/${k}`) % order.length : k % order.length];
      out.push({ tick, end: Math.min(tick + arp.gate * arp.rate, pick.held.end), note: pick.note, held: pick.held });
    }
  });
  return out;
}

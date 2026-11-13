// Turns the notes of the blocks into timed notes. Pure: the transport and the offline
// renderer both call this and hand the result to the engine.

import { laneGain, noteCurve } from './arrangement';
import { arpOf, arpeggiate } from './arp';
import type { Shape } from './arrangement';
import { TICKS_PER_STEP } from './defaults';
import { barOf } from './meter';
import type { Bar } from './meter';
import { hash } from './hash';
import type { Note, NoteEvent, Pattern, Placement, PlayScope, Project } from './types';

/** Length of one step (a sixteenth note) in seconds. */
export function stepSeconds(bpm: number): number {
  return 15 / bpm;
}

/**
 * Seconds from the start of playback to an absolute tick, which may be fractional. Swing pushes every second
 * sixteenth late by up to half a step: inside each pair of steps the first is stretched and the second squeezed,
 * and the ticks inside them move along in proportion, so ticks on the grid land exactly where the swing puts the
 * steps. Every meter has an even number of steps to the bar, so the pairs start again with each bar.
 */
export function tickTime(tick: number, bpm: number, swing: number): number {
  const s = stepSeconds(bpm);
  const step = Math.floor(tick / TICKS_PER_STEP);
  const frac = (tick - step * TICKS_PER_STEP) / TICKS_PER_STEP;
  const lean = step % 2 === 0 ? frac : 1 - frac;
  return step * s + frac * s + swing * s * 0.5 * lean;
}

/** The tick that sounds `seconds` after the start of playback, fractional: the inverse of `tickTime`. */
export function timeTick(seconds: number, bpm: number, swing: number): number {
  const s = stepSeconds(bpm);
  const pair = Math.floor(seconds / (2 * s));
  const rest = seconds - pair * 2 * s;
  const first = s * (1 + swing / 2);
  const steps = rest < first ? rest / first : 1 + (rest - first) / (2 * s - first);
  return (2 * pair + steps) * TICKS_PER_STEP;
}

export function patternSteps(pattern: Pattern, bar: Bar): number {
  return pattern.bars * bar.steps;
}

/** Length of the song in bars: the end of its last placement. */
export function songBars(project: Project): number {
  return project.song.reduce((end, p) => Math.max(end, p.bar + p.bars), 0);
}

/** Number of steps in one pass of the scope. */
export function loopSteps(project: Project, scope: PlayScope): number {
  const bar = barOf(project.meter);
  if (scope.kind === 'song') return songBars(project) * bar.steps;
  const pattern = project.patterns.find((p) => p.id === scope.patternId);
  return pattern ? patternSteps(pattern, bar) : 0;
}

/** A block being heard: at which of its ticks, and the placement that put it there (null when a block loops alone). */
export interface Heard {
  pattern: Pattern;
  tick: number;
  placement: Placement | null;
}

/** Where a block plays in one pass of the scope: from `start` until `end`, in ticks, repeating as it goes. */
interface Span {
  pattern: Pattern;
  start: number;
  end: number;
  placement: Placement | null;
}

function spans(project: Project, scope: PlayScope): Span[] {
  const { ticks } = barOf(project.meter);
  const find = (id: string) => project.patterns.find((p) => p.id === id);
  if (scope.kind === 'pattern') {
    const pattern = find(scope.patternId);
    return pattern ? [{ pattern, start: 0, end: pattern.bars * ticks, placement: null }] : [];
  }
  return project.song.flatMap((placement) => {
    const pattern = find(placement.pattern);
    const start = placement.bar * ticks;
    return pattern ? [{ pattern, start, end: start + placement.bars * ticks, placement }] : [];
  });
}

/**
 * The blocks heard at an absolute tick. Absolute ticks count from the start of playback and run on
 * past the end of the scope, which loops. Empty when the scope has nothing to play there.
 */
export function heardAt(project: Project, scope: PlayScope, tick: number): Heard[] {
  const total = loopSteps(project, scope) * TICKS_PER_STEP;
  if (total === 0) return [];
  const at = ((tick % total) + total) % total;
  const { ticks } = barOf(project.meter);
  return spans(project, scope).flatMap(({ pattern, start, end, placement }) =>
    at < start || at >= end ? [] : [{ pattern, tick: (at - start) % (pattern.bars * ticks), placement }]);
}

/**
 * Whether a note with a chance plays on one pass of its block. The answer is a hash of the note, the block and the
 * pass, so it is the same on every play and in an export.
 */
export function plays(note: Note, patternId: string, pass: number | string): boolean {
  return note.chance === undefined || hash(`${patternId}/${note.id}/${pass}`) % 100 < note.chance;
}

/** How many ticks a row loops in, at most the block's length (`length` ticks). */
export function rowLoop(pattern: Pattern, channelId: string, length: number): number {
  const steps = pattern.loops?.[channelId];
  return steps === undefined ? length : Math.min(length, steps * TICKS_PER_STEP);
}

/** One time a note of a row starts in a pass, in absolute ticks. */
interface Occurrence {
  note: Note;
  start: number;
  edge: number; // where this copy of the row ends; ratchet repeats from there on are left out
  seed: number | string; // the pass that `plays` asks about
  first: boolean; // in the first repeat of the block and the first copy of the row, the one that starts a hold
}

/**
 * The notes of a row in one repeat of its block from `base`, `length` ticks long, as they start in the copies of
 * its loop of `loop` ticks: copy k starts k loops later and plays the notes that start inside the loop. Copies whose
 * notes all end by `after` are left out. The first copy keeps the block's pass as its seed, the others add their
 * number to it, so a chance is decided anew in every copy.
 */
function copies(
  row: readonly Note[], base: number, length: number, loop: number, seed: number, first: boolean, after: number,
): Occurrence[] {
  const longest = Math.max(0, ...row.map((n) => n.len));
  const out: Occurrence[] = [];
  for (let k = Math.max(0, Math.floor((after - base - longest) / loop) - 1); base + k * loop < base + length; k++) {
    const edge = Math.min(base + (k + 1) * loop, base + length);
    for (const note of row) {
      const start = base + k * loop + note.start;
      if (note.start >= loop || start >= base + length) continue;
      out.push({ note, start, edge, seed: k === 0 ? seed : `${seed}:${k}`, first: first && k === 0 });
    }
  }
  return out;
}

/**
 * The notes that start on absolute ticks in [from, to), in time order; notes on the same tick keep the order of
 * the placements, the channels and the notes. Times are seconds from the start of playback, and a note's end
 * follows the swing like its start. Mute and solo are left to the engine.
 *
 * A row with a loop of its own plays the notes inside it over and over, end to end, for the length of the block, and
 * leaves its other notes silent; it starts again with the block. Swing counts from the bar like everywhere else, so
 * a note sounds where its step sounds in every row.
 *
 * A note with a chance plays on a pass when `plays` says so; its pass is how often the block has started since
 * playback began, or in the song the bar where this repeat of its placement starts, and the copy of a row's loop.
 * A ratchet plays the note that many times, evenly inside its length, each that long; repeats past the end of the
 * block, the copy of the loop or the placement are left out. A held note sounds from its start to the end of its
 * placement, or of the block when it plays on repeat, and only the placement's first repeat of the block starts it;
 * with a ratchet the last repeat is held.
 *
 * A sound whose arpeggiator is on plays the notes its row holds together through `arpeggiate`, up to the end of the
 * block on repeat or of the placement; each note it makes has the chance and the slide of the note it comes from,
 * and its own hash for the chance. Ratchets are ignored then.
 *
 * In the song a muted lane plays nothing, and neither do the sounds a placement mutes. A placement with a fade, or
 * in a lane that is not at 0 dB, gives each of its notes a gain curve (`noteCurve`); other notes carry none.
 */
export function eventsBetween(project: Project, scope: PlayScope, from: number, to: number): NoteEvent[] {
  const total = loopSteps(project, scope) * TICKS_PER_STEP;
  if (total === 0 || to <= from) return [];
  const found: { tick: number; event: NoteEvent }[] = [];
  const time = (tick: number) => tickTime(tick, project.bpm, project.swing);
  const { ticks } = barOf(project.meter);
  for (const { pattern, start, end, placement } of spans(project, scope)) {
    const length = pattern.bars * ticks;
    const level = placement ? laneGain(project.lanes[placement.lane]) : 1;
    if (level === 0) continue;
    const { fadeIn = 0, fadeOut = 0, mutes = [] } = placement ?? {};
    const shape: Shape | null = level !== 1 || fadeIn > 0 || fadeOut > 0
      ? { length: end - start, fadeIn: fadeIn * ticks, fadeOut: fadeOut * ticks, level } : null;
    // Every pass of the scope that overlaps the window.
    for (let pass = Math.floor(from / total) * total; pass < to; pass += total) {
      const origin = pass + start;
      const stop = pass + end;
      const seedOf = (repeat: number) =>
        (placement ? placement.bar + repeat * pattern.bars : (origin + repeat * length) / length);
      const emit = (channelId: string, tick: number, until: number, n: Note, slide: boolean) => {
        const at = time(tick);
        const event: NoteEvent = { channelId, time: at, dur: time(until) - at, note: n.note, vel: n.vel };
        if (slide) event.slide = true;
        if (shape) event.gain = noteCurve(shape, tick - origin, until - origin, (t) => time(origin + t));
        found.push({ tick, event });
      };
      for (const channel of project.channels) {
        const row = pattern.notes[channel.id];
        if (!row || mutes.includes(channel.id)) continue;
        const loop = rowLoop(pattern, channel.id, length);
        const arp = arpOf(channel.sound.play);
        if (arp) {
          // Everything that can still sound at `from`, and what changed the held notes last before it.
          const longest = Math.max(0, ...row.filter((n) => !n.hold).map((n) => n.len));
          const first = Math.max(0, Math.floor((from - origin - 2 * longest - length) / length));
          const repeats = first > 0 ? [0] : [];
          for (let r = first; origin + r * length < Math.min(to, stop); r++) repeats.push(r);
          const held = repeats
            .flatMap((r) => copies(row, origin + r * length, length, loop, seedOf(r), r === 0, -Infinity))
            .filter((o) => o.start < Math.min(to, stop) && (!o.note.hold || o.first))
            .map((o) => ({
              ...o,
              end: o.note.hold ? stop : Math.min(o.start + o.note.len, stop),
              pitch: o.note.note,
              key: `${o.note.id}@${o.seed}`,
            }));
          for (const a of arpeggiate(held, arp, from, Math.min(to, stop))) {
            if (plays(a.held.note, pattern.id, `${a.held.seed}@${a.tick - a.held.start}`)) {
              emit(channel.id, a.tick, a.end, { ...a.held.note, note: a.note }, !!a.held.note.slide);
            }
          }
          continue;
        }
        // Every repeat of the block inside its span that overlaps the window.
        const firstRepeat = Math.max(0, Math.floor((from - origin) / length));
        for (let repeat = firstRepeat; origin + repeat * length < Math.min(to, stop); repeat++) {
          const base = origin + repeat * length;
          for (const o of copies(row, base, length, loop, seedOf(repeat), repeat === 0, from)) {
            const n = o.note;
            if (o.start >= to || o.start + n.len <= from || (n.hold && !o.first)) continue;
            if (!plays(n, pattern.id, o.seed)) continue;
            const times = n.ratchet ?? 1;
            const each = n.len / times;
            for (let r = 0; r < times; r++) {
              const tick = o.start + r * each;
              if (tick >= o.edge || tick >= stop || tick < from || tick >= to) continue;
              emit(channel.id, tick, n.hold && r === times - 1 ? stop : tick + each, n, !!n.slide && r === 0);
            }
          }
        }
      }
    }
  }
  return found.sort((a, b) => a.tick - b.tick).map((f) => f.event);
}

// The examples of the Guide Book, measured: nobody can listen on the machine that runs the tests, so every example
// is rendered and checked for level, clipping and silence, and every before/after pair for the difference its page
// claims. Short renders at a reduced sample rate keep it quick; they show the same things.

import { expect, test } from 'vitest';
import { renderProject } from '../../src/audio';
import { hearScope } from '../../src/app/book/bookStore';
import { CHAPTERS } from '../../src/app/book/pages';
import type { Claim, ComparePiece, Example, WorkedPiece } from '../../src/app/book/pages';
import { extractBlock } from '../../src/core/block';
import { stepSeconds } from '../../src/core/sequencer';
import { TICKS_PER_STEP } from '../../src/core/defaults';
import type { Pcm, PlayScope, Project } from '../../src/core/types';
import { demoProject, starterProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';
import { amplitudeAt, peak, rms } from './helpers';

const SR = 22050;
const all = CHAPTERS.flatMap((c) => c.pages.flatMap((p) => p.pieces.filter((piece) => typeof piece !== 'string')));
const worked = all.filter((p) => p.kind === 'worked') as WorkedPiece[];
const recipes = worked.filter((p) => p.checkpoints);

const render = (project: Project, scope: PlayScope = hearScope(project), tail = 1.5) =>
  renderProject(project, scope, { tail, sampleRate: SR });
const mono = (pcm: Pcm) => pcm.channels[0].map((v, i) => (v + pcm.channels[1][i]) / 2);
const cut = (d: Float32Array, t0: number, t1: number) => d.subarray(Math.round(t0 * SR), Math.round(t1 * SR));
const loudest = (pcm: Pcm) => Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));

/** Heard, and not hitting the master's soft clipper hard. */
function healthy(pcm: Pcm, what: string): void {
  const p = loudest(pcm);
  expect(p, `${what} is silent`).toBeGreaterThan(0.005);
  expect(p, `${what} clips`).toBeLessThan(0.9);
  expect(pcm.channels.every((d) => d.every(Number.isFinite)), what).toBe(true);
}

/** How bright a signal is: the level of its slope against its level, which rises with every octave. */
function brightness(d: Float32Array): number {
  let slope = 0;
  for (let i = 1; i < d.length; i++) slope += (d[i] - d[i - 1]) ** 2;
  return Math.sqrt(slope / d.length) / Math.max(rms(d), 1e-9);
}

/** The share of a signal below about 150 Hz, through a one-pole low pass. */
function lowShare(d: Float32Array): number {
  const a = Math.exp((-2 * Math.PI * 150) / SR);
  const low = new Float32Array(d.length);
  let y = 0;
  d.forEach((v, i) => (low[i] = y = (1 - a) * v + a * y));
  return rms(low) / Math.max(rms(d), 1e-9);
}

/** Values of something in windows of 50 ms while the notes play. */
function perWindow(d: Float32Array, seconds: number, of: (w: Float32Array) => number): number[] {
  const out: number[] = [];
  for (let t = 0; t + 0.05 <= seconds; t += 0.05) {
    const w = cut(d, t, t + 0.05);
    if (rms(w) > 1e-3) out.push(of(w));
  }
  return out;
}

const spread = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / Math.max(Math.abs(mean), 1e-9);
};

/** The pitch of a window from its rising zero crossings, in cents above 1 Hz. */
function cents(d: Float32Array): number {
  let first = -1;
  let last = -1;
  let n = 0;
  for (let i = 1; i < d.length; i++) {
    if (d[i - 1] < 0 && d[i] >= 0) {
      const t = i - 1 + -d[i - 1] / (d[i] - d[i - 1]);
      if (first < 0) first = t;
      last = t;
      n++;
    }
  }
  return n > 1 ? 1200 * Math.log2(((n - 1) * SR) / (last - first)) : 0;
}

/** How long the notes of a project's first block or song play, in seconds. */
function playing(project: Project): number {
  const scope = hearScope(project);
  const bars = scope.kind === 'song' ? Math.max(...project.song.map((s) => s.bar + s.bars))
    : project.patterns[0].bars;
  return bars * 16 * stepSeconds(project.bpm);
}

/** One number for a claim: more of the thing it names gives a bigger number. */
async function measure(example: Example, claim: Claim): Promise<number> {
  const project = example.make();
  const seconds = playing(project);
  if (claim.measure === 'duck') {
    // Ducking keeps working while its source is muted, so the bass can be measured on its own.
    const bass = project.channels.find((c) => c.duck.source) ?? project.channels.find((c) => c.sound.name.includes('Bass'))!;
    const kick = project.channels.find((c) => c.sound.name.includes('Kick'))!;
    const alone = { ...project, channels: project.channels.map((c) => ({ ...c, mute: c.id !== bass.id })) };
    const d = mono(await render(alone));
    const hits = project.patterns[0].notes[kick.id].map((n) => (n.start / TICKS_PER_STEP) * stepSeconds(project.bpm));
    const during = rms(Float32Array.from(hits.flatMap((t) => [...cut(d, t + 0.01, t + 0.06)])));
    const after = rms(Float32Array.from(hits.flatMap((t) => [...cut(d, t + 0.25, t + 0.3)])));
    return after / Math.max(during, 1e-9);
  }
  const pcm = await render(project, hearScope(project), claim.measure === 'tail' ? 6 : 1.5);
  const d = mono(pcm);
  const notes = cut(d, 0, seconds);
  switch (claim.measure) {
    case 'level':
      return rms(notes);
    case 'highs':
      return brightness(notes);
    case 'lows':
      return lowShare(notes);
    case 'tail':
      return rms(cut(d, seconds + 0.3, seconds + 3)) / Math.max(rms(notes), 1e-9);
    case 'width': {
      const [l, r] = pcm.channels.map((c) => cut(c, 0, seconds));
      return rms(l.map((v, i) => v - r[i])) / Math.max(rms(l.map((v, i) => v + r[i])), 1e-9);
    }
    case 'crest':
      return peak(notes) / Math.max(rms(notes), 1e-9);
    case 'harmonics':
      return amplitudeAt(notes, 3 * claim.hz!, SR) / Math.max(amplitudeAt(notes, claim.hz!, SR), 1e-9);
    case 'ring': {
      const w = cut(d, 0.02, Math.min(seconds, 1));
      return amplitudeAt(w, claim.hz!, SR) / Math.max(amplitudeAt(w, 1.5 * claim.hz!, SR), 1e-9);
    }
    case 'sidebands':
      return amplitudeAt(notes, claim.hz!, SR) / Math.max(rms(notes), 1e-9);
    case 'movement':
      return spread(perWindow(d, seconds, brightness));
    case 'wobble': {
      // The standard deviation of the pitch from window to window, in cents.
      const c = perWindow(d, seconds, cents);
      const mean = c.reduce((a, b) => a + b, 0) / c.length;
      return Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / c.length);
    }
  }
}

test('every example makes a healthy sound', async () => {
  const examples = new Set<Example>();
  for (const piece of all) {
    if (piece.kind === 'example') examples.add(piece.example);
    if (piece.kind === 'compare') [piece.before, piece.after].forEach((e) => examples.add(e));
    if (piece.kind === 'worked' && piece.example.kind !== 'project') examples.add(piece.example);
  }
  for (const example of examples) {
    const project = example.make();
    const scope = hearScope(project);
    const short = scope.kind === 'song' ? { kind: 'pattern' as const, patternId: project.patterns[0].id } : scope;
    healthy(await render(project, short), example.title);
  }
}, 60_000);

test('every pair sounds different in the way its page says', async () => {
  for (const piece of all.filter((p) => p.kind === 'compare') as ComparePiece[]) {
    const before = await measure(piece.before, piece.claim);
    const after = await measure(piece.after, piece.claim);
    const what = `${piece.after.title}: ${piece.claim.measure} ${before.toFixed(3)} -> ${after.toFixed(3)}`;
    if (piece.claim.more) expect(after, what).toBeGreaterThan(before * 1.25);
    else expect(after, what).toBeLessThan(before / 1.25);
    // A pitch that wavers must waver by enough to hear: ten cents up and down at least.
    if (piece.claim.measure === 'wobble') expect(after - before, what).toBeGreaterThan(10);
  }
}, 60_000);

/** Load a worked example as Load does and do every step; the project and what to hear of it. */
function finish(piece: WorkedPiece): { project: Project; scope: PlayScope } {
  const made = piece.example.make();
  if (piece.example.kind === 'project') store.openProject(made, null);
  else {
    store.openProject(piece.example.kind === 'sound' ? starterProject() : demoProject(), null);
    if (piece.example.kind === 'sound') store.addChannel(made.channels[0].sound, made.samples);
    else store.insertBlock(extractBlock(made, made.patterns[0].id)!);
  }
  for (const step of piece.steps) step.act?.(store.useApp.getState());
  const { project, channelId, patternId } = store.useApp.getState();
  if (piece.example.kind === 'sound') {
    // The finished sound on the notes of the example.
    const sound = project.channels.find((c) => c.id === channelId)!.sound;
    const own = { ...made, channels: [{ ...made.channels[0], sound }] };
    return { project: own, scope: hearScope(own) };
  }
  if (piece.example.kind === 'block') return { project, scope: { kind: 'pattern', patternId } };
  return { project, scope: hearScope(project) };
}

test('every worked example finishes in a healthy sound', async () => {
  for (const piece of worked.filter((p) => !p.checkpoints)) {
    const { project, scope } = finish(piece);
    const block = project.patterns.find((p) => p.id === (scope.kind === 'pattern' ? scope.patternId : project.patterns[0].id))!;
    // A lesson that only builds a sound leaves no notes to hear it by.
    if (Object.values(block.notes).flat().length === 0) continue;
    healthy(await render(project, { kind: 'pattern', patternId: block.id }), `${piece.example.title}, finished`);
  }
}, 60_000);

/**
 * The four bars of a song where the most tiles play together, as a song of its own. The window starts on a multiple
 * of four bars, as every tile of the recipes does, so blocks keep their phase; fades are left out, which can only
 * make it louder. Rendering it instead of the whole song keeps the test quick.
 */
function busiest(project: Project): Project {
  const covering = (bar: number) => project.song.filter((s) => s.bar <= bar && bar + 4 <= s.bar + s.bars);
  const end = Math.max(...project.song.map((s) => s.bar + s.bars));
  let best = 0;
  for (let bar = 4; bar + 4 <= end; bar += 4) if (covering(bar).length > covering(best).length) best = bar;
  return { ...project, song: covering(best).map(({ fadeIn: _in, fadeOut: _out, ...s }) => ({ ...s, bar: 0, bars: 4 })) };
}

test('every recipe loads at each checkpoint, and its finished track is as loud as the demo and the same every time', async () => {
  for (const piece of recipes) {
    for (const { label, after } of piece.checkpoints!) {
      const project = piece.example.make();
      store.openProject(project, null);
      for (const step of piece.steps.slice(0, after)) step.act?.(store.useApp.getState());
      expect(store.useApp.getState().project.channels.length, `${piece.example.title}, ${label}`).toBeGreaterThan(0);
    }
    const { project } = finish(piece);
    expect(project.song.length, piece.example.title).toBeGreaterThan(0);
    const loudPart = busiest(project);
    const [a, b] = [await render(loudPart, { kind: 'song' }, 0.5), await render(loudPart, { kind: 'song' }, 0.5)];
    const p = loudest(a);
    expect(p, piece.example.title).toBeGreaterThan(0.3);
    expect(p, piece.example.title).toBeLessThan(0.8);
    for (const [c, d] of a.channels.entries()) {
      expect(peak(d.map((v, i) => v - b.channels[c][i])), piece.example.title).toBe(0);
    }
  }
}, 60_000);

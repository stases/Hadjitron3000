import { expect, test } from 'vitest';
import { Engine, renderProject, sampleBuffer } from '../../src/audio';
import type { Project, Sound } from '../../src/core/types';
import {
  adsr, amplitudeAt, db, effect, freq, maxJump, mod, onset, peak, project, rms, slice, sound, SR, wav,
} from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const sine = () => sound('osc', { wave: 'sine' }, { amp: flat, out: { level: -6 } });
const withSound = (p: Project, f: (s: Sound) => Sound): Project => ({
  ...p,
  channels: p.channels.map((c) => ({ ...c, sound: f(c.sound) })),
});

/** Render with an engine, applying project edits at given times while the audio runs. */
async function live(
  seconds: number,
  start: Project,
  setup: (engine: Engine) => void,
  edits: [number, (p: Project, engine: Engine) => Project | Promise<Project>][],
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SR), SR);
  const engine = new Engine(ctx);
  let p = start;
  engine.setProject(p);
  setup(engine);
  for (const [at, edit] of edits) {
    void ctx.suspend(at).then(async () => {
      p = await edit(p, engine);
      engine.setProject(p);
      return ctx.resume();
    });
  }
  return (await ctx.startRendering()).getChannelData(0);
}

test('a parameter change applies in place to a sounding note; a structural change rebuilds', async () => {
  const d = await live(2, project([{ id: 'a', sound: sine() }]), (e) => e.play('a', 57, 1, 0, 1.9), [
    [0.5, (p) => withSound(p, (s) => ({ ...s, out: { ...s.out, level: -12 } }))],
    [
      1,
      (p, e) => {
        const next = withSound(p, (s) => ({ ...s, chain: [effect('filter', { cutoff: 20000 })] }));
        e.setProject(next);
        e.play('a', 57, 1, 1.3, 0.3);
        return next;
      },
    ],
  ]);
  const before = rms(slice(d, 0.2, 0.45));
  expect(db(rms(slice(d, 0.6, 0.95)) / before)).toBeCloseTo(-6, 1);
  // The level glides: no jump bigger than the 220 Hz sine itself makes.
  expect(maxJump(slice(d, 0.45, 0.6))).toBeLessThan(0.02);
  expect(peak(slice(d, 1.1, 1.29))).toBe(0);
  expect(db(rms(slice(d, 1.35, 1.55)) / before)).toBeCloseTo(-6, 0);
});

test('muting fades the channel out within about 10 ms without a click', async () => {
  const d = await live(1, project([{ id: 'a', sound: sine() }]), (e) => e.play('a', 45, 1, 0, 0.9), [
    [0.5, (p) => ({ ...p, channels: p.channels.map((c) => ({ ...c, mute: true })) })],
  ]);
  expect(rms(slice(d, 0.4, 0.5))).toBeGreaterThan(0.1);
  expect(peak(slice(d, 0.52, 0.9))).toBeLessThan(0.01);
  expect(maxJump(slice(d, 0.45, 0.6))).toBeLessThan(0.01);
});

test('changing the reverb size crossfades to the new impulse without a click', async () => {
  const s = sound('osc', { wave: 'sine' }, { amp: flat, chain: [effect('reverb', { size: 3, mix: 0.5 })], out: { level: -6 } });
  const d = await live(2.5, project([{ id: 'a', sound: s }]), (e) => e.play('a', 57, 1, 0, 1.2), [
    [
      0.7,
      async (p, e) => {
        const next = withSound(p, (x) => ({ ...x, chain: [{ ...x.chain[0], params: { ...x.chain[0].params, size: 0.4 } }] }));
        e.setProject(next);
        // The new impulse is built after a 100 ms debounce, while the render waits here.
        await new Promise((r) => setTimeout(r, 250));
        return next;
      },
    ],
  ]);
  expect(maxJump(slice(d, 0.6, 0.9))).toBeLessThan(1.5 * maxJump(slice(d, 0.3, 0.6)));
  // The 0.4 s tail has died 0.6 s after the note, where a 3 s tail would still ring.
  expect(db(rms(slice(d, 1.85, 2.0)) / rms(slice(d, 1.0, 1.2)))).toBeLessThan(-60);
});

test('a synced delay follows a tempo change', async () => {
  const s = sound('osc', { wave: 'sine' }, {
    amp: adsr(0.001, 0.1, 1, 0),
    chain: [effect('delay', { sync: '1/4', feedback: 0, mix: 1, tone: 20000 })],
    out: { level: -6 },
  });
  const d = await live(
    2.5,
    project([{ id: 'a', sound: s }], {}, { bpm: 120 }),
    (e) => {
      e.play('a', 81, 1, 0, 0.04);
      e.play('a', 81, 1, 1, 0.04);
    },
    [[0.7, (p) => ({ ...p, bpm: 60 })]],
  );
  expect(onset(d, 0.1)).toBeCloseTo(0.5, 3);
  expect(onset(d, 1.1)).toBeCloseTo(2, 2);
});

test('removing a channel while its note sounds tears it down without errors', async () => {
  const d = await live(1, project([{ id: 'a', sound: sine() }, { id: 'b', sound: sine() }]), (e) => e.play('a', 57, 1, 0, 0.9), [
    [
      0.3,
      (p, e) => {
        const next = { ...p, channels: p.channels.filter((c) => c.id !== 'a') };
        e.setProject(next);
        e.noteOff('a', 57);
        e.play('a', 57, 1, 0.5, 0.1);
        return next;
      },
    ],
  ]);
  expect(rms(slice(d, 0.1, 0.3))).toBeGreaterThan(0.1);
  expect(peak(slice(d, 0.4, 1))).toBe(0);
});

test('live notes sound until note off, then release', async () => {
  const s = sound('osc', { wave: 'sine' }, { amp: adsr(0.002, 0.1, 1, 0.1), out: { level: -6 } });
  const d = await live(1, project([{ id: 'a', sound: s }]), (e) => e.noteOn('a', 57, 1), [
    [
      0.4,
      (p, e) => {
        e.noteOff('a', 57);
        return p;
      },
    ],
  ]);
  expect(rms(slice(d, 0.2, 0.4))).toBeGreaterThan(0.2);
  expect(peak(slice(d, 0.4 + 0.125 + 0.003, 1))).toBe(0);
  expect(maxJump(slice(d, 0.35, 0.6))).toBeLessThan(0.05);
});

test('at most 24 voices sound per channel', async () => {
  // A constant (DC) sample: each voice adds the same level, so the sum counts voices.
  const id = 'dc-voices';
  const p = project([{ id: 'a', sound: sound('sample', { sample: id, mode: 'gate' }, { amp: adsr(0.001, 0.1, 1, 0.01) }) }], {}, {
    samples: { [id]: { name: 'dc.wav', bytes: wav(new Float32Array(2 * SR).fill(0.01)) } },
  });
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  engine.setProject(p);
  await engine.ready();
  for (let i = 0; i < 30; i++) engine.play('a', 60, 1, i * 0.01, 0.8);
  const d = (await ctx.startRendering()).getChannelData(0);
  const one = (328 / 32767) * Math.SQRT1_2;
  const mean = (t0: number, t1: number) => slice(d, t0, t1).reduce((a, b) => a + b) / (Math.round(t1 * SR) - Math.round(t0 * SR));
  expect(mean(0.215, 0.219) / one).toBeCloseTo(22, 1);
  expect(mean(0.32, 0.4) / one).toBeCloseTo(24, 1);
});

test('samples decode in the background and become audible when ready', async () => {
  const id = 'late-sample';
  const p = project([{ id: 'a', sound: sound('sample', { sample: id }, { amp: flat }) }], {}, {
    samples: { [id]: { name: 'x.wav', bytes: wav(new Float32Array(SR).fill(0.25)) } },
  });
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  engine.setProject(p);
  engine.play('a', 60, 1, 0, 0.2);
  expect(sampleBuffer(id)).toBeUndefined();
  await engine.ready();
  expect(sampleBuffer(id)?.duration).toBeCloseTo(1, 3);
  engine.play('a', 60, 1, 0.5, 0.2);
  const d = (await ctx.startRendering()).getChannelData(0);
  expect(peak(slice(d, 0, 0.4))).toBe(0);
  expect(peak(slice(d, 0.55, 0.65))).toBeGreaterThan(0.1);
});

test('rendering the same project twice gives identical samples', async () => {
  const p = project(
    [
      { id: 'hat', sound: sound('noise', {}, { amp: adsr(0.001, 0.05, 0, 0.05), chain: [effect('filter', { mode: 'highpass', cutoff: 7000 })] }) },
      {
        id: 'pad',
        sound: sound('osc', { voices: 5, noise: 0.2 }, {
          chain: [effect('drive'), effect('delay', { pingpong: true }), effect('reverb', { size: 1 })],
        }),
      },
      {
        id: 'bell',
        sound: sound('fm', { ratio: 3.5 }, {
          mods: [
            mod('lfo', { module: 'source', param: 'pitch' }, 0.01, { rate: 5 }),
            mod('lfo', { module: 'source', param: 'pitch' }, 0.01, { rate: 7 }),
            mod('env', { module: 'source', param: 'pitch' }, 0.02),
          ],
        }),
      },
    ],
    {
      hat: { 0: { note: 60, vel: 0.7, len: 1 }, 2: { note: 60, vel: 0.5, len: 1 }, 4: { note: 60, vel: 0.7, len: 1 } },
      // Overlapping notes: several voices sound at once.
      pad: { 0: { note: 48, vel: 0.8, len: 12 }, 2: { note: 55, vel: 0.8, len: 12 }, 4: { note: 63, vel: 0.8, len: 12 } },
      bell: { 4: { note: 72, vel: 0.9, len: 2 } },
    },
  );
  const scope = { kind: 'pattern', patternId: p.patterns[0].id } as const;
  const a = await renderProject(p, scope, { tail: 1 });
  const b = await renderProject(p, scope, { tail: 1 });
  expect(peak(a.channels[0])).toBeGreaterThan(0.05);
  expect(b.channels[0]).toEqual(a.channels[0]);
  expect(b.channels[1]).toEqual(a.channels[1]);
  // Successive noise hits start at different points of the noise loop.
  const hit = (k: number) => slice(a.channels[0], k * 0.25 + 0.002, k * 0.25 + 0.02);
  const diff = rms(hit(0).map((v, i) => v - hit(1)[i]));
  expect(diff).toBeGreaterThan(0.5 * rms(hit(0)));
});

test('a channel tap carries that channel alone, keeps showing it when muted, and knows the note it plays', async () => {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  const p = project([{ id: 'a', sound: sine() }, { id: 'b', sound: sine() }]);
  engine.setProject(p);
  const a = new Float32Array(4096);
  const b = new Float32Array(4096);
  const master = new Float32Array(1024);
  const look = () => {
    engine.channelScope('a', a);
    engine.channelScope('b', b);
    engine.scope(master);
    const notes = [engine.soundingNote('a'), engine.soundingNote('b')];
    return { a: a.slice(), b: b.slice(), master: master.slice(), notes };
  };
  look();
  engine.play('a', 57, 1, 0, 0.8); // 220 Hz
  engine.play('b', 76, 1, 0.1, 0.8); // 659 Hz
  const seen: ReturnType<typeof look>[] = [];
  for (const [at, mute] of [[0.4, false], [0.5, true], [0.7, false], [0.95, false]] as const) {
    void ctx.suspend(at).then(() => {
      if (mute) engine.setProject({ ...p, channels: p.channels.map((c) => ({ ...c, mute: c.id === 'b' })) });
      else seen.push(look());
      return ctx.resume();
    });
  }
  await ctx.startRendering();
  const [both, muted, done] = seen;

  expect(freq(both.a)).toBeCloseTo(220, 0);
  expect(freq(both.b)).toBeCloseTo(659.3, 0);
  expect(amplitudeAt(both.a, 659.3)).toBeLessThan(0.01 * amplitudeAt(both.a, 220));
  expect(amplitudeAt(both.b, 220)).toBeLessThan(0.01 * amplitudeAt(both.b, 659.3));
  expect(both.notes).toEqual([57, 76]);

  // Muted, the channel is gone from the master but still on its own tap.
  expect(amplitudeAt(muted.master, 659.3)).toBeLessThan(0.01 * amplitudeAt(muted.master, 220));
  expect(amplitudeAt(muted.b, 659.3)).toBeCloseTo(amplitudeAt(both.b, 659.3), 2);

  expect(done.notes).toEqual([null, null]);
  expect(peak(done.a)).toBeLessThan(peak(both.a));
});

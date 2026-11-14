// The mixer in the engine: sends to the two buses, their racks, the master rack, sidechain ducking and the tail.

import { expect, test } from 'vitest';
import { Engine, renderProject, ringOut } from '../../src/audio';
import { parseProject, serializeProject } from '../../src/core/fileformat';
import type { Channel, ModuleInst, Pcm, Project } from '../../src/core/types';
import {
  adsr, amplitudeAt, db, effect, expectEnergy, mod, oldDemo, peak, project, rms, slice, sound, SR, wav,
} from './helpers';

const blip = (pitch = 81) =>
  sound('osc', { wave: 'sine', pitch: pitch - 60 }, { amp: adsr(0.002, 0.1, 1, 0.02), out: { level: -12 } });
const echo = (params = {}) => effect('delay', { sync: 'free', time: 0.3, feedback: 0, tone: 20000, mix: 1, ...params });
const scopeOf = (p: Project) => ({ kind: 'pattern', patternId: p.patterns[0].id }) as const;

/** One channel playing a note at step 0 for 0.1 s (a step at 120 bpm is 0.125 s), with bus A holding `chain`. */
function sent(channel: Partial<Channel> = {}, chain: ModuleInst[] = [echo()], extra: Partial<Project> = {}): Project {
  const p = project([{ id: 'a', sound: blip(), ...channel }], { a: { 0: { note: 60, vel: 1, len: 0.8 } } }, extra);
  p.mixer.buses[0] = { ...p.mixer.buses[0], chain };
  return p;
}

const render = (p: Project, tail = 1) => renderProject(p, scopeOf(p), { tail });

/** What the sends add: the render minus the same project sending nothing, left channel. */
async function added(p: Project): Promise<Float32Array> {
  const dry = (await render({ ...p, channels: p.channels.map((c) => ({ ...c, sends: [0, 0] })) })).channels[0];
  const wet = (await render(p)).channels[0];
  return wet.map((v, i) => v - dry[i]);
}

test('a channel sent to a fully wet delay on a bus comes back delayed, and its dry sound is unchanged', async () => {
  const dry = (await render(sent())).channels[0];
  const extra = await added(sent({ sends: [0.5, 0] }));
  expect(peak(slice(extra, 0, 0.299))).toBe(0);
  expect(db(rms(slice(extra, 0.31, 0.39)) / rms(slice(dry, 0.01, 0.09)))).toBeCloseTo(-6, 1);
  // The echo is the dry note itself, half as loud, 0.3 s later (the delay's tone filter turns its phase a little).
  const late = slice(extra, 0.3, 0.4);
  const early = slice(dry, 0, 0.1);
  expect(peak(late.map((v, i) => v - 0.5 * early[i]))).toBeLessThan(0.1 * peak(late));
  // A quarter is 6 dB less than a half.
  const quarter = await added(sent({ sends: [0.25, 0] }));
  expect(db(rms(slice(quarter, 0.31, 0.39)) / rms(slice(extra, 0.31, 0.39)))).toBeCloseTo(-6, 1);
});

test('a muted channel sends nothing; a bus has a level and a mute of its own', async () => {
  const muted = await render(sent({ sends: [1, 1], mute: true }));
  expect(peak(muted.channels[0])).toBe(0);
  const full = await added(sent({ sends: [0.5, 0] }));
  const down = sent({ sends: [0.5, 0] });
  down.mixer.buses[0].level = -9;
  expect(db(rms(slice(await added(down), 0.31, 0.39)) / rms(slice(full, 0.31, 0.39)))).toBeCloseTo(-9, 1);
  down.mixer.buses[0].mute = true;
  expect(peak(await added(down))).toBe(0);
  // Bus B gets its own sends: its default echo answers after a dotted eighth (0.375 s at 120 bpm).
  const b = await added(sent({ sends: [0, 0.5] }));
  expect(peak(slice(b, 0, 0.37))).toBe(0);
  expect(peak(slice(b, 0.38, 0.47))).toBeGreaterThan(0.05);
});

test('on a bus a Mix of 0 passes the sound dry, so Mix crossfades from dry to wet', async () => {
  const dry = (await render(sent())).channels[0];
  const extra = await added(sent({ sends: [0.5, 0] }, [effect('reverb', { size: 2, mix: 0 })]));
  expect(peak(extra.map((v, i) => v - 0.5 * dry[i]))).toBeLessThan(1e-6);
});

test('the master rack works on everything, the buses included', async () => {
  const p = sent({ sends: [0.5, 0] });
  const plain = (await render(p)).channels[0];
  p.mixer.master.chain = [effect('filter', { cutoff: 100, reso: 0 })];
  const filtered = (await render(p)).channels[0];
  for (const [t0, t1] of [[0.02, 0.09], [0.32, 0.39]]) {
    expect(db(rms(slice(filtered, t0, t1)) / rms(slice(plain, t0, t1)))).toBeLessThan(-20);
  }
});

test('an old project, and one with default buses and no sends, render exactly as before the mixer', async () => {
  // Length and energy of both channels, measured on the commit before the mixer.
  const pinned: [Project, number, number, number][] = [
    [busy(), 132300, 1220.819346603, 1986.448699010],
    [oldDemo(), 283667, 2877.251223941, 2678.784811694],
  ];
  for (const [p, length, left, right] of pinned) {
    const sr = p.name === 'Welcome' ? 8000 : SR;
    const scope = p.song.length ? { kind: 'song' } as const : scopeOf(p);
    const pcm = await renderProject(p, scope, { tail: p.song.length ? undefined : 1, sampleRate: sr });
    expect(pcm.channels[0].length, p.name).toBe(length);
    expectEnergy(pcm.channels[0], left, p.name);
    expectEnergy(pcm.channels[1], right, p.name);
    // The same project read from a file written before the mixer, and with other buses that nobody sends to.
    const old = JSON.parse(serializeProject(p));
    delete old.project.mixer;
    for (const c of old.project.channels) {
      delete c.sends;
      delete c.duck;
    }
    const opened = parseProject(JSON.stringify(old));
    opened.mixer.buses[0].chain = [effect('drive')];
    const again = await renderProject(opened, p.song.length ? scope : scopeOf(opened), {
      tail: p.song.length ? undefined : 1, sampleRate: sr,
    });
    expect(again.channels).toEqual(pcm.channels);
  }
}, 60_000);

/** Three sounds with effects and modulators, one panned, under a master of -2 dB. */
function busy(): Project {
  return project(
    [
      {
        id: 'hat',
        sound: sound('noise', {}, {
          amp: adsr(0.001, 0.05, 0, 0.05), chain: [effect('filter', { mode: 'highpass', cutoff: 7000 })],
        }),
      },
      {
        id: 'pad',
        sound: sound('osc', { voices: 5, noise: 0.2 }, {
          chain: [effect('drive'), effect('delay', { pingpong: true }), effect('reverb', { size: 1 })],
          out: { level: -6, pan: 0.4 },
        }),
      },
      {
        id: 'bell',
        sound: sound('fm', { ratio: 3.5 }, {
          mods: [
            mod('lfo', { module: 'source', param: 'pitch' }, 0.01, { rate: 5 }),
            mod('env', { module: 'source', param: 'pitch' }, 0.02),
          ],
        }),
      },
    ],
    {
      hat: { 0: { note: 60, vel: 0.7, len: 1 }, 2: { note: 60, vel: 0.5, len: 1 }, 4: { note: 60, vel: 0.7, len: 1 } },
      pad: {
        0: { note: 48, vel: 0.8, len: 12 }, 2: { note: 55, vel: 0.8, len: 12 }, 4: { note: 63, vel: 0.8, len: 12 },
      },
      bell: { 4: { note: 72, vel: 0.9, len: 2 } },
    },
    { master: -2 },
  );
}

// A sampler playing a constant: its output is its gain, so the ducking can be read off sample by sample.
const DC = 'dc-duck';
const dcSamples = { [DC]: { name: 'dc.wav', bytes: wav(new Float32Array(3 * SR).fill(0.25)) } };
const dc = () => sound('sample', { sample: DC, mode: 'gate' }, { amp: adsr(0.001, 0.1, 1, 0.01), out: { level: -6 } });

/** A pad of constant level ducking to a muted kick, beside a tone on the left alone that does not duck. */
function ducking(kicks: Record<number, { note: number; vel: number; len: number }>): Project {
  return project(
    [
      { id: 'kick', sound: blip(), mute: true },
      { id: 'pad', sound: dc(), duck: { source: 'kick', amount: 0.75, release: 0.2 } },
      { id: 'tone', sound: sound('osc', { wave: 'sine', pitch: 23 }, { out: { level: -12, pan: -1 } }) },
    ],
    { kick: kicks, pad: { 0: { note: 60, vel: 1, len: 16 } }, tone: { 0: { note: 60, vel: 1, len: 16 } } },
    { samples: dcSamples },
  );
}

/** The mean over 10 ms centred on `t`, on the right where only the pad is: its gain at `t`. */
const gainAt = (d: Float32Array, t: number) => {
  const w = slice(d, t - 0.005, t + 0.005);
  return w.reduce((a, b) => a + b, 0) / w.length;
};

test('ducking dips the channel by its amount at the notes of its source and recovers over the release', async () => {
  const kick = { note: 60, vel: 1, len: 0.5 };
  const p = ducking({ 4: kick, 12: kick });
  const [left, d] = (await renderProject(p, scopeOf(p), { tail: 0 })).channels;
  const full = gainAt(d, 0.4);
  expect(full).toBeGreaterThan(0.05);
  // At 120 bpm the kicks are at 0.5 s and 1.5 s; each falls in 5 ms to a quarter and rises back in 0.2 s.
  for (const t of [0.5, 1.5]) {
    expect(gainAt(d, t - 0.01) / full).toBeCloseTo(1, 3);
    expect(gainAt(d, t + 0.01) / full).toBeCloseTo(0.25 + 0.75 * (0.005 / 0.2), 2);
    expect(gainAt(d, t + 0.105) / full).toBeCloseTo(0.625, 2);
    expect(gainAt(d, t + 0.25) / full).toBeCloseTo(1, 3);
  }
  // The tone, which does not duck, keeps its level through the dip.
  const tone = (t: number) => amplitudeAt(slice(left, t, t + 0.05), 987.77);
  expect(db(tone(0.51) / tone(0.3))).toBeCloseTo(0, 1);
});

test('a live note of the source ducks too, without losing a dip already scheduled after it', async () => {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  const p = ducking({});
  engine.setProject(p);
  await engine.ready();
  engine.play('pad', 60, 1, 0, 1);
  engine.play('kick', 60, 1, 0.8, 0.05);
  let at = 0;
  void ctx.suspend(0.3).then(() => {
    at = ctx.currentTime;
    engine.noteOn('kick', 60, 1);
    return ctx.resume();
  });
  const d = (await ctx.startRendering()).getChannelData(1);
  const full = gainAt(d, 0.2);
  expect(gainAt(d, at + 0.01) / full).toBeCloseTo(0.26875, 2);
  expect(gainAt(d, at + 0.105) / full).toBeCloseTo(0.625, 2);
  expect(gainAt(d, at + 0.3) / full).toBeCloseTo(1, 3);
  expect(gainAt(d, 0.81) / full).toBeCloseTo(0.26875, 2);
  expect(gainAt(d, 0.905) / full).toBeCloseTo(0.625, 2);
});

test('ducking reaches the sends too, and a channel never ducks to itself', async () => {
  const p = ducking({ 4: { note: 60, vel: 1, len: 0.5 } });
  p.channels[1].sends = [1, 0];
  p.mixer.buses[0].chain = [echo({ time: 0.5 })];
  const d = (await renderProject(p, scopeOf(p), { tail: 0 })).channels[1];
  const pad = gainAt(d, 0.4);
  // The bus echoes the pad half a second late, dip and all: at 1.01 s the pad is back up, its echo from 0.51 s not.
  expect(gainAt(d, 1.01) / pad).toBeCloseTo(1 + 0.26875, 2);
  const self = ducking({});
  self.channels[1].duck.source = 'pad';
  const same = (await renderProject(self, scopeOf(self), { tail: 0 })).channels[1];
  expect(gainAt(same, 0.51) / gainAt(same, 0.4)).toBeCloseTo(1, 4);
});

test('the meters read each channel after its mute and each bus that is sent to', async () => {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  const p = sent({ sends: [0.5, 0] });
  p.channels.push({ ...p.channels[0], id: 'b', mute: true });
  engine.setProject(p);
  engine.play('a', 81, 1, 0, 0.9);
  engine.play('b', 81, 1, 0, 0.9);
  const seen: number[][] = [];
  // The meters' taps are made on the first read, and show the signal from then on.
  for (const t of [0.3, 0.5]) {
    void ctx.suspend(t).then(() => {
      seen.splice(0, 4, engine.channelLevels('a'), engine.channelLevels('b'), engine.busLevels(0), engine.busLevels(1));
      return ctx.resume();
    });
  }
  await ctx.startRendering();
  const [a, b, room, echoes] = seen;
  expect(a[0]).toBeCloseTo(Math.SQRT1_2 * 10 ** (-12 / 20), 2);
  expect(b).toEqual([0, 0]);
  expect(room[0]).toBeCloseTo(a[0] / 2, 2);
  expect(echoes).toEqual([0, 0]);
});

test('a compressor on a bus or the master reports its gain reduction, as one in a sound does', async () => {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  const squash = (id: string) => ({ ...effect('compressor', { threshold: -40, ratio: 20 }), id });
  const p = sent({ sends: [1, 0] }, [squash('room')]);
  p.mixer.buses[1] = { ...p.mixer.buses[1], chain: [squash('unused')] };
  p.mixer.master.chain = [squash('master')];
  engine.setProject(p);
  engine.play('a', 81, 1, 0, 0.9);
  const seen: number[] = [];
  void ctx.suspend(0.5).then(() => {
    seen.push(...[[0, 'room'], [1, 'unused'], ['master', 'master'], [0, 'missing']]
      .map(([rack, id]) => engine.effectReduction({ rack: rack as 0 | 1 | 'master' }, id as string)));
    return ctx.resume();
  });
  await ctx.startRendering();
  const [room, unused, master, missing] = seen;
  expect(room).toBeLessThan(-6);
  expect(master).toBeLessThan(-6);
  expect([unused, missing]).toEqual([0, 0]);
});

test('the tail of an export lets a long reverb on a bus ring out', async () => {
  const sr = 8000;
  const room = [effect('reverb', { size: 12, mix: 1 })];
  const p = sent({ sends: [1, 0], sound: { ...blip(57), out: { level: 0 } } }, room);
  const pcm: Pcm = await renderProject(p, scopeOf(p), { sampleRate: sr });
  const seconds = pcm.channels[0].length / sr;
  expect(seconds).toBeGreaterThan(2 + 6 + 1);
  expect(seconds).toBeLessThan(2 + ringOut([p.channels[0].sound], p.bpm, 12) + 0.06);
  // Sending nothing, the same project has the usual six seconds at most.
  const quiet = await renderProject({ ...p, channels: [{ ...p.channels[0], sends: [0, 0] }] }, scopeOf(p), {
    sampleRate: sr,
  });
  expect(quiet.channels[0].length / sr).toBeLessThan(2 + 1);
});

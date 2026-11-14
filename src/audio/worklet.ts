// Custom signal code: the AudioWorklet processors in src/audio/processors, loaded once into each audio context, and
// the effect builder that wraps one of them.

import type { Params } from '../core/types';
import { glide, rampWith } from './automation';
import type { EffectBuilder } from './modules/effects';
import processorsUrl from './processors/index.ts?worker&url';

// The processor of an effect whose channel has gone stops this long after it, once the channel has faded out.
const STOP_AFTER = 0.2;
const STEREO = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' } as const;

const loads = new WeakMap<BaseAudioContext, Promise<boolean>>();
const loaded = new WeakSet<BaseAudioContext>();

/**
 * Load the processors into a context, the first time this is asked for that context. Resolves to false when they
 * cannot be loaded; the effects that need them then pass the sound through unchanged.
 */
export function loadProcessors(ctx: BaseAudioContext): Promise<boolean> {
  let load = loads.get(ctx);
  if (!load) {
    load = Promise.resolve()
      .then(() => ctx.audioWorklet.addModule(processorsUrl))
      .then(
        () => {
          loaded.add(ctx);
          return true;
        },
        (err: unknown) => {
          console.warn('The audio processors could not be loaded.', err);
          return false;
        },
      );
    loads.set(ctx, load);
  }
  return load;
}

/** The loading of the processors into a context, if an effect or a source has started it; the engine waits for it. */
export const processorsLoading = (ctx: BaseAudioContext): Promise<boolean> | undefined => loads.get(ctx);

/** Whether the processors are in a context, so a processor node can be made there right now. */
export const processorsLoaded = (ctx: BaseAudioContext): boolean => loaded.has(ctx);

/**
 * An effect made of one processor. `values` gives the value of each of its parameters from the module's
 * parameters, and from whether it is shared (on a bus or the master, see EffectBuilder); each value is a ConstantSourceNode connected to the processor's parameter, so a knob glides it and a
 * modulator adds to it, even before the processor exists. `targets` names the processor parameter that each
 * modulation target of the module moves. Until the processors are loaded in the context the sound passes straight
 * through; in an offline render that is over before the first sample, because the engine waits for the loading.
 */
export function processorEffect(
  name: string,
  values: (p: Params, shared: boolean) => Record<string, number>,
  targets: Record<string, string> = {},
): EffectBuilder {
  return (ctx, p, _bpm, shared = false) => {
    const input = new GainNode(ctx, STEREO);
    const output = new GainNode(ctx);
    input.connect(output);
    const sources = Object.entries(values(p, shared)).map(([id, offset]) => {
      const source = new ConstantSourceNode(ctx, { offset });
      source.start();
      return [id, source] as const;
    });
    const param = (id: string) => sources.find(([key]) => key === id)![1].offset;
    let node: AudioWorkletNode | null = null;
    let gone = false;
    const attach = () => {
      if (gone) return;
      try {
        node = new AudioWorkletNode(ctx, name, { ...STEREO, outputChannelCount: [2] });
      } catch (err) {
        console.warn(`The ${name} processor could not be started.`, err);
        return;
      }
      for (const [id, source] of sources) source.connect(node.parameters.get(id)!);
      input.disconnect(output);
      input.connect(node).connect(output);
    };
    // Every value glides, so automation ramps the ConstantSourceNodes that a parameter moves.
    const update = (p: Params) => {
      const t = ctx.currentTime;
      for (const [id, value] of Object.entries(values(p, shared))) glide(param(id), value, t);
    };
    if (loaded.has(ctx)) attach();
    else void loadProcessors(ctx).then((ok) => ok && attach());
    return {
      input,
      output,
      targets: Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, [param(target)]])),
      update,
      ramp: (p, _bpm, id, time) => rampWith(update, p, id, time),
      dispose() {
        gone = true;
        for (const [, source] of sources) source.stop(ctx.currentTime + STOP_AFTER);
        setTimeout(() => node?.port.postMessage('stop'), STOP_AFTER * 1000);
      },
    };
  };
}

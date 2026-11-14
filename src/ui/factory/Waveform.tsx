import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { loadSample, loadSampleFile } from '../../app/commands';
import { decodeSample, sampleBuffer } from '../../audio';
import { MODULES, paramSpec } from '../../core/modules';
import { formatValue } from '../../core/params';
import type { ModuleInst } from '../../core/types';
import { setParam, useApp } from '../../state/store';
import { Button, Display, setHint, tokenColor, useHint } from '../kit';
import { PARAM_HINTS } from './hints';
import type { Cell } from './levels';

/** The widest the display draws, and the narrowest it shrinks to in a narrow rack, such as beside the Guide Book. */
export const WAVE_W = 500;
const MIN_W = 160;
const WAVE_H = 76;
/** The display's bevel on both sides. */
const FRAME = 4;
/** The strip at the top of the display that holds the file name and the direction arrow. */
export const STRIP = 16;

export type Shade = '--amber' | '--amber-mid' | '--amber-dim';

/** Lowest and highest sample of every pixel column, over all channels. */
function peaks(buffer: AudioBuffer, columns: number): Float32Array {
  const out = new Float32Array(columns * 2);
  const data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let x = 0; x < columns; x++) {
    const i0 = Math.floor((x * buffer.length) / columns);
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * buffer.length) / columns));
    let lo = 0;
    let hi = 0;
    for (const d of data) {
      for (let i = i0; i < i1 && i < d.length; i++) {
        lo = Math.min(lo, d[i]);
        hi = Math.max(hi, d[i]);
      }
    }
    out[x * 2] = lo;
    out[x * 2 + 1] = hi;
  }
  return out;
}

/** The decoded sample of a source: undefined while it decodes (or when none is loaded), null when it cannot be. */
export function useDecoded(id: string): AudioBuffer | null | undefined {
  const bytes = useApp((s) => (id ? s.project.samples[id]?.bytes : undefined));
  const [result, setResult] = useState<{ id: string; buffer: AudioBuffer | null }>();
  useEffect(() => {
    if (!id || !bytes || sampleBuffer(id)) return;
    let live = true;
    decodeSample(id, bytes).then(
      (buffer) => live && setResult({ id, buffer }),
      () => live && setResult({ id, buffer: null }),
    );
    return () => {
      live = false;
    };
  }, [id, bytes]);
  if (!id) return undefined;
  if (!bytes) return null;
  return sampleBuffer(id) ?? (result?.id === id ? result.buffer : undefined);
}

/** The column of a display `width` pixels wide at a share of the sample. */
export const column = (share: number, width: number) => Math.round(share * (width - 1));

interface WaveformProps {
  channelId: string;
  source: ModuleInst;
  buffer: AudioBuffer | null | undefined;
  /** The colour of each column of the waveform, by its x. */
  shade: (x: number) => Shade;
  /** Marks drawn over the waveform. */
  overlay: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Redraw when these change. */
  deps: unknown[];
  /**
   * A press at a share of the sample: the parameter it moves from then on, given the value it is pressed at, and
   * how to keep that parameter's value in range while dragging.
   */
  grab: (share: number) => { param: string; limit: (share: number) => number };
  hint: string;
  /** How wide the display draws, which the unit keeps so its marks land on the right columns. */
  width: number;
  /** Told the width the row leaves for the display, whenever it changes. */
  onWidth: (width: number) => void;
}

/**
 * A sample's waveform on an amber display, with its name; dragging on it moves the parameter that `grab` picks, and
 * an audio file dropped on it is loaded into the channel.
 */
export function Waveform({ channelId, source, buffer, shade, overlay, deps, grab, hint, width, onWidth }: WaveformProps) {
  const id = source.params.sample as string;
  const name = useApp((s) => (id ? s.project.samples[id]?.name : undefined));
  const columns = useMemo(() => buffer && peaks(buffer, width), [buffer, width]);
  const drag = useRef<ReturnType<WaveformProps['grab']> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => onWidth(Math.max(MIN_W, Math.min(WAVE_W, el.clientWidth - FRAME)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onWidth]);
  const fullHint = buffer
    ? `${hint} Drop another audio file here to load it.`
    : `Drop an audio file here to load it into the ${source.type === 'grains' ? 'grains' : 'sampler'}.`;
  const hover = useHint(fullHint);

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const canvas = e.currentTarget.querySelector('canvas')!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - canvas.left) / (width - 1)));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { param, limit } = drag.current;
    const value = limit(Math.round(at(e) * 1000) / 1000);
    const spec = paramSpec(MODULES[source.type], param)!;
    setParam(channelId, 'source', param, value);
    setHint(`${spec.label}: ${formatValue(spec, value)}`);
  };
  const stop = () => {
    if (!drag.current) return;
    drag.current = null;
    setHint(hover.over.current ? fullHint : null);
  };

  const message = !id
    ? 'Drop an audio file here or press Load.'
    : buffer === null
      ? 'This file could not be read. Try another one.'
      : null;
  return (
    <div
      ref={box}
      className="h-factory-wave"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void loadSampleFile(channelId, file);
      }}
      onPointerDown={(e) => {
        if (!columns || e.button !== 0) return;
        drag.current = grab(at(e));
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={stop}
      onLostPointerCapture={stop}
      {...hover.props}
    >
      <Display
        width={width}
        height={WAVE_H}
        deps={[columns, ...deps]}
        draw={(g, w, h) => {
          if (!columns) return;
          const mid = STRIP + Math.floor((h - STRIP) / 2);
          const half = Math.floor((h - STRIP) / 2) - 1;
          g.fillStyle = tokenColor('--amber-dim');
          for (let x = 0; x < w; x += 2) g.fillRect(x, mid, 1, 1);
          const colours = { '--amber': '', '--amber-mid': '', '--amber-dim': '' };
          for (const token of Object.keys(colours) as Shade[]) colours[token] = tokenColor(token);
          for (let x = 0; x < w; x++) {
            const top = mid - Math.round(columns[x * 2 + 1] * half);
            const bottom = mid - Math.round(columns[x * 2] * half);
            g.fillStyle = colours[shade(x)];
            g.fillRect(x, top, 1, bottom - top + 1);
          }
          g.fillStyle = colours['--amber-dim'];
          for (let x = 0; x < w; x += 2) g.fillRect(x, STRIP - 1, 1, 1);
          overlay(g, w, h);
        }}
      />
      {name && buffer && <span className="h-factory-wave-name">{name}</span>}
      {message && <span className="h-factory-wave-message">{message}</span>}
    </div>
  );
}

/** The Sample cell of a unit that plays one: its Load... button. */
export function loadCell(channelId: string, type: string): Cell {
  return {
    level: 1,
    changed: false,
    node: (
      <div key="sample" className="h-factory-cell is-wide">
        <div className="h-param">
          <span className="h-param-label">Sample</span>
          <Button onClick={() => void loadSample(channelId)} hint={PARAM_HINTS[type].sample}>
            Load...
          </Button>
        </div>
      </div>
    ),
  };
}

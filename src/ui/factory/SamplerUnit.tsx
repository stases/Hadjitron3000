import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { loadSample, loadSampleFile } from '../../app/commands';
import { decodeSample, sampleBuffer } from '../../audio';
import { MODULES, paramSpec } from '../../core/modules';
import { formatValue } from '../../core/params';
import type { ModuleInst } from '../../core/types';
import { setParam, useApp } from '../../state/store';
import { Button, Display, RackUnit, setHint, tokenColor, useHint } from '../kit';
import { Control, SourceSelect, paramCell } from './controls';
import { PARAM_HINTS } from './hints';
import { useLevels } from './levels';
import type { Cell } from './levels';

const WAVE_W = 500;
const WAVE_H = 76;
/** The strip at the top of the display that holds the file name and the direction arrow. */
const STRIP = 16;

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

function useDecoded(id: string, bytes: Uint8Array | undefined): AudioBuffer | null | undefined {
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

function Waveform({ channelId, source }: { channelId: string; source: ModuleInst }) {
  const id = source.params.sample as string;
  const sample = useApp((s) => (id ? s.project.samples[id] : undefined));
  const buffer = useDecoded(id, sample?.bytes);
  const start = source.params.start as number;
  const end = source.params.end as number;
  const reverse = source.params.reverse as boolean;
  const columns = useMemo(() => buffer && peaks(buffer, WAVE_W), [buffer]);
  const drag = useRef<'start' | 'end' | null>(null);
  const hint = buffer
    ? 'Drag the two markers to choose the part of the sample that plays, or drop another audio file here.'
    : 'Drop an audio file here to load it into the sampler.';
  const hover = useHint(hint);

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const canvas = e.currentTarget.querySelector('canvas')!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - canvas.left) / (WAVE_W - 1)));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const t = Math.round(at(e) * 1000) / 1000;
    const value = drag.current === 'start' ? Math.min(t, end) : Math.max(t, start);
    const spec = paramSpec(MODULES.sample, drag.current)!;
    setParam(channelId, 'source', drag.current, value);
    setHint(`${spec.label}: ${formatValue(spec, value)}`);
  };
  const stop = () => {
    if (!drag.current) return;
    drag.current = null;
    setHint(hover.over.current ? hint : null);
  };

  const message = !id
    ? 'Drop an audio file here or press Load.'
    : buffer === null
      ? 'This file could not be read. Try another one.'
      : null;
  return (
    <div
      className="h-factory-wave"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void loadSampleFile(channelId, file);
      }}
      onPointerDown={(e) => {
        if (!columns || e.button !== 0) return;
        const t = at(e);
        drag.current = Math.abs(t - start) <= Math.abs(t - end) && (t <= end || start !== end) ? 'start' : 'end';
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={stop}
      onLostPointerCapture={stop}
      {...hover.props}
    >
      <Display
        width={WAVE_W}
        height={WAVE_H}
        deps={[columns, start, end, reverse]}
        draw={(g, w, h) => {
          if (!columns) return;
          const mid = STRIP + Math.floor((h - STRIP) / 2);
          const half = Math.floor((h - STRIP) / 2) - 1;
          const xs = Math.round(start * (w - 1));
          const xe = Math.round(end * (w - 1));
          g.fillStyle = tokenColor('--amber-dim');
          for (let x = 0; x < w; x += 2) g.fillRect(x, mid, 1, 1);
          const bright = tokenColor('--amber');
          const dim = tokenColor('--amber-dim');
          for (let x = 0; x < w; x++) {
            const top = mid - Math.round(columns[x * 2 + 1] * half);
            const bottom = mid - Math.round(columns[x * 2] * half);
            g.fillStyle = x >= xs && x <= xe ? bright : dim;
            g.fillRect(x, top, 1, bottom - top + 1);
          }
          for (let x = 0; x < w; x += 2) g.fillRect(x, STRIP - 1, 1, 1);
          g.fillStyle = bright;
          for (const [x, dir] of [[xs, 1], [xe, -1]]) {
            g.fillRect(x, STRIP, 1, h - STRIP);
            for (let i = 0; i < 4; i++) g.fillRect(dir > 0 ? x : x - 3 + i, STRIP + i, 4 - i, 1);
          }
          if (reverse && xe - xs > 16) {
            const cx = Math.round((xs + xe) / 2);
            const y = Math.floor(STRIP / 2) - 1;
            g.fillStyle = tokenColor('--amber-mid');
            g.fillRect(cx - 4, y, 9, 1);
            g.fillRect(cx - 3, y - 1, 1, 3);
            g.fillRect(cx - 2, y - 2, 1, 5);
          }
        }}
      />
      {sample && buffer && <span className="h-factory-wave-name">{sample.name}</span>}
      {message && <span className="h-factory-wave-message">{message}</span>}
    </div>
  );
}

/** The sampler's Source unit; `play` are the cells of the play controls, which follow its own. */
export function SamplerUnit({ channelId, source, play }: { channelId: string; source: ModuleInst; play: Cell[] }) {
  const props = (pid: string) => ({
    owner: channelId,
    moduleId: 'source',
    type: 'sample',
    spec: paramSpec(MODULES.sample, pid)!,
    params: source.params,
  });
  const cells: Cell[] = [
    {
      level: 1,
      changed: false,
      node: (
        <div key="sample" className="h-factory-cell is-wide">
          <div className="h-param">
            <span className="h-param-label">Sample</span>
            <Button onClick={() => void loadSample(channelId)} hint={PARAM_HINTS.sample.sample}>
              Load...
            </Button>
          </div>
        </div>
      ),
    },
    ...['pitch', 'fine', 'start', 'end'].map((pid) => paramCell(props(pid))),
    {
      level: 2,
      changed: !!source.params.loop || !!source.params.reverse,
      node: (
        <div key="loop" className="h-factory-cell is-wide is-stack">
          <Control {...props('loop')} />
          <Control {...props('reverse')} />
        </div>
      ),
    },
    paramCell(props('mode')),
    ...play,
  ];
  const { row, folds } = useLevels('sample', cells);
  return (
    <RackUnit name="Source" folds={folds}>
      <div className="h-factory-sampler">
        <div className="h-factory-row">
          <SourceSelect channelId={channelId} type="sample" />
          <Waveform channelId={channelId} source={source} />
        </div>
        <div className="h-factory-row">{row}</div>
      </div>
    </RackUnit>
  );
}

import { useRef } from 'react';
import { effectReduction } from '../../app/audio';
import { Display, tokenColor, useHint } from '../kit';

const WIDTH = 116;
const HEIGHT = 32;
const SEGMENTS = 12;
const DB_PER_SEGMENT = 2;
// A longer tick under every third segment marks 6, 12 and 18 dB.
const MAJOR = 3;

/**
 * A compressor's gain reduction: a row of amber segments that light from the left, 2 dB each, over a scale, with
 * the value in dB below it like the value under a knob.
 */
export function ReductionMeter({ channelId, moduleId }: { channelId: string; moduleId: string }) {
  const readout = useRef<HTMLSpanElement>(null);
  const hover = useHint('How far the compressor turns the sound down right now; each segment is 2 dB.');
  return (
    <div className="h-factory-cell is-meter" {...hover.props}>
      <Display
        width={WIDTH}
        height={HEIGHT}
        live
        draw={(g, w) => {
          const reduction = Math.max(0, -effectReduction(channelId, moduleId));
          const lit = Math.min(SEGMENTS, Math.round(reduction / DB_PER_SEGMENT));
          const pitch = Math.floor((w - 2) / SEGMENTS);
          const left = Math.floor((w - pitch * SEGMENTS + 2) / 2);
          for (let i = 0; i < SEGMENTS; i++) {
            const x = left + i * pitch;
            g.fillStyle = tokenColor(i < lit ? '--amber' : '--amber-dim');
            g.fillRect(x, 4, pitch - 2, 14);
            g.fillStyle = tokenColor('--amber-mid');
            g.fillRect(x - 1, 21, 1, i % MAJOR === 0 ? 6 : 2);
          }
          g.fillRect(left + SEGMENTS * pitch - 1, 21, 1, 6);
          const text = reduction < 0.05 ? '0.0 dB' : `-${reduction.toFixed(1)} dB`;
          if (readout.current && readout.current.textContent !== text) readout.current.textContent = text;
        }}
      />
      <span className="h-factory-meter-label">Reduction</span>
      <span className="h-factory-meter-value" ref={readout} />
    </div>
  );
}

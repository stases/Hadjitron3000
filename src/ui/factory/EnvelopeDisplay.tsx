import { adsrOf, envelopeAt } from '../../core/envelope';
import type { Params } from '../../core/types';
import { Display, tokenColor } from '../kit';

/**
 * The ADSR curve of a note held long enough to reach its sustain, then let go, computed by core/envelope so it is
 * exactly what the engine plays. A dotted line marks the moment the key is let go.
 */
export function EnvelopeDisplay({ params, width, height }: { params: Params; width: number; height: number }) {
  const env = adsrOf(params);
  return (
    <Display
      width={width}
      height={height}
      deps={[env.attack, env.decay, env.sustain, env.release]}
      draw={(g, w, h) => {
        const attack = Math.max(env.attack, 0.001);
        const hold = 0.2 * (attack + env.decay + 1.25 * env.release) + 0.01;
        const gate = attack + env.decay + hold;
        const total = gate + 1.25 * env.release;
        const top = 2;
        const bottom = h - 2;
        const y = (v: number) => Math.round(bottom - v * (bottom - top));
        const gateX = Math.round((gate / total) * w);

        g.fillStyle = tokenColor('--amber-dim');
        for (let x = 0; x < w; x += 2) g.fillRect(x, bottom, 1, 1);
        for (let yy = top; yy < bottom; yy += 2) g.fillRect(gateX, yy, 1, 1);

        let prev = y(envelopeAt(env, 0, gate));
        for (let x = 0; x < w; x++) {
          const next = y(envelopeAt(env, ((x + 1) / w) * total, gate));
          const hi = Math.min(prev, next);
          g.fillStyle = tokenColor('--amber-dim');
          for (let yy = hi + 1 + ((hi + x) % 2); yy < bottom; yy += 2) g.fillRect(x, yy, 1, 1);
          g.fillStyle = tokenColor('--amber');
          g.fillRect(x, hi, 1, Math.max(prev, next) - hi + 1);
          prev = next;
        }
      }}
    />
  );
}

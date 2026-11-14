import { useEffect, useState } from 'react';
import { slicesToTrack } from '../../app/commands';
import { soundingNote } from '../../app/audio';
import { sliceTimes } from '../../audio';
import { MODULES, paramSpec } from '../../core/modules';
import type { ModuleInst } from '../../core/types';
import { Button, RackUnit, tokenColor } from '../kit';
import { Control, SourceSelect, paramCell } from './controls';
import { SLICE_HINTS } from './hints';
import { useLevels } from './levels';
import type { Cell } from './levels';
import { STRIP, Waveform, column, loadCell, useDecoded } from './Waveform';

/** The note a channel sounds, read on every frame while `on`, or null. */
function useSounding(channelId: string, on: boolean): number | null {
  const [note, setNote] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let frame = requestAnimationFrame(function loop() {
      setNote(soundingNote(channelId));
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [channelId, on]);
  return on ? note : null;
}

/** The sampler's Source unit; `play` are the cells of the play controls, which follow its own. */
export function SamplerUnit({ channelId, source, play }: { channelId: string; source: ModuleInst; play: Cell[] }) {
  const p = source.params;
  const buffer = useDecoded(p.sample as string);
  const slices = buffer ? sliceTimes(buffer, p) : null;
  const sounding = useSounding(channelId, !!slices);
  // The slice a sounding note plays lights up; the lowest one, when several sound.
  const lit = slices && sounding !== null && sounding >= 60 && sounding - 60 < slices.length - 1 ? sounding - 60 : -1;
  const share = (t: number) => (buffer ? t / buffer.duration : 0);
  const xs = column(p.start as number);
  const xe = column(p.end as number);
  const lines = slices?.slice(1, -1).map((t) => column(share(t))) ?? [];
  const litFrom = lit >= 0 ? column(share(slices![lit])) : 0;
  const litTo = lit >= 0 ? column(share(slices![lit + 1])) : 0;

  const props = (pid: string) => ({
    owner: channelId,
    moduleId: 'source',
    type: 'sample',
    spec: paramSpec(MODULES.sample, pid)!,
    params: p,
  });
  const cells: Cell[] = [
    loadCell(channelId, 'sample'),
    ...['pitch', 'fine', 'start', 'end'].map((pid) => paramCell(props(pid))),
    {
      level: 2,
      changed: !!p.loop || !!p.reverse,
      node: (
        <div key="loop" className="h-factory-cell is-wide is-stack">
          <Control {...props('loop')} />
          <Control {...props('reverse')} />
        </div>
      ),
    },
    paramCell(props('xfade')),
    paramCell(props('mode')),
    paramCell(props('slices')),
    ...(p.slices === 'hits' ? [paramCell(props('sens'))] : []),
    {
      level: 2,
      changed: false,
      node: (
        <div key="track" className="h-factory-cell is-wide is-track">
          <div className="h-param">
            <span className="h-param-label">Track</span>
            <Button disabled={!slices} onClick={() => void slicesToTrack(channelId)} hint={SLICE_HINTS.toTrack}>
              Slices to Track
            </Button>
          </div>
        </div>
      ),
    },
    ...play,
  ];
  const { row, folds } = useLevels('sample', cells);
  return (
    <RackUnit name="Source" folds={folds}>
      <div className="h-factory-sampler">
        <div className="h-factory-row">
          <SourceSelect channelId={channelId} type="sample" />
          <Waveform
            channelId={channelId}
            source={source}
            buffer={buffer}
            deps={[xs, xe, p.reverse, lines.join(), litFrom, litTo]}
            shade={(x) => {
              if (x < xs || x > xe) return '--amber-dim';
              return lit < 0 || (x >= litFrom && x < litTo) ? '--amber' : '--amber-mid';
            }}
            overlay={(g, _w, h) => {
              g.fillStyle = tokenColor('--amber');
              for (const x of lines) for (let y = STRIP + 1; y < h; y += 2) g.fillRect(x, y, 1, 1);
              for (const [x, dir] of [[xs, 1], [xe, -1]]) {
                g.fillRect(x, STRIP, 1, h - STRIP);
                for (let i = 0; i < 4; i++) g.fillRect(dir > 0 ? x : x - 3 + i, STRIP + i, 4 - i, 1);
              }
              if (p.reverse && xe - xs > 16) {
                const cx = Math.round((xs + xe) / 2);
                const y = Math.floor(STRIP / 2) - 1;
                g.fillStyle = tokenColor('--amber-mid');
                g.fillRect(cx - 4, y, 9, 1);
                g.fillRect(cx - 3, y - 1, 1, 3);
                g.fillRect(cx - 2, y - 2, 1, 5);
              }
            }}
            grab={(t) => {
              const start = p.start as number;
              const end = p.end as number;
              return Math.abs(t - start) <= Math.abs(t - end) && (t <= end || start !== end)
                ? { param: 'start', limit: (v) => Math.min(v, end) }
                : { param: 'end', limit: (v) => Math.max(v, start) };
            }}
            hint={slices
              ? 'Drag the two markers to choose the part of the sample that is sliced; the lit slice is playing.'
              : 'Drag the two markers to choose the part of the sample that plays.'}
          />
        </div>
        <div className="h-factory-row">{row}</div>
      </div>
    </RackUnit>
  );
}

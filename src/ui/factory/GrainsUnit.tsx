import { useState } from 'react';
import { MODULES } from '../../core/modules';
import type { ModuleInst } from '../../core/types';
import { RackUnit, tokenColor } from '../kit';
import { SourceSelect, paramCell } from './controls';
import { useLevels } from './levels';
import type { Cell } from './levels';
import { STRIP, WAVE_W, Waveform, column, loadCell, useDecoded } from './Waveform';

/**
 * The Grains source unit: the sample with Position marked on it and the stretch Spray scatters the grains over lit
 * up, and the cloud's controls; `play` are the cells of the play controls, which follow its own.
 */
export function GrainsUnit({ channelId, source, play }: { channelId: string; source: ModuleInst; play: Cell[] }) {
  const p = source.params;
  const buffer = useDecoded(p.sample as string);
  const position = p.position as number;
  const spray = p.spray as number;
  const [width, setWidth] = useState(WAVE_W);
  const x = column(position, width);
  const from = column(Math.max(0, position - spray / 2), width);
  const to = column(Math.min(1, position + spray / 2), width);
  const cells: Cell[] = [
    loadCell(channelId, 'grains'),
    ...MODULES.grains.params
      .filter((spec) => spec.kind !== 'sample')
      .map((spec) => paramCell({ owner: channelId, moduleId: 'source', type: 'grains', spec, params: p })),
    ...play,
  ];
  const { row, folds } = useLevels('grains', cells);
  return (
    <RackUnit name="Source" folds={folds} data-tour="unit-source">
      <div className="h-factory-sampler">
        <div className="h-factory-row">
          <SourceSelect channelId={channelId} type="grains" />
          <Waveform
            channelId={channelId}
            source={source}
            buffer={buffer}
            width={width}
            onWidth={setWidth}
            deps={[x, from, to]}
            shade={(c) => (c >= from && c <= to ? '--amber' : '--amber-dim')}
            overlay={(g, _w, h) => {
              g.fillStyle = tokenColor('--amber');
              g.fillRect(x, STRIP, 1, h - STRIP);
              for (let i = 0; i < 4; i++) g.fillRect(x - 3 + i, STRIP + i, 7 - 2 * i, 1);
              for (const edge of [from, to]) {
                for (let i = 0; i < 3; i++) {
                  g.fillRect(edge, STRIP + i, 1, 1);
                  g.fillRect(edge, h - 1 - i, 1, 1);
                }
              }
            }}
            grab={() => ({ param: 'position', limit: (v) => v })}
            hint="Drag to move Position, where the grains come from; the lit stretch is where Spray scatters them."
          />
        </div>
        <div className="h-factory-row">{row}</div>
      </div>
    </RackUnit>
  );
}

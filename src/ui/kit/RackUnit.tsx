import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Led } from './Displays';
import { Icon, SpriteImage } from './Icon';
import type { Sprite } from './icons';

const SCREW: Sprite = {
  rows: ['.hhl.', 'hFFkl', 'hFkfk', 'lkfLk', '.lkk.'],
  colors: { h: 'var(--hi)', F: 'var(--face-hi)', f: 'var(--face)', L: 'var(--face-lo)', l: 'var(--lo)', k: 'var(--ink)' },
};

/** A labelled section of a unit's controls that folds away behind a toggle; the toggle's lamp is `lit`. */
export interface RackFold {
  label: string;
  open: boolean;
  lit: boolean;
  hint: string;
  onToggle(): void;
  children: ReactNode;
}

/**
 * The toggles of some folds, stacked or in a row: each the fold's label in small capitals with an amber lamp that
 * is lit while something in it differs from its default.
 */
export function FoldToggles({ folds, row }: { folds: Omit<RackFold, 'children'>[]; row?: boolean }) {
  return (
    <div className={cx('h-folds', row && 'is-row')}>
      {folds.map((f) => (
        <Button key={f.label} small pressed={f.open} onClick={f.onToggle} hint={f.hint}>
          <Led on={f.lit} color="amber" />
          {f.label}
        </Button>
      ))}
    </div>
  );
}

interface RackUnitProps {
  name: string;
  led?: { on: boolean; onToggle(): void };
  folds?: RackFold[];
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
  onRemove?: () => void;
  children?: ReactNode;
  'data-tour'?: string;
}

/**
 * One module in the rack: an ink nameplate up the left edge, two screws at the right and the controls in a row.
 * A name ending in a part in brackets, "Filter (whole sound)", has that part as a second line on the plate.
 * The lamp has its own column whether or not it is drawn, so the controls start at the same x in every unit.
 * The fold toggles sit at the top of the right edge and each open fold adds a labelled row under the controls.
 * The move buttons are drawn when either move handler is given (null draws it disabled); the remove button when
 * onRemove is given. The buttons sit at the bottom of the right edge, so they line up from unit to unit.
 */
export function RackUnit({
  name, led, folds = [], onMoveUp, onMoveDown, onRemove, children, 'data-tour': tour,
}: RackUnitProps) {
  const moves = onMoveUp !== undefined || onMoveDown !== undefined;
  return (
    <div className="h-rack" role="group" aria-label={name} data-tour={tour}>
      <div className="h-rack-plate">{name.replace(/ \((.*)\)$/, '\n$1')}</div>
      <span className="h-rack-led">
        {led && <Led on={led.on} onClick={led.onToggle} hint={led.on ? 'Click to bypass.' : 'Click to switch on.'} />}
      </span>
      <div className="h-rack-body">
        <div className="h-rack-controls">{children}</div>
        {folds
          .filter((f) => f.open)
          .map((f) => (
            <div key={f.label} className="h-rack-section" role="group" aria-label={f.label}>
              <div className="h-rack-section-label">{f.label}</div>
              <div className="h-rack-controls">{f.children}</div>
            </div>
          ))}
      </div>
      {(folds.length > 0 || moves || onRemove) && (
        <div className="h-rack-side">
          {folds.length > 0 && <FoldToggles folds={folds} />}
          {(moves || onRemove) && (
            <div className="h-rack-buttons">
              {moves && (
                <>
                  <Button square small disabled={!onMoveUp} onClick={() => onMoveUp?.()} hint="Move up in the chain.">
                    <Icon name="up" />
                  </Button>
                  <Button
                    square
                    small
                    disabled={!onMoveDown}
                    onClick={() => onMoveDown?.()}
                    hint="Move down in the chain."
                  >
                    <Icon name="down" />
                  </Button>
                </>
              )}
              {onRemove && (
                <Button square small onClick={onRemove} hint="Remove.">
                  <Icon name="close" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <span className="h-screw is-top">
        <SpriteImage sprite={SCREW} />
      </span>
      <span className="h-screw is-bottom">
        <SpriteImage sprite={SCREW} />
      </span>
    </div>
  );
}

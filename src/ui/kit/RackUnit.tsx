import type { ReactNode } from 'react';
import { Button } from './Button';
import { Led } from './Displays';
import { Icon, SpriteImage } from './Icon';
import type { Sprite } from './icons';

const SCREW: Sprite = {
  rows: ['.hhl.', 'hFFkl', 'hFkfk', 'lkfLk', '.lkk.'],
  colors: { h: 'var(--hi)', F: 'var(--face-hi)', f: 'var(--face)', L: 'var(--face-lo)', l: 'var(--lo)', k: 'var(--ink)' },
};

interface RackUnitProps {
  name: string;
  led?: { on: boolean; onToggle(): void };
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
  onRemove?: () => void;
  children?: ReactNode;
  'data-tour'?: string;
}

/**
 * One module in the rack: an ink nameplate up the left edge, two screws at the right and the controls in a row.
 * The lamp has its own column whether or not it is drawn, so the controls start at the same x in every unit.
 * The move buttons are drawn when either move handler is given (null draws it disabled); the remove button when
 * onRemove is given. The buttons sit at the right edge, so they line up from unit to unit.
 */
export function RackUnit({ name, led, onMoveUp, onMoveDown, onRemove, children, 'data-tour': tour }: RackUnitProps) {
  const moves = onMoveUp !== undefined || onMoveDown !== undefined;
  return (
    <div className="h-rack" role="group" aria-label={name} data-tour={tour}>
      <div className="h-rack-plate">{name}</div>
      <span className="h-rack-led">
        {led && <Led on={led.on} onClick={led.onToggle} hint={led.on ? 'Click to bypass.' : 'Click to switch on.'} />}
      </span>
      <div className="h-rack-controls">{children}</div>
      {(moves || onRemove) && (
        <div className="h-rack-buttons">
          {moves && (
            <>
              <Button square small disabled={!onMoveUp} onClick={() => onMoveUp?.()} hint="Move up in the chain.">
                <Icon name="up" />
              </Button>
              <Button square small disabled={!onMoveDown} onClick={() => onMoveDown?.()} hint="Move down in the chain.">
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
      <span className="h-screw is-top">
        <SpriteImage sprite={SCREW} />
      </span>
      <span className="h-screw is-bottom">
        <SpriteImage sprite={SCREW} />
      </span>
    </div>
  );
}

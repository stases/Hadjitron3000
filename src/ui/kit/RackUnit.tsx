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
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  children?: ReactNode;
}

/**
 * One module in the rack: an ink nameplate up the left edge, two screws at the right and the controls in a row.
 * When any of the move or remove handlers is given, all three buttons are drawn and the missing ones are disabled,
 * so the buttons line up from unit to unit.
 */
export function RackUnit({ name, led, onMoveUp, onMoveDown, onRemove, children }: RackUnitProps) {
  const buttons = onMoveUp || onMoveDown || onRemove;
  return (
    <div className="h-rack" role="group" aria-label={name}>
      <div className="h-rack-plate">{name}</div>
      {led && (
        <span className="h-rack-led">
          <Led on={led.on} onClick={led.onToggle} hint={led.on ? 'Click to bypass.' : 'Click to switch on.'} />
        </span>
      )}
      <div className="h-rack-controls">{children}</div>
      {buttons && (
        <div className="h-rack-buttons">
          <Button square small disabled={!onMoveUp} onClick={() => onMoveUp?.()} hint="Move up in the chain.">
            <Icon name="up" />
          </Button>
          <Button square small disabled={!onMoveDown} onClick={() => onMoveDown?.()} hint="Move down in the chain.">
            <Icon name="down" />
          </Button>
          <Button square small disabled={!onRemove} onClick={() => onRemove?.()} hint="Remove.">
            <Icon name="close" />
          </Button>
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

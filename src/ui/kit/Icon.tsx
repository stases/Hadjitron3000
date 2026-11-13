import { ICONS, type IconName, type Sprite } from './icons';

/** A pixel sprite as an SVG of whole-pixel rectangles, one path per colour. */
export function SpriteImage({ sprite, size }: { sprite: Sprite; size?: number }) {
  const { rows, colors } = sprite;
  const w = rows[0].length;
  const h = rows.length;
  const paths = new Map<string, string>();
  rows.forEach((row, y) => {
    for (let x = 0; x < w; ) {
      const ch = row[x];
      let end = x + 1;
      while (end < w && row[end] === ch) end++;
      if (ch !== '.') paths.set(ch, (paths.get(ch) ?? '') + `M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  const scale = size ? size / w : 1;
  return (
    <svg
      className="h-icon"
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {[...paths].map(([ch, d]) => (
        <path key={ch} d={d} style={{ fill: colors[ch] }} />
      ))}
    </svg>
  );
}

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return <SpriteImage sprite={ICONS[name]} size={size} />;
}

export function ColorChip({ color }: { color: number }) {
  return <i className="h-chip" style={{ background: `var(--c${color})` }} />;
}

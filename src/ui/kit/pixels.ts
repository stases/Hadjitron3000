// Hard-edged drawing on canvases that run at CSS-pixel resolution.

const colors = new Map<string, string>();

/** The value of a colour token such as '--amber', read from the stylesheet once and cached. */
export function tokenColor(name: string): string {
  let c = colors.get(name);
  if (c === undefined) {
    c = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    colors.set(name, c);
  }
  return c;
}

export function fillPixel(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export function fillBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A one-pixel line between two points, without anti-aliasing. */
export function drawLine(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
): void {
  g.fillStyle = color;
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
  }
}

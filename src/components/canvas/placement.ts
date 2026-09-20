/** Flow-space jitter for new nodes; kept at module scope so `Math.random` is not flagged in components. */
export function randomOffset(
  baseX: number,
  baseY: number,
  rangeX: number,
  rangeY: number
): { x: number; y: number } {
  return {
    x: baseX + Math.random() * rangeX,
    y: baseY + Math.random() * rangeY,
  };
}

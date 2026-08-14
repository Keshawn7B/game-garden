export type GraphPoint = { x: number; y: number };

export const GRAPH_MIN = -8;
export const GRAPH_MAX = 8;
export const GRAPH_HIT_RADIUS = 0.42;

export function graphLineY(slope: number, intercept: number, x: number) {
  return slope * x + intercept;
}

export function graphLineDistance(point: GraphPoint, slope: number, intercept: number) {
  return Math.abs(slope * point.x - point.y + intercept) / Math.sqrt(slope * slope + 1);
}

export function graphLineHitsPoint(point: GraphPoint, slope: number, intercept: number, radius = GRAPH_HIT_RADIUS) {
  return graphLineDistance(point, slope, intercept) <= radius;
}

export function snapGraphPoint(x: number, y: number): GraphPoint {
  return {
    x: Math.max(GRAPH_MIN + 1, Math.min(GRAPH_MAX - 1, Math.round(x))),
    y: Math.max(GRAPH_MIN + 1, Math.min(GRAPH_MAX - 1, Math.round(y))),
  };
}

export function graphPlacementAllowed(player: 0 | 1, point: GraphPoint) {
  return player === 0 ? point.x <= -2 : point.x >= 2;
}

export function formatGraphFunction(slope: number, intercept: number) {
  const slopeText = slope === 0 ? "" : slope === 1 ? "x" : slope === -1 ? "−x" : `${slope}x`;
  if (intercept === 0) return `y = ${slopeText || "0"}`;
  if (!slopeText) return `y = ${intercept}`;
  return `y = ${slopeText} ${intercept > 0 ? "+" : "−"} ${Math.abs(intercept)}`;
}

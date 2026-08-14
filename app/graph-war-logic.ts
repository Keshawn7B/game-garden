export type GraphPoint = { x: number; y: number };
export type GraphBotDifficulty = "easy" | "medium" | "hard";

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

export function encodeGraphPoint(point: GraphPoint) {
  return (point.x - GRAPH_MIN) * (GRAPH_MAX - GRAPH_MIN + 1) + (point.y - GRAPH_MIN);
}

export function decodeGraphPoint(value: number): GraphPoint | null {
  const width = GRAPH_MAX - GRAPH_MIN + 1;
  if (!Number.isInteger(value) || value < 0 || value >= width * width) return null;
  return { x: Math.floor(value / width) + GRAPH_MIN, y: value % width + GRAPH_MIN };
}

export function randomGraphBotPoint(random = Math.random): GraphPoint {
  return {
    x: 2 + Math.floor(random() * 6),
    y: -7 + Math.floor(random() * 15),
  };
}

export function chooseGraphBotShot(target: GraphPoint, difficulty: GraphBotDifficulty, random = Math.random, previousShots = 0) {
  const baseAccuracy = { easy: 0.16, medium: 0.42, hard: 0.7 }[difficulty];
  const accuracy = Math.min(0.94, baseAccuracy + previousShots * (difficulty === "hard" ? 0.08 : difficulty === "medium" ? 0.05 : 0.025));
  const sampledSlope = Math.round((-3 + random() * 6) * 4) / 4;
  const slope = Math.abs(target.y - sampledSlope * target.x) <= 12 ? sampledSlope : 0;
  const perfectIntercept = target.y - slope * target.x;
  if (random() < accuracy) return { slope, intercept: Math.round(perfectIntercept * 100) / 100 };
  const direction = random() < 0.5 ? -1 : 1;
  const missMargin = difficulty === "easy" ? 2.2 : difficulty === "medium" ? 1.1 : 0.55;
  const intercept = perfectIntercept + direction * (GRAPH_HIT_RADIUS + missMargin) * Math.sqrt(slope * slope + 1);
  return { slope, intercept: Math.max(-12, Math.min(12, Math.round(intercept * 100) / 100)) };
}

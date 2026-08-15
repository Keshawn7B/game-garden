export type GraphPoint = { x: number; y: number };
export type GraphBotDifficulty = "easy" | "medium" | "hard";
export type GraphFunctionMode = "normal" | "first" | "second";
export type GraphObstacle = GraphPoint & { radius: number };
export type GraphTrajectory = { points: GraphPoint[]; exploded: boolean; hit: boolean };
export type GraphFunctionShot = { player: 0 | 1; mode: GraphFunctionMode; expression: string; angle: number };

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

export function randomGraphBotPoint(random = Math.random, obstacles: GraphObstacle[] = []): GraphPoint {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const point = { x: 2 + Math.floor(random() * 6), y: -7 + Math.floor(random() * 15) };
    if (!obstacles.some((obstacle) => Math.hypot(point.x - obstacle.x, point.y - obstacle.y) <= obstacle.radius + 0.5)) return point;
  }
  return { x: 7, y: 7 };
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

type ExpressionNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: "x" | "y" | "v" }
  | { type: "unary"; operator: 1 | -1; value: ExpressionNode }
  | { type: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: ExpressionNode; right: ExpressionNode }
  | { type: "function"; name: string; args: ExpressionNode[] };

type Token = { type: "number" | "name" | "operator" | "left" | "right" | "comma" | "end"; value: string };

const GRAPH_FUNCTIONS: Record<string, (...values: number[]) => number> = {
  sqrt: Math.sqrt, log: Math.log10, ln: Math.log, abs: Math.abs,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max,
};

function tokenizeGraphExpression(raw: string) {
  const source = raw.toLowerCase().replaceAll("π", "pi").replaceAll("y'", "v").replaceAll("×", "*").replaceAll("·", "*").replaceAll("**", "^");
  if (!source.trim() || source.length > 96) throw new Error("Enter a function up to 96 characters.");
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (/[0-9.]/.test(character)) {
      const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/);
      if (!match) throw new Error("That number is not valid.");
      tokens.push({ type: "number", value: match[0] }); index += match[0].length; continue;
    }
    if (/[a-z]/.test(character)) {
      const match = source.slice(index).match(/^[a-z]+/)!;
      tokens.push({ type: "name", value: match[0] }); index += match[0].length; continue;
    }
    if ("+-*/^".includes(character)) tokens.push({ type: "operator", value: character });
    else if (character === "(") tokens.push({ type: "left", value: character });
    else if (character === ")") tokens.push({ type: "right", value: character });
    else if (character === ",") tokens.push({ type: "comma", value: character });
    else throw new Error(`Unsupported symbol: ${character}`);
    index += 1;
  }
  tokens.push({ type: "end", value: "" });
  return tokens;
}

export function compileGraphExpression(raw: string) {
  const tokens = tokenizeGraphExpression(raw);
  let cursor = 0;
  const current = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const startsPrimary = (token: Token) => token.type === "number" || token.type === "name" || token.type === "left";

  const parsePrimary = (): ExpressionNode => {
    const token = take();
    if (token.type === "number") return { type: "number", value: Number(token.value) };
    if (token.type === "left") {
      const value = parseExpression();
      if (take().type !== "right") throw new Error("Close every parenthesis.");
      return value;
    }
    if (token.type !== "name") throw new Error("Expected a number, variable, or function.");
    if (token.value === "pi") return { type: "number", value: Math.PI };
    if (token.value === "e") return { type: "number", value: Math.E };
    if (token.value === "x" || token.value === "y" || token.value === "v") return { type: "variable", name: token.value };
    if (!GRAPH_FUNCTIONS[token.value]) throw new Error(`Unknown function: ${token.value}`);
    if (take().type !== "left") throw new Error(`${token.value} needs parentheses.`);
    const args: ExpressionNode[] = [];
    if (current().type !== "right") {
      args.push(parseExpression());
      while (current().type === "comma") { take(); args.push(parseExpression()); }
    }
    if (take().type !== "right") throw new Error("Close every function parenthesis.");
    if ((token.value === "min" || token.value === "max") ? args.length < 2 : args.length !== 1) throw new Error(`${token.value} has the wrong number of values.`);
    return { type: "function", name: token.value, args };
  };
  const parsePower = (): ExpressionNode => {
    let left = parsePrimary();
    if (current().type === "operator" && current().value === "^") { take(); left = { type: "binary", operator: "^", left, right: parseUnary() }; }
    return left;
  };
  const parseUnary = (): ExpressionNode => {
    if (current().type === "operator" && (current().value === "+" || current().value === "-")) {
      const operator = take().value === "-" ? -1 : 1;
      return { type: "unary", operator, value: parseUnary() };
    }
    return parsePower();
  };
  const parseTerm = (): ExpressionNode => {
    let left = parseUnary();
    while ((current().type === "operator" && (current().value === "*" || current().value === "/")) || startsPrimary(current())) {
      const implicit = startsPrimary(current());
      const operator = implicit ? "*" : take().value as "*" | "/";
      left = { type: "binary", operator, left, right: parseUnary() };
    }
    return left;
  };
  const parseExpression = (): ExpressionNode => {
    let left = parseTerm();
    while (current().type === "operator" && (current().value === "+" || current().value === "-")) {
      const operator = take().value as "+" | "-";
      left = { type: "binary", operator, left, right: parseTerm() };
    }
    return left;
  };
  const tree = parseExpression();
  if (current().type !== "end") throw new Error("Check the function syntax.");

  const evaluate = (node: ExpressionNode, variables: { x: number; y: number; v: number }): number => {
    let result: number;
    if (node.type === "number") result = node.value;
    else if (node.type === "variable") result = variables[node.name];
    else if (node.type === "unary") result = node.operator * evaluate(node.value, variables);
    else if (node.type === "function") result = GRAPH_FUNCTIONS[node.name](...node.args.map((arg) => evaluate(arg, variables)));
    else {
      const left = evaluate(node.left, variables); const right = evaluate(node.right, variables);
      result = node.operator === "+" ? left + right : node.operator === "-" ? left - right : node.operator === "*" ? left * right : node.operator === "/" ? left / right : left ** right;
    }
    if (!Number.isFinite(result) || Math.abs(result) > 1_000_000) throw new Error("The function exploded.");
    return result;
  };
  return (variables: { x: number; y?: number; v?: number }) => evaluate(tree, { x: variables.x, y: variables.y ?? 0, v: variables.v ?? 0 });
}

function pointDistance(left: GraphPoint, right: GraphPoint) { return Math.hypot(left.x - right.x, left.y - right.y); }

export function traceGraphFunction(shot: GraphFunctionShot, origin: GraphPoint, target?: GraphPoint | null, obstacles: GraphObstacle[] = []): GraphTrajectory {
  let evaluate: ReturnType<typeof compileGraphExpression>;
  try { evaluate = compileGraphExpression(shot.expression); } catch { return { points: [origin], exploded: true, hit: false }; }
  const direction = shot.player === 0 ? 1 : -1;
  const dx = direction * 0.06;
  const points: GraphPoint[] = [origin];
  let y = origin.y;
  let velocity = Math.tan(shot.angle * Math.PI / 180);
  let offset = 0;
  try { if (shot.mode === "normal") offset = origin.y - evaluate({ x: origin.x, y, v: velocity }); }
  catch { return { points, exploded: true, hit: false }; }
  for (let step = 1; step <= 270; step += 1) {
    const x = origin.x + dx * step;
    try {
      if (shot.mode === "normal") y = evaluate({ x, y, v: velocity }) + offset;
      else if (shot.mode === "first") y += evaluate({ x: x - dx, y, v: velocity }) * dx;
      else { velocity += evaluate({ x: x - dx, y, v: velocity }) * dx; y += velocity * dx; }
    } catch { return { points, exploded: true, hit: false }; }
    const point = { x, y };
    if (x < GRAPH_MIN || x > GRAPH_MAX || y < GRAPH_MIN || y > GRAPH_MAX) return { points, exploded: false, hit: false };
    points.push(point);
    if (obstacles.some((obstacle) => pointDistance(point, obstacle) <= obstacle.radius)) return { points, exploded: true, hit: false };
    if (target && pointDistance(point, target) <= GRAPH_HIT_RADIUS) return { points, exploded: false, hit: true };
  }
  return { points, exploded: false, hit: false };
}

export function graphObstaclesForSeed(seed: string): GraphObstacle[] {
  let hash = 2166136261;
  for (const character of seed) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const random = () => { hash = Math.imul(hash ^ (hash >>> 15), 2246822519); return ((hash >>> 0) % 10000) / 10000; };
  return [-1.1, 0, 1.1].map((x) => ({ x: x + (random() - 0.5) * 0.5, y: -4.5 + random() * 9, radius: 0.5 + random() * 0.2 }));
}

type GraphBotCandidate = { centeredShot: Omit<GraphFunctionShot, "player">; withOffset: (offset: number) => Omit<GraphFunctionShot, "player"> };
const GRAPH_BOT_RANGES = {
  easy: { initialSteps: 10, decay: 0.7 },
  medium: { initialSteps: 5, decay: 0.58 },
  hard: { initialSteps: 2, decay: 0.45 },
} as const;

function graphNumber(value: number) { return String(Math.round(value * 1000) / 1000); }
export function graphBotRangeSteps(difficulty: GraphBotDifficulty, previousShots: number) {
  const range = GRAPH_BOT_RANGES[difficulty];
  return Math.max(0, Math.round(range.initialSteps * range.decay ** previousShots));
}

function graphBotCandidates(origin: GraphPoint, target: GraphPoint): GraphBotCandidate[] {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const candidates: GraphBotCandidate[] = [];
  const normalCurve = (curveExpression: string, curveDelta: number) => {
    const centeredSlope = (dy - curveDelta) / dx;
    const make = (offset: number) => ({ mode: "normal" as const, expression: `${graphNumber(centeredSlope + offset)}x${curveExpression}`, angle: 0 });
    candidates.push({ centeredShot: make(0), withOffset: make });
  };
  normalCurve("", 0);
  for (const curve of [-0.14, -0.08, 0.08, 0.14]) normalCurve(`${curve < 0 ? " - " : " + "}${graphNumber(Math.abs(curve))}x^2`, curve * (target.x ** 2 - origin.x ** 2));
  for (const amplitude of [-3, -1.8, 1.8, 3]) {
    const frequency = 0.55;
    normalCurve(`${amplitude < 0 ? " - " : " + "}${graphNumber(Math.abs(amplitude))}sin(${frequency}x)`, amplitude * (Math.sin(frequency * target.x) - Math.sin(frequency * origin.x)));
  }
  for (const amplitude of [-2.4, 2.4]) {
    const frequency = 0.45;
    normalCurve(`${amplitude < 0 ? " - " : " + "}${graphNumber(Math.abs(amplitude))}cos(${frequency}x)`, amplitude * (Math.cos(frequency * target.x) - Math.cos(frequency * origin.x)));
  }
  for (const amplitude of [-1.8, 1.8]) {
    const frequency = 0.5;
    const centeredSlope = (dy - (amplitude / frequency) * (Math.sin(frequency * target.x) - Math.sin(frequency * origin.x))) / dx;
    const make = (offset: number) => ({ mode: "first" as const, expression: `${graphNumber(centeredSlope + offset)}${amplitude < 0 ? " - " : " + "}${graphNumber(Math.abs(amplitude))}cos(${frequency}x)`, angle: 0 });
    candidates.push({ centeredShot: make(0), withOffset: make });
  }
  for (const acceleration of [-0.16, -0.08, 0.08, 0.16]) {
    const centeredVelocity = (dy - 0.5 * acceleration * dx ** 2) / dx;
    const make = (offset: number) => ({ mode: "second" as const, expression: graphNumber(acceleration), angle: Math.atan(centeredVelocity + offset) * 180 / Math.PI });
    candidates.push({ centeredShot: make(0), withOffset: make });
  }
  return candidates;
}

export function chooseGraphBotFunction(origin: GraphPoint, target: GraphPoint, difficulty: GraphBotDifficulty, random = Math.random, previousShots = 0, obstacles: GraphObstacle[] = []): Omit<GraphFunctionShot, "player"> {
  const player: 0 | 1 = origin.x < target.x ? 0 : 1;
  const rankedCandidates = graphBotCandidates(origin, target).map((candidate) => {
    const shot = { player, ...candidate.centeredShot };
    const result = traceGraphFunction(shot, origin, target, obstacles);
    const clearance = obstacles.length && result.points.length
      ? Math.min(...result.points.flatMap((point) => obstacles.map((obstacle) => pointDistance(point, obstacle) - obstacle.radius)))
      : 4;
    const closest = result.points.length ? Math.min(...result.points.map((point) => pointDistance(point, target))) : 99;
    return { candidate, safe: result.hit && !result.exploded, score: (result.hit ? 100 : 0) - (result.exploded ? 100 : 0) + Math.min(clearance, 4) - closest };
  }).sort((left, right) => right.score - left.score);
  const safeCandidates = rankedCandidates.filter((item) => item.safe);
  const candidatePool = (safeCandidates.length ? safeCandidates : rankedCandidates).slice(0, difficulty === "easy" ? 3 : difficulty === "medium" ? 6 : 9);
  const selected = candidatePool[Math.min(candidatePool.length - 1, Math.floor(random() * candidatePool.length))].candidate;
  const rangeSteps = graphBotRangeSteps(difficulty, previousShots);
  const offsetSteps = rangeSteps ? Math.floor(random() * (rangeSteps * 2 + 1)) - rangeSteps : 0;
  return selected.withOffset(offsetSteps * 0.08);
}

export function encodeGraphFunctionShot(shot: GraphFunctionShot) { return `${shot.player}~${shot.mode}~${Math.round(shot.angle * 10) / 10}~${encodeURIComponent(shot.expression)}`; }
export function decodeGraphFunctionShot(value: unknown): GraphFunctionShot | null {
  if (typeof value !== "string") return null;
  const [playerText, mode, angleText, expression] = value.split("~");
  const player = Number(playerText); const angle = Number(angleText);
  if ((player !== 0 && player !== 1) || (mode !== "normal" && mode !== "first" && mode !== "second") || !Number.isFinite(angle) || !expression) return null;
  try { return { player, mode, angle, expression: decodeURIComponent(expression) }; } catch { return null; }
}

export function graphModeLabel(mode: GraphFunctionMode) { return mode === "normal" ? "y" : mode === "first" ? "y′" : "y″"; }

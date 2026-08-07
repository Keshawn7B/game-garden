export type AirHockeyPoint = { x: number; y: number };
export type AirHockeyDifficulty = "easy" | "normal" | "hard";
export type AirHockeyPlayer = 0 | 1;
export type AirHockeyBody = AirHockeyPoint & { vx: number; vy: number };

export const AIR_HOCKEY_WIN_SCORE = 3;
export const AIR_HOCKEY_MATCH_SECONDS = 120;
export const AIR_HOCKEY_CENTER: AirHockeyPoint = { x: 50, y: 75 };
export const AIR_HOCKEY_LIVE_START: AirHockeyBody = { ...AIR_HOCKEY_CENTER, vx: 16, vy: 28 };

const AIR_HOCKEY_PUCK_SPEED_CAPS: Record<AirHockeyDifficulty, number> = {
  easy: 60,
  normal: 78,
  hard: 98,
};

const AIR_HOCKEY_CPU_SETTINGS: Record<AirHockeyDifficulty, { speed: number; predictionSeconds: number; homeTracking: number }> = {
  easy: { speed: 29, predictionSeconds: 0.4, homeTracking: 0.16 },
  normal: { speed: 45, predictionSeconds: 0.75, homeTracking: 0.28 },
  hard: { speed: 62, predictionSeconds: 1.1, homeTracking: 0.4 },
};

export type AirHockeyShot = {
  trajectory: AirHockeyPoint[];
  final: AirHockeyPoint;
  goal: AirHockeyPlayer | null;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function airHockeyPuckSpeedCap(difficulty: AirHockeyDifficulty) {
  return AIR_HOCKEY_PUCK_SPEED_CAPS[difficulty];
}

function limitAirHockeyVelocity(vx: number, vy: number, maximum: number) {
  const speed = Math.hypot(vx, vy);
  if (speed <= maximum || speed < 0.001) return { vx, vy };
  return { vx: vx / speed * maximum, vy: vy / speed * maximum };
}

function reflectAirHockeyX(value: number) {
  const span = 90;
  const cycle = span * 2;
  const offset = ((value - 5) % cycle + cycle) % cycle;
  return offset <= span ? 5 + offset : 95 - (offset - span);
}

function predictAirHockeyX(puck: AirHockeyBody, targetY: number, predictionSeconds: number) {
  const crossingSeconds = Math.abs(puck.vy) < 0.5 ? predictionSeconds * 0.35 : (targetY - puck.y) / puck.vy;
  const travelSeconds = clamp(crossingSeconds, 0, predictionSeconds);
  return clamp(reflectAirHockeyX(puck.x + puck.vx * travelSeconds), 12, 88);
}

export function stepAirHockeyLive(puck: AirHockeyBody, mallets: [AirHockeyPoint, AirHockeyPoint], malletVelocities: [AirHockeyPoint, AirHockeyPoint], elapsedMs: number, difficulty: AirHockeyDifficulty = "normal") {
  const elapsed = clamp(elapsedMs, 0, 34) / 1000;
  const maximumPuckSpeed = airHockeyPuckSpeedCap(difficulty);
  const boundedPuckVelocity = limitAirHockeyVelocity(puck.vx, puck.vy, maximumPuckSpeed);
  let vx = boundedPuckVelocity.vx;
  let vy = boundedPuckVelocity.vy;
  let x = puck.x + vx * elapsed;
  let y = puck.y + vy * elapsed;
  let goal: AirHockeyPlayer | null = null;

  if (x < 5) { x = 5 + (5 - x); vx = Math.abs(vx) * 0.94; }
  if (x > 95) { x = 95 - (x - 95); vx = -Math.abs(vx) * 0.94; }

  const inGoal = x >= 34 && x <= 66;
  if (y < 5 && inGoal) goal = 0;
  else if (y > 145 && inGoal) goal = 1;
  else {
    if (y < 5) { y = 5 + (5 - y); vy = Math.abs(vy) * 0.94; }
    if (y > 145) { y = 145 - (y - 145); vy = -Math.abs(vy) * 0.94; }
  }

  if (goal == null) {
    for (let player = 0; player < 2; player += 1) {
      const mallet = mallets[player];
      const malletVelocity = malletVelocities[player];
      const dx = x - mallet.x;
      const dy = y - mallet.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      if (distance > 12.5) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const closingSpeed = (malletVelocity.x - vx) * nx + (malletVelocity.y - vy) * ny;
      if (closingSpeed < -2 && distance > 11.7) continue;
      x = mallet.x + nx * 12.6;
      y = mallet.y + ny * 12.6;
      const malletSpeed = Math.hypot(malletVelocity.x, malletVelocity.y);
      const incomingSpeed = Math.hypot(vx, vy);
      const impact = clamp(22 + incomingSpeed * 0.32 + Math.max(0, closingSpeed) * 0.58 + malletSpeed * 0.22, 24, maximumPuckSpeed);
      const hitVelocity = limitAirHockeyVelocity(
        nx * impact + malletVelocity.x * 0.22,
        ny * impact + malletVelocity.y * 0.22,
        maximumPuckSpeed,
      );
      vx = hitVelocity.vx;
      vy = hitVelocity.vy;
    }

    const drag = Math.pow(0.996, elapsed * 60);
    vx *= drag;
    vy *= drag;
    const speed = Math.hypot(vx, vy);
    if (speed < 9) {
      if (speed < 0.1) { vx = 5.2; vy = 7.4; }
      else { vx = vx / speed * 9; vy = vy / speed * 9; }
    }
    const cappedVelocity = limitAirHockeyVelocity(vx, vy, maximumPuckSpeed);
    vx = cappedVelocity.vx;
    vy = cappedVelocity.vy;
  }

  return { puck: goal == null ? { x, y, vx, vy } : { ...AIR_HOCKEY_LIVE_START }, goal };
}

export function moveAirHockeyCpu(mallet: AirHockeyPoint, puck: AirHockeyBody, difficulty: AirHockeyDifficulty, elapsedMs: number) {
  const settings = AIR_HOCKEY_CPU_SETTINGS[difficulty];
  const home = { x: 50, y: 27 };
  const puckInCorner = puck.y < 36 && (puck.x < 20 || puck.x > 80);
  const puckOnCpuSide = puck.y <= 74;
  const puckApproaching = puck.vy < -2;
  let target: AirHockeyPoint;
  if (puckInCorner) {
    target = { x: puck.x < 50 ? 30 : 70, y: 38 };
  } else if (puckOnCpuSide) {
    target = {
      x: predictAirHockeyX(puck, clamp(puck.y - 11, 15, 61), settings.predictionSeconds * 0.45),
      y: clamp(puck.y - 11, 14, 66),
    };
  } else if (puckApproaching) {
    target = {
      x: predictAirHockeyX(puck, 34, settings.predictionSeconds),
      y: 31,
    };
  } else {
    target = {
      x: clamp(home.x + (puck.x - home.x) * settings.homeTracking, 37, 63),
      y: home.y,
    };
  }
  const dx = target.x - mallet.x;
  const dy = target.y - mallet.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.01) return { ...mallet };
  const movement = Math.min(distance, settings.speed * clamp(elapsedMs, 0, 50) / 1000);
  return {
    x: clamp(mallet.x + dx / distance * movement, 8, 92),
    y: clamp(mallet.y + dy / distance * movement, 12, 67),
  };
}

export function airHockeyVelocityFromMallet(previous: AirHockeyPoint, current: AirHockeyPoint, elapsedMs = 16) {
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.2) return null;
  const timing = clamp(20 / Math.max(8, elapsedMs), 0.55, 1.8);
  const speed = clamp(distance * timing * 0.9, 1.55, 5.7);
  return { x: dx / distance * speed, y: dy / distance * speed };
}

export function simulateAirHockeyShot(puck: AirHockeyPoint, velocity: AirHockeyPoint): AirHockeyShot {
  let x = clamp(puck.x, 6, 94);
  let y = clamp(puck.y, 6, 144);
  let vx = clamp(velocity.x, -6, 6);
  let vy = clamp(velocity.y, -6, 6);
  const trajectory: AirHockeyPoint[] = [{ x, y }];
  let goal: AirHockeyPlayer | null = null;

  for (let step = 0; step < 180 && Math.hypot(vx, vy) > 0.12; step += 1) {
    x += vx;
    y += vy;
    if (x < 5) { x = 5 + (5 - x); vx = Math.abs(vx) * 0.94; }
    if (x > 95) { x = 95 - (x - 95); vx = -Math.abs(vx) * 0.94; }

    const inGoal = x >= 34 && x <= 66;
    if (y < 5 && inGoal) { y = 0; goal = 0; trajectory.push({ x, y }); break; }
    if (y > 145 && inGoal) { y = 150; goal = 1; trajectory.push({ x, y }); break; }
    if (y < 5) { y = 5 + (5 - y); vy = Math.abs(vy) * 0.94; }
    if (y > 145) { y = 145 - (y - 145); vy = -Math.abs(vy) * 0.94; }

    vx *= 0.974;
    vy *= 0.974;
    if (step % 2 === 0) trajectory.push({ x, y });
  }
  const final = goal == null ? { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : { ...AIR_HOCKEY_CENTER };
  return { trajectory, final, goal };
}

export function chooseAirHockeyCpuVelocity(puck: AirHockeyPoint, difficulty: AirHockeyDifficulty, random = Math.random) {
  const settings = difficulty === "easy" ? { noise: 28, power: 3.2 } : difficulty === "normal" ? { noise: 14, power: 4.15 } : { noise: 5, power: 5.05 };
  const targetX = 50 + (random() - 0.5) * settings.noise;
  const targetY = 150;
  const dx = targetX - puck.x;
  const dy = targetY - puck.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  return { x: dx / distance * settings.power, y: dy / distance * settings.power };
}

export function encodeAirHockeyTrajectory(points: AirHockeyPoint[]) {
  return points.slice(0, 92).flatMap((point) => [Math.round(point.x * 10), Math.round(point.y * 10)]);
}

export function decodeAirHockeyTrajectory(values: number[]) {
  const points: AirHockeyPoint[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index] / 10, y: values[index + 1] / 10 });
  return points;
}

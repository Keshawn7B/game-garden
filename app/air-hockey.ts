export type AirHockeyPoint = { x: number; y: number };
export type AirHockeyDifficulty = "easy" | "normal" | "hard";
export type AirHockeyPlayer = 0 | 1;
export type AirHockeyBody = AirHockeyPoint & { vx: number; vy: number };

export const AIR_HOCKEY_WIN_SCORE = 5;
export const AIR_HOCKEY_CENTER: AirHockeyPoint = { x: 50, y: 75 };
export const AIR_HOCKEY_LIVE_START: AirHockeyBody = { ...AIR_HOCKEY_CENTER, vx: 0, vy: 0 };

export type AirHockeyShot = {
  trajectory: AirHockeyPoint[];
  final: AirHockeyPoint;
  goal: AirHockeyPlayer | null;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function stepAirHockeyLive(puck: AirHockeyBody, mallets: [AirHockeyPoint, AirHockeyPoint], malletVelocities: [AirHockeyPoint, AirHockeyPoint], elapsedMs: number) {
  const elapsed = clamp(elapsedMs, 0, 34) / 1000;
  let x = puck.x + puck.vx * elapsed;
  let y = puck.y + puck.vy * elapsed;
  let vx = puck.vx;
  let vy = puck.vy;
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
      const impact = clamp(Math.max(25, closingSpeed * 1.45 + malletSpeed * 0.5), 25, 82);
      vx = clamp(nx * impact + malletVelocity.x * 0.32, -82, 82);
      vy = clamp(ny * impact + malletVelocity.y * 0.32, -82, 82);
    }

    const drag = Math.pow(0.992, elapsed * 60);
    vx *= drag;
    vy *= drag;
    if (Math.hypot(vx, vy) < 0.7) { vx = 0; vy = 0; }
  }

  return { puck: goal == null ? { x, y, vx, vy } : { ...AIR_HOCKEY_LIVE_START }, goal };
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

export type AirHockeyPoint = { x: number; y: number };
export type AirHockeyDifficulty = "easy" | "normal" | "hard";
export type AirHockeyPlayer = 0 | 1;

export const AIR_HOCKEY_WIN_SCORE = 5;
export const AIR_HOCKEY_CENTER: AirHockeyPoint = { x: 50, y: 75 };

export type AirHockeyShot = {
  trajectory: AirHockeyPoint[];
  final: AirHockeyPoint;
  goal: AirHockeyPlayer | null;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function airHockeyVelocityFromPull(puck: AirHockeyPoint, pull: AirHockeyPoint) {
  const dx = puck.x - pull.x;
  const dy = puck.y - pull.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 3) return null;
  const speed = clamp(distance * 0.13, 1.7, 5.7);
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

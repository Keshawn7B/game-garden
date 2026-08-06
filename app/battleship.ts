export type BattleshipDifficulty = "easy" | "normal" | "hard";
export type BattleshipOrientation = "h" | "v";

export const BATTLESHIP_SIZE = 10;
export const BATTLESHIP_SHIPS = [
  { id: "carrier", name: "Carrier", size: 5 },
  { id: "battleship", name: "Battleship", size: 4 },
  { id: "cruiser", name: "Cruiser", size: 3 },
  { id: "submarine", name: "Submarine", size: 3 },
  { id: "destroyer", name: "Destroyer", size: 2 },
] as const;

export type BattleshipFleet = number[][];

export function battleshipCells(start: number, size: number, orientation: BattleshipOrientation) {
  const row = Math.floor(start / BATTLESHIP_SIZE);
  const column = start % BATTLESHIP_SIZE;
  if (orientation === "h" && column + size > BATTLESHIP_SIZE) return null;
  if (orientation === "v" && row + size > BATTLESHIP_SIZE) return null;
  return Array.from({ length: size }, (_, offset) => start + (orientation === "h" ? offset : offset * BATTLESHIP_SIZE));
}

export function canPlaceBattleship(fleet: BattleshipFleet, shipIndex: number, cells: number[]) {
  const occupied = new Set(fleet.flatMap((ship, index) => index === shipIndex ? [] : ship));
  return cells.every((cell) => cell >= 0 && cell < BATTLESHIP_SIZE * BATTLESHIP_SIZE && !occupied.has(cell));
}

export function placeBattleship(fleet: BattleshipFleet, shipIndex: number, start: number, orientation: BattleshipOrientation) {
  const ship = BATTLESHIP_SHIPS[shipIndex];
  const cells = ship ? battleshipCells(start, ship.size, orientation) : null;
  if (!cells || !canPlaceBattleship(fleet, shipIndex, cells)) return null;
  const next = fleet.map((current) => [...current]);
  next[shipIndex] = cells;
  return next;
}

export function randomBattleshipFleet(random = Math.random): BattleshipFleet {
  const fleet: BattleshipFleet = BATTLESHIP_SHIPS.map(() => []);
  BATTLESHIP_SHIPS.forEach((ship, shipIndex) => {
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      const orientation: BattleshipOrientation = random() < .5 ? "h" : "v";
      const start = Math.floor(random() * BATTLESHIP_SIZE * BATTLESHIP_SIZE);
      const placed = placeBattleship(fleet, shipIndex, start, orientation);
      if (placed) {
        fleet[shipIndex] = placed[shipIndex];
        return;
      }
    }
    throw new Error(`Could not place ${ship.name}.`);
  });
  return fleet;
}

export function validBattleshipFleet(fleet: BattleshipFleet) {
  if (fleet.length !== BATTLESHIP_SHIPS.length) return false;
  const occupied = new Set<number>();
  return fleet.every((cells, shipIndex) => {
    const size = BATTLESHIP_SHIPS[shipIndex].size;
    if (cells.length !== size || cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= 100 || occupied.has(cell))) return false;
    const rows = cells.map((cell) => Math.floor(cell / BATTLESHIP_SIZE));
    const columns = cells.map((cell) => cell % BATTLESHIP_SIZE);
    const straight = rows.every((row) => row === rows[0]) || columns.every((column) => column === columns[0]);
    const sorted = [...cells].sort((left, right) => left - right);
    const step = rows.every((row) => row === rows[0]) ? 1 : BATTLESHIP_SIZE;
    const contiguous = sorted.every((cell, index) => index === 0 || cell - sorted[index - 1] === step);
    if (!straight || !contiguous) return false;
    cells.forEach((cell) => occupied.add(cell));
    return true;
  });
}

export function encodeBattleshipFleet(fleet: BattleshipFleet) {
  return fleet.map((cells, index) => `${BATTLESHIP_SHIPS[index].id}:${cells.join(",")}`);
}

export function decodeBattleshipFleet(encoded: string[]): BattleshipFleet {
  if (!Array.isArray(encoded)) return BATTLESHIP_SHIPS.map(() => []);
  return BATTLESHIP_SHIPS.map((ship) => {
    const entry = encoded.find((value) => value.startsWith(`${ship.id}:`));
    return entry ? entry.slice(entry.indexOf(":") + 1).split(",").filter(Boolean).map(Number) : [];
  });
}

export function battleshipShipAt(fleet: BattleshipFleet, cell: number) {
  return fleet.findIndex((ship) => ship.includes(cell));
}

export function battleshipShipSunk(ship: number[], shots: number[]) {
  return ship.length > 0 && ship.every((cell) => shots.includes(cell));
}

export function battleshipFleetDefeated(fleet: BattleshipFleet, shots: number[]) {
  return validBattleshipFleet(fleet) && fleet.every((ship) => battleshipShipSunk(ship, shots));
}

function availableCells(shots: number[]) {
  const used = new Set(shots);
  return Array.from({ length: BATTLESHIP_SIZE * BATTLESHIP_SIZE }, (_, index) => index).filter((index) => !used.has(index));
}

function neighbors(cell: number) {
  const row = Math.floor(cell / BATTLESHIP_SIZE);
  const column = cell % BATTLESHIP_SIZE;
  return [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]
    .filter(([nextRow, nextColumn]) => nextRow >= 0 && nextRow < BATTLESHIP_SIZE && nextColumn >= 0 && nextColumn < BATTLESHIP_SIZE)
    .map(([nextRow, nextColumn]) => nextRow * BATTLESHIP_SIZE + nextColumn);
}

export function chooseBattleshipCpuShot(shots: number[], targetFleet: BattleshipFleet, difficulty: BattleshipDifficulty, random = Math.random) {
  const available = availableCells(shots);
  if (!available.length) return null;
  if (difficulty === "easy") return available[Math.floor(random() * available.length)];

  const hitCells = shots.filter((cell) => battleshipShipAt(targetFleet, cell) >= 0);
  const unresolvedHits = hitCells.filter((cell) => {
    const ship = targetFleet[battleshipShipAt(targetFleet, cell)];
    return ship && !battleshipShipSunk(ship, shots);
  });
  const targets = [...new Set(unresolvedHits.flatMap(neighbors))].filter((cell) => available.includes(cell));
  if (targets.length && (difficulty === "hard" || random() < .78)) return targets[Math.floor(random() * targets.length)];

  if (difficulty === "normal") return available[Math.floor(random() * available.length)];

  const remainingSizes = targetFleet.filter((ship) => !battleshipShipSunk(ship, shots)).map((ship) => ship.length);
  const scores = new Map(available.map((cell) => [cell, 0]));
  for (const size of remainingSizes) for (const orientation of ["h", "v"] as BattleshipOrientation[]) for (let start = 0; start < 100; start += 1) {
    const cells = battleshipCells(start, size, orientation);
    if (!cells || cells.some((cell) => shots.includes(cell) && !hitCells.includes(cell))) continue;
    if (unresolvedHits.length && !unresolvedHits.every((hit) => cells.includes(hit))) continue;
    cells.forEach((cell) => { if (scores.has(cell)) scores.set(cell, (scores.get(cell) ?? 0) + 1); });
  }
  const best = Math.max(...scores.values());
  const bestCells = available.filter((cell) => scores.get(cell) === best && ((Math.floor(cell / 10) + cell % 10) % 2 === 0 || best <= 0));
  const pool = bestCells.length ? bestCells : available;
  return pool[Math.floor(random() * pool.length)];
}

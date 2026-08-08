export const GAME_2048_SIZE = 4;
export const GAME_2048_TARGET = 2048;

export type Game2048Direction = "left" | "right" | "up" | "down";

export type Game2048Move = {
  board: number[];
  gained: number;
  moved: boolean;
};

export type Game2048TileMovement = {
  from: number;
  to: number;
  merged: boolean;
};

function collapseLine(line: number[]) {
  const values = line.filter(Boolean);
  const collapsed: number[] = [];
  let gained = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === values[index + 1]) {
      const merged = value * 2;
      collapsed.push(merged);
      gained += merged;
      index += 1;
    } else {
      collapsed.push(value);
    }
  }

  while (collapsed.length < GAME_2048_SIZE) collapsed.push(0);
  return { line: collapsed, gained };
}

function lineIndices(direction: Game2048Direction, line: number) {
  const forward = Array.from({ length: GAME_2048_SIZE }, (_, index) => index);
  const order = direction === "right" || direction === "down" ? forward.reverse() : forward;
  return order.map((offset) => direction === "left" || direction === "right"
    ? line * GAME_2048_SIZE + offset
    : offset * GAME_2048_SIZE + line);
}

export function move2048Board(board: number[], direction: Game2048Direction): Game2048Move {
  if (board.length !== GAME_2048_SIZE ** 2) throw new Error("A 2048 board must contain sixteen cells.");
  const next = [...board];
  let gained = 0;

  for (let line = 0; line < GAME_2048_SIZE; line += 1) {
    const indices = lineIndices(direction, line);
    const collapsed = collapseLine(indices.map((index) => board[index]));
    gained += collapsed.gained;
    indices.forEach((boardIndex, index) => { next[boardIndex] = collapsed.line[index]; });
  }

  return { board: next, gained, moved: next.some((value, index) => value !== board[index]) };
}

export function trace2048Move(board: number[], direction: Game2048Direction): Game2048TileMovement[] {
  if (board.length !== GAME_2048_SIZE ** 2) throw new Error("A 2048 board must contain sixteen cells.");
  const movements: Game2048TileMovement[] = [];

  for (let line = 0; line < GAME_2048_SIZE; line += 1) {
    const indices = lineIndices(direction, line);
    const tiles = indices.flatMap((index) => board[index] ? [{ index, value: board[index] }] : []);
    let destination = 0;

    for (let tile = 0; tile < tiles.length; tile += 1) {
      const merges = tiles[tile].value === tiles[tile + 1]?.value;
      movements.push({ from: tiles[tile].index, to: indices[destination], merged: merges });
      if (merges) {
        movements.push({ from: tiles[tile + 1].index, to: indices[destination], merged: true });
        tile += 1;
      }
      destination += 1;
    }
  }

  return movements;
}

export function addRandom2048Tile(board: number[], random: () => number = Math.random) {
  const openCells = board.flatMap((value, index) => value === 0 ? [index] : []);
  if (openCells.length === 0) return [...board];
  const slot = openCells[Math.min(openCells.length - 1, Math.floor(random() * openCells.length))];
  const next = [...board];
  next[slot] = random() < 0.9 ? 2 : 4;
  return next;
}

export function create2048Board(random: () => number = Math.random) {
  const empty = Array<number>(GAME_2048_SIZE ** 2).fill(0);
  return addRandom2048Tile(addRandom2048Tile(empty, random), random);
}

export function canMove2048(board: number[]) {
  if (board.some((value) => value === 0)) return true;
  for (let row = 0; row < GAME_2048_SIZE; row += 1) {
    for (let column = 0; column < GAME_2048_SIZE; column += 1) {
      const index = row * GAME_2048_SIZE + column;
      if (column < GAME_2048_SIZE - 1 && board[index] === board[index + 1]) return true;
      if (row < GAME_2048_SIZE - 1 && board[index] === board[index + GAME_2048_SIZE]) return true;
    }
  }
  return false;
}

export type QueensCellState = 0 | 1 | 2;

export type QueensPuzzle = {
  id: string;
  title: string;
  regions: number[][];
  solution: number[];
};

const BASE_REGIONS = [
  [2, 2, 2, 2, 2, 0, 0],
  [2, 2, 2, 1, 1, 1, 0],
  [4, 4, 2, 2, 3, 3, 3],
  [4, 5, 5, 2, 3, 3, 3],
  [4, 4, 5, 5, 3, 5, 3],
  [4, 4, 6, 5, 5, 5, 3],
  [4, 6, 6, 5, 5, 5, 3],
];

const BASE_SOLUTION = [6, 4, 2, 5, 0, 3, 1];

function transformedPuzzle(id: string, title: string, transform: (row: number, column: number, size: number) => [number, number]): QueensPuzzle {
  const size = BASE_REGIONS.length;
  const regions = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const solution = Array<number>(size).fill(0);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const [nextRow, nextColumn] = transform(row, column, size);
      regions[nextRow][nextColumn] = BASE_REGIONS[row][column];
    }
    const [nextRow, nextColumn] = transform(row, BASE_SOLUTION[row], size);
    solution[nextRow] = nextColumn;
  }

  return { id, title, regions, solution };
}

export const QUEENS_PUZZLES: QueensPuzzle[] = [
  transformedPuzzle("crane", "Crane Court", (row, column) => [row, column]),
  transformedPuzzle("moon", "Moon Palace", (row, column, size) => [column, size - 1 - row]),
  transformedPuzzle("koi", "Koi Garden", (row, column, size) => [size - 1 - row, size - 1 - column]),
  transformedPuzzle("sakura", "Sakura Hall", (row, column) => [column, row]),
];

export function queensConflictCells(regions: number[][], cells: QueensCellState[]) {
  const size = regions.length;
  const queens = cells.flatMap((state, index) => state === 2 ? [index] : []);
  const conflicts = new Set<number>();

  for (let left = 0; left < queens.length; left += 1) {
    const leftIndex = queens[left];
    const leftRow = Math.floor(leftIndex / size);
    const leftColumn = leftIndex % size;
    for (let right = left + 1; right < queens.length; right += 1) {
      const rightIndex = queens[right];
      const rightRow = Math.floor(rightIndex / size);
      const rightColumn = rightIndex % size;
      const sameRow = leftRow === rightRow;
      const sameColumn = leftColumn === rightColumn;
      const sameRegion = regions[leftRow][leftColumn] === regions[rightRow][rightColumn];
      const touching = Math.abs(leftRow - rightRow) <= 1 && Math.abs(leftColumn - rightColumn) <= 1;
      if (sameRow || sameColumn || sameRegion || touching) {
        conflicts.add(leftIndex);
        conflicts.add(rightIndex);
      }
    }
  }

  return [...conflicts].sort((left, right) => left - right);
}

export function isQueensSolved(regions: number[][], cells: QueensCellState[]) {
  const size = regions.length;
  const queens = cells.flatMap((state, index) => state === 2 ? [index] : []);
  if (queens.length !== size || queensConflictCells(regions, cells).length) return false;
  return new Set(queens.map((index) => regions[Math.floor(index / size)][index % size])).size === size;
}

export function queensSolutionCells(puzzle: QueensPuzzle) {
  return puzzle.solution.map((column, row) => row * puzzle.regions.length + column);
}

export function cycleQueensCell(state: QueensCellState): QueensCellState {
  return state === 0 ? 1 : state === 1 ? 2 : 0;
}

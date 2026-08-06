export type DotsBoxesPlayer = 0 | 1;
export type DotsBoxesDifficulty = "easy" | "normal" | "hard";

export const DOTS_GRID_SIZE = 5;
export const DOTS_BOX_COLUMNS = DOTS_GRID_SIZE - 1;
export const DOTS_BOX_COUNT = DOTS_BOX_COLUMNS * DOTS_BOX_COLUMNS;
export const DOTS_HORIZONTAL_EDGE_COUNT = DOTS_GRID_SIZE * DOTS_BOX_COLUMNS;
export const DOTS_EDGE_COUNT = DOTS_HORIZONTAL_EDGE_COUNT * 2;

export function dotsBoxEdges(box: number) {
  const row = Math.floor(box / DOTS_BOX_COLUMNS);
  const column = box % DOTS_BOX_COLUMNS;
  return [
    row * DOTS_BOX_COLUMNS + column,
    (row + 1) * DOTS_BOX_COLUMNS + column,
    DOTS_HORIZONTAL_EDGE_COUNT + row * DOTS_GRID_SIZE + column,
    DOTS_HORIZONTAL_EDGE_COUNT + row * DOTS_GRID_SIZE + column + 1,
  ];
}

export function dotsEdgeBoxes(edge: number) {
  const boxes: number[] = [];
  for (let box = 0; box < DOTS_BOX_COUNT; box += 1) {
    if (dotsBoxEdges(box).includes(edge)) boxes.push(box);
  }
  return boxes;
}

export function dotsBoxesScores(boxes: number[]): [number, number] {
  return [boxes.filter((owner) => owner === 1).length, boxes.filter((owner) => owner === 2).length];
}

export function applyDotsBoxesEdge(edges: number[], boxes: number[], edge: number, player: DotsBoxesPlayer) {
  if (edge < 0 || edge >= DOTS_EDGE_COUNT || edges[edge]) return null;
  const nextEdges = [...edges];
  const nextBoxes = [...boxes];
  nextEdges[edge] = player + 1;
  const completed = dotsEdgeBoxes(edge).filter((box) => !nextBoxes[box] && dotsBoxEdges(box).every((side) => Boolean(nextEdges[side])));
  completed.forEach((box) => { nextBoxes[box] = player + 1; });
  return { edges: nextEdges, boxes: nextBoxes, completed };
}

function dangerCreated(edges: number[], boxes: number[], edge: number) {
  const trial = [...edges];
  trial[edge] = 1;
  return dotsEdgeBoxes(edge).filter((box) => !boxes[box] && dotsBoxEdges(box).filter((side) => Boolean(trial[side])).length === 3).length;
}

export function chooseDotsBoxesCpuEdge(edges: number[], boxes: number[], difficulty: DotsBoxesDifficulty, random = Math.random) {
  const available = edges.map((owner, edge) => owner ? -1 : edge).filter((edge) => edge >= 0);
  if (!available.length) return null;
  if (difficulty === "easy") return available[Math.floor(random() * available.length)];

  const ranked = available.map((edge) => {
    const result = applyDotsBoxesEdge(edges, boxes, edge, 1)!;
    const danger = dangerCreated(edges, boxes, edge);
    const builds = dotsEdgeBoxes(edge).reduce((total, box) => total + (!boxes[box] ? dotsBoxEdges(box).filter((side) => Boolean(result.edges[side])).length : 0), 0);
    return { edge, captures: result.completed.length, danger, builds };
  });
  const captures = Math.max(...ranked.map((move) => move.captures));
  let choices = captures > 0 ? ranked.filter((move) => move.captures === captures) : ranked.filter((move) => move.danger === Math.min(...ranked.map((move) => move.danger)));
  if (difficulty === "hard") {
    const build = Math.min(...choices.map((move) => move.builds));
    choices = choices.filter((move) => move.builds === build);
  }
  return choices[Math.floor(random() * choices.length)].edge;
}

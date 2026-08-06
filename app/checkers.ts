export type CheckersPiece = "" | "r" | "R" | "b" | "B";
export type CheckersPlayer = 0 | 1;
export type CheckersDifficulty = "easy" | "normal" | "hard";

export type CheckersMove = {
  from: number;
  to: number;
  captured: number | null;
};

export type CheckersTurn = {
  moves: CheckersMove[];
  board: CheckersPiece[];
  captures: number;
};

export const CHECKERS_START: CheckersPiece[] = Array.from({ length: 64 }, (_, index) => {
  const row = Math.floor(index / 8);
  const column = index % 8;
  if ((row + column) % 2 === 0) return "";
  if (row < 3) return "b";
  if (row > 4) return "r";
  return "";
});

export function checkersPieceOwner(piece: CheckersPiece): CheckersPlayer | null {
  if (piece === "r" || piece === "R") return 0;
  if (piece === "b" || piece === "B") return 1;
  return null;
}

function checkersDirections(piece: CheckersPiece) {
  if (piece === "R" || piece === "B") return [-1, 1];
  return piece === "r" ? [-1] : [1];
}

function pieceMoves(board: CheckersPiece[], from: number, capturesOnly: boolean) {
  const piece = board[from];
  const owner = checkersPieceOwner(piece);
  if (owner == null) return [];
  const row = Math.floor(from / 8);
  const column = from % 8;
  const moves: CheckersMove[] = [];

  for (const rowDirection of checkersDirections(piece)) for (const columnDirection of [-1, 1]) {
    const nearRow = row + rowDirection;
    const nearColumn = column + columnDirection;
    if (nearRow < 0 || nearRow > 7 || nearColumn < 0 || nearColumn > 7) continue;
    const near = nearRow * 8 + nearColumn;
    if (!board[near]) {
      if (!capturesOnly) moves.push({ from, to: near, captured: null });
      continue;
    }
    if (checkersPieceOwner(board[near]) === owner) continue;
    const landingRow = row + rowDirection * 2;
    const landingColumn = column + columnDirection * 2;
    if (landingRow < 0 || landingRow > 7 || landingColumn < 0 || landingColumn > 7) continue;
    const landing = landingRow * 8 + landingColumn;
    if (!board[landing]) moves.push({ from, to: landing, captured: near });
  }
  return moves;
}

export function checkersLegalMoves(board: CheckersPiece[], player: CheckersPlayer, forcedFrom: number | null = null) {
  if (forcedFrom != null) return pieceMoves(board, forcedFrom, true).filter((move) => move.captured != null);
  const owned = board.flatMap((piece, index) => checkersPieceOwner(piece) === player ? [index] : []);
  const captures = owned.flatMap((index) => pieceMoves(board, index, true)).filter((move) => move.captured != null);
  return captures.length ? captures : owned.flatMap((index) => pieceMoves(board, index, false)).filter((move) => move.captured == null);
}

export function applyCheckersMove(board: CheckersPiece[], move: CheckersMove) {
  const next = [...board];
  const piece = next[move.from];
  next[move.from] = "";
  if (move.captured != null) next[move.captured] = "";
  const destinationRow = Math.floor(move.to / 8);
  const promoted = (piece === "r" && destinationRow === 0) || (piece === "b" && destinationRow === 7);
  next[move.to] = promoted ? piece === "r" ? "R" : "B" : piece;
  return { board: next, promoted };
}

export function checkersWinner(board: CheckersPiece[], playerToMove: CheckersPlayer): CheckersPlayer | null {
  const redCount = board.filter((piece) => piece === "r" || piece === "R").length;
  const blackCount = board.filter((piece) => piece === "b" || piece === "B").length;
  if (!redCount) return 1;
  if (!blackCount) return 0;
  return checkersLegalMoves(board, playerToMove).length ? null : playerToMove === 0 ? 1 : 0;
}

export function checkersPieceCount(board: CheckersPiece[], player: CheckersPlayer) {
  return board.filter((piece) => checkersPieceOwner(piece) === player).length;
}

function finishCaptureTurn(board: CheckersPiece[], player: CheckersPlayer, first: CheckersMove, moves: CheckersMove[], captures: number): CheckersTurn[] {
  const applied = applyCheckersMove(board, first);
  const nextMoves = [...moves, first];
  const nextCaptures = captures + (first.captured == null ? 0 : 1);
  if (first.captured == null || applied.promoted) return [{ moves: nextMoves, board: applied.board, captures: nextCaptures }];
  const followUps = checkersLegalMoves(applied.board, player, first.to);
  if (!followUps.length) return [{ moves: nextMoves, board: applied.board, captures: nextCaptures }];
  return followUps.flatMap((followUp) => finishCaptureTurn(applied.board, player, followUp, nextMoves, nextCaptures));
}

export function checkersTurnOptions(board: CheckersPiece[], player: CheckersPlayer) {
  return checkersLegalMoves(board, player).flatMap((move) => finishCaptureTurn(board, player, move, [], 0));
}

function evaluateCheckers(board: CheckersPiece[], cpu: CheckersPlayer) {
  let score = 0;
  board.forEach((piece, index) => {
    const owner = checkersPieceOwner(piece);
    if (owner == null) return;
    const row = Math.floor(index / 8);
    const column = index % 8;
    const king = piece === "R" || piece === "B";
    const advancement = owner === 0 ? 7 - row : row;
    const center = row >= 2 && row <= 5 && column >= 2 && column <= 5 ? 5 : 0;
    const value = (king ? 175 : 100) + advancement * 3 + center;
    score += owner === cpu ? value : -value;
  });
  const other = cpu === 0 ? 1 : 0;
  return score + (checkersLegalMoves(board, cpu).length - checkersLegalMoves(board, other).length) * 2;
}

function checkersMinimax(board: CheckersPiece[], player: CheckersPlayer, cpu: CheckersPlayer, depth: number, alpha: number, beta: number): number {
  const winner = checkersWinner(board, player);
  if (winner != null) return winner === cpu ? 100_000 + depth : -100_000 - depth;
  if (depth === 0) return evaluateCheckers(board, cpu);
  const options = checkersTurnOptions(board, player);
  const maximizing = player === cpu;
  let best = maximizing ? -Infinity : Infinity;
  for (const option of options) {
    const score = checkersMinimax(option.board, player === 0 ? 1 : 0, cpu, depth - 1, alpha, beta);
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
    if (maximizing) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseCheckersCpuTurn(board: CheckersPiece[], difficulty: CheckersDifficulty): CheckersTurn | null {
  const options = checkersTurnOptions(board, 1);
  if (!options.length) return null;
  if (difficulty === "easy") return options[Math.floor(Math.random() * options.length)];
  const depth = difficulty === "hard" ? 4 : 2;
  const ranked = options.map((option) => ({ option, score: checkersMinimax(option.board, 0, 1, depth - 1, -Infinity, Infinity) }));
  ranked.sort((left, right) => right.score - left.score);
  if (difficulty === "normal" && ranked.length > 1 && Math.random() < .22) return ranked[Math.min(2, ranked.length - 1)].option;
  return ranked[0].option;
}

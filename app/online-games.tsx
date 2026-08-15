"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { doc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { HeaderChatButton } from "./chat-chrome";
import { BarricadeDragPiece, type BarricadeDragKind } from "./barricade-drag";
import { CHECKERS_START, applyCheckersMove, checkersLegalMoves, checkersPieceCount, checkersPieceOwner, checkersWinner, type CheckersMove, type CheckersPiece, type CheckersPlayer } from "./checkers";
import { battleshipFleetDefeated, battleshipShipAt, decodeBattleshipFleet, encodeBattleshipFleet, randomBattleshipFleet, validBattleshipFleet, type BattleshipFleet } from "./battleship";
import { BattleshipGrid, BattleshipPlacement } from "./battleship-game";
import { DOTS_BOX_COUNT, DOTS_EDGE_COUNT, applyDotsBoxesEdge } from "./dots-boxes";
import { DotsBoxesBoard } from "./dots-boxes-game";
import { GameResult } from "./game-result";
import { AIR_HOCKEY_CENTER, AIR_HOCKEY_MATCH_SECONDS, AIR_HOCKEY_WIN_SCORE, type AirHockeyPlayer } from "./air-hockey";
import { OnlineAirHockeyRink } from "./online-air-hockey";
import { GraphFunctionConsole, GraphWarBoard, type GraphShot } from "./graph-war-game";
import { compileGraphExpression, decodeGraphFunctionShot, decodeGraphPoint, encodeGraphFunctionShot, encodeGraphPoint, graphObstaclesForSeed, graphPlacementAllowed, traceGraphFunction, type GraphFunctionMode, type GraphPoint } from "./graph-war-logic";

export type OnlineGameId = "codebreaker" | "order" | "memory" | "tictactoe" | "connect4" | "rps" | "dice" | "barricade" | "checkers" | "battleship" | "dotsboxes" | "airhockey" | "graphwar";

type Room = {
  code: string;
  gameId: OnlineGameId | "number";
  hostUid: string;
  hostName: string;
  guestUid?: string;
  guestName?: string;
};

type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";
type Guess = { colors: ColorId[]; exact: number; close: number; uid: string };
type PlayerPair<T> = { p0: T; p1: T };
type OnlineState = {
  gameId: OnlineGameId;
  roomCode: string;
  players: [string, string];
  names: [string, string];
  turnUid: string;
  phase: "placing" | "playing" | "revealing" | "relocating" | "complete";
  round: number;
  moves: number;
  scores: [number, number];
  winnerUid: string;
  board: (string | number)[];
  secret: ColorId[];
  guesses: Guess[];
  target: ColorId[];
  objects: ColorId[];
  checks: number[];
  deck: string[];
  open: number[];
  matched: number[];
  choices: string[];
  positions: [number, number];
  faces: [number, number];
  barricades: string[];
  wallsLeft: [number, number];
  fleets: PlayerPair<string[]>;
  shots: PlayerPair<number[]>;
  ready: [boolean, boolean];
  lastShots: [number, number];
  airEndsAt?: number;
};

const COLORS: { id: ColorId; label: string; hex: string }[] = [
  { id: "coral", label: "Coral", hex: "#ff6b4a" },
  { id: "gold", label: "Gold", hex: "#ffc943" },
  { id: "mint", label: "Mint", hex: "#52d6a5" },
  { id: "blue", label: "Blue", hex: "#4d8cff" },
  { id: "violet", label: "Violet", hex: "#9b6cff" },
  { id: "pink", label: "Pink", hex: "#ef6fb3" },
];
const ORDER_COLORS: ColorId[] = ["coral", "gold", "mint", "blue"];
const MEMORY_SYMBOLS = ["☀", "✿", "◆", "☂", "♫", "☕", "★", "☾"];
const TIC_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const CONNECT_ROWS = 6;
const CONNECT_COLUMNS = 7;
const CONNECT_WINDOWS: number[][] = (() => {
  const windows: number[][] = [];
  for (let row = 0; row < CONNECT_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_COLUMNS; column += 1) {
      if (column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((step) => row * CONNECT_COLUMNS + column + step));
      if (row <= CONNECT_ROWS - 4) windows.push([0, 1, 2, 3].map((step) => (row + step) * CONNECT_COLUMNS + column));
      if (row <= CONNECT_ROWS - 4 && column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((step) => (row + step) * CONNECT_COLUMNS + column + step));
      if (row <= CONNECT_ROWS - 4 && column >= 3) windows.push([0, 1, 2, 3].map((step) => (row + step) * CONNECT_COLUMNS + column - step));
    }
  }
  return windows;
})();
const RPS = [
  { id: "rock", symbol: "✊", label: "Rock", japanese: "石" },
  { id: "paper", symbol: "✋", label: "Paper", japanese: "紙" },
  { id: "scissors", symbol: "✌", label: "Scissors", japanese: "鋏" },
] as const;
type RpsChoice = (typeof RPS)[number]["id"];

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function nextOrderRound() {
  const target = shuffle(ORDER_COLORS);
  let objects = shuffle(ORDER_COLORS);
  while (objects.every((color, index) => color === target[index])) objects = shuffle(ORDER_COLORS);
  return { target, objects };
}

function emptyState(gameId: OnlineGameId, room: Room): OnlineState {
  const players: [string, string] = [room.hostUid, room.guestUid!];
  const names: [string, string] = [room.hostName, room.guestName!];
  const order = nextOrderRound();
  return {
    gameId,
    roomCode: room.code,
    players,
    names,
    turnUid: room.hostUid,
    phase: gameId === "battleship" || gameId === "graphwar" ? "placing" : "playing",
    round: 1,
    moves: 0,
    scores: [0, 0],
    winnerUid: "",
    board: gameId === "tictactoe" ? Array(9).fill("") : gameId === "connect4" ? Array(42).fill(0) : gameId === "checkers" ? [...CHECKERS_START] : gameId === "dotsboxes" ? Array(DOTS_EDGE_COUNT).fill(0) : gameId === "airhockey" ? [AIR_HOCKEY_CENTER.x, AIR_HOCKEY_CENTER.y] : [],
    secret: gameId === "codebreaker" ? Array.from({ length: 4 }, () => COLORS[Math.floor(Math.random() * COLORS.length)].id) : [],
    guesses: [],
    target: gameId === "order" ? order.target : [],
    objects: gameId === "order" ? order.objects : [],
    checks: [],
    deck: gameId === "memory" ? shuffle([...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]) : [],
    open: [],
    matched: gameId === "dotsboxes" ? Array(DOTS_BOX_COUNT).fill(0) : [],
    choices: gameId === "rps" ? ["", ""] : [],
    positions: gameId === "barricade" ? [76, 4] : gameId === "graphwar" ? [-1, -1] : [0, 0],
    faces: [0, 0],
    barricades: [],
    wallsLeft: [10, 10],
    // Firestore rejects arrays nested directly inside arrays. Player-keyed
    // maps keep each fleet/shot list independently writable and serializable.
    fleets: { p0: [], p1: [] },
    shots: { p0: [], p1: [] },
    ready: [false, false],
    lastShots: [-1, -1],
    airEndsAt: gameId === "airhockey" ? Date.now() + AIR_HOCKEY_MATCH_SECONDS * 1000 : 0,
  };
}

function onlineAirClock(seconds: number) {
  const safe = Math.max(0, Math.min(AIR_HOCKEY_MATCH_SECONDS, Math.ceil(seconds)));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function makeOnlineGameState(gameId: OnlineGameId, room: Room) {
  return emptyState(gameId, room);
}

function scoreGuess(guess: ColorId[], secret: ColorId[]) {
  let exact = 0;
  const guessedCounts: Partial<Record<ColorId, number>> = {};
  const secretCounts: Partial<Record<ColorId, number>> = {};
  guess.forEach((color, index) => {
    if (color === secret[index]) exact += 1;
    else {
      guessedCounts[color] = (guessedCounts[color] ?? 0) + 1;
      secretCounts[secret[index]] = (secretCounts[secret[index]] ?? 0) + 1;
    }
  });
  return { exact, close: COLORS.reduce((sum, color) => sum + Math.min(guessedCounts[color.id] ?? 0, secretCounts[color.id] ?? 0), 0) };
}

function ticWinner(board: (string | number)[]) {
  for (const [a, b, c] of TIC_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return String(board[a]);
  return "";
}

function connectWinner(board: (string | number)[]) {
  for (const cells of CONNECT_WINDOWS) {
    const player = Number(board[cells[0]]);
    if (player && cells.every((index) => Number(board[index]) === player)) return { player, cells };
  }
  return null;
}

function dropPiece(board: (string | number)[], column: number, player: number) {
  for (let row = CONNECT_ROWS - 1; row >= 0; row -= 1) {
    const index = row * CONNECT_COLUMNS + column;
    if (!board[index]) {
      const next = [...board];
      next[index] = player;
      return { board: next, index };
    }
  }
  return null;
}

function rpsWinner(first: RpsChoice, second: RpsChoice) {
  if (first === second) return -1;
  return (first === "rock" && second === "scissors") || (first === "paper" && second === "rock") || (first === "scissors" && second === "paper") ? 0 : 1;
}

type OnlineWall = { row: number; column: number; orientation: "h" | "v"; owner: 0 | 1 };
const GRID_SIZE = 9;

function encodeOnlineWall(wall: OnlineWall) {
  return `${wall.orientation}:${wall.row}:${wall.column}:${wall.owner}`;
}

function decodeOnlineWalls(walls: string[]) {
  return walls.map((value) => {
    const [orientation, row, column, owner] = value.split(":");
    return { orientation: orientation as "h" | "v", row: Number(row), column: Number(column), owner: Number(owner) as 0 | 1 };
  });
}

function onlineEdgeBlocked(from: number, to: number, walls: OnlineWall[]) {
  const fromRow = Math.floor(from / GRID_SIZE);
  const fromColumn = from % GRID_SIZE;
  const toRow = Math.floor(to / GRID_SIZE);
  const toColumn = to % GRID_SIZE;
  if (fromRow !== toRow) {
    const boundary = Math.min(fromRow, toRow);
    return walls.some((wall) => wall.orientation === "h" && wall.row === boundary && (wall.column === fromColumn || wall.column + 1 === fromColumn));
  }
  const boundary = Math.min(fromColumn, toColumn);
  return walls.some((wall) => wall.orientation === "v" && wall.column === boundary && (wall.row === fromRow || wall.row + 1 === fromRow));
}

function onlineNeighbors(position: number, walls: OnlineWall[]) {
  const row = Math.floor(position / GRID_SIZE);
  const column = position % GRID_SIZE;
  return [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]
    .filter(([nextRow, nextColumn]) => nextRow >= 0 && nextRow < GRID_SIZE && nextColumn >= 0 && nextColumn < GRID_SIZE)
    .map(([nextRow, nextColumn]) => nextRow * GRID_SIZE + nextColumn)
    .filter((next) => !onlineEdgeBlocked(position, next, walls));
}

function onlineBarricadeMoves(position: number, opponent: number, walls: OnlineWall[]) {
  const moves = new Set<number>();
  for (const next of onlineNeighbors(position, walls)) {
    if (next !== opponent) {
      moves.add(next);
      continue;
    }
    const rowDelta = Math.floor(opponent / GRID_SIZE) - Math.floor(position / GRID_SIZE);
    const columnDelta = opponent % GRID_SIZE - position % GRID_SIZE;
    const behindRow = Math.floor(opponent / GRID_SIZE) + rowDelta;
    const behindColumn = opponent % GRID_SIZE + columnDelta;
    if (behindRow >= 0 && behindRow < GRID_SIZE && behindColumn >= 0 && behindColumn < GRID_SIZE) {
      const behind = behindRow * GRID_SIZE + behindColumn;
      if (!onlineEdgeBlocked(opponent, behind, walls)) {
        moves.add(behind);
        continue;
      }
    }
    for (const side of onlineNeighbors(opponent, walls)) {
      const sideRow = Math.floor(side / GRID_SIZE);
      const sideColumn = side % GRID_SIZE;
      if ((rowDelta !== 0 && sideRow === Math.floor(opponent / GRID_SIZE)) || (columnDelta !== 0 && sideColumn === opponent % GRID_SIZE)) moves.add(side);
    }
  }
  return [...moves];
}

function onlinePathExists(start: number, goalRow: number, walls: OnlineWall[]) {
  const queue = [start];
  const seen = new Set(queue);
  while (queue.length) {
    const position = queue.shift()!;
    if (Math.floor(position / GRID_SIZE) === goalRow) return true;
    for (const next of onlineNeighbors(position, walls)) if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function legalOnlineWall(candidate: OnlineWall, walls: OnlineWall[], positions: [number, number]) {
  const overlaps = walls.some((wall) => wall.orientation === candidate.orientation
    ? candidate.orientation === "h" ? wall.row === candidate.row && Math.abs(wall.column - candidate.column) < 2 : wall.column === candidate.column && Math.abs(wall.row - candidate.row) < 2
    : wall.row === candidate.row && wall.column === candidate.column);
  if (overlaps) return false;
  const nextWalls = [...walls, candidate];
  return onlinePathExists(positions[0], 0, nextWalls) && onlinePathExists(positions[1], 8, nextWalls);
}

function HeaderLogo() {
  return <span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" />;
}

function PlayerStrip({ state, user, simultaneous = false }: { state: OnlineState; user: User; simultaneous?: boolean }) {
  const active = state.phase === "playing" ? state.players.indexOf(state.turnUid) : -1;
  return (
    <div className="online-player-strip" aria-label="Online players">
      {state.names.map((name, index) => <div className={state.phase === "playing" && (simultaneous || active === index) ? "active" : ""} key={state.players[index]}><small>{state.players[index] === user.uid ? "YOU" : index === 0 ? "HOST" : "GUEST"}</small><strong>{name}</strong><span>{state.scores[index]}</span></div>)}
      <b>LIVE</b>
    </div>
  );
}

function Peg({ color, hidden = false }: { color?: ColorId; hidden?: boolean }) {
  const details = COLORS.find((item) => item.id === color);
  return <span className={`peg ${hidden ? "peg-hidden" : ""}`} style={details && !hidden ? { backgroundColor: details.hex } : undefined}>{hidden ? "?" : ""}</span>;
}

export function OnlineVersusGame({ room, user, onLeave }: { room: Room; user: User; onLeave: () => Promise<void> }) {
  const [state, setState] = useState<OnlineState | null>(null);
  const [error, setError] = useState("");
  const [colors, setColors] = useState<ColorId[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const [draggingBarricadePiece, setDraggingBarricadePiece] = useState<BarricadeDragKind | null>(null);
  const [barricadeWallSnap, setBarricadeWallSnap] = useState<{ row: number; column: number; orientation: BarricadeDragKind } | null>(null);
  const [lastCheckersMove, setLastCheckersMove] = useState<CheckersMove | null>(null);
  const [battleshipFleet, setBattleshipFleet] = useState<BattleshipFleet>(() => randomBattleshipFleet());
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [graphMode, setGraphMode] = useState<GraphFunctionMode>("normal");
  const [graphExpression, setGraphExpression] = useState("2x");
  const [graphAngle, setGraphAngle] = useState(0);
  const barricadeBoardRef = useRef<HTMLDivElement>(null);
  const latestState = useRef<OnlineState | null>(null);
  const stateRef = useMemo(() => doc(db, "rooms", room.code, "game", "state"), [room.code]);

  useEffect(() => onSnapshot(stateRef, (snapshot) => {
    if (snapshot.exists()) {
      const next = snapshot.data() as OnlineState;
      const previous = latestState.current;
      if (previous?.gameId === "battleship" && next.gameId === "battleship" && previous.phase === "complete" && next.phase === "placing") setBattleshipFleet(randomBattleshipFleet());
      if (previous?.gameId === "checkers" && next.gameId === "checkers" && next.moves < previous.moves) {
        setLastCheckersMove(null);
        setSelected(null);
      } else if (previous?.gameId === "checkers" && next.gameId === "checkers" && previous.phase === "playing" && next.moves >= previous.moves) {
        const before = previous.board as CheckersPiece[];
        const after = next.board as CheckersPiece[];
        const mover = previous.players.indexOf(previous.turnUid) as CheckersPlayer;
        const opponent = mover === 0 ? 1 : 0;
        const from = before.findIndex((piece, index) => checkersPieceOwner(piece) === mover && !after[index]);
        const to = after.findIndex((piece, index) => checkersPieceOwner(piece) === mover && !before[index]);
        const captured = before.findIndex((piece, index) => checkersPieceOwner(piece) === opponent && !after[index]);
        if (from >= 0 && to >= 0) setLastCheckersMove({ from, to, captured: captured >= 0 ? captured : null });
      }
      latestState.current = next;
      setState(next);
    }
  }, () => setError("The online match lost connection.")), [stateRef]);

  // Regular turns have a single permitted mover, so a direct Firestore write is
  // both safe for the game flow and immediately visible through latency
  // compensation. Transactions are reserved for the two truly concurrent
  // paths below (RPS choices and host-controlled reveal resolution).
  const mutate = useCallback(async (change: (current: OnlineState) => Partial<OnlineState> | null) => {
    setError("");
    const current = latestState.current;
    if (!current) return;
    const update = change(current);
    if (!update) return;

    const optimistic = { ...current, ...update } as OnlineState;
    latestState.current = optimistic;
    setState(optimistic);

    try {
      await updateDoc(stateRef, { ...update, updatedAt: serverTimestamp() });
    } catch {
      setError("Your move did not send. Please try again.");
    }
  }, [stateRef]);

  const mutateAtomic = useCallback(async (change: (current: OnlineState) => Partial<OnlineState> | null) => {
    setError("");
    const current = latestState.current;
    if (current) {
      const update = change(current);
      if (update) {
        const optimistic = { ...current, ...update } as OnlineState;
        latestState.current = optimistic;
        setState(optimistic);
      }
    }

    try {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(stateRef);
        if (!snapshot.exists()) return;
        const current = snapshot.data() as OnlineState;
        const update = change(current);
        if (update) transaction.update(stateRef, { ...update, updatedAt: serverTimestamp() });
      });
    } catch { setError("Your move did not send. Please try again."); }
  }, [stateRef]);

  useEffect(() => {
    if (state?.gameId !== "airhockey" || state.phase !== "playing") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state?.gameId, state?.phase]);

  useEffect(() => {
    if (!state || state.gameId !== "airhockey" || user.uid !== room.hostUid) return;
    if (!state.airEndsAt) {
      const timer = window.setTimeout(() => void mutateAtomic((current) => current.gameId === "airhockey" && !current.airEndsAt ? { airEndsAt: Date.now() + AIR_HOCKEY_MATCH_SECONDS * 1000 } : null), 0);
      return () => window.clearTimeout(timer);
    }
    if (state.phase !== "playing" || clockNow < state.airEndsAt) return;
    const timer = window.setTimeout(() => void mutateAtomic((current) => {
      if (current.gameId !== "airhockey" || current.phase !== "playing" || !current.airEndsAt || Date.now() < current.airEndsAt) return null;
      const winnerUid = current.scores[0] === current.scores[1] ? "draw" : current.players[current.scores[0] > current.scores[1] ? 0 : 1];
      return { phase: "complete", winnerUid };
    }), 0);
    return () => window.clearTimeout(timer);
  }, [clockNow, mutateAtomic, room.hostUid, state, user.uid]);

  const reset = useCallback(async () => {
    if (user.uid !== room.hostUid || room.gameId === "number") return;
    try { await setDoc(stateRef, { ...emptyState(room.gameId, room), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); }
    catch { setError("Could not start the rematch."); }
  }, [room, stateRef, user.uid]);

  useEffect(() => {
    if (!state || state.gameId !== "memory" || state.phase !== "revealing" || user.uid !== room.hostUid || state.open.length !== 2) return;
    const timer = window.setTimeout(() => void mutateAtomic((current) => {
      if (current.gameId !== "memory" || current.phase !== "revealing" || current.open.length !== 2) return null;
      const [first, second] = current.open;
      const match = current.deck[first] === current.deck[second];
      const player = current.players.indexOf(current.turnUid);
      const matched = match ? [...current.matched, first, second] : current.matched;
      const scores: [number, number] = [...current.scores];
      if (match) scores[player] += 1;
      const complete = matched.length === current.deck.length;
      return {
        open: [], matched, scores,
        phase: complete ? "complete" : "playing",
        winnerUid: complete ? scores[0] === scores[1] ? "draw" : current.players[scores[0] > scores[1] ? 0 : 1] : "",
        turnUid: match ? current.turnUid : current.players[player === 0 ? 1 : 0],
      };
    }), 850);
    return () => window.clearTimeout(timer);
  }, [mutateAtomic, room.hostUid, state, user.uid]);

  useEffect(() => {
    if (!state || state.gameId !== "rps" || state.phase !== "revealing" || state.winnerUid || user.uid !== room.hostUid) return;
    const timer = window.setTimeout(() => void mutateAtomic((current) => current.gameId === "rps" && current.phase === "revealing" && !current.winnerUid ? { choices: ["", ""], phase: "playing", round: current.round + 1 } : null), 1400);
    return () => window.clearTimeout(timer);
  }, [mutateAtomic, room.hostUid, state, user.uid]);

  const scoreAirHockeyGoal = useCallback((scorer: AirHockeyPlayer, goalRound: number) => void mutateAtomic((current) => {
    if (current.gameId !== "airhockey" || current.phase !== "playing" || current.round !== goalRound) return null;
    const scores: [number, number] = [...current.scores];
    scores[scorer] += 1;
    const winnerIndex = scores.findIndex((score) => score >= AIR_HOCKEY_WIN_SCORE);
    const won = winnerIndex >= 0;
    return {
      board: [AIR_HOCKEY_CENTER.x, AIR_HOCKEY_CENTER.y],
      open: [],
      scores,
      moves: current.moves + 1,
      round: current.round + 1,
      phase: won ? "complete" : "playing",
      winnerUid: won ? current.players[winnerIndex] : "",
      turnUid: current.players[0],
    };
  }), [mutateAtomic]);

  if (!state) return <main className="game-shell"><header className="game-topbar"><button className="back-button" onClick={() => void onLeave()}>← Leave room</button><HeaderLogo /><div className="game-header-actions"><HeaderChatButton inGame /><span className="online-room-pill">● {room.code}</span></div></header><section className="online-game waiting"><b>接</b><h1>Connecting match…</h1><p>Synchronizing both players.</p></section></main>;

  const playerIndex = state.players.indexOf(user.uid) as 0 | 1;
  const otherIndex = playerIndex === 0 ? 1 : 0;
  const myTurn = state.turnUid === user.uid && state.phase === "playing";
  const winnerName = state.winnerUid === "draw" ? "Draw Match" : state.winnerUid ? `${state.names[state.players.indexOf(state.winnerUid)]} Wins!` : "";
  const finish = <GameResult outcome={winnerName} detail="The final result synchronized live on both devices." onPlayAgain={user.uid === room.hostUid ? () => void reset() : undefined} waitingText={`Waiting for ${room.hostName} to play again…`} draw={state.winnerUid === "draw"} />;
  const status = state.phase === "complete" ? winnerName : myTurn ? "Your turn" : `Waiting for ${state.names[otherIndex]}`;
  const airSecondsLeft = state.gameId === "airhockey" ? Math.max(0, Math.ceil(((state.airEndsAt ?? clockNow + AIR_HOCKEY_MATCH_SECONDS * 1000) - clockNow) / 1000)) : AIR_HOCKEY_MATCH_SECONDS;

  const submitCode = () => {
    if (colors.length !== 4) return;
    const submitted = [...colors];
    void mutate((current) => {
      if (current.gameId !== "codebreaker" || current.turnUid !== user.uid || current.phase !== "playing") return null;
      const result = scoreGuess(submitted, current.secret);
      const guesses = [...current.guesses, { colors: submitted, ...result, uid: user.uid }];
      const won = result.exact === 4;
      const done = won || guesses.length >= 8;
      return { guesses, moves: guesses.length, winnerUid: won ? user.uid : done ? "draw" : "", phase: done ? "complete" : "playing", turnUid: current.players[otherIndex] };
    });
    setColors([]);
  };

  const switchObject = (index: number) => {
    if (!myTurn) return;
    if (selected == null) { setSelected(index); return; }
    if (selected === index) { setSelected(null); return; }
    const first = selected;
    setSelected(null);
    void mutate((current) => {
      if (current.gameId !== "order" || current.turnUid !== user.uid || current.phase !== "playing") return null;
      const objects = [...current.objects];
      [objects[first], objects[index]] = [objects[index], objects[first]];
      return { objects };
    });
  };

  const checkOrder = () => void mutate((current) => {
    if (current.gameId !== "order" || current.turnUid !== user.uid || current.phase !== "playing") return null;
    const exact = current.objects.filter((color, index) => color === current.target[index]).length;
    const checks = [...current.checks, exact];
    const complete = exact === 4 || checks.length >= 8;
    return { checks, moves: checks.length, winnerUid: exact === 4 ? user.uid : complete ? "draw" : "", phase: complete ? "complete" : "playing", turnUid: current.players[otherIndex] };
  });

  const flipCard = (index: number) => void mutate((current) => {
    if (current.gameId !== "memory" || current.turnUid !== user.uid || current.phase !== "playing" || current.open.includes(index) || current.matched.includes(index)) return null;
    const open = [...current.open, index];
    return { open, phase: open.length === 2 ? "revealing" : "playing", moves: open.length === 2 ? current.moves + 1 : current.moves };
  });

  const playTic = (index: number) => void mutate((current) => {
    if (current.gameId !== "tictactoe" || current.turnUid !== user.uid || current.phase !== "playing" || current.board[index]) return null;
    const board = [...current.board];
    board[index] = playerIndex === 0 ? "X" : "O";
    const mark = ticWinner(board);
    const draw = !mark && board.every(Boolean);
    return { board, moves: current.moves + 1, winnerUid: mark ? user.uid : draw ? "draw" : "", phase: mark || draw ? "complete" : "playing", turnUid: current.players[otherIndex] };
  });

  const playConnect = (column: number) => void mutate((current) => {
    if (current.gameId !== "connect4" || current.turnUid !== user.uid || current.phase !== "playing") return null;
    const move = dropPiece(current.board, column, playerIndex + 1);
    if (!move) return null;
    const winner = connectWinner(move.board);
    const draw = !winner && move.board.every(Boolean);
    return { board: move.board, moves: current.moves + 1, winnerUid: winner ? user.uid : draw ? "draw" : "", phase: winner || draw ? "complete" : "playing", turnUid: current.players[otherIndex] };
  });

  const playDotsBoxes = (edge: number) => void mutate((current) => {
    if (current.gameId !== "dotsboxes" || current.turnUid !== user.uid || current.phase !== "playing") return null;
    const result = applyDotsBoxesEdge(current.board.map(Number), current.matched.map(Number), edge, playerIndex);
    if (!result) return null;
    const scores: [number, number] = [...current.scores];
    scores[playerIndex] += result.completed.length;
    const complete = result.edges.every(Boolean);
    const winnerUid = complete ? scores[0] === scores[1] ? "draw" : current.players[scores[0] > scores[1] ? 0 : 1] : "";
    return {
      board: result.edges,
      matched: result.boxes,
      scores,
      moves: current.moves + 1,
      open: [edge],
      phase: complete ? "complete" : "playing",
      winnerUid,
      turnUid: complete || result.completed.length ? user.uid : current.players[otherIndex],
    };
  });

  const readyBattleshipFleet = () => {
    if (!validBattleshipFleet(battleshipFleet)) return;
    void mutateAtomic((current) => {
      if (current.gameId !== "battleship" || current.phase !== "placing" || current.ready[playerIndex]) return null;
      const playerKey: keyof PlayerPair<unknown> = playerIndex === 0 ? "p0" : "p1";
      const fleets: PlayerPair<string[]> = { p0: [...current.fleets.p0], p1: [...current.fleets.p1] };
      const ready: [boolean, boolean] = [current.ready[0], current.ready[1]];
      fleets[playerKey] = encodeBattleshipFleet(battleshipFleet);
      ready[playerIndex] = true;
      return { fleets, ready, phase: ready[0] && ready[1] ? "playing" : "placing", turnUid: current.players[0] };
    });
  };

  const fireBattleship = (cell: number) => void mutate((current) => {
    const playerKey: keyof PlayerPair<unknown> = playerIndex === 0 ? "p0" : "p1";
    const otherKey: keyof PlayerPair<unknown> = otherIndex === 0 ? "p0" : "p1";
    if (current.gameId !== "battleship" || current.turnUid !== user.uid || current.phase !== "playing" || current.shots[playerKey].includes(cell)) return null;
    const enemyFleet = decodeBattleshipFleet(current.fleets[otherKey]);
    if (!validBattleshipFleet(enemyFleet)) return null;
    const shots: PlayerPair<number[]> = { p0: [...current.shots.p0], p1: [...current.shots.p1] };
    shots[playerKey] = [...shots[playerKey], cell];
    const scores: [number, number] = [...current.scores];
    if (battleshipShipAt(enemyFleet, cell) >= 0) scores[playerIndex] += 1;
    const lastShots: [number, number] = [...current.lastShots];
    lastShots[playerIndex] = cell;
    const won = battleshipFleetDefeated(enemyFleet, shots[playerKey]);
    return { shots, scores, lastShots, moves: current.moves + 1, winnerUid: won ? user.uid : "", phase: won ? "complete" : "playing", turnUid: won ? user.uid : current.players[otherIndex] };
  });

  const playCheckers = (move: CheckersMove) => void mutate((current) => {
    if (current.gameId !== "checkers" || current.turnUid !== user.uid || current.phase !== "playing") return null;
    const board = current.board as CheckersPiece[];
    const player = playerIndex as CheckersPlayer;
    const forcedFrom = current.open[0] ?? null;
    const legalMove = checkersLegalMoves(board, player, forcedFrom).find((candidate) => candidate.from === move.from && candidate.to === move.to && candidate.captured === move.captured);
    if (!legalMove) return null;
    setLastCheckersMove(legalMove);
    const applied = applyCheckersMove(board, legalMove);
    const followUps = legalMove.captured != null && !applied.promoted ? checkersLegalMoves(applied.board, player, legalMove.to) : [];
    if (followUps.length) {
      setSelected(legalMove.to);
      return { board: applied.board, open: [legalMove.to] };
    }
    setSelected(null);
    const nextPlayer = otherIndex as CheckersPlayer;
    const winner = checkersWinner(applied.board, nextPlayer);
    return { board: applied.board, open: [], moves: current.moves + 1, winnerUid: winner == null ? "" : current.players[winner], phase: winner == null ? "playing" : "complete", turnUid: winner == null ? current.players[otherIndex] : user.uid };
  });

  const chooseRps = (choice: RpsChoice) => void mutateAtomic((current) => {
    if (current.gameId !== "rps" || current.phase !== "playing" || current.choices[playerIndex]) return null;
    const choices = [...current.choices];
    choices[playerIndex] = choice;
    if (!choices[0] || !choices[1]) return { choices };
    const winner = rpsWinner(choices[0] as RpsChoice, choices[1] as RpsChoice);
    const scores: [number, number] = [...current.scores];
    if (winner === 0 || winner === 1) scores[winner] += 1;
    const matchWinner = scores[0] >= 3 ? current.players[0] : scores[1] >= 3 ? current.players[1] : "";
    return { choices, scores, moves: current.moves + 1, phase: matchWinner ? "complete" : "revealing", winnerUid: matchWinner };
  });

  const roll = () => void mutate((current) => {
    if (current.gameId !== "dice" || current.turnUid !== user.uid || current.phase !== "playing") return null;
    const face = Math.floor(Math.random() * 6) + 1;
    const positions: [number, number] = [...current.positions];
    const faces: [number, number] = [...current.faces];
    positions[playerIndex] += face;
    faces[playerIndex] = face;
    const won = positions[playerIndex] >= 20;
    return { positions, faces, moves: current.moves + 1, winnerUid: won ? user.uid : "", phase: won ? "complete" : "playing", turnUid: current.players[otherIndex] };
  });

  const moveBarricadePawn = (destination: number) => void mutate((current) => {
    if (current.gameId !== "barricade" || current.turnUid !== user.uid || current.phase !== "playing") return null;
    const walls = decodeOnlineWalls(current.barricades);
    if (!onlineBarricadeMoves(current.positions[playerIndex], current.positions[otherIndex], walls).includes(destination)) return null;
    const positions: [number, number] = [...current.positions];
    positions[playerIndex] = destination;
    const won = Math.floor(destination / GRID_SIZE) === (playerIndex === 0 ? 0 : 8);
    return { positions, moves: current.moves + 1, phase: won ? "complete" : "playing", winnerUid: won ? user.uid : "", turnUid: won ? user.uid : current.players[otherIndex] };
  });

  const placeBarricade = (row: number, column: number, orientation: "h" | "v") => void mutate((current) => {
    if (current.gameId !== "barricade" || current.turnUid !== user.uid || current.phase !== "playing" || current.wallsLeft[playerIndex] <= 0) return null;
    const walls = decodeOnlineWalls(current.barricades);
    const candidate: OnlineWall = { row, column, orientation, owner: playerIndex };
    if (!legalOnlineWall(candidate, walls, current.positions)) return null;
    const wallsLeft: [number, number] = [...current.wallsLeft];
    wallsLeft[playerIndex] -= 1;
    return { barricades: [...current.barricades, encodeOnlineWall(candidate)], wallsLeft, moves: current.moves + 1, turnUid: current.players[otherIndex] };
  });

  const dropOnlineBarricadePiece = (clientX: number, clientY: number, kind: BarricadeDragKind) => {
    const cells = barricadeBoardRef.current?.querySelector<HTMLElement>(".quoridor-cells");
    if (!cells || !myTurn || state.phase !== "playing") return;
    const rect = cells.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      setError("Drop the piece on the board.");
      return;
    }
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const decodedWalls = decodeOnlineWalls(state.barricades);
    const row = Math.round(y * 9 - 1);
    const column = Math.round(x * 9 - 1);
    if (row < 0 || row > 7 || column < 0 || column > 7 || !legalOnlineWall({ row, column, orientation: kind, owner: playerIndex }, decodedWalls, state.positions)) {
      setError("That wall cannot be placed there.");
      return;
    }
    setError("");
    placeBarricade(row, column, kind);
  };

  const previewOnlineBarricadeWall = (clientX: number, clientY: number, orientation: BarricadeDragKind) => {
    const cells = barricadeBoardRef.current?.querySelector<HTMLElement>(".quoridor-cells");
    if (!cells) return setBarricadeWallSnap(null);
    const rect = cells.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return setBarricadeWallSnap(null);
    const row = Math.round(((clientY - rect.top) / rect.height) * 9 - 1);
    const column = Math.round(((clientX - rect.left) / rect.width) * 9 - 1);
    setBarricadeWallSnap(row >= 0 && row <= 7 && column >= 0 && column <= 7 ? { row, column, orientation } : null);
  };

  const graphPositions: [GraphPoint | null, GraphPoint | null] = state.gameId === "graphwar"
    ? [decodeGraphPoint(state.positions[0]), decodeGraphPoint(state.positions[1])]
    : [null, null];
  const graphObstacles = state.gameId === "graphwar" ? graphObstaclesForSeed(room.code) : [];
  const graphShots: GraphShot[] = state.gameId === "graphwar" ? state.barricades.flatMap((encoded, index) => {
    const shot = decodeGraphFunctionShot(encoded);
    if (!shot) return [];
    const origin = graphPositions[shot.player]; const target = graphPositions[shot.player === 0 ? 1 : 0];
    if (!origin || !target) return [];
    return [{ id: index + 1, ...shot, ...traceGraphFunction(shot, origin, target, graphObstacles) }];
  }) : [];
  const graphPlacingPlayer: 0 | 1 | null = state.gameId === "graphwar" && state.phase === "placing" ? state.ready[0] ? 1 : 0 : null;
  let validGraphFunction = true;
  try { compileGraphExpression(graphExpression); } catch { validGraphFunction = false; }
  const graphPreview = null;

  const placeGraphPoint = (point: GraphPoint) => void mutate((current) => {
    if (current.gameId !== "graphwar" || current.phase !== "placing" || current.turnUid !== user.uid) return null;
    const placingPlayer: 0 | 1 = current.ready[0] ? 1 : 0;
    if (placingPlayer !== playerIndex || !graphPlacementAllowed(playerIndex, point) || graphObstacles.some((obstacle) => Math.hypot(point.x - obstacle.x, point.y - obstacle.y) <= obstacle.radius + 0.5)) return null;
    const positions: [number, number] = [...current.positions];
    const ready: [boolean, boolean] = [...current.ready];
    positions[playerIndex] = encodeGraphPoint(point);
    ready[playerIndex] = true;
    const readyToPlay = ready[0] && ready[1];
    return { positions, ready, phase: readyToPlay ? "playing" : "placing", turnUid: readyToPlay ? current.players[0] : current.players[1] };
  });

  const fireGraphFunction = () => {
    if (!validGraphFunction) return setError("Check the function syntax before firing.");
    setError("");
    void mutate((current) => {
      if (current.gameId !== "graphwar" || current.phase !== "playing" || current.turnUid !== user.uid || current.barricades.length >= 20) return null;
      const origin = decodeGraphPoint(current.positions[playerIndex]);
      const target = decodeGraphPoint(current.positions[otherIndex]);
      if (!origin || !target) return null;
      const shot = { player: playerIndex, mode: graphMode, expression: graphExpression.trim(), angle: graphAngle } as const;
      const result = traceGraphFunction(shot, origin, target, graphObstacles);
      if (result.points.length === 1 && result.exploded) { setError("Invalid function—the shot exploded at launch."); return null; }
      return {
        barricades: [...current.barricades, encodeGraphFunctionShot(shot)],
        moves: current.moves + 1,
        phase: result.hit ? "complete" : "playing",
        winnerUid: result.hit ? user.uid : "",
        turnUid: result.hit ? user.uid : current.players[otherIndex],
      };
    });
  };

  let gameView = null;
  if (state.gameId === "graphwar") {
    const canPlace = state.phase === "placing" && state.turnUid === user.uid && graphPlacingPlayer === playerIndex;
    const visiblePositions: [GraphPoint | null, GraphPoint | null] = state.phase === "placing"
      ? [playerIndex === 0 ? graphPositions[0] : null, playerIndex === 1 ? graphPositions[1] : null]
      : graphPositions;
    const graphStatus = state.phase === "placing"
      ? canPlace ? `Tap a point in your ${playerIndex === 0 ? "red left" : "gold right"} home zone.` : `Waiting for ${state.names[graphPlacingPlayer ?? otherIndex]} to choose a dot…`
      : status;
    gameView = <section className="online-game graph-war-game online-graph-war">
      <div className="graph-war-heading"><div><p className="eyebrow">MATHEMATICAL ARTILLERY · LIVE ONLINE</p><h1>Graph War</h1><p>Fire functions and differential equations around shared obstacles.</p></div><span aria-hidden="true">関</span></div>
      <PlayerStrip state={state} user={user} />
      <div className="online-turn-status">{graphStatus}</div>
      <GraphWarBoard positions={visiblePositions} shots={graphShots} obstacles={graphObstacles} currentPlayer={state.players.indexOf(state.turnUid) as 0 | 1} placingPlayer={graphPlacingPlayer} preview={graphPreview} onPlace={canPlace ? placeGraphPoint : undefined} labels={[state.names[0].slice(0, 7).toUpperCase(), state.names[1].slice(0, 7).toUpperCase()]} />
      {(state.phase === "playing" || state.phase === "complete") && <GraphFunctionConsole mode={graphMode} expression={graphExpression} angle={graphAngle} disabled={!myTurn} history={graphShots} playerIndex={playerIndex} onMode={setGraphMode} onExpression={setGraphExpression} onAngle={setGraphAngle} onFire={fireGraphFunction} />}
      {state.phase === "complete" && finish}
    </section>;
  }
  if (state.gameId === "codebreaker") gameView = <section className="online-game codebreaker-online"><p className="eyebrow">LOGIC · LIVE ONLINE</p><h1>Crack the shared code.</h1><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status}</div><div className="secret-row"><span>SECRET CODE</span><div className="peg-row">{state.secret.map((color, index) => <Peg key={index} color={color} hidden={state.phase !== "complete"} />)}</div></div><div className="online-code-history">{state.guesses.map((guess, index) => <div key={index}><b>{guess.uid === user.uid ? "YOU" : state.names[otherIndex]}</b><span>{guess.colors.map((color, peg) => <Peg key={peg} color={color} />)}</span><em>● {guess.exact} exact · ○ {guess.close} close</em></div>)}</div>{state.phase === "complete" ? finish : <div className="picker-panel"><p>{myTurn ? "Choose four colors" : "Opponent is choosing"}<span>{colors.length}/4</span></p><div className="color-picker">{COLORS.map((color) => <button key={color.id} className="color-choice" style={{ backgroundColor: color.hex }} disabled={!myTurn || colors.length >= 4} onClick={() => setColors((current) => [...current, color.id])} aria-label={`Add ${color.label}`} />)}</div><div className="picker-actions"><button className="text-button" disabled={!myTurn || !colors.length} onClick={() => setColors((current) => current.slice(0, -1))}>Undo</button><button className="primary-button" disabled={!myTurn || colors.length !== 4} onClick={submitCode}>Send guess</button></div></div>}</section>;

  if (state.gameId === "order") {
    const exact = state.checks.at(-1);
    gameView = <section className="online-game order-game"><p className="eyebrow">LOGIC · LIVE ONLINE</p><h1>Match the hidden order.</h1><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status}</div><div className="order-board"><div className="order-secret"><span>HIDDEN ORDER</span><div className="order-row">{state.target.map((color, index) => <Peg key={index} color={color} hidden={state.phase !== "complete"} />)}</div></div><div className="order-status"><strong>{exact == null ? "—" : exact} / 4</strong><span>{exact == null ? "CHECK WHEN READY" : "IN THE CORRECT PLACE"}</span></div><div className="order-play-area"><p>SHARED ORDER <span>{myTurn ? selected == null ? "SELECT AN OBJECT" : "SELECT ITS NEW PLACE" : "OPPONENT MOVING"}</span></p><div className="order-row player-order">{state.objects.map((color, index) => <button key={`${color}-${index}`} className={`order-object ${selected === index ? "is-selected" : ""}`} style={{ backgroundColor: COLORS.find((item) => item.id === color)!.hex }} disabled={!myTurn} onClick={() => switchObject(index)}>{index + 1}</button>)}</div><button className="primary-button" disabled={!myTurn} onClick={() => void checkOrder()}>Check order</button></div></div>{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "memory") gameView = <section className="online-game memory-game"><div className="memory-heading"><div><p className="eyebrow">MEMORY · LIVE ONLINE</p><h1>Meet your match.</h1><p>Find a pair to keep your turn and score a point.</p></div><div className="moves"><strong>{state.moves}</strong><span>moves</span></div></div><PlayerStrip state={state} user={user} /><div className="online-turn-status">{state.phase === "revealing" ? "Checking the pair…" : status}</div><div className="memory-grid">{state.deck.map((symbol, index) => { const visible = state.open.includes(index) || state.matched.includes(index); return <button className={`memory-card ${visible ? "is-open" : ""} ${state.matched.includes(index) ? "is-matched" : ""}`} key={index} disabled={!myTurn || state.phase !== "playing" || visible} onClick={() => void flipCard(index)}><span>{visible ? symbol : ""}</span></button>; })}</div>{state.phase === "complete" && finish}</section>;

  if (state.gameId === "tictactoe") gameView = <section className="online-game simple-game tic-game"><p className="eyebrow">STRATEGY · LIVE ONLINE</p><h1>Tic Tac Toe</h1><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status} · You are {playerIndex === 0 ? "X" : "O"}</div><div className="tic-board">{state.board.map((mark, index) => <button key={index} className={mark ? `tic-${String(mark).toLowerCase()}` : ""} disabled={!myTurn || Boolean(mark)} onClick={() => void playTic(index)}>{mark}</button>)}</div>{state.phase === "complete" && finish}</section>;

  if (state.gameId === "connect4") {
    const winner = connectWinner(state.board);
    const winning = new Set(winner?.cells ?? []);
    const preview = hoveredColumn == null ? null : dropPiece(state.board, hoveredColumn, playerIndex + 1)?.index ?? null;
    gameView = <section className="online-game connect-game"><div className="connect-heading"><div><p className="eyebrow">STRATEGY · LIVE ONLINE</p><h1>Connect Four</h1><p>Drop a chip on your device. It appears on both boards instantly.</p></div><span><b>四</b><small>四目並べ</small></span></div><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status}</div><div className="connect-stage"><div className="connect-column-controls">{Array.from({ length: 7 }, (_, column) => <button key={column} className={hoveredColumn === column ? "is-preview" : ""} disabled={!myTurn || Boolean(state.board[column])} onMouseEnter={() => setHoveredColumn(column)} onMouseLeave={() => setHoveredColumn(null)} onClick={() => void playConnect(column)}><span>▼</span><b>{column + 1}</b></button>)}</div><div className="connect-board">{state.board.map((piece, index) => { const column = index % 7; return <button key={index} disabled={!myTurn || Boolean(state.board[column])} onMouseEnter={() => setHoveredColumn(column)} onMouseLeave={() => setHoveredColumn(null)} onClick={() => void playConnect(column)} className={`connect-cell ${piece ? `piece-${piece}` : ""} ${winning.has(index) ? "winning-piece" : ""} ${index === preview ? `preview-slot preview-${playerIndex + 1}` : ""}`}><i /></button>; })}</div><div className="connect-feet"><i /><i /></div></div>{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "dotsboxes") {
    gameView = <section className="online-game dots-boxes-game online-dots-boxes"><div className="dots-boxes-heading"><div><p className="eyebrow">STRATEGY · LIVE ONLINE</p><h1>Dots &amp; Boxes</h1><p>Close a square to score and keep your turn.</p></div><span>点</span></div><PlayerStrip state={state} user={user} /><div className="dots-score-strip"><div className={state.turnUid === state.players[0] && state.phase === "playing" ? "active" : ""}><small>{state.names[0]}</small><strong>{state.scores[0]}</strong><span>RED BOXES</span></div><b>対<small>{state.moves}/40 LINES</small></b><div className={state.turnUid === state.players[1] && state.phase === "playing" ? "active" : ""}><small>{state.names[1]}</small><strong>{state.scores[1]}</strong><span>INK BOXES</span></div></div><div className="online-turn-status">{status}</div><DotsBoxesBoard edges={state.board.map(Number)} boxes={state.matched.map(Number)} lastEdge={state.open[0] ?? null} onEdge={playDotsBoxes} disabled={!myTurn} labels={[state.names[0].slice(0, 3).toUpperCase(), state.names[1].slice(0, 3).toUpperCase()]} />{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "airhockey") {
    gameView = <section className="online-game air-hockey-game online-air-hockey"><div className="air-hockey-heading"><div><p className="eyebrow">ARCADE · SIMULTANEOUS ONLINE</p><h1>Air Hockey</h1><p>Two minutes. First to three. Lock the rink and move at the same time as your opponent.</p></div><span>氷</span></div><PlayerStrip state={state} user={user} simultaneous /><div className="air-scoreboard"><div className={state.phase === "playing" ? "active" : ""}><small>{state.names[0]}</small><strong>{state.scores[0]}</strong></div><b>FIRST TO 3<small>{onlineAirClock(airSecondsLeft)}</small></b><div className={state.phase === "playing" ? "active" : ""}><strong>{state.scores[1]}</strong><small>{state.names[1]}</small></div></div><div className="online-turn-status">{state.phase === "complete" ? winnerName : "BOTH PLAYERS LIVE — lock the rink and move your mallet"}</div><OnlineAirHockeyRink roomCode={room.code} players={state.players} names={state.names} scores={state.scores} secondsLeft={airSecondsLeft} userUid={user.uid} round={state.round} disabled={state.phase !== "playing"} result={state.phase === "complete" ? { outcome: winnerName, detail: `Final score ${state.scores[0]}–${state.scores[1]}.`, draw: state.winnerUid === "draw", waitingText: `Waiting for ${room.hostName} to play again…` } : undefined} onGoal={scoreAirHockeyGoal} onPlayAgain={user.uid === room.hostUid ? () => void reset() : undefined} onConnectionError={() => setError("The live rink lost connection.")} />{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "rps") {
    const revealed = state.phase !== "playing";
    gameView = <section className="online-game simple-game rps-game"><p className="eyebrow">QUICK · LIVE ONLINE</p><h1>Rock Paper Scissors</h1><p>Choose privately on your own device. First to three wins.</p><PlayerStrip state={state} user={user} /><div className="online-turn-status">{state.choices[playerIndex] ? state.choices[otherIndex] ? "Hands revealed!" : `Locked. Waiting for ${state.names[otherIndex]}` : "Choose your hand"}</div><div className={`rps-arena ${revealed ? "has-reveal" : "is-waiting"}`}><div className="rps-fighter fighter-left"><span className="rps-fighter-label">YOU</span><div className="rps-hand-shell"><b className="rps-hand">{state.choices[playerIndex] ? RPS.find((item) => item.id === state.choices[playerIndex])?.symbol : "?"}</b><i>{state.choices[playerIndex] ? revealed ? state.choices[playerIndex] : "LOCKED" : "CHOOSE"}</i></div></div><div className="rps-impact"><strong>対</strong><span>LIVE</span></div><div className="rps-fighter fighter-right"><span className="rps-fighter-label">{state.names[otherIndex]}</span><div className="rps-hand-shell"><b className="rps-hand">{revealed ? RPS.find((item) => item.id === state.choices[otherIndex])?.symbol : "?"}</b><i>{revealed ? state.choices[otherIndex] : "HIDDEN"}</i></div></div></div><div className="rps-choices">{RPS.map((choice) => <button className={`rps-choice-card choice-${choice.id}`} key={choice.id} onClick={() => void chooseRps(choice.id)} disabled={state.phase !== "playing" || Boolean(state.choices[playerIndex])}><i /><b>{choice.symbol}</b><span><em>{choice.japanese}</em><strong>{choice.label}</strong></span></button>)}</div>{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "dice") gameView = <section className="online-game simple-game dice-game"><p className="eyebrow">LUCK · LIVE ONLINE</p><h1>Dice Race</h1><p>Roll on your turn. Both racers update live.</p><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status}</div><div className="dice-racers">{state.positions.map((position, index) => <div key={index}><span>{state.names[index]}</span><b>{state.faces[index] || "□"}</b><strong>{Math.min(position, 20)}<small>/20</small></strong><i><em style={{ width: `${Math.min(position / 20 * 100, 100)}%` }} /></i></div>)}</div>{state.phase === "complete" ? finish : <button className="primary-button dice-roll" disabled={!myTurn} onClick={() => void roll()}>{myTurn ? "Roll the dice" : "Opponent rolling…"}</button>}</section>;

  if (state.gameId === "battleship") {
    const playerKey: keyof PlayerPair<unknown> = playerIndex === 0 ? "p0" : "p1";
    const otherKey: keyof PlayerPair<unknown> = otherIndex === 0 ? "p0" : "p1";
    const ownFleet = state.ready[playerIndex] ? decodeBattleshipFleet(state.fleets[playerKey]) : battleshipFleet;
    const enemyFleet = decodeBattleshipFleet(state.fleets[otherKey]);
    const ownShots = state.shots[playerKey];
    const enemyShots = state.shots[otherKey];
    const placementStatus = state.ready[playerIndex] ? `Fleet locked. Waiting for ${state.names[otherIndex]}…` : "Arrange your fleet and lock it in.";
    gameView = <section className="online-game battleship-game">
      <div className="battleship-heading"><div><p className="eyebrow">NAVAL STRATEGY · LIVE ONLINE</p><h1>Battleship</h1><p>Each captain hides a fleet, then fires live from their own device.</p></div><span>艦</span></div>
      <PlayerStrip state={state} user={user} />
      {state.phase === "placing" ? <>
        <div className="online-turn-status">{placementStatus}</div>
        {!state.ready[playerIndex] ? <BattleshipPlacement fleet={battleshipFleet} onChange={setBattleshipFleet} onReady={readyBattleshipFleet} readyLabel="Lock fleet" /> : <div className="battleship-waiting"><BattleshipGrid fleet={ownFleet} shots={[]} revealShips label="Your locked fleet" /><strong>Fleet locked</strong><span>Your opponent is still placing ships.</span></div>}
      </> : <>
        <div className="battleship-score-strip"><div className={state.turnUid === state.players[0] && state.phase === "playing" ? "active" : ""}><small>{state.names[0]}</small><strong>{state.scores[0]}<span>/17 HITS</span></strong></div><b>対<small>{state.moves} SHOTS</small></b><div className={state.turnUid === state.players[1] && state.phase === "playing" ? "active" : ""}><small>{state.names[1]}</small><strong>{state.scores[1]}<span>/17 HITS</span></strong></div></div>
        <div className="online-turn-status">{status}</div>
        <div className="battleship-boards">
          <section><div><small>FIRING GRID</small><h2>{state.names[otherIndex]}&apos;s waters</h2></div><BattleshipGrid fleet={enemyFleet} shots={ownShots} revealShips={state.phase === "complete"} onFire={fireBattleship} disabled={!myTurn} label="Opponent waters" lastShot={state.lastShots[playerIndex]} /></section>
          <section><div><small>YOUR FLEET</small><h2>Home waters</h2></div><BattleshipGrid fleet={ownFleet} shots={enemyShots} revealShips label="Your fleet" lastShot={state.lastShots[otherIndex]} /></section>
        </div>
        {state.phase === "complete" && finish}
      </>}
    </section>;
  }

  if (state.gameId === "checkers") {
    const board = state.board as CheckersPiece[];
    const forcedFrom = state.open[0] ?? null;
    const legalMoves = myTurn ? checkersLegalMoves(board, playerIndex as CheckersPlayer, forcedFrom) : [];
    const selectable = new Set(legalMoves.map((move) => move.from));
    const destinations = new Map(legalMoves.filter((move) => move.from === selected).map((move) => [move.to, move]));
    const captureRequired = legalMoves.some((move) => move.captured != null);
    const chooseSquare = (index: number) => {
      const destination = destinations.get(index);
      if (destination) return playCheckers(destination);
      if (selectable.has(index)) setSelected(index);
    };
    gameView = <section className="online-game checkers-game"><div className="checkers-heading"><div><p className="eyebrow">STRATEGY · LIVE ONLINE</p><h1>Checkers</h1><p>Mandatory captures and multi-jumps update live on both boards.</p></div><span>棋</span></div><PlayerStrip state={state} user={user} /><div className="online-turn-status">{forcedFrom != null && myTurn ? "Continue your jump with the same piece" : captureRequired && myTurn ? "Capture required" : status}</div><div className="checkers-score-strip"><div className={state.turnUid === state.players[0] && state.phase !== "complete" ? "active" : ""}><i className="red-piece" /><span>{state.names[0]}</span><strong>{checkersPieceCount(board, 0)}<small>PIECES</small></strong></div><b>対<small>{state.moves} MOVES</small></b><div className={state.turnUid === state.players[1] && state.phase !== "complete" ? "active" : ""}><strong>{checkersPieceCount(board, 1)}<small>PIECES</small></strong><span>{state.names[1]}</span><i className="black-piece" /></div></div><div className={`checkers-board ${playerIndex === 1 ? "is-flipped" : ""}`} role="grid" aria-label="Online Checkers board">{board.map((piece, index) => { const row = Math.floor(index / 8); const column = index % 8; const playable = (row + column) % 2 === 1; const owner = checkersPieceOwner(piece); const isKing = piece === "R" || piece === "B"; const isDestination = destinations.has(index); const canSelect = myTurn && selectable.has(index); const isArrival = lastCheckersMove?.to === index; const moveStyle = isArrival ? { "--move-x": `${(lastCheckersMove.from % 8 - column) * 137}%`, "--move-y": `${(Math.floor(lastCheckersMove.from / 8) - row) * 137}%` } as React.CSSProperties : undefined; return <button type="button" role="gridcell" key={index} className={`${playable ? "dark-square" : "light-square"} ${selected === index ? "selected" : ""} ${isDestination ? "legal-target" : ""} ${canSelect ? "selectable" : ""}`} disabled={!myTurn || (!canSelect && !isDestination)} onClick={() => chooseSquare(index)} aria-label={`Row ${row + 1}, column ${column + 1}${piece ? `, ${owner === 0 ? "red" : "black"}${isKing ? " king" : " piece"}` : isDestination ? ", legal move" : ", empty"}`}>{piece && <span style={moveStyle} className={`checkers-piece ${owner === 0 ? "red" : "black"} ${isKing ? "king" : ""} ${isArrival ? "move-arrival" : ""}`}>{isKing && <b>王</b>}</span>}{isDestination && <i className={destinations.get(index)?.captured != null ? "capture-dot" : "move-dot"} />}{lastCheckersMove?.captured === index && <i className="capture-burst" aria-hidden="true" />}</button>; })}</div>{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "barricade") {
    const decodedWalls = decodeOnlineWalls(state.barricades);
    const legalMoves = myTurn ? onlineBarricadeMoves(state.positions[playerIndex], state.positions[otherIndex], decodedWalls) : [];
    gameView = <section className="online-game barricade-game grid-barricade"><div className="barricade-heading"><div><p className="eyebrow">STRATEGY · LIVE ONLINE</p><h1>Barricade</h1><p>Tap a highlighted space to move. Drag a wall to block a route.</p></div><span>壁</span></div><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status}</div><div className="barricade-score-strip"><div className={state.turnUid === state.players[0] && state.phase !== "complete" ? "active" : ""}><i className="pawn-one" /><span>{state.names[0]}</span><strong>{state.wallsLeft[0]}<small>WALLS</small></strong></div><b>対<small>LIVE</small></b><div className={state.turnUid === state.players[1] && state.phase !== "complete" ? "active" : ""}><strong>{state.wallsLeft[1]}<small>WALLS</small></strong><span>{state.names[1]}</span><i className="pawn-two" /></div></div><div className="barricade-piece-tray" aria-label="Drag a wall onto the board"><BarricadeDragPiece kind="h" owner={playerIndex === 0 ? 1 : 2} label="Drag a horizontal wall" disabled={!myTurn || state.wallsLeft[playerIndex] === 0} onDragStart={setDraggingBarricadePiece} onDragMove={previewOnlineBarricadeWall} onDragEnd={() => { setDraggingBarricadePiece(null); setBarricadeWallSnap(null); }} onDrop={dropOnlineBarricadePiece} /><span><strong>{state.wallsLeft[playerIndex]}</strong><small>WALLS</small></span><BarricadeDragPiece kind="v" owner={playerIndex === 0 ? 1 : 2} label="Drag a vertical wall" disabled={!myTurn || state.wallsLeft[playerIndex] === 0} onDragStart={setDraggingBarricadePiece} onDragMove={previewOnlineBarricadeWall} onDragEnd={() => { setDraggingBarricadePiece(null); setBarricadeWallSnap(null); }} onDrop={dropOnlineBarricadePiece} /></div><div className="quoridor-board" ref={barricadeBoardRef}><div className="quoridor-cells" role="grid">{Array.from({ length: 81 }, (_, index) => <button key={index} role="gridcell" className={`${legalMoves.includes(index) ? "legal-move" : ""} ${Math.floor(index / 9) === 0 ? "top-goal" : ""} ${Math.floor(index / 9) === 8 ? "bottom-goal" : ""}`} onClick={() => moveBarricadePawn(index)} disabled={!legalMoves.includes(index)} aria-label={legalMoves.includes(index) ? `Move to row ${Math.floor(index / 9) + 1}, column ${index % 9 + 1}` : `Board row ${Math.floor(index / 9) + 1}, column ${index % 9 + 1}`}>{state.positions[0] === index && <i className="pawn-one" />}{state.positions[1] === index && <i className="pawn-two" />}</button>)}</div><div className={`quoridor-wall-layer dragging-${draggingBarricadePiece ?? "none"}`}>{Array.from({ length: 64 }, (_, index) => { const row = Math.floor(index / 8); const column = index % 8; const orientation = draggingBarricadePiece; const canPlace = myTurn && orientation != null && legalOnlineWall({ row, column, orientation, owner: playerIndex }, decodedWalls, state.positions); const isSnap = barricadeWallSnap?.row === row && barricadeWallSnap.column === column && barricadeWallSnap.orientation === orientation; const classes = ["wall-target", `owner-${playerIndex + 1}`, orientation ? `wall-${orientation}` : "", canPlace ? "legal" : isSnap ? "blocked" : "", isSnap ? "snap-preview" : ""].filter(Boolean).join(" "); return <span key={index} className={classes} style={{ "--wall-row": row, "--wall-column": column } as React.CSSProperties} />; })}{decodedWalls.map((wall, index) => <i key={index} className={`placed-wall wall-${wall.orientation} owner-${wall.owner + 1}`} style={{ "--wall-row": wall.row, "--wall-column": wall.column } as React.CSSProperties} />)}</div></div>{state.phase === "complete" && finish}</section>;
  }

  return <main className={`game-shell online-versus-shell online-${state.gameId}`}><header className="game-topbar"><button className="back-button" onClick={() => void onLeave()}>← Leave room</button><HeaderLogo /><div className="game-header-actions"><HeaderChatButton inGame /><span className="online-room-pill">● {room.code}</span></div></header>{gameView}{error && <p className="online-game-error" role="alert">{error}</p>}</main>;
}

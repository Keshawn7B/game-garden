"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, onSnapshot, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export type OnlineGameId = "codebreaker" | "order" | "memory" | "tictactoe" | "connect4" | "rps" | "dice";

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
type OnlineState = {
  gameId: OnlineGameId;
  roomCode: string;
  players: [string, string];
  names: [string, string];
  turnUid: string;
  phase: "playing" | "revealing" | "complete";
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
    phase: "playing",
    round: 1,
    moves: 0,
    scores: [0, 0],
    winnerUid: "",
    board: gameId === "tictactoe" ? Array(9).fill("") : gameId === "connect4" ? Array(42).fill(0) : [],
    secret: gameId === "codebreaker" ? Array.from({ length: 4 }, () => COLORS[Math.floor(Math.random() * COLORS.length)].id) : [],
    guesses: [],
    target: gameId === "order" ? order.target : [],
    objects: gameId === "order" ? order.objects : [],
    checks: [],
    deck: gameId === "memory" ? shuffle([...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]) : [],
    open: [],
    matched: [],
    choices: gameId === "rps" ? ["", ""] : [],
    positions: [0, 0],
    faces: [0, 0],
  };
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

function HeaderLogo() {
  return <span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" />;
}

function PlayerStrip({ state, user }: { state: OnlineState; user: User }) {
  const active = state.phase === "playing" ? state.players.indexOf(state.turnUid) : -1;
  return (
    <div className="online-player-strip" aria-label="Online players">
      {state.names.map((name, index) => <div className={active === index ? "active" : ""} key={state.players[index]}><small>{state.players[index] === user.uid ? "YOU" : index === 0 ? "HOST" : "GUEST"}</small><strong>{name}</strong><span>{state.scores[index]}</span></div>)}
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
  const stateRef = useMemo(() => doc(db, "rooms", room.code, "game", "state"), [room.code]);

  useEffect(() => onSnapshot(stateRef, (snapshot) => {
    if (snapshot.exists()) setState(snapshot.data() as OnlineState);
  }, () => setError("The online match lost connection.")), [stateRef]);

  const mutate = useCallback(async (change: (current: OnlineState) => Partial<OnlineState> | null) => {
    setError("");
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

  const reset = useCallback(async () => {
    if (user.uid !== room.hostUid || room.gameId === "number") return;
    try { await setDoc(stateRef, { ...emptyState(room.gameId, room), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); }
    catch { setError("Could not start the rematch."); }
  }, [room, stateRef, user.uid]);

  useEffect(() => {
    if (!state || state.gameId !== "memory" || state.phase !== "revealing" || user.uid !== room.hostUid || state.open.length !== 2) return;
    const timer = window.setTimeout(() => void mutate((current) => {
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
  }, [mutate, room.hostUid, state, user.uid]);

  useEffect(() => {
    if (!state || state.gameId !== "rps" || state.phase !== "revealing" || state.winnerUid || user.uid !== room.hostUid) return;
    const timer = window.setTimeout(() => void mutate((current) => current.gameId === "rps" && current.phase === "revealing" && !current.winnerUid ? { choices: ["", ""], phase: "playing", round: current.round + 1 } : null), 1400);
    return () => window.clearTimeout(timer);
  }, [mutate, room.hostUid, state, user.uid]);

  if (!state) return <main className="game-shell"><header className="game-topbar"><button className="back-button" onClick={() => void onLeave()}>← Leave room</button><HeaderLogo /><span className="online-room-pill">● {room.code}</span></header><section className="online-game waiting"><b>接</b><h1>Connecting match…</h1><p>Synchronizing both players.</p></section></main>;

  const playerIndex = state.players.indexOf(user.uid) as 0 | 1;
  const otherIndex = playerIndex === 0 ? 1 : 0;
  const myTurn = state.turnUid === user.uid && state.phase === "playing";
  const winnerName = state.winnerUid === "draw" ? "Draw match" : state.winnerUid ? `${state.names[state.players.indexOf(state.winnerUid)]} wins` : "";
  const finish = <div className="online-result" role="status"><span>勝</span><div><small>ONLINE MATCH COMPLETE</small><h2>{winnerName}!</h2><p>Both players saw every move live on their own device.</p></div>{user.uid === room.hostUid ? <button className="primary-button" onClick={() => void reset()}>Rematch</button> : <em>Waiting for host rematch…</em>}</div>;
  const status = state.phase === "complete" ? winnerName : myTurn ? "Your turn" : `Waiting for ${state.names[otherIndex]}`;

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

  const chooseRps = (choice: RpsChoice) => void mutate((current) => {
    if (current.gameId !== "rps" || current.phase !== "playing" || current.choices[playerIndex]) return null;
    const choices = [...current.choices];
    choices[playerIndex] = choice;
    if (!choices[0] || !choices[1]) return { choices };
    const winner = rpsWinner(choices[0] as RpsChoice, choices[1] as RpsChoice);
    const scores: [number, number] = [...current.scores];
    if (winner >= 0) scores[winner] += 1;
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

  let gameView = null;
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

  if (state.gameId === "rps") {
    const revealed = state.phase !== "playing";
    gameView = <section className="online-game simple-game rps-game"><p className="eyebrow">QUICK · LIVE ONLINE</p><h1>Rock Paper Scissors</h1><p>Choose privately on your own device. First to three wins.</p><PlayerStrip state={state} user={user} /><div className="online-turn-status">{state.choices[playerIndex] ? state.choices[otherIndex] ? "Hands revealed!" : `Locked. Waiting for ${state.names[otherIndex]}` : "Choose your hand"}</div><div className={`rps-arena ${revealed ? "has-reveal" : "is-waiting"}`}><div className="rps-fighter fighter-left"><span className="rps-fighter-label">YOU</span><div className="rps-hand-shell"><b className="rps-hand">{state.choices[playerIndex] ? RPS.find((item) => item.id === state.choices[playerIndex])?.symbol : "?"}</b><i>{state.choices[playerIndex] ? revealed ? state.choices[playerIndex] : "LOCKED" : "CHOOSE"}</i></div></div><div className="rps-impact"><strong>対</strong><span>LIVE</span></div><div className="rps-fighter fighter-right"><span className="rps-fighter-label">{state.names[otherIndex]}</span><div className="rps-hand-shell"><b className="rps-hand">{revealed ? RPS.find((item) => item.id === state.choices[otherIndex])?.symbol : "?"}</b><i>{revealed ? state.choices[otherIndex] : "HIDDEN"}</i></div></div></div><div className="rps-choices">{RPS.map((choice) => <button className={`rps-choice-card choice-${choice.id}`} key={choice.id} onClick={() => void chooseRps(choice.id)} disabled={state.phase !== "playing" || Boolean(state.choices[playerIndex])}><i /><b>{choice.symbol}</b><span><em>{choice.japanese}</em><strong>{choice.label}</strong></span></button>)}</div>{state.phase === "complete" && finish}</section>;
  }

  if (state.gameId === "dice") gameView = <section className="online-game simple-game dice-game"><p className="eyebrow">LUCK · LIVE ONLINE</p><h1>Dice Race</h1><p>Roll on your turn. Both racers update live.</p><PlayerStrip state={state} user={user} /><div className="online-turn-status">{status}</div><div className="dice-racers">{state.positions.map((position, index) => <div key={index}><span>{state.names[index]}</span><b>{state.faces[index] || "□"}</b><strong>{Math.min(position, 20)}<small>/20</small></strong><i><em style={{ width: `${Math.min(position / 20 * 100, 100)}%` }} /></i></div>)}</div>{state.phase === "complete" ? finish : <button className="primary-button dice-roll" disabled={!myTurn} onClick={() => void roll()}>{myTurn ? "Roll the dice" : "Opponent rolling…"}</button>}</section>;

  return <main className={`game-shell online-versus-shell online-${state.gameId}`}><header className="game-topbar"><button className="back-button" onClick={() => void onLeave()}>← Leave room</button><HeaderLogo /><span className="online-room-pill">● {room.code}</span></header>{gameView}{error && <p className="online-game-error" role="alert">{error}</p>}</main>;
}

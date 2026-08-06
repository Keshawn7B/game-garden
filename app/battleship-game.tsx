"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import {
  BATTLESHIP_SHIPS,
  battleshipCells,
  battleshipFleetDefeated,
  battleshipShipAt,
  battleshipShipSunk,
  canPlaceBattleship,
  chooseBattleshipCpuShot,
  placeBattleship,
  randomBattleshipFleet,
  validBattleshipFleet,
  type BattleshipDifficulty,
  type BattleshipFleet,
  type BattleshipOrientation,
} from "./battleship";

export function BattleshipGrid({ fleet, shots, revealShips, onFire, disabled = false, label, lastShot = null, previewCells = [], previewValid = true, gridRef, onShipPointerDown, onShipPointerMove, onShipPointerUp, onShipPointerCancel }: {
  fleet: BattleshipFleet;
  shots: number[];
  revealShips: boolean;
  onFire?: (cell: number) => void;
  disabled?: boolean;
  label: string;
  lastShot?: number | null;
  previewCells?: number[];
  previewValid?: boolean;
  gridRef?: (element: HTMLDivElement | null) => void;
  onShipPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number, cell: number) => void;
  onShipPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number) => void;
  onShipPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number) => void;
  onShipPointerCancel?: () => void;
}) {
  return <div className="battleship-grid" role="grid" aria-label={label} ref={gridRef}>{Array.from({ length: 100 }, (_, cell) => {
    const shipIndex = battleshipShipAt(fleet, cell);
    const shot = shots.includes(cell);
    const hit = shot && shipIndex >= 0;
    const sunk = shipIndex >= 0 && battleshipShipSunk(fleet[shipIndex], shots);
    const row = Math.floor(cell / 10);
    const column = cell % 10;
    return <button
      type="button"
      role="gridcell"
      key={cell}
      className={`${revealShips && shipIndex >= 0 ? "has-ship" : ""} ${shot ? hit ? "is-hit" : "is-miss" : ""} ${sunk ? "is-sunk" : ""} ${lastShot === cell ? "last-shot" : ""} ${previewCells.includes(cell) ? previewValid ? "ship-drop-preview valid" : "ship-drop-preview invalid" : ""}`}
      disabled={(!onFire && !onShipPointerDown) || disabled || shot}
      onPointerDown={(event) => { if (shipIndex >= 0) onShipPointerDown?.(event, shipIndex, cell); }}
      onPointerMove={(event) => { if (shipIndex >= 0) onShipPointerMove?.(event, shipIndex); }}
      onPointerUp={(event) => { if (shipIndex >= 0) onShipPointerUp?.(event, shipIndex); }}
      onPointerCancel={onShipPointerCancel}
      onClick={() => onFire?.(cell)}
      aria-label={`${String.fromCharCode(65 + column)}${row + 1}${shot ? hit ? ", hit" : ", miss" : revealShips && shipIndex >= 0 ? ", ship" : ""}`}
    >{previewCells.includes(cell) ? <em /> : hit ? <b>×</b> : shot ? <i /> : revealShips && shipIndex >= 0 ? <span /> : null}</button>;
  })}</div>;
}

export function BattleshipPlacement({ fleet, onChange, onReady, readyLabel = "Ready fleet" }: {
  fleet: BattleshipFleet;
  onChange: (fleet: BattleshipFleet) => void;
  onReady: () => void;
  readyLabel?: string;
}) {
  const [selectedShip, setSelectedShip] = useState(0);
  const [orientation, setOrientation] = useState<BattleshipOrientation>("h");
  const [note, setNote] = useState("Grab a ship on the grid and drag it to a new position.");
  const [draggingShip, setDraggingShip] = useState<number | null>(null);
  const [dragOrientation, setDragOrientation] = useState<BattleshipOrientation>("h");
  const [dragOffset, setDragOffset] = useState(0);
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const dragSource = useRef<"tray" | "board">("tray");
  const suppressGridClick = useRef(false);

  const blockImmediateGridClick = () => {
    suppressGridClick.current = true;
    window.setTimeout(() => { suppressGridClick.current = false; }, 0);
  };

  const cellAtPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    const column = Math.min(9, Math.floor((clientX - rect.left) / rect.width * 10));
    const row = Math.min(9, Math.floor((clientY - rect.top) / rect.height * 10));
    return row * 10 + column;
  };

  const placementAt = (anchor: number | null, shipIndex: number, activeOrientation = orientation, activeOffset = Math.floor((BATTLESHIP_SHIPS[shipIndex].size - 1) / 2)) => {
    if (anchor == null) return { start: -1, cells: [] as number[], valid: false };
    const size = BATTLESHIP_SHIPS[shipIndex].size;
    const start = activeOrientation === "h" ? anchor - activeOffset : anchor - activeOffset * 10;
    const cells = battleshipCells(start, size, activeOrientation);
    const visibleCells = cells?.filter((cell) => cell >= 0 && cell < 100) ?? [];
    const valid = Boolean(cells && canPlaceBattleship(fleet, shipIndex, cells));
    return { start, cells: visibleCells.length ? visibleCells : [anchor], valid };
  };

  const dragPreview = draggingShip == null ? { cells: [] as number[], valid: false } : placementAt(hoverCell, draggingShip, dragOrientation, dragOffset);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedShip(shipIndex);
    setDraggingShip(shipIndex);
    setDragOrientation(orientation);
    setDragOffset(Math.floor((BATTLESHIP_SHIPS[shipIndex].size - 1) / 2));
    dragSource.current = "tray";
    dragOrigin.current = { x: event.clientX, y: event.clientY };
    setDragPoint({ x: event.clientX, y: event.clientY });
    setHoverCell(cellAtPoint(event.clientX, event.clientY));
    setNote(`Dragging ${BATTLESHIP_SHIPS[shipIndex].name.toLowerCase()}…`);
  };

  const beginBoardDrag = (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number, cell: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const cells = [...fleet[shipIndex]].sort((left, right) => left - right);
    const activeOrientation: BattleshipOrientation = cells.every((shipCell) => Math.floor(shipCell / 10) === Math.floor(cells[0] / 10)) ? "h" : "v";
    setSelectedShip(shipIndex);
    setOrientation(activeOrientation);
    setDragOrientation(activeOrientation);
    setDragOffset(Math.max(0, cells.indexOf(cell)));
    setDraggingShip(shipIndex);
    dragSource.current = "board";
    dragOrigin.current = { x: event.clientX, y: event.clientY };
    setDragPoint({ x: event.clientX, y: event.clientY });
    setHoverCell(cellAtPoint(event.clientX, event.clientY));
    setNote(`Moving ${BATTLESHIP_SHIPS[shipIndex].name.toLowerCase()} from the grid…`);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number) => {
    if (draggingShip !== shipIndex) return;
    event.preventDefault();
    setDragPoint({ x: event.clientX, y: event.clientY });
    setHoverCell(cellAtPoint(event.clientX, event.clientY));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, shipIndex: number) => {
    if (draggingShip !== shipIndex) return;
    const anchor = cellAtPoint(event.clientX, event.clientY);
    const moved = Math.hypot(event.clientX - dragOrigin.current.x, event.clientY - dragOrigin.current.y) > 7;
    if (!moved) {
      if (dragSource.current === "board") blockImmediateGridClick();
      setDraggingShip(null);
      setHoverCell(null);
      setNote(`Drag the ${BATTLESHIP_SHIPS[shipIndex].name.toLowerCase()} directly from the grid.`);
      return;
    }
    const placement = placementAt(anchor, shipIndex, dragOrientation, dragOffset);
    const placed = placement.valid ? placeBattleship(fleet, shipIndex, placement.start, dragOrientation) : null;
    if (dragSource.current === "board") blockImmediateGridClick();
    if (placed) {
      onChange(placed);
      setNote(`${BATTLESHIP_SHIPS[shipIndex].name} snapped into position.`);
    } else setNote(anchor == null ? "Drop the ship inside the ocean grid." : "That ship does not fit there.");
    setDraggingShip(null);
    setHoverCell(null);
  };

  const cancelDrag = () => {
    setDraggingShip(null);
    setHoverCell(null);
    setNote("Grab a ship on the grid and drag it.");
  };

  const positionShip = (cell: number) => {
    if (suppressGridClick.current) {
      suppressGridClick.current = false;
      return;
    }
    const placed = placeBattleship(fleet, selectedShip, cell, orientation);
    if (!placed) {
      setNote("That ship does not fit there.");
      return;
    }
    onChange(placed);
    setNote(`${BATTLESHIP_SHIPS[selectedShip].name} repositioned.`);
  };

  const dragGhostStyle = draggingShip == null ? undefined : {
    left: dragPoint.x,
    top: dragPoint.y,
    transform: dragOrientation === "h"
      ? `translate(-${(dragOffset + .5) / BATTLESHIP_SHIPS[draggingShip].size * 100}%, -50%) rotate(-2deg)`
      : `translate(-50%, -${(dragOffset + .5) / BATTLESHIP_SHIPS[draggingShip].size * 100}%) rotate(2deg)`,
  };

  return <section className="battleship-placement">
    <div className="battleship-placement-tools">
      <div className="battleship-fleet-list" aria-label="Drag a ship onto the ocean grid">{BATTLESHIP_SHIPS.map((ship, index) => <button type="button" key={ship.id} className={`${selectedShip === index ? "active" : ""} ${draggingShip === index ? "is-dragging" : ""}`} aria-grabbed={draggingShip === index} onFocus={() => setSelectedShip(index)} onDragStart={(event) => event.preventDefault()} onPointerDown={(event) => beginDrag(event, index)} onPointerMove={(event) => moveDrag(event, index)} onPointerUp={(event) => finishDrag(event, index)} onPointerCancel={cancelDrag}><span>{ship.name}</span><i>{Array.from({ length: ship.size }, (_, marker) => <b key={marker} />)}</i></button>)}</div>
      <div className="battleship-placement-actions">
        <button type="button" onClick={() => setOrientation((current) => current === "h" ? "v" : "h")}><b className={`ship-direction direction-${orientation}`} />{orientation === "h" ? "Horizontal" : "Vertical"}</button>
        <button type="button" onClick={() => { onChange(randomBattleshipFleet()); setNote("Fleet randomized."); }}>Shuffle fleet</button>
      </div>
      <p role="status">{note}</p>
    </div>
    <BattleshipGrid fleet={fleet} shots={[]} revealShips label="Position your fleet" onFire={positionShip} previewCells={dragPreview.cells} previewValid={dragPreview.valid} gridRef={(element) => { boardRef.current = element; }} onShipPointerDown={beginBoardDrag} onShipPointerMove={moveDrag} onShipPointerUp={finishDrag} onShipPointerCancel={cancelDrag} />
    {draggingShip != null && <div className={`battleship-drag-ghost direction-${dragOrientation}`} style={dragGhostStyle} aria-hidden="true">{Array.from({ length: BATTLESHIP_SHIPS[draggingShip].size }, (_, marker) => <i key={marker} />)}</div>}
    <button className="primary-button battleship-ready" type="button" disabled={!validBattleshipFleet(fleet)} onClick={onReady}>{readyLabel} <span>→</span></button>
  </section>;
}

export function Battleship({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [difficulty, setDifficulty] = useState<BattleshipDifficulty>("normal");
  const [phase, setPhase] = useState<"placing" | "playing" | "complete">("placing");
  const [playerFleet, setPlayerFleet] = useState<BattleshipFleet>(() => randomBattleshipFleet());
  const [cpuFleet, setCpuFleet] = useState<BattleshipFleet>(() => randomBattleshipFleet());
  const [playerShots, setPlayerShots] = useState<number[]>([]);
  const [cpuShots, setCpuShots] = useState<number[]>([]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState("Position your fleet before launch.");
  const [lastShots, setLastShots] = useState<[number | null, number | null]>([null, null]);

  const reset = () => {
    setPhase("placing");
    setPlayerFleet(randomBattleshipFleet());
    setCpuFleet(randomBattleshipFleet());
    setPlayerShots([]);
    setCpuShots([]);
    setTurn(0);
    setWinner(null);
    setLastShots([null, null]);
    setMessage("Position your fleet before launch.");
  };

  const playerHits = useMemo(() => playerShots.filter((cell) => battleshipShipAt(cpuFleet, cell) >= 0).length, [cpuFleet, playerShots]);
  const cpuHits = useMemo(() => cpuShots.filter((cell) => battleshipShipAt(playerFleet, cell) >= 0).length, [cpuShots, playerFleet]);

  const fire = (cell: number) => {
    if (phase !== "playing" || turn !== 0 || playerShots.includes(cell)) return;
    const shots = [...playerShots, cell];
    const hit = battleshipShipAt(cpuFleet, cell) >= 0;
    setPlayerShots(shots);
    setLastShots((current) => [cell, current[1]]);
    if (battleshipFleetDefeated(cpuFleet, shots)) {
      setWinner(0);
      setPhase("complete");
      setMessage("Enemy fleet destroyed. Victory!");
      onScore(shots.length);
      return;
    }
    setMessage(hit ? "Direct hit! Enemy returning fire…" : "Miss. Enemy returning fire…");
    setTurn(1);
  };

  useEffect(() => {
    if (phase !== "playing" || turn !== 1 || winner != null) return;
    const timer = window.setTimeout(() => {
      const cell = chooseBattleshipCpuShot(cpuShots, playerFleet, difficulty);
      if (cell == null) return;
      const shots = [...cpuShots, cell];
      const hit = battleshipShipAt(playerFleet, cell) >= 0;
      setCpuShots(shots);
      setLastShots((current) => [current[0], cell]);
      if (battleshipFleetDefeated(playerFleet, shots)) {
        setWinner(1);
        setPhase("complete");
        setMessage("Your fleet was destroyed.");
        return;
      }
      setMessage(hit ? "Your ship was hit. Choose a target." : "Enemy missed. Choose a target.");
      setTurn(0);
    }, 720);
    return () => window.clearTimeout(timer);
  }, [cpuShots, difficulty, phase, playerFleet, turn, winner]);

  return <main className="game-shell battleship-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Battleship">↻</button></div></header>
    <section className="battleship-game">
      <div className="battleship-heading"><div><p className="eyebrow">NAVAL STRATEGY · VS CPU</p><h1>Battleship</h1><p>Hide your fleet. Call your shots. Sink all five enemy ships.</p></div><span>艦</span></div>
      {phase === "placing" ? <>
        <div className="cpu-difficulty"><div><span>CPU LEVEL</span><small>難易度</small></div><div className="difficulty-options">{(["easy", "normal", "hard"] as BattleshipDifficulty[]).map((level) => <button key={level} type="button" className={difficulty === level ? "active" : ""} onClick={() => setDifficulty(level)}><strong>{level}</strong><span>{level === "easy" ? "Relaxed" : level === "normal" ? "Balanced" : "Tactical"}</span></button>)}</div></div>
        <BattleshipPlacement fleet={playerFleet} onChange={setPlayerFleet} onReady={() => { setPhase("playing"); setMessage("Your turn. Choose enemy waters to fire."); }} />
      </> : <>
        <div className="battleship-score-strip"><div className={turn === 0 && phase === "playing" ? "active" : ""}><small>YOU</small><strong>{playerHits}<span>/17 HITS</span></strong></div><b>対<small>{playerShots.length + cpuShots.length} SHOTS</small></b><div className={turn === 1 && phase === "playing" ? "active" : ""}><small>CPU · {difficulty.toUpperCase()}</small><strong>{cpuHits}<span>/17 HITS</span></strong></div></div>
        <div className={`battleship-status ${turn === 1 ? "cpu-turn" : ""}`} role="status"><span>{turn === 1 && phase === "playing" ? "⌁" : winner == null ? "照" : winner === 0 ? "勝" : "敗"}</span><strong>{message}</strong></div>
        <div className="battleship-boards">
          <section><div><small>FIRING GRID</small><h2>Enemy waters</h2></div><BattleshipGrid fleet={cpuFleet} shots={playerShots} revealShips={phase === "complete"} onFire={fire} disabled={turn !== 0 || phase !== "playing"} label="Enemy waters" lastShot={lastShots[0]} /></section>
          <section><div><small>YOUR FLEET</small><h2>Home waters</h2></div><BattleshipGrid fleet={playerFleet} shots={cpuShots} revealShips label="Your fleet" lastShot={lastShots[1]} /></section>
        </div>
        {phase === "complete" && <div className="battleship-result"><span>{winner === 0 ? "勝" : "敗"}</span><div><small>BATTLE COMPLETE</small><h2>{winner === 0 ? "You rule the sea." : "The CPU wins."}</h2><p>{playerShots.length + cpuShots.length} shots exchanged.</p></div><button className="primary-button" onClick={reset}>Play again</button></div>}
      </>}
    </section>
  </main>;
}

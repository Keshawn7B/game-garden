"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { AIR_HOCKEY_LIVE_START, stepAirHockeyLive, type AirHockeyBody, type AirHockeyPlayer, type AirHockeyPoint } from "./air-hockey";
import { db } from "./firebase";

const MALLET_STARTS: [AirHockeyPoint, AirHockeyPoint] = [{ x: 50, y: 124 }, { x: 50, y: 26 }];
const ZERO_VELOCITIES: [AirHockeyPoint, AirHockeyPoint] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

type LivePuckDocument = AirHockeyBody & { round: number };
type LiveMalletDocument = AirHockeyPoint & { player: AirHockeyPlayer; uid: string };

function boundedMallet(point: AirHockeyPoint, player: AirHockeyPlayer) {
  return {
    x: Math.max(9, Math.min(91, point.x)),
    y: player === 0 ? Math.max(75, Math.min(139, point.y)) : Math.max(11, Math.min(75, point.y)),
  };
}

function placeLiveElement(element: HTMLElement | null, point: AirHockeyPoint) {
  if (!element) return;
  element.style.left = `${point.x}%`;
  element.style.top = `${point.y / 1.5}%`;
}

export function OnlineAirHockeyRink({ roomCode, players, names, userUid, round, disabled, onGoal, onConnectionError }: {
  roomCode: string;
  players: [string, string];
  names: [string, string];
  userUid: string;
  round: number;
  disabled?: boolean;
  onGoal: (scorer: AirHockeyPlayer, round: number) => void;
  onConnectionError?: () => void;
}) {
  const controlledPlayer = players.indexOf(userUid) as AirHockeyPlayer;
  const isHost = controlledPlayer === 0;
  const liveRef = useMemo(() => doc(db, "rooms", roomCode, "airhockey", "live"), [roomCode]);
  const malletRefs = useMemo(() => players.map((uid) => doc(db, "rooms", roomCode, "airhockey", uid)) as [ReturnType<typeof doc>, ReturnType<typeof doc>], [players, roomCode]);
  const rinkRef = useRef<HTMLDivElement>(null);
  const puckElementRef = useRef<HTMLSpanElement>(null);
  const topMalletElementRef = useRef<HTMLSpanElement>(null);
  const bottomMalletElementRef = useRef<HTMLSpanElement>(null);
  const puckRef = useRef<AirHockeyBody>({ ...AIR_HOCKEY_LIVE_START });
  const malletsRef = useRef<[AirHockeyPoint, AirHockeyPoint]>(MALLET_STARTS.map((point) => ({ ...point })) as [AirHockeyPoint, AirHockeyPoint]);
  const malletVelocitiesRef = useRef<[AirHockeyPoint, AirHockeyPoint]>(ZERO_VELOCITIES.map((point) => ({ ...point })) as [AirHockeyPoint, AirHockeyPoint]);
  const malletTimesRef = useRef<[number, number]>([0, 0]);
  const previousPointerRef = useRef<{ point: AirHockeyPoint; time: number } | null>(null);
  const pointerActiveRef = useRef(false);
  const lastMalletSendRef = useRef(0);
  const lastPuckSendRef = useRef(0);
  const goalLockedRef = useRef(false);
  const onGoalRef = useRef(onGoal);
  const [controlLocked, setControlLocked] = useState(false);

  useEffect(() => { onGoalRef.current = onGoal; }, [onGoal]);

  useEffect(() => {
    goalLockedRef.current = false;
    puckRef.current = { ...AIR_HOCKEY_LIVE_START };
    placeLiveElement(puckElementRef.current, puckRef.current);
    if (!isHost || disabled) return;
    void setDoc(liveRef, { ...AIR_HOCKEY_LIVE_START, round, updatedAt: serverTimestamp() }).catch(() => onConnectionError?.());
  }, [disabled, isHost, liveRef, onConnectionError, round]);

  useEffect(() => {
    const player = controlledPlayer;
    const start = MALLET_STARTS[player];
    void setDoc(malletRefs[player], { ...start, player, uid: userUid, updatedAt: serverTimestamp() }).catch(() => onConnectionError?.());
  }, [controlledPlayer, malletRefs, onConnectionError, userUid]);

  useEffect(() => onSnapshot(liveRef, (snapshot) => {
    if (!snapshot.exists() || isHost) return;
    const incoming = snapshot.data() as LivePuckDocument;
    if (incoming.round !== round) return;
    const puck = { x: Number(incoming.x), y: Number(incoming.y), vx: Number(incoming.vx), vy: Number(incoming.vy) };
    if (Object.values(puck).every(Number.isFinite)) {
      puckRef.current = puck;
      placeLiveElement(puckElementRef.current, puck);
    }
  }, () => onConnectionError?.()), [isHost, liveRef, onConnectionError, round]);

  useEffect(() => {
    const unsubscribers = malletRefs.map((reference, player) => onSnapshot(reference, (snapshot) => {
      if (!snapshot.exists() || player === controlledPlayer) return;
      const incoming = snapshot.data() as LiveMalletDocument;
      const next = boundedMallet({ x: Number(incoming.x), y: Number(incoming.y) }, player as AirHockeyPlayer);
      const now = performance.now();
      const elapsed = Math.max(16, now - malletTimesRef.current[player]) / 1000;
      const previous = malletsRef.current[player];
      malletVelocitiesRef.current[player] = {
        x: Math.max(-120, Math.min(120, (next.x - previous.x) / elapsed)),
        y: Math.max(-120, Math.min(120, (next.y - previous.y) / elapsed)),
      };
      malletTimesRef.current[player] = now;
      malletsRef.current[player] = next;
      placeLiveElement(player === 0 ? bottomMalletElementRef.current : topMalletElementRef.current, next);
    }, () => onConnectionError?.()));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [controlledPlayer, malletRefs, onConnectionError]);

  useEffect(() => {
    if (!controlLocked) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => { document.body.style.overflow = previousOverflow; document.body.style.overscrollBehavior = previousOverscroll; };
  }, [controlLocked]);

  useEffect(() => {
    if (disabled) return;
    let animationFrame = 0;
    let lastFrame = performance.now();
    const animate = (now: number) => {
      const elapsed = now - lastFrame;
      lastFrame = now;
      for (let player = 0; player < 2; player += 1) {
        if (now - malletTimesRef.current[player] > 140) malletVelocitiesRef.current[player] = { x: 0, y: 0 };
      }
      const stepped = stepAirHockeyLive(
        puckRef.current,
        malletsRef.current,
        isHost ? malletVelocitiesRef.current : ZERO_VELOCITIES,
        elapsed,
      );
      puckRef.current = stepped.puck;
      placeLiveElement(puckElementRef.current, stepped.puck);
      if (isHost && stepped.goal != null && !goalLockedRef.current) {
        goalLockedRef.current = true;
        onGoalRef.current(stepped.goal, round);
      } else if (isHost && stepped.goal == null && now - lastPuckSendRef.current >= 90) {
        lastPuckSendRef.current = now;
        const puck = stepped.puck;
        void setDoc(liveRef, { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy, round, updatedAt: serverTimestamp() }).catch(() => onConnectionError?.());
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [disabled, isHost, liveRef, onConnectionError, round]);

  const pointAt = (clientX: number, clientY: number) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return boundedMallet({ x: (clientX - rect.left) / rect.width * 100, y: (clientY - rect.top) / rect.height * 150 }, controlledPlayer);
  };

  const moveControlledMallet = (point: AirHockeyPoint, now: number, forceSend = false) => {
    const previous = previousPointerRef.current;
    if (previous) {
      const elapsed = Math.max(8, now - previous.time) / 1000;
      malletVelocitiesRef.current[controlledPlayer] = {
        x: Math.max(-140, Math.min(140, (point.x - previous.point.x) / elapsed)),
        y: Math.max(-140, Math.min(140, (point.y - previous.point.y) / elapsed)),
      };
    }
    previousPointerRef.current = { point, time: now };
    malletTimesRef.current[controlledPlayer] = now;
    malletsRef.current[controlledPlayer] = point;
    placeLiveElement(controlledPlayer === 0 ? bottomMalletElementRef.current : topMalletElementRef.current, point);
    if (forceSend || now - lastMalletSendRef.current >= 70) {
      lastMalletSendRef.current = now;
      void setDoc(malletRefs[controlledPlayer], { ...point, player: controlledPlayer, uid: userUid, updatedAt: serverTimestamp() }).catch(() => onConnectionError?.());
    }
  };

  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlLocked || disabled) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerActiveRef.current = true;
    previousPointerRef.current = null;
    moveControlledMallet(point, performance.now(), true);
  };
  const moveMallet = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerActiveRef.current || disabled) return;
    const point = pointAt(event.clientX, event.clientY);
    if (point) moveControlledMallet(point, performance.now());
  };
  const endMove = () => {
    if (pointerActiveRef.current) moveControlledMallet(malletsRef.current[controlledPlayer], performance.now(), true);
    pointerActiveRef.current = false;
    previousPointerRef.current = null;
  };

  return <div className={`air-rink-controller ${controlLocked ? "is-control-locked" : ""}`}>
    <button className={`air-control-lock ${controlLocked ? "active" : ""}`} onClick={() => setControlLocked((current) => !current)} aria-pressed={controlLocked}><i>{controlLocked ? "×" : "⌖"}</i><span>{controlLocked ? "UNLOCK SCREEN" : "LOCK RINK"}<small>{controlLocked ? "RETURN TO GAME PAGE" : "BOTH PLAYERS MOVE LIVE"}</small></span></button>
    <div className={`air-hockey-rink live-rink ${disabled ? "is-disabled" : ""} ${controlLocked ? "controls-active" : ""}`} ref={rinkRef} role="application" aria-label={controlLocked ? "Live air hockey rink. Move your mallet while your opponent moves theirs." : "Live air hockey rink. Lock the rink to play."} onPointerDown={beginMove} onPointerMove={moveMallet} onPointerUp={endMove} onPointerCancel={endMove}>
      <div className="air-hockey-goal goal-top"><span /></div><div className="air-hockey-goal goal-bottom"><span /></div>
      <i className="air-rink-line center-line" /><i className="air-rink-circle" />
      <div className="air-player-label label-top active"><i />{names[1]}</div>
      <div className="air-player-label label-bottom active"><i />{names[0]}</div>
      <span ref={topMalletElementRef} className={`air-mallet mallet-top ${controlledPlayer === 1 ? "is-controlled" : ""}`} style={{ left: `${MALLET_STARTS[1].x}%`, top: `${MALLET_STARTS[1].y / 1.5}%` }} />
      <span ref={bottomMalletElementRef} className={`air-mallet mallet-bottom ${controlledPlayer === 0 ? "is-controlled" : ""}`} style={{ left: `${MALLET_STARTS[0].x}%`, top: `${MALLET_STARTS[0].y / 1.5}%` }} />
      <span ref={puckElementRef} className="air-puck" style={{ left: `${AIR_HOCKEY_LIVE_START.x}%`, top: `${AIR_HOCKEY_LIVE_START.y / 1.5}%` }} aria-label="Air hockey puck"><i /></span>
      {controlLocked && !disabled && <div className="air-live-badge"><i /> BOTH PLAYERS LIVE</div>}
      {!controlLocked && <div className="air-lock-overlay"><b>⌖</b><span>LOCK RINK TO PLAY LIVE</span></div>}
    </div>
  </div>;
}

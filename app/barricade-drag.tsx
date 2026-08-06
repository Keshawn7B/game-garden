"use client";

import { useState, type PointerEvent } from "react";

export type BarricadeDragKind = "h" | "v";

const dragPoint = (clientX: number, clientY: number, kind: BarricadeDragKind) => kind === "v"
  ? { x: clientX + 22, y: clientY - 58 }
  : { x: clientX, y: clientY };

export function BarricadeDragPiece({
  kind,
  disabled = false,
  owner = 1,
  label,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDrop,
}: {
  kind: BarricadeDragKind;
  disabled?: boolean;
  owner?: 1 | 2;
  label: string;
  onDragStart?: (kind: BarricadeDragKind) => void;
  onDragMove?: (clientX: number, clientY: number, kind: BarricadeDragKind) => void;
  onDragEnd?: () => void;
  onDrop: (clientX: number, clientY: number, kind: BarricadeDragKind) => void;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; pointerId: number } | null>(null);

  const begin = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = dragPoint(event.clientX, event.clientY, kind);
    setDrag({ ...point, pointerId: event.pointerId });
    onDragStart?.(kind);
  };

  const move = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = dragPoint(event.clientX, event.clientY, kind);
    setDrag({ ...point, pointerId: event.pointerId });
    onDragMove?.(point.x, point.y, kind);
  };

  const finish = (event: PointerEvent<HTMLSpanElement>, cancelled = false) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = dragPoint(event.clientX, event.clientY, kind);
    setDrag(null);
    onDragEnd?.();
    if (!cancelled) onDrop(point.x, point.y, kind);
  };

  return (
    <span
      className={`barricade-drag-piece drag-${kind} owner-${owner} ${drag ? "is-dragging" : ""} ${disabled ? "is-disabled" : ""}`}
      style={drag ? { "--drag-x": `${drag.x}px`, "--drag-y": `${drag.y}px` } as React.CSSProperties : undefined}
      role="img"
      aria-label={label}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
    >
      <i />
    </span>
  );
}

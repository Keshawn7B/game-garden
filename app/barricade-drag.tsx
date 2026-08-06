"use client";

import { useState, type PointerEvent } from "react";

export type BarricadeDragKind = "h" | "v";

export function BarricadeDragPiece({
  kind,
  disabled = false,
  owner = 1,
  label,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  kind: BarricadeDragKind;
  disabled?: boolean;
  owner?: 1 | 2;
  label: string;
  onDragStart?: (kind: BarricadeDragKind) => void;
  onDragEnd?: () => void;
  onDrop: (clientX: number, clientY: number, kind: BarricadeDragKind) => void;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; pointerId: number } | null>(null);

  const begin = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, y: event.clientY, pointerId: event.pointerId });
    onDragStart?.(kind);
  };

  const move = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDrag({ x: event.clientX, y: event.clientY, pointerId: event.pointerId });
  };

  const finish = (event: PointerEvent<HTMLSpanElement>, cancelled = false) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { clientX, clientY } = event;
    setDrag(null);
    onDragEnd?.();
    if (!cancelled) onDrop(clientX, clientY, kind);
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

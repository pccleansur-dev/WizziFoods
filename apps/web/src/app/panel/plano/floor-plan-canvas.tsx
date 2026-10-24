"use client";

import { FLOOR_PLAN_LIMITS, type FloorPlanDraft } from "@platform/contracts";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { seatPositions } from "./floor-plan-editor-state";

export const SECTOR_COLORS = [
  "#dbe8df",
  "#f3e2c7",
  "#dde3f3",
  "#f1d9dc",
  "#e6ddf0",
  "#d6ebeb"
] as const;
const GROUP_COLORS = ["#b45309", "#1d4ed8", "#be185d", "#15803d", "#7c3aed"];
const SNAP = 10;
const VIEW_STEP = 400;

export function viewBoxFor(plan: FloorPlanDraft): {
  height: number;
  width: number;
} {
  let right = 0;
  let bottom = 0;
  for (const table of plan.tables) {
    right = Math.max(right, table.x + table.width + 80);
    bottom = Math.max(bottom, table.y + table.height + 80);
  }
  const width = Math.min(
    FLOOR_PLAN_LIMITS.canvasWidth,
    Math.max(1600, Math.ceil(right / VIEW_STEP) * VIEW_STEP)
  );
  const height = Math.min(
    FLOOR_PLAN_LIMITS.canvasHeight,
    Math.max(1200, Math.ceil(bottom / VIEW_STEP) * VIEW_STEP)
  );
  return { height, width };
}

export function FloorPlanCanvas({
  disabled,
  onKeyDown,
  onMove,
  onSelect,
  plan,
  selected,
  zoom
}: {
  disabled: boolean;
  onKeyDown: (event: KeyboardEvent, tableId: string) => void;
  onMove: (tableId: string, x: number, y: number) => void;
  onSelect: (tableId: string, additive: boolean) => void;
  plan: FloorPlanDraft;
  selected: string[];
  zoom: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const view = viewBoxFor(plan);
  const sectorIndex = new Map(plan.sectors.map(({ id }, index) => [id, index]));
  const tableById = new Map(plan.tables.map((table) => [table.id, table]));

  function toPlanPoint(event: PointerEvent) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function snap(value: number) {
    return Math.round(value / SNAP) * SNAP;
  }

  return (
    <div className="floor-plan-viewport">
      <svg
        aria-label="Plano del salón"
        className="floor-plan-svg"
        ref={svgRef}
        role="group"
        style={{ width: `${zoom * 100}%` }}
        viewBox={`0 0 ${view.width} ${view.height}`}
      >
        <defs>
          <pattern
            height="100"
            id="floor-plan-grid"
            patternUnits="userSpaceOnUse"
            width="100"
          >
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#e5dfd3" />
          </pattern>
        </defs>
        <rect fill="url(#floor-plan-grid)" height="100%" width="100%" />

        {plan.groups.map((group, index) => {
          const members = group.tableIds.flatMap((id) => {
            const table = tableById.get(id);
            return table ? [table] : [];
          });
          if (members.length === 0) return null;
          const left = Math.min(...members.map((table) => table.x)) - 50;
          const top = Math.min(...members.map((table) => table.y)) - 50;
          const right =
            Math.max(...members.map((table) => table.x + table.width)) + 50;
          const bottom =
            Math.max(...members.map((table) => table.y + table.height)) + 50;
          const color = GROUP_COLORS[index % GROUP_COLORS.length];
          return (
            <g aria-hidden="true" key={group.id}>
              <rect
                fill="none"
                height={bottom - top}
                rx="24"
                stroke={color}
                strokeDasharray="14 10"
                strokeWidth="4"
                width={right - left}
                x={left}
                y={top}
              />
              <text
                fill={color}
                fontSize="30"
                fontWeight="700"
                x={left + 10}
                y={top - 10}
              >
                {group.name}
              </text>
            </g>
          );
        })}

        {plan.tables.map((table) => {
          const isSelected = selected.includes(table.id);
          const sectorPosition = sectorIndex.get(table.sectorId) ?? 0;
          const sector = plan.sectors[sectorPosition];
          const centerX = table.x + table.width / 2;
          const centerY = table.y + table.height / 2;
          const fill = SECTOR_COLORS[sectorPosition % SECTOR_COLORS.length];
          const stroke = isSelected ? "#0f3d2e" : "#6b6455";
          return (
            <g
              aria-describedby="floor-plan-keyboard-help"
              aria-label={`Mesa ${table.label}, ${table.seatCount} sillas, sector ${
                sector?.name ?? "sin sector"
              }${isSelected ? ", seleccionada" : ""}`}
              aria-pressed={isSelected}
              className="floor-plan-table"
              data-table-id={table.id}
              key={table.id}
              onKeyDown={(event) => onKeyDown(event, table.id)}
              onPointerDown={(event) => {
                if (disabled) return;
                const point = toPlanPoint(event);
                if (!point) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  id: table.id,
                  offsetX: point.x - table.x,
                  offsetY: point.y - table.y
                };
                onSelect(
                  table.id,
                  event.shiftKey || event.ctrlKey || event.metaKey
                );
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.id !== table.id) return;
                const point = toPlanPoint(event);
                if (point) {
                  onMove(
                    table.id,
                    snap(point.x - drag.offsetX),
                    snap(point.y - drag.offsetY)
                  );
                }
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              role="button"
              tabIndex={0}
            >
              <g
                transform={`translate(${centerX} ${centerY}) rotate(${table.rotation})`}
              >
                {seatPositions(table).map((seat, index) => (
                  <circle
                    cx={seat.x}
                    cy={seat.y}
                    fill="#ffffff"
                    key={index}
                    r="12"
                    stroke="#6b6455"
                    strokeWidth="3"
                  />
                ))}
                {table.shape === "round" ? (
                  <circle
                    fill={fill}
                    r={table.width / 2}
                    stroke={stroke}
                    strokeWidth={isSelected ? 8 : 4}
                  />
                ) : (
                  <rect
                    fill={fill}
                    height={table.height}
                    rx="10"
                    stroke={stroke}
                    strokeWidth={isSelected ? 8 : 4}
                    width={table.width}
                    x={-table.width / 2}
                    y={-table.height / 2}
                  />
                )}
              </g>
              <text
                dominantBaseline="central"
                fill="#221f1a"
                fontSize="34"
                fontWeight="700"
                pointerEvents="none"
                textAnchor="middle"
                x={centerX}
                y={centerY}
              >
                {table.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

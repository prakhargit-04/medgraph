'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Pill, AlertTriangle, HelpCircle, Info, Hourglass, Plus, Minus, RotateCcw, Maximize2 } from 'lucide-react';
import { GraphEdgeData, GraphNodeData } from '../types';

interface GraphProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  onEdgeSelect: (edgeData: GraphEdgeData | null) => void;
  selectedEdgeId?: string | null;
  warningNodeIds?: string[];
}

type Pos = { x: number; y: number };
type IconName = 'triangle' | 'question' | 'info' | 'hourglass';

// Node avatar colors, cycled by position — MedGraph caps analyses at 5
// medications, so 5 distinct, colorblind-considerate hues cover every case.
const NODE_PALETTE = [
  { bg: '#3b82f6', ring: '#bfdbfe' }, // blue
  { bg: '#ef4444', ring: '#fecaca' }, // red
  { bg: '#10b981', ring: '#a7f3d0' }, // emerald
  { bg: '#8b5cf6', ring: '#ddd6fe' }, // violet
  { bg: '#f59e0b', ring: '#fde68a' }, // amber
];

const STATUS_META: Record<
  GraphEdgeData['status'],
  { line: string; dash?: string; icon: IconName; badgeBg: string; badgeFg: string; label: string }
> = {
  signal: { line: '#e11d48', icon: 'triangle', badgeBg: '#fee2e2', badgeFg: '#e11d48', label: 'Potential safety signal' },
  no_evidence: { line: '#94a3b8', dash: '5 4', icon: 'question', badgeBg: '#e2e8f0', badgeFg: '#64748b', label: 'No relevant evidence found' },
  unavailable: { line: '#cbd5e1', dash: '2 5', icon: 'info', badgeBg: '#e2e8f0', badgeFg: '#94a3b8', label: 'Source unavailable' },
  extraction_failed: { line: '#f59e0b', dash: '6 4', icon: 'hourglass', badgeBg: '#fef3c7', badgeFg: '#b45309', label: 'Extraction unavailable' },
};

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

// Deterministic layout for up to ~6 nodes: a ring around the canvas center,
// starting at the top and going clockwise. No physics engine needed — the
// medication cap (5) means this always produces a clean, readable shape
// (a single line for 2, a triangle for 3, etc.) without any settling time.
function defaultLayout(n: number): Pos[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 50, y: 50 }];
  const cx = 50;
  const cy = 52;
  const rx = 34;
  const ry = 30;
  const positions: Pos[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
    positions.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return positions;
}

function StatusIcon({ type, className }: { type: IconName; className?: string }) {
  switch (type) {
    case 'triangle':
      return <AlertTriangle className={className} />;
    case 'question':
      return <HelpCircle className={className} />;
    case 'info':
      return <Info className={className} />;
    case 'hourglass':
      return <Hourglass className={className} />;
  }
}

function LegendItem({
  color,
  dashed,
  icon,
  label,
  sub,
}: {
  color: string;
  dashed: boolean;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="10" className="flex-shrink-0" aria-hidden="true">
        <line
          x1="1" y1="5" x2="21" y2="5"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      </svg>
      <span className="flex-shrink-0" style={{ color }}>{icon}</span>
      <div className="leading-tight">
        <div className="text-xs font-bold" style={{ color }}>{label}</div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</div>
      </div>
    </div>
  );
}

const iconBtnClass =
  'inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-colors text-xs font-bold';

export default function Graph({ nodes, edges, onEdgeSelect, selectedEdgeId, warningNodeIds = [] }: GraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
  const [dragOverrides, setDragOverrides] = useState<Record<string, Pos>>({});
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const dragState = useRef<{
    type: 'pan' | 'node';
    id?: string;
    startX: number;
    startY: number;
    startPan: Pos;
    startPos?: Pos;
    moved: boolean;
  } | null>(null);

  const basePositions = useMemo(() => {
    const layout = defaultLayout(nodes.length);
    const map: Record<string, Pos> = {};
    nodes.forEach((n, i) => {
      map[n.id] = layout[i];
    });
    return map;
  }, [nodes]);

  const positions = useMemo(() => {
    const map: Record<string, Pos> = {};
    nodes.forEach((n) => {
      map[n.id] = dragOverrides[n.id] || basePositions[n.id];
    });
    return map;
  }, [nodes, basePositions, dragOverrides]);

  const clampZoom = (z: number) => Math.min(2.2, Math.max(0.5, z));

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => clampZoom(z - e.deltaY * 0.001));
  }, []);

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    dragState.current = { type: 'pan', startX: e.clientX, startY: e.clientY, startPan: pan, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    dragState.current = {
      type: 'node',
      id,
      startX: e.clientX,
      startY: e.clientY,
      startPan: pan,
      startPos: positions[id],
      moved: false,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dxPx = e.clientX - ds.startX;
    const dyPx = e.clientY - ds.startY;
    if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) ds.moved = true;

    if (ds.type === 'pan') {
      setPan({ x: ds.startPan.x + dxPx, y: ds.startPan.y + dyPx });
    } else if (ds.type === 'node' && ds.id && ds.startPos) {
      const dxPct = (dxPx / zoom / rect.width) * 100;
      const dyPct = (dyPx / zoom / rect.height) * 100;
      const nx = Math.min(97, Math.max(3, ds.startPos.x + dxPct));
      const ny = Math.min(95, Math.max(8, ds.startPos.y + dyPct));
      setDragOverrides((prev) => ({ ...prev, [ds.id as string]: { x: nx, y: ny } }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragState.current;
    // A plain click (no drag) on empty canvas clears the current selection,
    // matching the old vis-network "deselect on blank click" behavior.
    if (ds && ds.type === 'pan' && !ds.moved) {
      onEdgeSelect(null);
    }
    dragState.current = null;
  };

  const handleZoomIn = () => setZoom((z) => clampZoom(z + 0.2));
  const handleZoomOut = () => setZoom((z) => clampZoom(z - 0.2));

  // Reset: back to the algorithmic layout AND default zoom/pan. Fit View:
  // just re-centers/re-scales the viewport without discarding any manual
  // node arrangement the user made — the two controls do genuinely
  // different things, matching their distinct icons in the header.
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragOverrides({});
  };
  const handleFitView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const possiblePairs = edges.length;

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        No graph data yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-4 bg-white/50 dark:bg-slate-900/50 flex-shrink-0">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
            Interaction Graph
          </h3>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">
            {nodes.length} medication{nodes.length !== 1 ? 's' : ''} · {possiblePairs} possible pair{possiblePairs !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleZoomIn} title="Zoom in" className={iconBtnClass}><Plus className="w-3.5 h-3.5" /></button>
          <button onClick={handleZoomOut} title="Zoom out" className={iconBtnClass}><Minus className="w-3.5 h-3.5" /></button>
          <button onClick={handleReset} title="Reset layout, zoom and pan" className={iconBtnClass}><RotateCcw className="w-3.5 h-3.5" />Reset</button>
          <button onClick={handleFitView} title="Fit graph to view" className={iconBtnClass}><Maximize2 className="w-3.5 h-3.5" />Fit View</button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-slate-50/60 dark:bg-slate-950/40 cursor-grab active:cursor-grabbing touch-none select-none"
        onWheel={handleWheel}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          className="absolute inset-0 origin-center"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {/* Edge lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            {edges.map((edge) => {
              const from = positions[edge.from];
              const to = positions[edge.to];
              if (!from || !to) return null;
              const meta = STATUS_META[edge.status];
              const isSelected = selectedEdgeId === edge.id;
              const isHovered = hoveredEdge === edge.id;
              return (
                <line
                  key={edge.id}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={meta.line}
                  strokeWidth={isSelected || isHovered ? 2.2 : edge.status === 'signal' ? 1.6 : 1.1}
                  strokeDasharray={meta.dash}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(e) => { e.stopPropagation(); onEdgeSelect(edge); }}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge((h) => (h === edge.id ? null : h))}
                />
              );
            })}
          </svg>

          {/* Edge status badges */}
          {edges.map((edge) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;
            const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
            const meta = STATUS_META[edge.status];
            const isSelected = selectedEdgeId === edge.id;
            return (
              <div
                key={edge.id}
                className="absolute flex flex-col items-center gap-1"
                style={{ left: `${mid.x}%`, top: `${mid.y}%`, transform: 'translate(-50%, -50%)' }}
                onPointerDown={(e) => { e.stopPropagation(); onEdgeSelect(edge); }}
                onMouseEnter={() => setHoveredEdge(edge.id)}
                onMouseLeave={() => setHoveredEdge((h) => (h === edge.id ? null : h))}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shadow-md ring-2 ring-white dark:ring-slate-900 cursor-pointer transition-transform"
                  style={{ background: meta.badgeBg, color: meta.badgeFg, transform: isSelected ? 'scale(1.15)' : undefined }}
                >
                  <StatusIcon type={meta.icon} className="w-3.5 h-3.5" />
                </div>
                <span
                  className="text-[10px] font-extrabold whitespace-nowrap px-1.5 py-0.5 rounded-md bg-white/95 dark:bg-slate-900/95 shadow-sm cursor-pointer"
                  style={{ color: meta.badgeFg }}
                >
                  {meta.label}
                </span>
              </div>
            );
          })}

          {/* Nodes */}
          {nodes.map((node, idx) => {
            const pos = positions[node.id];
            if (!pos) return null;
            const palette = NODE_PALETTE[idx % NODE_PALETTE.length];
            const hasPatientWarning = warningNodeIds.includes(node.label.toLowerCase());
            return (
              <div
                key={node.id}
                className="absolute flex flex-col items-center gap-1.5 group"
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)', cursor: 'grab' }}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
                  style={{ background: palette.bg, border: `4px solid ${hasPatientWarning ? '#f59e0b' : palette.ring}`, boxShadow: hasPatientWarning ? '0 0 0 5px rgba(245,158,11,.18)' : undefined }}
                >
                  <Pill className="w-7 h-7 text-white -rotate-45" strokeWidth={2.25} />
                </div>
                <div className="text-center">
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                    {titleCase(node.label)}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    RxCUI: {node.rxcui || '—'}
                  </div>
                  {hasPatientWarning && <div className="text-[10px] font-bold text-amber-600">Patient warning</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800/60 flex flex-wrap items-center gap-x-7 gap-y-2.5 bg-white/60 dark:bg-slate-900/60 flex-shrink-0">
        <LegendItem color="#e11d48" dashed={false} icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Potential safety signal" sub="Relevant evidence found in labeling" />
        <LegendItem color="#64748b" dashed icon={<HelpCircle className="w-3.5 h-3.5" />} label="No relevant evidence" sub="No explicit relationship found" />
        <LegendItem color="#94a3b8" dashed icon={<Info className="w-3.5 h-3.5" />} label="Source unavailable" sub="Could not retrieve usable labeling" />
        {edges.some((e) => e.status === 'extraction_failed') && (
          <LegendItem color="#b45309" dashed icon={<Hourglass className="w-3.5 h-3.5" />} label="Extraction unavailable" sub="AI evidence extraction failed" />
        )}
      </div>
    </div>
  );
}

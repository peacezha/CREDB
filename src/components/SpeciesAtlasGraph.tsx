import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildTree, cladeColor, cladePathFor, type TreeNode } from '../lib/phylogeny';

// ============================================================
//  Species atlas — interactive phylogenetic floating network.
//  Hand-rolled lightweight force simulation (no dependencies):
//  radial tree layout as home anchors + link springs + pairwise
//  repulsion + weak home gravity + perpetual sine drift.
//  Positions are written straight to SVG DOM refs inside rAF,
//  bypassing React state for 60fps with ~60 nodes.
// ============================================================

const W = 1200;
const H = 620;
const CX = W / 2;
const CY = H / 2;
/** Ring radius per tree depth: root / class / family / genus / species. */
const RING = [0, 95, 175, 228, 268];

const CLADE_GRAY = '#9c917d'; // journal-400 for class-level nodes

interface SpeciesEntry {
  species: string;
  totalPeaks: number;
  tissues: number;
  topContexts: { label: string; value: number }[];
}

interface Props {
  species: SpeciesEntry[];
  selectedSpecies: string;
  onSelect: (species: string) => void;
  avatarFor: (species: string, size: number) => React.ReactNode;
  formatCompact: (n: number) => string;
}

interface SimNode {
  id: string;
  name: string;
  kind: 'root' | 'clade' | 'species';
  species?: string;
  depth: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position while dragging (or permanently for the root). */
  fx?: number;
  fy?: number;
  homeX: number;
  homeY: number;
  radius: number;
  color: string;
  phase: number;
  parent?: SimNode;
}

interface SimLink {
  id: string;
  source: SimNode;
  target: SimNode;
  color: string;
}

interface Layout {
  nodes: SimNode[];
  links: SimLink[];
  nodeById: Map<string, SimNode>;
}

/** Family key for repulsion tuning; every unknown species shares "Others". */
const familyOf = (species: string): string => {
  const path = cladePathFor(species);
  return path[0] === 'Others' ? 'Others' : path[1];
};

/** Radial initial layout: leaf angles spread by subtree size, parents centered on children. */
const buildLayout = (entries: SpeciesEntry[]): Layout => {
  const tree = buildTree(entries.map(e => e.species));
  const maxPeaks = Math.max(1, ...entries.map(e => e.totalPeaks));
  const peakOf = new Map(entries.map(e => [e.species, e.totalPeaks]));
  const nodes: SimNode[] = [];
  const links: SimLink[] = [];
  const nodeById = new Map<string, SimNode>();

  const leafCount = (n: TreeNode): number =>
    n.species ? 1 : (n.children ?? []).reduce((s, c) => s + leafCount(c), 0);
  const total = Math.max(1, leafCount(tree));

  let cursor = 0;
  const place = (n: TreeNode, depth: number, path: string[]): { node: SimNode; angle: number } => {
    const id = [...path, n.name].join('/');
    const ring = RING[Math.min(depth, RING.length - 1)];
    if (n.species) {
      const angle = ((cursor + 0.5) / total) * Math.PI * 2 - Math.PI / 2;
      cursor += 1;
      const x = CX + Math.cos(angle) * ring;
      const y = CY + Math.sin(angle) * ring;
      const radius = (40 + ((peakOf.get(n.species) ?? 0) / maxPeaks) * 70) / 2;
      const node: SimNode = {
        id,
        name: n.name,
        kind: 'species',
        species: n.species,
        depth,
        x,
        y,
        vx: 0,
        vy: 0,
        homeX: x,
        homeY: y,
        radius,
        color: cladeColor(familyOf(n.species)),
        phase: (id.length * 137.5) % (Math.PI * 2),
      };
      nodes.push(node);
      nodeById.set(id, node);
      return { node, angle };
    }

    const childResults = (n.children ?? []).map(c => place(c, depth + 1, [...path, n.name]));
    const isRoot = depth === 0;
    const angle =
      childResults.length > 0
        ? childResults.reduce((s, c) => s + c.angle, 0) / childResults.length
        : 0;
    const x = isRoot ? CX : CX + Math.cos(angle) * ring;
    const y = isRoot ? CY : CY + Math.sin(angle) * ring;
    const node: SimNode = {
      id,
      name: n.name,
      kind: isRoot ? 'root' : 'clade',
      depth,
      x,
      y,
      vx: 0,
      vy: 0,
      homeX: x,
      homeY: y,
      radius: isRoot ? 6 : depth === 1 ? 5 : 3.5,
      color: depth >= 2 ? cladeColor(n.name) : CLADE_GRAY,
      phase: (id.length * 97.3) % (Math.PI * 2),
      ...(isRoot ? { fx: CX, fy: CY } : {}),
    };
    nodes.push(node);
    nodeById.set(id, node);
    for (const c of childResults) {
      c.node.parent = node;
      links.push({
        id: `${id}->${c.node.id}`,
        source: node,
        target: c.node,
        color: c.node.color !== CLADE_GRAY ? c.node.color : node.color,
      });
    }
    return { node, angle };
  };
  place(tree, 0, []);
  return { nodes, links, nodeById };
};

/** Quadratic bezier with a slight perpendicular bow — softer than a straight line. */
const linkPath = (l: SimLink): string => {
  const { source: s, target: t } = l;
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = d * 0.12;
  const cx = (s.x + t.x) / 2 - (dy / d) * k;
  const cy = (s.y + t.y) / 2 + (dx / d) * k;
  return `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`;
};

type Hover = { kind: 'species' | 'clade'; id: string } | null;

const SpeciesAtlasGraph: React.FC<Props> = ({
  species,
  selectedSpecies,
  onSelect,
  avatarFor,
  formatCompact,
}) => {
  const layout = useMemo(() => buildLayout(species), [species]);
  const entryBySpecies = useMemo(
    () => new Map(species.map(e => [e.species, e])),
    [species]
  );
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of species) {
      const fam = familyOf(e.species);
      if (!seen.has(fam)) seen.set(fam, cladeColor(fam));
    }
    return [...seen.entries()];
  }, [species]);

  const [hover, setHover] = useState<Hover>(null);
  const hoverRef = useRef<Hover>(null);
  hoverRef.current = hover;

  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const linkEls = useRef(new Map<string, SVGPathElement>());
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(
    null
  );

  /** Push current sim positions into the DOM (no React state involved). */
  const applyPositions = () => {
    for (const n of nodesRef.current) {
      nodeEls.current.get(n.id)?.setAttribute('transform', `translate(${n.x} ${n.y})`);
    }
    for (const l of linksRef.current) {
      linkEls.current.get(l.id)?.setAttribute('d', linkPath(l));
    }
    const hov = hoverRef.current;
    if (hov?.kind === 'species' && tooltipRef.current) {
      const n = nodesRef.current.find(x => x.id === hov.id);
      if (n) {
        tooltipRef.current.style.left = `${(n.x / W) * 100}%`;
        tooltipRef.current.style.top = `${(n.y / H) * 100}%`;
      }
    }
  };

  // Force simulation — runs forever (gentle drift), paused when tab hidden.
  useEffect(() => {
    nodesRef.current = layout.nodes;
    linksRef.current = layout.links;

    const step = (now: number) => {
      const nodes = nodesRef.current;
      const links = linksRef.current;

      // Weak pull toward the radial home anchor + perpetual sine drift
      for (const n of nodes) {
        if (n.fx !== undefined) continue;
        n.vx += (n.homeX - n.x) * 0.006;
        n.vy += (n.homeY - n.y) * 0.006;
        n.vx += Math.sin(now * 0.0006 + n.phase) * 0.012;
        n.vy += Math.cos(now * 0.0007 + n.phase * 1.7) * 0.012;
      }

      // Link springs (parent → child)
      for (const l of links) {
        const s = l.source;
        const t = l.target;
        let dx = t.x - s.x;
        let dy = t.y - s.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const rest = 55 + t.radius * 0.4;
        const f = ((d - rest) / d) * 0.015;
        dx *= f;
        dy *= f;
        if (s.fx === undefined) {
          s.vx += dx;
          s.vy += dy;
        }
        if (t.fx === undefined) {
          t.vx -= dx;
          t.vy -= dy;
        }
      }

      // Pairwise short-range repulsion — weak inside a family, stronger across
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const sameFam =
            a.kind === 'species' &&
            b.kind === 'species' &&
            familyOf(a.species!) === familyOf(b.species!);
          const pad = a.radius + b.radius + (sameFam ? 6 : 20);
          if (d >= pad) continue;
          const f = Math.min(0.9, ((pad - d) / d) * 0.12) * (sameFam ? 0.5 : 1);
          dx *= f;
          dy *= f;
          if (a.fx === undefined) {
            a.vx -= dx;
            a.vy -= dy;
          }
          if (b.fx === undefined) {
            b.vx += dx;
            b.vy += dy;
          }
        }
      }

      // Integrate: damping 0.85, per-frame displacement capped at 3px, wall clamp
      for (const n of nodes) {
        if (n.fx !== undefined) {
          n.x = n.fx;
          n.y = n.fy ?? n.y;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= 0.85;
        n.vy *= 0.85;
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > 3) {
          n.vx = (n.vx / sp) * 3;
          n.vy = (n.vy / sp) * 3;
        }
        n.x += n.vx;
        n.y += n.vy;
        const m = n.radius + 6;
        n.x = Math.max(m, Math.min(W - m, n.x));
        n.y = Math.max(m, Math.min(H - m, n.y));
      }
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Static radial layout only — no simulation.
      applyPositions();
      return;
    }

    let raf = 0;
    const tick = (now: number) => {
      step(now);
      applyPositions();
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => cancelAnimationFrame(raf);
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // ── Highlight sets for the current hover ────────────────────
  const highlight = useMemo(() => {
    if (!hover) return null;
    const nodeIds = new Set<string>();
    const linkIds = new Set<string>();
    const speciesIds = new Set<string>();
    if (hover.kind === 'species') {
      let n = layout.nodeById.get(hover.id);
      while (n) {
        nodeIds.add(n.id);
        if (n.kind === 'species') speciesIds.add(n.id);
        n = n.parent;
      }
    } else {
      const queue = [hover.id];
      nodeIds.add(hover.id);
      while (queue.length > 0) {
        const id = queue.pop()!;
        for (const l of layout.links) {
          if (l.source.id !== id) continue;
          nodeIds.add(l.target.id);
          if (l.target.kind === 'species') speciesIds.add(l.target.id);
          queue.push(l.target.id);
        }
      }
    }
    for (const l of layout.links) {
      if (nodeIds.has(l.source.id) && nodeIds.has(l.target.id)) linkIds.add(l.id);
    }
    return { nodeIds, linkIds, speciesIds };
  }, [hover, layout]);

  // ── Pointer interactions ────────────────────────────────────
  const toLocal = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return [0, 0];
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [pt.x, pt.y];
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGGElement>, n: SimNode) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toLocal(e.clientX, e.clientY);
    dragRef.current = { id: n.id, startX: x, startY: y, moved: false };
    n.fx = n.x;
    n.fy = n.y;
  };

  const handleNodePointerMove = (e: React.PointerEvent<SVGGElement>, n: SimNode) => {
    const d = dragRef.current;
    if (!d || d.id !== n.id) return;
    const [x, y] = toLocal(e.clientX, e.clientY);
    if (!d.moved && Math.hypot(x - d.startX, y - d.startY) > 6) d.moved = true;
    n.fx = x;
    n.fy = y;
  };

  const handleNodePointerUp = (e: React.PointerEvent<SVGGElement>, n: SimNode) => {
    const d = dragRef.current;
    if (!d || d.id !== n.id) return;
    dragRef.current = null;
    const wasDrag = d.moved;
    n.fx = undefined;
    n.fy = undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // No simulation to carry it back — snap home explicitly.
      n.x = n.homeX;
      n.y = n.homeY;
      applyPositions();
    }
    if (!wasDrag) onSelect(n.species!);
  };

  if (species.length === 0) return null;

  const hoverSpeciesNode =
    hover?.kind === 'species' ? layout.nodeById.get(hover.id) : undefined;
  const hoverEntry = hoverSpeciesNode?.species
    ? entryBySpecies.get(hoverSpeciesNode.species)
    : undefined;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[620px] w-full touch-none select-none"
        role="img"
        aria-label="Interactive phylogenetic network of species"
      >
        {/* Evolutionary links */}
        {layout.links.map(l => {
          const onPath = highlight ? highlight.linkIds.has(l.id) : false;
          return (
            <path
              key={l.id}
              ref={el => {
                if (el) linkEls.current.set(l.id, el);
                else linkEls.current.delete(l.id);
              }}
              d={linkPath(l)}
              fill="none"
              stroke={l.color}
              strokeOpacity={highlight ? (onPath ? 0.9 : 0.08) : 0.4}
              strokeWidth={onPath ? 2.5 : 1.5}
              style={{ transition: 'stroke-opacity 200ms' }}
            />
          );
        })}

        {/* Internal clade nodes (root / class / family / genus) */}
        {layout.nodes
          .filter(n => n.kind !== 'species')
          .map(n => {
            const dimmed = highlight ? !highlight.nodeIds.has(n.id) : false;
            return (
              <g
                key={n.id}
                ref={el => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                transform={`translate(${n.x} ${n.y})`}
                opacity={dimmed ? 0.2 : 1}
                style={{ transition: 'opacity 200ms', cursor: 'default' }}
                onPointerEnter={() => setHover({ kind: 'clade', id: n.id })}
                onPointerLeave={() => setHover(null)}
              >
                <circle r={n.radius} fill={n.color} stroke="#ffffff" strokeWidth={1.5} />
                {n.depth <= 2 && (
                  <text
                    x={n.radius + 4}
                    y={3.5}
                    fontSize={11}
                    fontStyle="italic"
                    fill="#766a58"
                  >
                    {n.name}
                  </text>
                )}
              </g>
            );
          })}

        {/* Species nodes — draggable, clickable, hoverable */}
        {layout.nodes
          .filter(n => n.kind === 'species')
          .map(n => {
            const dimmed = highlight ? !highlight.speciesIds.has(n.id) : false;
            const isSelected = selectedSpecies === n.species;
            return (
              <g
                key={n.id}
                ref={el => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                transform={`translate(${n.x} ${n.y})`}
                opacity={dimmed ? 0.25 : 1}
                style={{ transition: 'opacity 200ms', cursor: 'grab' }}
                onPointerDown={e => handleNodePointerDown(e, n)}
                onPointerMove={e => handleNodePointerMove(e, n)}
                onPointerUp={e => handleNodePointerUp(e, n)}
                onPointerEnter={() => setHover({ kind: 'species', id: n.id })}
                onPointerLeave={() => setHover(null)}
              >
                <circle
                  r={n.radius + 2.5}
                  fill="#ffffff"
                  stroke={isSelected ? '#2d5a8f' : '#d4cfc3'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                <foreignObject
                  x={-n.radius}
                  y={-n.radius}
                  width={n.radius * 2}
                  height={n.radius * 2}
                  pointerEvents="none"
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      overflow: 'hidden',
                    }}
                  >
                    {avatarFor(n.species!, n.radius * 1.7)}
                  </div>
                </foreignObject>
              </g>
            );
          })}
      </svg>

      {/* Tooltip — position is pinned to the node every animation frame */}
      {hoverSpeciesNode && hoverEntry && (
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-navy-900 px-3 py-2 text-left text-xs text-white shadow-xl"
          style={{
            left: `${(hoverSpeciesNode.x / W) * 100}%`,
            top: `${(hoverSpeciesNode.y / H) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 16px))',
          }}
        >
          <span className="block font-bold">{hoverEntry.species}</span>
          <span className="block opacity-80">
            {hoverEntry.totalPeaks.toLocaleString()} peaks · {hoverEntry.topContexts.length}{' '}
            annotations
          </span>
        </div>
      )}

      {/* Family legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {legend.map(([fam, color]) => (
          <span key={fam} className="flex items-center gap-1.5 text-[11px] text-journal-500">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className="font-serif italic">{fam}</span>
          </span>
        ))}
        <span className="text-[11px] text-journal-400">
          · drag bubbles to rearrange, click to explore
        </span>
      </div>
    </div>
  );
};

export default SpeciesAtlasGraph;

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart, registerables } from 'chart.js';
import type { BarElement, LegendItem, Plugin } from 'chart.js';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Database,
  FileText,
  Layers,
  Loader2,
  PieChart,
  RefreshCw,
  Search,
  Sprout,
  X,
} from 'lucide-react';
import type { DashboardData, SpeciesOverview } from '../types';
import { describeError, fetchDashboardData, fetchOverview, isAbortError } from '../services/api';
import SpeciesAvatar from '../components/SpeciesAvatar';
import {
  CHART_COLORS,
  CHART_FONT_FAMILY,
  CHART_GRID_COLOR,
  CHART_SERIF_FAMILY,
  CHART_TEXT_COLOR,
  baseChartOptions,
  hexToRgba,
  makeGradient,
} from '../lib/chartTheme';

Chart.register(...registerables);

/** Compact count for stats, bubbles and chart ticks: below 1000 as-is, then 12k / 3.4M. */
const formatCompact = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
};

/** Stagger index → CSS custom property consumed by `.stagger-item` entrance animation. */
const stagger = (i: number) => ({ '--i': i } as React.CSSProperties);

/**
 * Animated integer counter: easeOutCubic over `durationMs`, restarting whenever
 * `target` changes. NaN/0-safe; with prefers-reduced-motion the final value is
 * shown immediately.
 */
const useCountUp = (target: number, durationMs = 1200): number => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const safeTarget = Number.isFinite(target) && target > 0 ? Math.round(target) : 0;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(safeTarget);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(safeTarget * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
};

// ============================================================
//  Decorative DNA double helix for the hero backdrop — two sine
//  strands (x woven between 40 and 160) plus horizontal rungs.
// ============================================================
const helixStrand = (startControl: number): string => {
  let d = 'M100 -100 ';
  let c = startControl;
  for (let y = -100; y < 700; y += 100) {
    d += `C${c} ${y + 25} ${c} ${y + 75} 100 ${y + 100} `;
    c = c === 160 ? 40 : 160;
  }
  return d;
};
const HELIX_STRAND_A = helixStrand(160);
const HELIX_STRAND_B = helixStrand(40);
const HELIX_RUNGS = [-50, 50, 150, 250, 350, 450, 550, 650];

// ============================================================
//  Inline chart plugins — they live and die with the Chart
//  instance, so the usual chart.destroy() cleanup is untouched.
// ============================================================

/** Rounded-rect path helper (capsule radius clamped to the box). */
const roundedRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void => {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

/** Faint journal-100 capsule track drawn behind every horizontal bar. */
const capsuleTrack: Plugin<'bar'> = {
  id: 'capsuleTrack',
  beforeDatasetsDraw: chart => {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.fillStyle = 'rgba(232, 229, 221, 0.45)'; // journal-100 wash
    for (const el of meta.data) {
      const { y, height } = (el as BarElement).getProps(['y', 'height'], true);
      if (y == null) continue;
      const h = Math.max(height, 4);
      roundedRectPath(ctx, chartArea.left, y - h / 2, chartArea.right - chartArea.left, h, h / 2);
      ctx.fill();
    }
    ctx.restore();
  },
};

/** Serif value labels drawn at the end of each horizontal bar. */
const barEndLabels = (format: (v: number) => string): Plugin<'bar'> => ({
  id: 'barEndLabels',
  afterDatasetsDraw: chart => {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data as number[];
    ctx.save();
    ctx.font = `10px ${CHART_SERIF_FAMILY}`;
    ctx.fillStyle = '#5f5547'; // journal-700
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < meta.data.length; i++) {
      const { x, y } = (meta.data[i] as BarElement).getProps(['x', 'y'], true);
      if (x == null || y == null) continue;
      const label = format(Number(data[i]));
      // Keep the label inside the plot area even for the longest bar.
      const lx = Math.min(x + 6, chartArea.right - ctx.measureText(label).width - 2);
      ctx.fillText(label, lx, y);
    }
    ctx.restore();
  },
});

/** Dashed horizontal average reference line for the chromosome area chart. */
const avgLine = (values: number[]): Plugin<'line'> => ({
  id: 'avgLine',
  afterDraw: chart => {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || values.length === 0) return;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const y = scales.y.getPixelForValue(avg);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.strokeStyle = '#b8b0a0'; // journal-300
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `10px ${CHART_FONT_FAMILY}`;
    ctx.fillStyle = '#9c917d'; // journal-400
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('avg', chartArea.right - 2, y - 3);
    ctx.restore();
  },
});

const ErrorBanner: React.FC<{ title: string; message: string; onRetry: () => void }> = ({
  title,
  message,
  onRetry,
}) => (
  <div className="flex flex-wrap items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4" role="alert">
    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-red-800">{title}</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
    </div>
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      Retry
    </button>
  </div>
);

const MODULES = [
  {
    title: 'Data Browser',
    desc: 'Filter and search cis-regulatory elements by ID, genomic position, or gene association.',
    icon: Database,
    to: '/data',
  },
  {
    title: 'Genome Browser',
    desc: 'Visualize peaks in context with gene models using JBrowse 2.',
    icon: Layers,
    to: '/jbrowse',
  },
  {
    title: 'Bulk Download',
    desc: 'Access full datasets in standardized formats for offline analysis.',
    icon: FileText,
    to: '/download',
  },
];

const Home: React.FC = () => {
  const [overview, setOverview] = useState<SpeciesOverview[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewRetryTick, setOverviewRetryTick] = useState(0);

  const [selectedSpecies, setSelectedSpecies] = useState('');
  // Dashboard data is tagged with its species, so stale data is never rendered
  // under a newly selected species title — a switch instantly shows the skeleton.
  const [dashboard, setDashboard] = useState<{ species: string; data: DashboardData } | null>(null);
  const [dashboardError, setDashboardError] = useState<{ species: string; message: string } | null>(null);
  const [dashboardRetryTick, setDashboardRetryTick] = useState(0);

  const [speciesFilter, setSpeciesFilter] = useState('');
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const tissueCanvasRef = useRef<HTMLCanvasElement>(null);
  const typeCanvasRef = useRef<HTMLCanvasElement>(null);
  const genesCanvasRef = useRef<HTMLCanvasElement>(null);
  const chrCanvasRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Species overview — single abortable request on mount / retry.
  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const list = await fetchOverview(ctrl.signal);
        setOverview(list);
        setOverviewError(null);
        if (list.length > 0) setSelectedSpecies(prev => prev || list[0].species);
      } catch (err) {
        if (isAbortError(err)) return;
        setOverview([]);
        setOverviewError(describeError(err));
      }
    };
    load();
    return () => ctrl.abort();
  }, [overviewRetryTick]);

  // Per-species dashboard data — re-fetched on species change / retry.
  useEffect(() => {
    if (!selectedSpecies) return;
    const species = selectedSpecies;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const data = await fetchDashboardData(species, ctrl.signal);
        setDashboard({ species, data });
        setDashboardError(null);
      } catch (err) {
        if (isAbortError(err)) return;
        setDashboardError({ species, message: describeError(err) });
      }
    };
    load();
    return () => ctrl.abort();
  }, [selectedSpecies, dashboardRetryTick]);

  const dashboardData = dashboard && dashboard.species === selectedSpecies ? dashboard.data : null;
  const visibleDashboardError =
    dashboardError && dashboardError.species === selectedSpecies ? dashboardError.message : null;
  const dashboardLoading = !!selectedSpecies && !dashboardData && !visibleDashboardError;

  // Figure 1 — genomic annotation distribution as a doughnut; the center text
  // plugin draws the selected species' total peaks inside the cutout.
  useEffect(() => {
    const canvas = annotationCanvasRef.current;
    const dist = dashboardData?.distribution;
    if (!canvas || !dist || dist.length === 0) return;
    const totalPeaks = dashboardData?.stats.totalPeaks ?? 0;
    const speciesName = dashboard?.species ?? selectedSpecies;
    const colors = dist.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    const base = baseChartOptions<'doughnut'>();
    const centerText: Plugin<'doughnut'> = {
      id: 'centerText',
      afterDraw: chart => {
        const { ctx, chartArea } = chart;
        const x = (chartArea.left + chartArea.right) / 2;
        const y = (chartArea.top + chartArea.bottom) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 22px ${CHART_SERIF_FAMILY}`;
        ctx.fillStyle = '#15273f'; // navy-900
        ctx.fillText(totalPeaks.toLocaleString(), x, y - 10);
        ctx.font = `italic 11px ${CHART_SERIF_FAMILY}`;
        ctx.fillStyle = '#8b7e6a'; // journal-500
        ctx.fillText(speciesName, x, y + 12);
        ctx.restore();
      },
    };
    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: dist.map(d => d.label),
        datasets: [
          {
            data: dist.map(d => d.value),
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 2,
            borderRadius: 4,
            spacing: 2,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        ...base,
        cutout: '62%',
        plugins: {
          ...base.plugins,
          legend: {
            ...base.plugins?.legend,
            position: 'right',
            labels: {
              ...base.plugins?.legend?.labels,
              // Default legend entries annotated with each slice's percentage.
              generateLabels: (c): LegendItem[] => {
                const ds = c.data.datasets[0];
                const fills = (ds.backgroundColor ?? []) as string[];
                return (c.data.labels ?? []).map((label, i) => ({
                  text: `${String(label)} · ${Number(ds.data[i])}%`,
                  fillStyle: fills[i] ?? CHART_COLORS[0],
                  strokeStyle: fills[i] ?? CHART_COLORS[0],
                  lineWidth: 0,
                  pointStyle: 'circle',
                  hidden: !c.getDataVisibility(i),
                  index: i,
                }));
              },
            },
          },
          tooltip: {
            ...base.plugins?.tooltip,
            callbacks: { label: item => ` ${item.label}: ${Number(item.raw)}%` },
          },
        },
      },
      plugins: [centerText],
    });
    return () => {
      chart.destroy();
    };
  }, [dashboardData]);

  // Figure 2 — tissue-specific peak density, navy gradient horizontal bars.
  useEffect(() => {
    const canvas = tissueCanvasRef.current;
    const tissues = dashboardData?.tissues;
    if (!canvas || !tissues || tissues.length === 0) return;
    const sorted = [...tissues].sort((a, b) => a.count - b.count);
    const base = baseChartOptions<'bar'>();
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(t => t.label),
        datasets: [
          {
            data: sorted.map(t => t.count),
            backgroundColor: context => {
              const { ctx, chartArea } = context.chart;
              if (!chartArea) return '#3d72aa';
              return makeGradient(
                ctx,
                chartArea,
                'rgba(144, 178, 216, 0.65)',
                'rgba(61, 114, 170, 0.95)',
                'horizontal'
              );
            },
            hoverBackgroundColor: context => {
              const { ctx, chartArea } = context.chart;
              if (!chartArea) return '#d64b6d';
              return makeGradient(
                ctx,
                chartArea,
                'rgba(240, 166, 182, 0.7)',
                'rgba(214, 75, 109, 0.95)',
                'horizontal'
              );
            },
            borderRadius: 999,
            borderSkipped: false,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        ...base,
        indexAxis: 'y',
        plugins: {
          ...base.plugins,
          legend: { display: false },
          tooltip: {
            ...base.plugins?.tooltip,
            callbacks: { label: item => ` ${Number(item.raw).toLocaleString()} peaks` },
          },
        },
        scales: {
          x: {
            // Headroom so the serif end labels never clip.
            suggestedMax: sorted[sorted.length - 1].count * 1.15,
            grid: { color: CHART_GRID_COLOR },
            border: { display: false },
            ticks: {
              color: CHART_TEXT_COLOR,
              font: { family: CHART_FONT_FAMILY, size: 10 },
              callback: value => formatCompact(Number(value)),
            },
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: CHART_TEXT_COLOR, font: { family: CHART_FONT_FAMILY, size: 10 } },
          },
        },
      },
      plugins: [capsuleTrack, barEndLabels(formatCompact)],
    });
    return () => {
      chart.destroy();
    };
  }, [dashboardData]);

  // Peak type distribution — polar area with translucent palette fills.
  useEffect(() => {
    const canvas = typeCanvasRef.current;
    const typeDist = dashboardData?.typeDist;
    if (!canvas || !typeDist || typeDist.length === 0) return;
    const base = baseChartOptions<'polarArea'>();
    const chart = new Chart(canvas, {
      type: 'polarArea',
      data: {
        labels: typeDist.map(t => t.label),
        datasets: [
          {
            data: typeDist.map(t => t.count),
            backgroundColor: typeDist.map((_, i) =>
              hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.75)
            ),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        ...base,
        plugins: {
          ...base.plugins,
          legend: { ...base.plugins?.legend, position: 'bottom' },
          tooltip: {
            ...base.plugins?.tooltip,
            callbacks: { label: item => ` ${item.label}: ${Number(item.raw).toLocaleString()} peaks` },
          },
        },
        scales: {
          r: {
            grid: { color: CHART_GRID_COLOR, circular: true },
            angleLines: { color: CHART_GRID_COLOR },
            ticks: { display: false },
          },
        },
      },
    });
    return () => {
      chart.destroy();
    };
  }, [dashboardData]);

  // Top associated genes — burgundy gradient horizontal bars.
  useEffect(() => {
    const canvas = genesCanvasRef.current;
    const topGenes = dashboardData?.topGenes;
    if (!canvas || !topGenes || topGenes.length === 0) return;
    const sorted = [...topGenes].sort((a, b) => a.count - b.count);
    const base = baseChartOptions<'bar'>();
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(g => g.label),
        datasets: [
          {
            data: sorted.map(g => g.count),
            backgroundColor: context => {
              const { ctx, chartArea } = context.chart;
              if (!chartArea) return '#d64b6d';
              return makeGradient(
                ctx,
                chartArea,
                'rgba(240, 166, 182, 0.65)',
                'rgba(214, 75, 109, 0.95)',
                'horizontal'
              );
            },
            borderRadius: 999,
            borderSkipped: false,
            maxBarThickness: 16,
          },
        ],
      },
      options: {
        ...base,
        indexAxis: 'y',
        plugins: {
          ...base.plugins,
          legend: { display: false },
          tooltip: {
            ...base.plugins?.tooltip,
            callbacks: { label: item => ` ${Number(item.raw).toLocaleString()} peaks` },
          },
        },
        scales: {
          x: {
            suggestedMax: sorted[sorted.length - 1].count * 1.15,
            grid: { color: CHART_GRID_COLOR },
            border: { display: false },
            ticks: {
              color: CHART_TEXT_COLOR,
              font: { family: CHART_FONT_FAMILY, size: 10 },
              callback: value => formatCompact(Number(value)),
            },
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: CHART_TEXT_COLOR,
              font: { family: CHART_FONT_FAMILY, size: 10 },
            },
          },
        },
      },
      plugins: [capsuleTrack, barEndLabels(formatCompact)],
    });
    return () => {
      chart.destroy();
    };
  }, [dashboardData]);

  // Chromosome distribution — smoothed line with a navy gradient area fill.
  useEffect(() => {
    const canvas = chrCanvasRef.current;
    const chrDist = dashboardData?.chrDist;
    if (!canvas || !chrDist || chrDist.length === 0) return;
    const base = baseChartOptions<'line'>();
    const counts = chrDist.map(c => c.count);
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: chrDist.map(c => c.label),
        datasets: [
          {
            data: counts,
            borderColor: context => {
              const { ctx, chartArea } = context.chart;
              if (!chartArea) return '#2d5a8f';
              return makeGradient(ctx, chartArea, '#90b2d8', '#2d5a8f', 'horizontal');
            },
            borderWidth: 2,
            fill: true,
            backgroundColor: context => {
              const { ctx, chartArea } = context.chart;
              if (!chartArea) return 'rgba(61, 114, 170, 0.12)';
              return makeGradient(
                ctx,
                chartArea,
                'rgba(61, 114, 170, 0.22)',
                'rgba(61, 114, 170, 0.03)',
                'vertical'
              );
            },
            tension: 0.35,
            pointStyle: 'rectRot',
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#2d5a8f',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        ...base,
        plugins: {
          ...base.plugins,
          legend: { display: false },
          tooltip: {
            ...base.plugins?.tooltip,
            callbacks: { label: item => ` ${Number(item.raw).toLocaleString()} peaks` },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: CHART_TEXT_COLOR, font: { family: CHART_FONT_FAMILY, size: 10 } },
          },
          y: {
            grid: { color: CHART_GRID_COLOR },
            border: { display: false },
            ticks: {
              color: CHART_TEXT_COLOR,
              font: { family: CHART_FONT_FAMILY, size: 10 },
              callback: value => formatCompact(Number(value)),
            },
          },
        },
      },
      plugins: [avgLine(counts)],
    });
    return () => {
      chart.destroy();
    };
  }, [dashboardData]);

  const speciesList = overview ?? [];
  const grandTotal = speciesList.reduce((sum, o) => sum + o.totalPeaks, 0);
  const tissueTypeCount = new Set(speciesList.flatMap(o => o.topTissues.map(t => t.label))).size;

  const heroPeaks = useCountUp(grandTotal);
  const heroSpecies = useCountUp(speciesList.length);
  const heroTissues = useCountUp(tissueTypeCount);

  const filteredOverview = speciesFilter
    ? speciesList.filter(o => o.species.toLowerCase().includes(speciesFilter.toLowerCase()))
    : speciesList;

  // Bubble size: 56–140 px scaled by relative peak count.
  const maxPeaks = speciesList.length ? Math.max(...speciesList.map(o => o.totalPeaks)) : 1;
  const getIconSize = (peaks: number) => Math.max(56, Math.min(140, 48 + (peaks / maxPeaks) * 92));

  if (overview === null && !overviewError) {
    return (
      <div className="flex h-[50vh] items-center justify-center gap-3 font-serif text-journal-500" role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        Loading Database...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section
        className="stagger-item hero-gradient relative overflow-hidden rounded-lg px-8 py-12 text-white"
        style={stagger(0)}
      >
        {/* Decorative DNA double helix, right edge */}
        <svg
          className="pointer-events-none absolute right-0 top-0 hidden h-full lg:block"
          width="260"
          viewBox="0 0 200 600"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <g fill="none" stroke="#ffffff" strokeOpacity="0.09" strokeWidth="2">
            <path d={HELIX_STRAND_A} />
            <path d={HELIX_STRAND_B} />
          </g>
          <g stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1.5">
            {HELIX_RUNGS.map(y => (
              <line key={y} x1="55" y1={y} x2="145" y2={y} />
            ))}
          </g>
        </svg>

        <div className="relative flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="mb-4 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-navy-200">
              <span className="inline-block h-px w-10 bg-white/40" aria-hidden="true" />
              HZAU · Functional Genomics Laboratory
            </p>
            <h1 className="mb-2 text-5xl text-white sm:text-6xl">CREDB</h1>
            <p className="font-serif text-xl italic text-navy-100">
              Cis-Regulatory Elements Database
            </p>
            <p className="mt-5 text-justify text-sm leading-relaxed text-navy-50/90 sm:text-base">
              Cis-regulatory elements (CREs) are fundamental drivers of transcriptional regulation,
              yet their annotation in complex plant genomes remains incomplete. CREDB is an
              integrated repository characterizing chromatin accessibility landscapes{' '}
              {speciesList.length > 0 ? (
                <>
                  across <strong className="text-white">{speciesList.length} species</strong>{' '}
                  spanning over{' '}
                  <strong className="text-white">{grandTotal.toLocaleString()}</strong> accessible
                  chromatin regions
                </>
              ) : (
                'across major crop species'
              )}
              . By synthesizing multi-omics data, we provide a high-resolution map of accessible
              chromatin regions linked to transcriptional activity across diverse major crop
              species.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/data"
                className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-2.5 text-sm font-bold text-navy-900 shadow-md transition-all hover:-translate-y-0.5 hover:bg-navy-50 hover:text-navy-900 hover:no-underline"
              >
                Explore Data Repository <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/analysis"
                className="inline-flex items-center gap-2 rounded-md border border-white/70 px-5 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-white hover:no-underline"
              >
                Online Analysis <Activity className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* Frosted-glass live stats with count-up animation */}
          <div className="w-full shrink-0 rounded-lg border border-white/20 bg-white/10 p-6 backdrop-blur-md lg:w-64">
            <div className="flex flex-col divide-y divide-white/15">
              {[
                { label: 'Total Peaks', value: heroPeaks },
                { label: 'Species', value: heroSpecies },
                { label: 'Tissue Types', value: heroTissues },
              ].map(s => (
                <div key={s.label} className="py-3 first:pt-0 last:pb-0">
                  <p className="stat-number text-3xl text-white sm:text-4xl">
                    {s.value.toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-widest text-navy-200">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {overviewError && (
        <ErrorBanner
          title="Failed to load species overview"
          message={overviewError}
          onRetry={() => setOverviewRetryTick(t => t + 1)}
        />
      )}

      {/* Empty database state */}
      {!overviewError && overview !== null && speciesList.length === 0 && (
        <section className="card-elevated rounded-md border border-journal-200 bg-white p-12 text-center">
          <Database className="mx-auto h-12 w-12 text-journal-300" aria-hidden="true" />
          <h2 className="mt-4 text-journal-900">No Data Yet</h2>
          <p className="mx-auto max-w-md text-sm text-journal-600">
            The database does not contain any species records yet. Import a dataset to populate the
            atlas.
          </p>
          <Link
            to="/submit"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-navy-800 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-navy-700 hover:text-white hover:no-underline"
          >
            Submit Data <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      )}

      {speciesList.length > 0 && (
        <>
          {/* Species atlas */}
          <section
            className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5 sm:p-6"
            style={stagger(1)}
          >
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-journal-200 pb-4">
              <div>
                <p className="section-kicker">01 — Explore</p>
                <h2 className="mb-0 mt-1 flex items-center gap-2 text-journal-900">
                  <Sprout className="h-5 w-5" aria-hidden="true" />
                  Species Atlas
                  <span className="text-sm font-normal text-journal-400">({speciesList.length} species)</span>
                </h2>
              </div>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-journal-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  placeholder="Filter species..."
                  aria-label="Filter species"
                  value={speciesFilter}
                  onChange={e => setSpeciesFilter(e.target.value)}
                  className="w-48 rounded-md border border-journal-300 bg-paper py-2 pl-9 pr-8 text-sm text-journal-900 outline-none transition-colors focus:border-navy-600 focus:bg-white focus:ring-2 focus:ring-navy-100"
                />
                {speciesFilter && (
                  <button
                    type="button"
                    aria-label="Clear species filter"
                    onClick={() => setSpeciesFilter('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-journal-400 transition-colors hover:text-journal-700"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex min-h-[200px] flex-wrap justify-center gap-3 md:gap-4">
              {filteredOverview.map((o, i) => {
                const size = getIconSize(o.totalPeaks);
                const isSelected = selectedSpecies === o.species;
                return (
                  <button
                    key={o.species}
                    type="button"
                    aria-label={`View details for ${o.species}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedSpecies(o.species);
                      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    onMouseEnter={() => setActiveTooltip(o.species)}
                    onMouseLeave={() => setActiveTooltip(null)}
                    onFocus={() => setActiveTooltip(o.species)}
                    onBlur={() => setActiveTooltip(null)}
                    className="stagger-item group relative flex flex-col items-center"
                    style={stagger(i + 2)}
                  >
                    <span
                      className={`flex items-center justify-center rounded-full transition-all duration-300 ${
                        isSelected
                          ? 'scale-105 border-2 border-transparent bg-navy-50 shadow-lg ring-2 ring-navy-600 ring-offset-2 ring-offset-white'
                          : 'border-2 border-journal-200 bg-white group-hover:-translate-y-1 group-hover:scale-105 group-hover:border-navy-300 group-hover:shadow-md'
                      }`}
                      style={{ width: size, height: size }}
                    >
                      <SpeciesAvatar species={o.species} size={size * 0.88} />
                    </span>
                    <span
                      className={`mt-2 max-w-[90px] text-center font-serif text-xs font-bold leading-tight transition-colors ${
                        isSelected ? 'text-navy-900' : 'text-journal-600'
                      }`}
                    >
                      {o.species.split(' ').map((w, i) => (
                        <span key={i} className="block">{w}</span>
                      ))}
                    </span>
                    <span className="tnum mt-0.5 text-[10px] text-journal-400">
                      {formatCompact(o.totalPeaks)}
                    </span>

                    {/* Tooltip — shown on hover and keyboard focus */}
                    {activeTooltip === o.species && (
                      <span className="pointer-events-none absolute -top-2 left-1/2 z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-navy-900 px-3 py-2 text-left text-xs text-white shadow-xl">
                        <span className="block font-bold">{o.species}</span>
                        <span className="block opacity-80">
                          {o.totalPeaks.toLocaleString()} peaks · {o.topContexts.length} annotations
                        </span>
                        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-navy-900" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {filteredOverview.length === 0 && (
              <p className="py-10 text-center font-serif text-journal-400">
                No species match &ldquo;{speciesFilter}&rdquo;
              </p>
            )}

            <p className="mt-4 text-center text-xs text-journal-400">
              Bubble size represents relative peak count — click a species to explore
            </p>
          </section>

          {/* Species detail (scroll target) */}
          <div ref={detailRef} className="scroll-mt-20">
            <section className="stagger-item space-y-6" style={stagger(2)}>
              <div>
                <p className="section-kicker">02 — Details</p>
                <h2 className="mt-1 flex items-center gap-2 border-b border-journal-200 pb-2 text-journal-900">
                  <PieChart className="h-6 w-6" aria-hidden="true" />
                  Species Detail: <em className="text-journal-600">{selectedSpecies}</em>
                </h2>
              </div>

              {visibleDashboardError ? (
                <ErrorBanner
                  title={`Failed to load dashboard for ${selectedSpecies}`}
                  message={visibleDashboardError}
                  onRetry={() => setDashboardRetryTick(t => t + 1)}
                />
              ) : (
                <>
                  {/* Table 1 — summary statistics */}
                  <div className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5" style={stagger(3)}>
                    <div className="overflow-x-auto">
                      <table className="academic-table">
                        <thead>
                          <tr>
                            <th>Total Peaks</th>
                            <th>Tissues</th>
                            <th>Annotations</th>
                            <th>Peak Types</th>
                            <th>Chromosomes</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {!dashboardData ? (
                              <td colSpan={5}>
                                <div className="h-6 animate-pulse rounded-sm bg-journal-100" />
                              </td>
                            ) : (
                              <>
                                <td className="tnum text-base font-bold text-navy-900">
                                  {dashboardData.stats.totalPeaks.toLocaleString()}
                                </td>
                                <td className="tnum text-base font-bold text-navy-900">
                                  {dashboardData.stats.tissues.toLocaleString()}
                                </td>
                                <td className="tnum text-base font-bold text-navy-900">
                                  {dashboardData.distribution.length}
                                </td>
                                <td className="tnum text-base font-bold text-navy-900">
                                  {dashboardData.typeDist?.length ?? '—'}
                                </td>
                                <td className="tnum text-base font-bold text-navy-900">
                                  {dashboardData.chrDist?.length ?? '—'}
                                </td>
                              </>
                            )}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="fig-caption">
                      <strong>Table 1.</strong> Summary of chromatin accessibility data available
                      for <em>{selectedSpecies}</em>.
                    </p>
                  </div>

                  {/* Figures */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5" style={stagger(4)}>
                      <div className="flex items-center justify-between gap-2 border-b border-journal-100 pb-2">
                        <h3 className="mb-0 text-base text-journal-900">
                          Genomic Annotation Distribution
                        </h3>
                        <span className="rounded-full border border-journal-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-journal-400">
                          Doughnut
                        </span>
                      </div>
                      <div className="mt-3 h-72">
                        {dashboardData?.distribution?.length ? (
                          <canvas ref={annotationCanvasRef} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {dashboardLoading ? (
                              <div className="h-full w-full animate-pulse rounded-sm bg-journal-50" />
                            ) : (
                              <span className="text-sm text-journal-400">No data</span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="fig-caption">
                        <strong>Fig 1.</strong> Distribution of chromatin accessibility peaks
                        relative to genomic features for <em>{selectedSpecies}</em> (percent of
                        total; center label shows total peaks).
                      </p>
                    </div>
                    <div className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5" style={stagger(5)}>
                      <div className="flex items-center justify-between gap-2 border-b border-journal-100 pb-2">
                        <h3 className="mb-0 text-base text-journal-900">
                          Tissue-specific Peak Density
                        </h3>
                        <span className="rounded-full border border-journal-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-journal-400">
                          Bars
                        </span>
                      </div>
                      <div className="mt-3 h-72">
                        {dashboardData?.tissues?.length ? (
                          <canvas ref={tissueCanvasRef} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {dashboardLoading ? (
                              <div className="h-full w-full animate-pulse rounded-sm bg-journal-50" />
                            ) : (
                              <span className="text-sm text-journal-400">No data</span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="fig-caption">
                        <strong>Fig 2.</strong> Number of high-confidence peaks identified across
                        tissue and developmental stage samples in <em>{selectedSpecies}</em>.
                      </p>
                    </div>
                  </div>

                  {/* Row 2: types + genes + chromosomes */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <div className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5 lg:col-span-4" style={stagger(6)}>
                      <div className="flex items-center justify-between gap-2 border-b border-journal-100 pb-2">
                        <h3 className="mb-0 text-base text-journal-900">
                          Peak Type Distribution
                        </h3>
                        <span className="rounded-full border border-journal-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-journal-400">
                          Polar
                        </span>
                      </div>
                      <div className="mt-3 h-64">
                        {dashboardData?.typeDist?.length ? (
                          <canvas ref={typeCanvasRef} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {dashboardLoading ? (
                              <div className="h-full w-full animate-pulse rounded-sm bg-journal-50" />
                            ) : (
                              <span className="text-sm text-journal-400">No type data</span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="fig-caption">
                        <strong>Fig 3.</strong> Relative abundance of peak types in{' '}
                        <em>{selectedSpecies}</em>.
                      </p>
                    </div>

                    <div className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5 lg:col-span-4" style={stagger(7)}>
                      <div className="flex items-center justify-between gap-2 border-b border-journal-100 pb-2">
                        <h3 className="mb-0 text-base text-journal-900">
                          Top Associated Genes
                        </h3>
                        <span className="rounded-full border border-journal-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-journal-400">
                          Bars
                        </span>
                      </div>
                      <div className="mt-3 h-64">
                        {dashboardData?.topGenes?.length ? (
                          <canvas ref={genesCanvasRef} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {dashboardLoading ? (
                              <div className="h-full w-full animate-pulse rounded-sm bg-journal-50" />
                            ) : (
                              <span className="text-sm text-journal-400">No gene data</span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="fig-caption">
                        <strong>Fig 4.</strong> Genes most frequently associated with accessible
                        peaks in <em>{selectedSpecies}</em>.
                      </p>
                    </div>

                    <div className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-5 lg:col-span-4" style={stagger(8)}>
                      <div className="flex items-center justify-between gap-2 border-b border-journal-100 pb-2">
                        <h3 className="mb-0 text-base text-journal-900">
                          Chromosome Distribution
                        </h3>
                        <span className="rounded-full border border-journal-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-journal-400">
                          Area
                        </span>
                      </div>
                      <div className="mt-3 h-64">
                        {dashboardData?.chrDist?.length ? (
                          <canvas ref={chrCanvasRef} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {dashboardLoading ? (
                              <div className="h-full w-full animate-pulse rounded-sm bg-journal-50" />
                            ) : (
                              <span className="text-sm text-journal-400">No chr data</span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="fig-caption">
                        <strong>Fig 5.</strong> Peaks per chromosome in <em>{selectedSpecies}</em>.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}

      {/* Module overview */}
      <section className="stagger-item space-y-4 pt-2" style={stagger(9)}>
        <div>
          <p className="section-kicker">03 — Modules</p>
          <h2 className="mb-0 mt-1 border-b border-journal-200 pb-2 text-journal-900">
            Module Overview
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {MODULES.map((m, i) => (
            <Link
              key={m.title}
              to={m.to}
              className="stagger-item card-elevated group rounded-md border border-journal-200 bg-white p-5 hover:no-underline"
              style={stagger(10 + i)}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="rounded-sm bg-journal-50 p-2 text-journal-800 transition-colors group-hover:bg-navy-900 group-hover:text-white">
                  <m.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mb-0 text-base text-journal-900">{m.title}</h3>
              </div>
              <p className="text-sm text-journal-600">{m.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;

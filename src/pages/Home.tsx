import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart, registerables } from 'chart.js';
import type { LegendItem, Plugin } from 'chart.js';
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
//  SPECIES ICON — auto-derived: "Triticum aestivum" → /icon/Triticum_aestivum.png
//  Put .png files in public/icon/ named after the species (spaces → _)
//  For exceptions (different filenames), add to OVERRIDES below.
// ============================================================
const OVERRIDES: Record<string, string> = {
  // 'Species name': 'actual_filename.png'
};

const getIconSrc = (species: string) => {
  if (OVERRIDES[species]) return `/icon/${OVERRIDES[species]}`;
  return `/icon/${species.replace(/ /g, '_')}.png`;
};

const SpeciesIcon: React.FC<{ species: string; size: number }> = ({ species, size }) => {
  // Mark the icon as failed once so a missing file is never re-requested.
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span role="img" aria-label={species} style={{ fontSize: size * 0.5, lineHeight: 1 }}>
        🌿
      </span>
    );
  }
  return (
    <img
      src={getIconSrc(species)}
      alt={species}
      loading="lazy"
      style={{ width: size * 0.7, height: size * 0.7, objectFit: 'contain' }}
      onError={() => setFailed(true)}
    />
  );
};

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
        ctx.fillText(totalPeaks.toLocaleString(), x, y - 9);
        ctx.font = `11px ${CHART_FONT_FAMILY}`;
        ctx.fillStyle = '#8b7e6a'; // journal-500
        ctx.fillText('total peaks', x, y + 13);
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
            borderRadius: 6,
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
              hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.7)
            ),
            borderColor: '#ffffff',
            borderWidth: 1,
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
            grid: { color: CHART_GRID_COLOR },
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
            borderRadius: 6,
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
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: chrDist.map(c => c.label),
        datasets: [
          {
            data: chrDist.map(c => c.count),
            borderColor: '#2d5a8f', // navy-600
            borderWidth: 2,
            fill: true,
            backgroundColor: context => {
              const { ctx, chartArea } = context.chart;
              if (!chartArea) return 'rgba(61, 114, 170, 0.15)';
              return makeGradient(
                ctx,
                chartArea,
                'rgba(61, 114, 170, 0.28)',
                'rgba(61, 114, 170, 0.02)',
                'vertical'
              );
            },
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#2d5a8f',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
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
        className="stagger-item hero-gradient rounded-lg px-8 py-12 text-white"
        style={stagger(0)}
      >
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
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

          {/* Live aggregate stats with count-up animation */}
          <div className="flex shrink-0 flex-wrap gap-8 border-t border-white/20 pt-6 lg:flex-col lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            {[
              { label: 'Total Peaks', value: heroPeaks },
              { label: 'Species', value: heroSpecies },
              { label: 'Tissue Types', value: heroTissues },
            ].map(s => (
              <div key={s.label}>
                <p className="stat-number text-white">{s.value.toLocaleString()}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-widest text-navy-200">
                  {s.label}
                </p>
              </div>
            ))}
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
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h2 className="mb-0 flex items-center gap-2 text-journal-900">
                <Sprout className="h-5 w-5" aria-hidden="true" />
                Species Atlas
                <span className="text-sm font-normal text-journal-400">({speciesList.length} species)</span>
              </h2>
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
                      className={`flex items-center justify-center rounded-full border-2 transition-all duration-300 ${
                        isSelected
                          ? 'scale-105 border-navy-700 bg-navy-100 shadow-lg'
                          : 'border-journal-200 bg-white group-hover:-translate-y-1 group-hover:scale-105 group-hover:border-navy-300 group-hover:shadow-md'
                      }`}
                      style={{ width: size, height: size }}
                    >
                      <SpeciesIcon species={o.species} size={size * 0.75} />
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
              <h2 className="flex items-center gap-2 border-b border-journal-200 pb-2 text-journal-900">
                <PieChart className="h-6 w-6" aria-hidden="true" />
                Species Detail: <em className="text-journal-600">{selectedSpecies}</em>
              </h2>

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
                      <h3 className="border-b border-journal-100 pb-2 text-base text-journal-900">
                        Genomic Annotation Distribution
                      </h3>
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
                      <h3 className="border-b border-journal-100 pb-2 text-base text-journal-900">
                        Tissue-specific Peak Density
                      </h3>
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
                      <h3 className="border-b border-journal-100 pb-2 text-base text-journal-900">
                        Peak Type Distribution
                      </h3>
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
                      <h3 className="border-b border-journal-100 pb-2 text-base text-journal-900">
                        Top Associated Genes
                      </h3>
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
                      <h3 className="border-b border-journal-100 pb-2 text-base text-journal-900">
                        Chromosome Distribution
                      </h3>
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
        <h2 className="mb-0 text-journal-900">Module Overview</h2>
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

import React, { useCallback, useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, Database, AlertCircle, RefreshCw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { fetchStats, getDownloadUrl, describeError, isAbortError } from '../services/api';
import type { SpeciesBreakdown } from '../types';

/** Backend may send Unix seconds or milliseconds — treat >= 1e12 as ms. */
const formatUpdatedAt = (updatedAt?: number): string => {
  if (updatedAt === undefined || updatedAt === null) return '—';
  const ms = updatedAt >= 1e12 ? updatedAt : updatedAt * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Shared chip style for dataset metadata (records, format, updated). */
const CHIP_CLASS =
  'rounded-full border border-journal-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-journal-400';

const Download: React.FC = () => {
  const [datasets, setDatasets] = useState<SpeciesBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const stats = await fetchStats(signal);
      setDatasets(stats.breakdown ?? []);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(describeError(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const handleRetry = () => {
    load();
  };

  const handleDownload = (species: string) => {
    // Anchor-click instead of window.location.href so a backend error page
    // never replaces the SPA and loses client state.
    const a = document.createElement('a');
    a.href = getDownloadUrl(species);
    a.download = '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24" role="status" aria-label="Loading datasets">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-journal-300 border-t-navy-700" />
        <span className="sr-only">Loading available datasets…</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        kicker="04 — Download"
        title="Bulk Download"
        description="Full TSV snapshots of every species dataset in CREDB, generated on-demand from the live database and distributed under CC BY 4.0."
        actions={
          !error && datasets.length > 0 ? (
            <span className={CHIP_CLASS}>
              <span className="tnum">{datasets.length}</span> species
            </span>
          ) : undefined
        }
      />

      {error ? (
        <div
          role="alert"
          className="stagger-item flex flex-col items-start gap-3 rounded-md border border-burgundy-200 bg-burgundy-50 p-6"
          style={{ '--i': 0 } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 text-burgundy-800">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="font-medium">Failed to load the dataset list.</p>
          </div>
          <p className="text-sm text-burgundy-700">{error}</p>
          <button
            onClick={handleRetry}
            className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : datasets.length === 0 ? (
        <div
          className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-12 text-center"
          style={{ '--i': 0 } as React.CSSProperties}
        >
          <Database className="mx-auto mb-4 h-16 w-16 text-journal-300" />
          <p className="font-serif text-lg text-journal-600">No datasets available in the database yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {datasets.map((d, i) => (
            <div
              key={d.species}
              className="stagger-item card-elevated flex flex-col gap-4 rounded-md border border-journal-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between"
              style={{ '--i': i } as React.CSSProperties}
            >
              <div className="flex items-start gap-4">
                <div className="rounded-md bg-navy-50 p-3 text-navy-700">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="font-serif text-lg text-navy-900">{d.species} Dataset</h2>
                  <p className="mt-1 text-sm text-journal-600">
                    Complete peak annotations and metadata for <em>{d.species}</em>.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={CHIP_CLASS}>
                      <span className="tnum">{d.count.toLocaleString()}</span> records
                    </span>
                    <span className={CHIP_CLASS}>TSV</span>
                    <span className={CHIP_CLASS}>Updated {formatUpdatedAt(d.updatedAt)}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDownload(d.species)}
                className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-md px-4 py-2 text-sm font-bold sm:self-center"
              >
                <FileDown className="h-4 w-4" />
                Download
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className="stagger-item card-elevated rounded-md border border-journal-200 bg-white p-6"
        style={{ '--i': datasets.length } as React.CSSProperties}
      >
        <h3 className="font-serif text-journal-800">Terms of Use</h3>
        <p className="text-sm text-journal-600">
          When using this data in your publications, please cite CREDB — see the <strong>How to Cite</strong>{' '}
          section in the footer of this page. Files are generated on-demand from the database and reflect its
          current contents.
        </p>
      </div>
    </div>
  );
};

export default Download;

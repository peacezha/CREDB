import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  Filter,
  Layers,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import DataGrid from '../components/DataGrid';
import {
  describeError,
  fetchData,
  fetchFilters,
  fetchSpeciesList,
  fetchSuggestions,
  isAbortError,
} from '../services/api';
import type { ApiResponse, ColumnDefinition, GenomicRecord, PaginationMeta } from '../types';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const ALL_SPECIES = 'All Species';
const ALL_TISSUES = 'All Tissues';
const ALL_CHROMOSOMES = 'All Chromosomes';
const DEFAULT_LIMIT = 15;
const PAGE_SIZE_OPTIONS = [15, 30, 50, 100];

// STANDARD CONFIGURATION (Mapped to DB Column Names)
// The backend normalizes these to lowercase snake_case (e.g. 'Peak_ID' -> 'peak_id')
const STANDARD_COLUMNS: ColumnDefinition[] = [
  { key: 'species', label: 'Species' },
  { key: 'peak_id', label: 'Peak ID' },
  { key: 'position', label: 'Position' },
  { key: 'tissue', label: 'Tissue' },
  { key: 'nearest_gene', label: 'Nearest Gene' },
  { key: 'to_tss', label: 'To TSS' },
  { key: 'type', label: 'Type' },
  { key: 'genomic_context', label: 'Genomic Context' },
  { key: 'summit', label: 'Summit' },
  { key: 'pam_position_link', label: 'PAM Position Link', isLink: true },
  { key: 'expression_link', label: 'Expression Link', isLink: true },
  { key: 'stage_link', label: 'JBrowse Link', isLink: true },
  { key: 'expression_tpm', label: 'Expression TPM' },
  { key: 'nearest_h3k9ac_peak', label: 'Nearest H3K9ac Peak' },
  { key: 'footprint', label: 'Footprint', isLongText: true },
];

const toExtraColumn = (key: string): ColumnDefinition => ({
  key,
  label: key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
  isLongText: /desc|seq|footprint/i.test(key),
});

const parsePositiveInt = (raw: string | null, fallback: number): number => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ---- Module-level query cache ------------------------------------------------
// Survives route changes / remounts. 45 s TTL, capped at 50 entries; when full
// the oldest entry (Map insertion order) is evicted.
interface PeakQuery {
  page: number;
  limit: number;
  q: string;
  species: string;
  tissue: string;
  chr: string;
}

const CACHE_TTL_MS = 45_000;
const CACHE_MAX_ENTRIES = 50;
const queryCache = new Map<string, { data: ApiResponse; expires: number }>();

const cacheKeyFor = (p: PeakQuery): string =>
  JSON.stringify([p.species, p.tissue, p.chr, p.q.trim(), p.page, p.limit]);

const cacheGet = (key: string): ApiResponse | null => {
  const hit = queryCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    queryCache.delete(key);
    return null;
  }
  return hit.data;
};

const cacheSet = (key: string, data: ApiResponse): void => {
  queryCache.delete(key); // re-insert as the most-recent entry
  queryCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  if (queryCache.size > CACHE_MAX_ENTRIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
};

const selectClass =
  'block w-full cursor-pointer appearance-none rounded-md border border-journal-300 bg-paper py-2.5 pl-10 pr-8 text-sm font-bold text-journal-900 outline-none transition-colors focus:border-navy-600 focus:bg-white focus:ring-2 focus:ring-navy-100 disabled:cursor-not-allowed disabled:opacity-50';

const FilterSelect: React.FC<{
  id: string;
  label: string;
  icon: React.ElementType;
  value: string;
  allLabel: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, icon: Icon, value, allLabel, options, disabled, onChange }) => (
  <div>
    <label
      htmlFor={id}
      className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wider text-journal-500"
    >
      {label}
    </label>
    <div className="relative">
      <Icon
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-journal-400"
        aria-hidden="true"
      />
      <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={selectClass}>
        <option value={allLabel}>{allLabel}</option>
        {options.map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        {/* Keep a URL-carried value selectable even while it is absent from the option list */}
        {value !== allLabel && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-journal-400"
        aria-hidden="true"
      />
    </div>
  </div>
);

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

const DataViewer: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the single source of truth for every filter — refreshing,
  // sharing, and navigating back/forward all restore the exact same view.
  const speciesParam = searchParams.get('species') ?? '';
  const tissueParam = searchParams.get('tissue') ?? '';
  const chrParam = searchParams.get('chr') ?? '';
  const qParam = searchParams.get('q') ?? '';
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const limit = parsePositiveInt(searchParams.get('limit'), DEFAULT_LIMIT);

  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          Object.entries(updates).forEach(([key, value]) => {
            if (value === null || value === '') next.delete(key);
            else next.set(key, String(value));
          });
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [data, setData] = useState<GenomicRecord[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page, limit, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataRetryTick, setDataRetryTick] = useState(0);
  // Stats for the currently displayed result set: server query time, or "cached".
  const [queryStats, setQueryStats] = useState<{ tookMs?: number; cached: boolean } | null>(null);

  // The search box is local state; its 400 ms-debounced value is written to the URL.
  const [searchInput, setSearchInput] = useState(qParam);
  const debouncedSearch = useDebounce(searchInput, 400);
  const debouncing = searchInput !== debouncedSearch;

  // ---- Autocomplete -----------------------------------------------------------
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suggestions, setSuggestions] = useState<{ peakIds: string[]; genes: string[] } | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The 200 ms suggestion debounce runs ahead of the 400 ms search debounce.
  const debouncedSuggest = useDebounce(searchInput, 200);
  // Selecting a suggestion (or pressing ESC) must not immediately reopen the
  // dropdown for the same text — remember what to suppress until the user types.
  const suppressSuggestFor = useRef<string | null>(null);

  const flatOptions = useMemo(() => {
    if (!suggestions) return [];
    return [...suggestions.peakIds, ...suggestions.genes];
  }, [suggestions]);

  useEffect(() => {
    const q = debouncedSuggest.trim();
    if (q.length < 2 || suppressSuggestFor.current === q) {
      if (q.length < 2) setSuggestions(null);
      return;
    }
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetchSuggestions(q, speciesParam || undefined, ctrl.signal);
        setSuggestions(res);
        setActiveIndex(-1);
        if (res.peakIds.length + res.genes.length > 0) setSuggestionsOpen(true);
      } catch (err) {
        if (isAbortError(err)) return;
        setSuggestions(null); // suggestions are auxiliary — fail silently
      }
    };
    load();
    return () => ctrl.abort();
  }, [debouncedSuggest, speciesParam]);

  // Tracks the last query this box wrote itself, so that only *external*
  // navigation (back/forward, pasted link) may overwrite the box contents.
  const lastWrittenQuery = useRef(qParam);
  useEffect(() => {
    if (qParam === lastWrittenQuery.current) return;
    lastWrittenQuery.current = qParam;
    setSearchInput(qParam);
  }, [qParam]);
  useEffect(() => {
    if (debouncedSearch === qParam) return;
    lastWrittenQuery.current = debouncedSearch;
    updateParams({ q: debouncedSearch || null, page: null });
    // qParam is intentionally read but not a dependency: reacting to it would
    // write the URL right back after external navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, updateParams]);

  // Filter option lists
  const [speciesList, setSpeciesList] = useState<string[]>([]);
  const [speciesError, setSpeciesError] = useState<string | null>(null);
  const [speciesRetryTick, setSpeciesRetryTick] = useState(0);
  const [tissueList, setTissueList] = useState<string[]>([]);
  const [chromosomeList, setChromosomeList] = useState<string[]>([]);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [filtersRetryTick, setFiltersRetryTick] = useState(0);

  // Extra (non-standard) columns accumulate as a union across pages so that
  // the table headers do not jitter when a page happens to lack a column.
  const [extraColumns, setExtraColumns] = useState<ColumnDefinition[]>([]);

  // Species list — abortable, with explicit error + retry.
  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const list = await fetchSpeciesList(ctrl.signal);
        setSpeciesList(list);
        setSpeciesError(null);
      } catch (err) {
        if (isAbortError(err)) return;
        setSpeciesList([]);
        setSpeciesError(describeError(err));
      }
    };
    load();
    return () => ctrl.abort();
  }, [speciesRetryTick]);

  // Tissue / chromosome options for the selected species.
  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const filters = await fetchFilters(speciesParam || ALL_SPECIES, ctrl.signal);
        setTissueList(filters.tissues);
        setChromosomeList(filters.chromosomes);
        setFiltersError(null);
      } catch (err) {
        if (isAbortError(err)) return;
        setTissueList([]);
        setChromosomeList([]);
        setFiltersError(describeError(err));
      }
    };
    load();
    return () => ctrl.abort();
  }, [speciesParam, filtersRetryTick]);

  // Main data query — re-runs on any URL change; the previous request is
  // aborted via the effect cleanup, so responses can never arrive out of order.
  // Results are served from / written to the module-level query cache, and the
  // next page is silently prefetched into that cache 300 ms after each load.
  useEffect(() => {
    const ctrl = new AbortController();
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
    let prefetchCtrl: AbortController | null = null;

    const query: PeakQuery = { page, limit, q: qParam, species: speciesParam, tissue: tissueParam, chr: chrParam };
    const key = cacheKeyFor(query);

    const applyResponse = (response: ApiResponse, cached: boolean) => {
      setData(response.data);
      setMeta(response.meta);
      setQueryStats({ tookMs: response.meta.tookMs, cached });

      const standardKeys = new Set(STANDARD_COLUMNS.map(c => c.key));
      const found = new Set<string>();
      response.data.forEach(row => {
        Object.keys(row).forEach(k => {
          if (k !== 'id' && !standardKeys.has(k)) found.add(k);
        });
      });
      if (found.size > 0) {
        setExtraColumns(prev => {
          const known = new Set(prev.map(c => c.key));
          const added = [...found].filter(k => !known.has(k)).map(toExtraColumn);
          return added.length > 0 ? [...prev, ...added] : prev;
        });
      }

      // Speculative next-page prefetch — own AbortController, cache-only, and
      // fully silent (aborts included): it never touches the UI.
      if (response.meta.page < response.meta.totalPages) {
        prefetchTimer = setTimeout(() => {
          prefetchCtrl = new AbortController();
          const nextQuery: PeakQuery = { ...query, page: response.meta.page + 1 };
          fetchData(nextQuery, prefetchCtrl.signal)
            .then(res => cacheSet(cacheKeyFor(nextQuery), res))
            .catch(() => {});
        }, 300);
      }
    };

    const load = async () => {
      setLoading(true);
      setError(null);

      const hit = cacheGet(key);
      if (hit) {
        applyResponse(hit, true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetchData(query, ctrl.signal);
        cacheSet(key, response);
        applyResponse(response, false);
      } catch (err) {
        if (isAbortError(err)) return;
        setData([]);
        setMeta(prev => ({ ...prev, total: 0, totalPages: 0 }));
        setQueryStats(null);
        setError(describeError(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    };
    load();

    return () => {
      ctrl.abort();
      if (prefetchTimer) clearTimeout(prefetchTimer);
      prefetchCtrl?.abort();
    };
  }, [page, limit, qParam, speciesParam, tissueParam, chrParam, dataRetryTick]);

  // Clear a pending blur-close timer on unmount.
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    []
  );

  // Standard columns + cumulative extra columns, keeping only columns that
  // have data in at least one row of the current page.
  const activeColumns = useMemo(() => {
    if (data.length === 0) return STANDARD_COLUMNS;
    return [...STANDARD_COLUMNS, ...extraColumns].filter(col =>
      data.some(row => {
        const val = row[col.key];
        return val !== null && val !== undefined && val !== '';
      })
    );
  }, [data, extraColumns]);

  // Species changes reset the dependent filters in the same atomic URL
  // update, so exactly one data request is fired afterwards.
  const handleSpeciesChange = (value: string) => {
    updateParams({ species: value === ALL_SPECIES ? null : value, tissue: null, chr: null, page: null });
  };
  const handleTissueChange = (value: string) => {
    updateParams({ tissue: value === ALL_TISSUES ? null : value, page: null });
  };
  const handleChromosomeChange = (value: string) => {
    updateParams({ chr: value === ALL_CHROMOSOMES ? null : value, page: null });
  };
  const handlePageChange = (newPage: number) => {
    updateParams({ page: newPage > 1 ? newPage : null });
  };
  const handlePageSizeChange = (size: number) => {
    updateParams({ limit: size === DEFAULT_LIMIT ? null : size, page: null });
  };

  // ---- Combobox interactions ---------------------------------------------------
  const selectSuggestion = (value: string) => {
    suppressSuggestFor.current = value;
    lastWrittenQuery.current = value;
    setSearchInput(value);
    setSuggestions(null);
    setSuggestionsOpen(false);
    setActiveIndex(-1);
    // Search immediately — do not wait for the 400 ms debounce.
    updateParams({ q: value, page: null });
    inputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const count = flatOptions.length;
    if (e.key === 'ArrowDown') {
      if (count === 0) return;
      e.preventDefault();
      setSuggestionsOpen(true);
      setActiveIndex(i => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      if (count === 0) return;
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? count - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (suggestionsOpen && activeIndex >= 0 && flatOptions[activeIndex]) {
        e.preventDefault();
        selectSuggestion(flatOptions[activeIndex]);
      } else if (searchInput.trim() !== qParam) {
        // No suggestion selected — run the typed query immediately.
        lastWrittenQuery.current = searchInput.trim();
        setSuggestionsOpen(false);
        updateParams({ q: searchInput.trim() || null, page: null });
      }
    } else if (e.key === 'Escape' && suggestionsOpen) {
      e.preventDefault();
      suppressSuggestFor.current = searchInput;
      setSuggestionsOpen(false);
      setActiveIndex(-1);
    }
  };

  const renderSuggestionOption = (value: string, index: number) => (
    <div
      key={value}
      id={`search-opt-${index}`}
      role="option"
      aria-selected={index === activeIndex}
      // Keep focus on the input so keyboard navigation survives the click.
      onMouseDown={e => e.preventDefault()}
      onClick={() => selectSuggestion(value)}
      onMouseEnter={() => setActiveIndex(index)}
      className={`cursor-pointer truncate px-3 py-1.5 font-mono text-xs ${
        index === activeIndex ? 'bg-navy-50 text-navy-900' : 'text-journal-800'
      }`}
    >
      {value}
    </div>
  );

  const statsText = (() => {
    if (!queryStats) return null;
    const parts = [`${meta.total.toLocaleString()} results`];
    if (queryStats.cached) parts.push('cached');
    else if (queryStats.tookMs !== undefined) parts.push(`${queryStats.tookMs} ms`);
    return parts.join(' · ');
  })();

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="mb-0 text-navy-900">Data Browser</h1>
        <p className="text-sm text-journal-500">
          Query the cis-regulatory elements database by Peak ID, genomic position, gene name, or
          functional annotation. Active filters are stored in the URL, so any view can be shared or
          bookmarked.
        </p>
      </div>

      {speciesError && (
        <ErrorBanner
          title="Failed to load species list"
          message={speciesError}
          onRetry={() => setSpeciesRetryTick(t => t + 1)}
        />
      )}

      {/* Filters + search */}
      <div className="space-y-4 rounded-md border border-journal-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FilterSelect
            id="filter-species"
            label="Species"
            icon={Layers}
            value={speciesParam || ALL_SPECIES}
            allLabel={ALL_SPECIES}
            options={speciesList}
            onChange={handleSpeciesChange}
          />
          <FilterSelect
            id="filter-tissue"
            label="Tissue"
            icon={Filter}
            value={tissueParam || ALL_TISSUES}
            allLabel={ALL_TISSUES}
            options={tissueList}
            disabled={tissueList.length === 0}
            onChange={handleTissueChange}
          />
          <FilterSelect
            id="filter-chromosome"
            label="Chromosome"
            icon={MapIcon}
            value={chrParam || ALL_CHROMOSOMES}
            allLabel={ALL_CHROMOSOMES}
            options={chromosomeList}
            disabled={chromosomeList.length === 0}
            onChange={handleChromosomeChange}
          />
        </div>

        {filtersError && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-amber-700" role="alert">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Filter options unavailable: {filtersError}</span>
            <button
              type="button"
              onClick={() => setFiltersRetryTick(t => t + 1)}
              className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Retry
            </button>
          </p>
        )}

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-journal-400"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={suggestionsOpen && flatOptions.length > 0}
            aria-controls="search-suggestions"
            aria-activedescendant={activeIndex >= 0 ? `search-opt-${activeIndex}` : undefined}
            aria-autocomplete="list"
            placeholder="Search Peak ID, gene, position (e.g. chr1:1000-2000)…"
            aria-label="Search records"
            value={searchInput}
            onChange={e => {
              suppressSuggestFor.current = null;
              setSearchInput(e.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => {
              if (blurTimer.current) {
                clearTimeout(blurTimer.current);
                blurTimer.current = null;
              }
              if (flatOptions.length > 0) setSuggestionsOpen(true);
            }}
            onBlur={() => {
              // Delay closing so a click on a suggestion registers first.
              blurTimer.current = setTimeout(() => setSuggestionsOpen(false), 150);
            }}
            className="block w-full rounded-md border border-journal-300 bg-white py-2.5 pl-10 pr-16 text-sm text-journal-900 shadow-sm outline-none transition-colors focus:border-navy-600 focus:ring-2 focus:ring-navy-100"
          />
          <div className="absolute inset-y-0 right-3 flex items-center gap-2">
            {debouncing && (
              <Loader2 className="h-4 w-4 animate-spin text-journal-400" aria-label="Search pending" />
            )}
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchInput('')}
                className="text-journal-400 transition-colors hover:text-journal-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {suggestionsOpen && suggestions && flatOptions.length > 0 && (
            <div
              id="search-suggestions"
              role="listbox"
              aria-label="Search suggestions"
              className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-journal-200 bg-white shadow-lg"
            >
              {suggestions.peakIds.length > 0 && (
                <div className="py-1">
                  <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-journal-400">
                    Peak IDs
                  </p>
                  {suggestions.peakIds.map((v, i) => renderSuggestionOption(v, i))}
                </div>
              )}
              {suggestions.genes.length > 0 && (
                <div className="border-t border-journal-100 py-1">
                  <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-journal-400">
                    Genes
                  </p>
                  {suggestions.genes.map((v, j) =>
                    renderSuggestionOption(v, suggestions.peakIds.length + j)
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-journal-400">
          Tip: separate multiple terms with a space to narrow the search.
        </p>
      </div>

      {error && (
        <ErrorBanner
          title="Failed to load records"
          message={error}
          onRetry={() => setDataRetryTick(t => t + 1)}
        />
      )}

      <div className="space-y-2">
        {statsText && !error && (
          <div className="flex justify-end">
            <p className="tnum text-xs text-journal-500">{statsText}</p>
          </div>
        )}
        <div className="min-h-[600px] rounded-md border border-journal-200 bg-white">
          <DataGrid
            columns={activeColumns}
            data={data}
            meta={meta}
            loading={loading}
            error={error}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
};

export default DataViewer;

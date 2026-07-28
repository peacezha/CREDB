import React, { useEffect, useRef, useState } from 'react';
import { GenomicRecord, PaginationMeta, ColumnDefinition } from '../types';
import {
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
  Eye,
  AlertCircle,
  Loader2,
  Tag,
} from 'lucide-react';
import Modal from './Modal';

interface DataGridProps {
  columns: ColumnDefinition[];
  data: GenomicRecord[];
  meta: PaginationMeta;
  loading: boolean;
  error?: string | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

/**
 * Sticky columns: the first three (Species / Peak ID / Position) stick to the left,
 * but only at the md breakpoint and above (small screens scroll normally).
 * Widths and cumulative left offsets (px) all live in this one table — keep the
 * Tailwind arbitrary values in sync if a width changes.
 */
const STICKY_COL_CLASSES = [
  'md:sticky md:left-0 md:w-[120px] md:min-w-[120px]',
  'md:sticky md:left-[120px] md:w-[160px] md:min-w-[160px]',
  'md:sticky md:left-[280px] md:w-[180px] md:min-w-[180px]',
] as const;
const STICKY_COL_COUNT = STICKY_COL_CLASSES.length;

const DEFAULT_PAGE_SIZES = [15, 30, 50];
const LONG_TEXT_THRESHOLD = 40;

/** Badge palettes per categorical column — design tokens only. */
const BADGE_STYLES: Record<string, string> = {
  species: 'border-navy-200 bg-navy-50 text-navy-700',
  tissue: 'border-journal-200 bg-journal-100 text-journal-800',
  type: 'border-burgundy-200 bg-burgundy-50 text-burgundy-700',
};

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** Integers render as-is; non-integers keep at most 2 decimal places. */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function formatCellValue(raw: string | number): { text: string; numeric: boolean } {
  if (typeof raw === 'number') return { text: formatNumber(raw), numeric: true };
  const trimmed = raw.trim();
  if (NUMERIC_RE.test(trimmed)) return { text: formatNumber(Number(trimmed)), numeric: true };
  return { text: raw, numeric: false };
}

const DataGrid: React.FC<DataGridProps> = ({
  columns,
  data,
  meta,
  loading,
  error = null,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
}) => {
  const [detailText, setDetailText] = useState<string | null>(null);

  // ---- Page-number input: local state, committed only on Enter / blur --------
  const [pageInput, setPageInput] = useState(String(meta.page));
  const [pageInvalid, setPageInvalid] = useState(false);
  const invalidTimer = useRef<number | null>(null);

  useEffect(() => {
    setPageInput(String(meta.page));
  }, [meta.page]);

  useEffect(
    () => () => {
      if (invalidTimer.current !== null) window.clearTimeout(invalidTimer.current);
    },
    []
  );

  const commitPageInput = () => {
    const maxPage = Math.max(meta.totalPages, 1);
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > maxPage) {
      // Revert to the real page and flash a red hint on the input.
      setPageInput(String(meta.page));
      setPageInvalid(true);
      if (invalidTimer.current !== null) window.clearTimeout(invalidTimer.current);
      invalidTimer.current = window.setTimeout(() => setPageInvalid(false), 1500);
      return;
    }
    if (parsed !== meta.page) onPageChange(parsed);
    else setPageInput(String(meta.page));
  };

  // ---- Derived pagination values --------------------------------------------
  const { page, limit, total, totalPages } = meta;
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, total);
  const sizeOptions = pageSizeOptions.includes(limit)
    ? pageSizeOptions
    : [...pageSizeOptions, limit].sort((a, b) => a - b);

  // ---- Cell renderer ----------------------------------------------------------
  const renderCell = (col: ColumnDefinition, rawValue: string | number) => {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return <span className="text-journal-300">-</span>;
    }

    const { text, numeric } = formatCellValue(rawValue);
    const rawStr = String(rawValue);
    const key = col.key.toLowerCase();

    // 1. Categorical badges (species / tissue / type)
    if (key in BADGE_STYLES) {
      return (
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${BADGE_STYLES[key]}`}
        >
          {rawStr}
        </span>
      );
    }

    // 2. URL links
    if (col.isLink || rawStr.startsWith('http')) {
      if (!rawStr.startsWith('http') && !rawStr.startsWith('www')) {
        return <span className="text-xs text-journal-500">{text}</span>;
      }
      return (
        <a
          href={rawStr}
          target="_blank"
          rel="noopener noreferrer"
          title={rawStr}
          className="group inline-flex items-center gap-1 rounded-md border border-navy-200 bg-white px-3 py-1 text-xs font-bold text-navy-700 shadow-sm transition-colors hover:border-navy-300 hover:bg-navy-50"
        >
          Open Link <ExternalLink className="h-3 w-3 transition-transform group-hover:scale-110" />
        </a>
      );
    }

    // 3. Long text (footprints, sequences, descriptions) — truncate + detail modal
    if (col.isLongText || text.length > LONG_TEXT_THRESHOLD) {
      return (
        <button
          type="button"
          onClick={() => setDetailText(rawStr)}
          className="group flex items-center gap-2 rounded border border-transparent bg-journal-50 px-2 py-1 text-left font-serif text-sm text-journal-700 transition-colors hover:border-navy-200 hover:bg-navy-50 hover:text-navy-700"
        >
          <span className="block max-w-[140px] truncate">
            {rawStr.includes(',') ? `${rawStr.split(',').length} motifs found` : 'View Sequence/Data'}
          </span>
          <Eye className="h-4 w-4 flex-shrink-0 text-journal-400 transition-colors group-hover:text-navy-600" />
        </button>
      );
    }

    // 4. Plain text / numbers (numbers get tabular alignment)
    return (
      <span
        title={text}
        className={`block max-w-[220px] truncate text-sm text-journal-900 ${numeric ? 'tnum' : ''}`}
      >
        {text}
      </span>
    );
  };

  // ---- Body states --------------------------------------------------------------
  const renderBodyState = () => {
    if (error) {
      return (
        <div className="flex h-96 w-full flex-col items-center justify-center gap-3" role="alert">
          <AlertCircle className="h-10 w-10 text-red-600" />
          <p className="font-serif text-lg font-bold text-journal-900">Failed to Load Data</p>
          <p className="max-w-md text-center text-sm text-journal-600">{error}</p>
        </div>
      );
    }
    if (loading && data.length === 0) {
      return (
        <div
          className="flex h-96 w-full flex-col items-center justify-center gap-4"
          role="status"
          aria-label="Loading records"
        >
          <div className="relative">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-journal-200 border-t-navy-700" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Database className="h-4 w-4 text-navy-700" />
            </div>
          </div>
          <p className="animate-pulse font-serif text-lg text-journal-600">Retrieving Records…</p>
        </div>
      );
    }
    if (data.length === 0) {
      return (
        <div className="flex h-96 w-full flex-col items-center justify-center">
          <div className="mb-4 rounded-full bg-journal-50 p-4">
            <Database className="h-12 w-12 text-journal-300" />
          </div>
          <p className="font-serif text-lg font-bold text-journal-900">No Data Found</p>
          <p className="font-serif text-journal-600">Try adjusting your search filters or queries.</p>
        </div>
      );
    }
    return null;
  };

  const bodyState = renderBodyState();

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-md border border-journal-200 bg-white">
      {/* Thin progress bar while reloading — old data stays visible underneath */}
      {loading && data.length > 0 && (
        <div className="h-0.5 w-full bg-navy-100" role="status" aria-label="Refreshing records">
          <div className="h-full w-full animate-pulse bg-navy-500" />
        </div>
      )}

      {/* Loading veil over the whole grid (table + pagination) while old data is
          still shown — blocks pointer input; z-40 sits above sticky headers
          (th z-20 / corner th md:z-30) and the sticky footer (z-20). */}
      {loading && data.length > 0 && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-[1px]"
          role="status"
          aria-label="Loading data"
        >
          <div className="flex items-center gap-2 text-navy-700">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span className="text-sm font-bold">Loading…</span>
          </div>
        </div>
      )}

      {bodyState ?? (
        <div className="relative flex-1 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Cis-regulatory element records</caption>
            <thead>
              <tr className="border-b-2 border-journal-900">
                {columns.map((col, idx) => {
                  const sticky = idx < STICKY_COL_COUNT ? STICKY_COL_CLASSES[idx] : '';
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={`sticky top-0 z-20 select-none whitespace-nowrap bg-journal-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-journal-800 ${sticky} ${
                        idx < STICKY_COL_COUNT ? 'md:z-30' : ''
                      } ${
                        idx === STICKY_COL_COUNT - 1 ? 'md:border-r md:border-journal-200' : ''
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {['species', 'tissue'].includes(col.key) && (
                          <Tag className="h-3 w-3 text-journal-400" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="bg-white">
              {data.map((row, rowIdx) => (
                <tr
                  key={row.peak_id ?? row.id ?? rowIdx}
                  className="group border-b border-journal-100 transition-colors hover:bg-journal-50"
                >
                  {columns.map((col, colIdx) => {
                    const sticky = colIdx < STICKY_COL_COUNT ? STICKY_COL_CLASSES[colIdx] : '';
                    return (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-4 py-3 ${sticky} ${
                          colIdx < STICKY_COL_COUNT
                            ? 'bg-white group-hover:bg-journal-50 md:z-10'
                            : ''
                        } ${
                          colIdx === STICKY_COL_COUNT - 1
                            ? 'md:border-r md:border-journal-200'
                            : ''
                        }`}
                      >
                        {renderCell(col, row[col.key])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination footer */}
      <div className="sticky bottom-0 z-20 flex flex-col items-center justify-between gap-3 border-t border-journal-100 bg-paper px-5 py-3 sm:flex-row">
        <div className="text-sm text-journal-700">
          Showing <span className="tnum font-bold text-navy-800">{rangeStart}</span>–
          <span className="tnum font-bold text-navy-800">{rangeEnd}</span> of{' '}
          <span className="tnum font-bold text-journal-900">{total}</span> records
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {/* Rows per page */}
          <label className="flex items-center gap-2 text-sm text-journal-700">
            Rows per page
            <select
              aria-label="Rows per page"
              value={limit}
              disabled={loading}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-sm border border-journal-200 bg-white px-2 py-1 text-sm text-journal-900 outline-none focus:border-navy-600 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {sizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          {/* Page controls */}
          <div className="flex items-center gap-1.5 rounded-sm border border-journal-200 bg-white p-1">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => onPageChange(page - 1)}
              disabled={loading || page <= 1}
              className="rounded-md p-2 text-journal-700 transition-colors hover:bg-journal-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex h-6 items-center gap-1 border-l border-r border-journal-200 px-2">
              <span className="font-serif text-sm font-medium text-journal-600">Page</span>
              <input
                type="number"
                aria-label="Go to page"
                aria-invalid={pageInvalid}
                min={1}
                max={Math.max(totalPages, 1)}
                value={pageInput}
                disabled={loading}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPageInput();
                }}
                onBlur={commitPageInput}
                title={
                  pageInvalid
                    ? `Enter a page between 1 and ${Math.max(totalPages, 1)}`
                    : undefined
                }
                className={`w-12 rounded bg-transparent text-center text-sm font-bold text-navy-700 focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-30 ${
                  pageInvalid ? 'ring-2 ring-red-600' : ''
                }`}
              />
              <span className="tnum font-serif text-sm text-journal-400">/ {totalPages}</span>
            </div>

            <button
              type="button"
              aria-label="Next page"
              onClick={() => onPageChange(page + 1)}
              disabled={loading || page >= totalPages}
              className="rounded-md p-2 text-journal-700 transition-colors hover:bg-journal-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Detail modal for long text / footprints */}
      <Modal
        open={detailText !== null}
        onClose={() => setDetailText(null)}
        maxWidth="max-w-2xl"
        title={
          <span className="flex items-center gap-2">
            <Info className="h-5 w-5 text-navy-700" />
            Detail View
          </span>
        }
      >
        {detailText !== null &&
          (detailText.includes(',') || detailText.includes('(') ? (
            <div className="flex flex-wrap gap-2">
              {detailText.split(/,(?![^()]*\))/).map((item, idx) => (
                <span
                  key={idx}
                  className="rounded-lg border border-journal-200 bg-white px-3 py-1.5 font-mono text-sm text-journal-800 shadow-sm transition-colors hover:border-navy-300"
                >
                  {item.trim()}
                </span>
              ))}
            </div>
          ) : (
            <p className="whitespace-pre-wrap font-serif text-lg leading-relaxed text-journal-800">
              {detailText}
            </p>
          ))}
      </Modal>
    </div>
  );
};

export default DataGrid;

import type {
  ApiResponse,
  ChromosomeInfo,
  DashboardData,
  FilterOptions,
  PredictionResult,
  SearchSuggestions,
  SpeciesOverview,
  StatsResponse,
} from '../types';

/**
 * API base URL.
 * - Override at build/run time with VITE_API_BASE (e.g. "https://example.org/api").
 * - Defaults to the same hostname on port 8001 (the Node backend).
 */
const envBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '');
export const API_BASE_URL =
  envBase ||
  (typeof window !== 'undefined' && window.location
    ? `http://${window.location.hostname}:8001/api`
    : 'http://localhost:8001/api');

export type ApiErrorKind = 'network' | 'http' | 'timeout' | 'abort';

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Human-readable message for UI error banners. */
export const describeError = (err: unknown): string => {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'network':
        return `Cannot reach the backend API at ${API_BASE_URL}. Make sure the server is running (npm run server).`;
      case 'timeout':
        return 'The request timed out. The server may be busy — please try again.';
      case 'abort':
        return 'Request cancelled.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
};

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 30000, signal: outerSignal, ...init } = options;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } catch (err) {
    if (ctrl.signal.aborted) {
      if (outerSignal?.aborted) throw new ApiError('abort', 'Request cancelled');
      throw new ApiError('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new ApiError('network', 'Network request failed');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `Server error (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiError('http', message, res.status);
  }
  return res.json() as Promise<T>;
}

/** Throws if the error was a user-initiated abort; use in catch blocks. */
export const isAbortError = (err: unknown): boolean =>
  err instanceof ApiError && err.kind === 'abort';

/** Overview for all species (single request, from summary table). */
export const fetchOverview = (signal?: AbortSignal) =>
  request<SpeciesOverview[]>('/overview', { signal });

/** Available ISM model list. */
export const fetchModels = (signal?: AbortSignal) => request<string[]>('/models', { signal });

/** Species list. */
export const fetchSpeciesList = (signal?: AbortSignal) =>
  request<string[]>('/species', { signal });

/** Global database statistics. */
export const fetchStats = (signal?: AbortSignal) => request<StatsResponse>('/stats', { signal });

/** Dashboard visualizations for one species. */
export const fetchDashboardData = (species: string, signal?: AbortSignal) =>
  request<DashboardData>(`/dashboard?species=${encodeURIComponent(species)}`, { signal });

/** Tissues and chromosomes available for a species. */
export const fetchFilters = (species: string, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  if (species && species !== 'All Species') params.append('species', species);
  return request<FilterOptions>(`/filters?${params.toString()}`, { signal });
};

/** Chromosomes from the genome FASTA index for a species. */
export const fetchChromosomes = (species: string, signal?: AbortSignal) =>
  request<ChromosomeInfo[]>(`/chromosomes?species=${encodeURIComponent(species)}`, { signal });

export interface FetchDataParams {
  page?: number;
  limit?: number;
  q?: string;
  species?: string;
  tissue?: string;
  chr?: string;
}

/** Paginated and filtered peaks query. */
export const fetchData = (
  { page = 1, limit = 15, q = '', species, tissue, chr }: FetchDataParams,
  signal?: AbortSignal
): Promise<ApiResponse> => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (species && species !== 'All Species') params.append('species', species);
  if (tissue && tissue !== 'All Tissues') params.append('tissue', tissue);
  if (chr && chr !== 'All Chromosomes') params.append('chr', chr);
  if (q.trim()) params.append('q', q.trim());
  return request<ApiResponse>(`/peaks?${params.toString()}`, { signal });
};

/** Autocomplete suggestions for the search box (up to 8 peak IDs + 8 genes). */
export const fetchSuggestions = (
  q: string,
  species?: string,
  signal?: AbortSignal
): Promise<SearchSuggestions> => {
  const params = new URLSearchParams({ q: q.trim() });
  if (species && species !== 'All Species') params.append('species', species);
  return request<SearchSuggestions>(`/suggest?${params.toString()}`, { signal });
};

export type PredictPayload =
  | { species: string; sequence: string }
  | { species: string; chr: string; start: number; end: number };

/** ISM prediction — slow (deep learning inference), hence the 5 minute timeout. */
export const runPrediction = (payload: PredictPayload, signal?: AbortSignal) =>
  request<PredictionResult>('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 300000,
    signal,
  });

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — matches the UI copy

/** Upload a TSV/CSV file tagged with a species name. Sends the file body directly. */
export const uploadData = (file: File, speciesName: string, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  if (speciesName) params.append('species', speciesName);
  return request<{ success?: boolean }>(`/upload?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: file,
    timeoutMs: 120000,
    signal,
  });
};

/** Delete all data for a species. Destructive — the UI must confirm first. */
export const deleteSpecies = (speciesName: string, signal?: AbortSignal) => {
  const params = new URLSearchParams({ species: speciesName });
  return request<{ success?: boolean }>(`/delete?${params.toString()}`, {
    method: 'POST',
    signal,
  });
};

/** Direct download URL for a species dataset (TSV stream). */
export const getDownloadUrl = (speciesName: string): string =>
  `${API_BASE_URL}/download?species=${encodeURIComponent(speciesName)}`;

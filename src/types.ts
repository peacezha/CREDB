export interface GenomicRecord {
  [key: string]: string | number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Server-side query time in milliseconds (present on /peaks responses). */
  tookMs?: number;
}

export interface ApiResponse {
  data: GenomicRecord[];
  meta: PaginationMeta;
}

export interface PredictionResult {
  score: number;
  classification: 'Open Chromatin' | 'Closed Chromatin';
  heatmapBase64?: string;
  error?: string;
}

export interface ColumnDefinition {
  key: string;
  label: string;
  isLink?: boolean;
  isLongText?: boolean;
}

export interface SpeciesOverview {
  species: string;
  totalPeaks: number;
  tissues: number;
  topTissues: { label: string; count: number }[];
  topContexts: { label: string; value: number }[];
}

export interface SpeciesBreakdown {
  species: string;
  count: number;
  updatedAt?: number;
}

export interface StatsResponse {
  totalPeaks: number;
  speciesCount: number;
  breakdown?: SpeciesBreakdown[];
}

export interface DashboardData {
  stats: {
    totalPeaks: number;
    tissues: number;
  };
  distribution: { label: string; value: number }[];
  tissues: { label: string; count: number }[];
  typeDist?: { label: string; count: number }[];
  topGenes?: { label: string; count: number }[];
  chrDist?: { label: string; count: number }[];
}

export interface ChromosomeInfo {
  name: string;
  length: number;
}

export interface FilterOptions {
  tissues: string[];
  chromosomes: string[];
}

export interface SearchSuggestions {
  peakIds: string[];
  genes: string[];
}

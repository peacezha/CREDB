import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Dna,
  Download,
  FileText,
  HelpCircle,
  MapPin,
  Play,
  RefreshCw,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  describeError,
  fetchChromosomes,
  fetchModels,
  isAbortError,
  runPrediction,
} from '../services/api';
import type { PredictPayload } from '../services/api';
import type { ChromosomeInfo, PredictionResult } from '../types';
import Modal from '../components/Modal';

type InputMode = 'sequence' | 'region';

const MIN_SEQUENCE_BP = 50;
const MAX_REGION_BP = 2000;
const SCORE_THRESHOLD = 0.5;

/** Digits only — rejects "10abc", "1e4", decimals and signs. */
const INTEGER_RE = /^[0-9]+$/;

/** Parse a genomic position typed by the user; null when not a plain integer. */
const parsePosition = (value: string): number | null => {
  const v = value.trim();
  if (!INTEGER_RE.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * Clean a pasted DNA sequence, FASTA-aware: drop header lines starting with
 * '>' (otherwise header words like "AT-rich" leak into the sequence), then
 * keep only A/T/C/G and normalize to upper case.
 */
const cleanSequence = (raw: string): string =>
  raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('')
    .replace(/[^ATCGatcg]/g, '')
    .toUpperCase();

const formatElapsed = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const inputClass =
  'w-full rounded-md border border-journal-300 bg-white px-3 py-2 text-sm text-journal-900 placeholder:text-journal-400 focus:border-navy-500';
const labelClass = 'mb-1 block text-sm font-semibold text-journal-700';

const Analysis: React.FC = () => {
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [chromosomes, setChromosomes] = useState<ChromosomeInfo[]>([]);
  const [chrError, setChrError] = useState<string | null>(null);

  const [species, setSpecies] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('sequence');

  // Sequence mode
  const [sequence, setSequence] = useState('');

  // Region mode
  const [chr, setChr] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lightbox (heatmap enlarge)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Abort handle for the in-flight prediction request
  const abortRef = useRef<AbortController | null>(null);

  // Load available models; failures surface with a retry instead of an empty dropdown.
  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await fetchModels();
      setModels(list);
      setSpecies((prev) => prev || list[0] || '');
    } catch (err) {
      setModels([]);
      setModelsError(describeError(err));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Fetch chromosomes (with lengths) when species or input mode requires them
  useEffect(() => {
    if (inputMode !== 'region' || !species) return;
    let cancelled = false;
    setChrError(null);
    fetchChromosomes(species)
      .then((list) => {
        if (cancelled) return;
        setChromosomes(list);
        if (list.length > 0) setChr((prev) => prev || list[0].name);
      })
      .catch((err) => {
        if (cancelled) return;
        setChromosomes([]);
        setChrError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [species, inputMode]);

  // Elapsed-time ticker while a prediction is running
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const cleanedLength = cleanSequence(sequence).length;
  const startNum = parsePosition(start);
  const endNum = parsePosition(end);
  const selectedChr = chromosomes.find((c) => c.name === chr);
  const hasGenome = chromosomes.length > 0;
  const speciesLabel = species ? species.replace(/_/g, ' ') : 'the selected species';

  const handleFillExample = () => {
    if (chromosomes.length > 0) {
      setChr(chromosomes[0].name);
      setStart('1');
      setEnd('200');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handlePredict = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setResult(null);

    let payload: PredictPayload;

    if (inputMode === 'region') {
      if (!chr) {
        setError('Please select a chromosome.');
        return;
      }
      if (startNum === null || endNum === null) {
        setError('Start and end must be whole numbers (digits only, e.g. 1200).');
        return;
      }
      if (startNum < 1) {
        setError('Start position must be at least 1.');
        return;
      }
      if (endNum <= startNum) {
        setError('End position must be greater than start position.');
        return;
      }
      if (endNum - startNum + 1 > MAX_REGION_BP) {
        setError(`Region too large. Maximum ${MAX_REGION_BP}bp allowed for prediction.`);
        return;
      }
      if (selectedChr && endNum > selectedChr.length) {
        setError(
          `End position exceeds ${chr} length (${selectedChr.length.toLocaleString()} bp).`
        );
        return;
      }
      payload = { species, chr, start: startNum, end: endNum };
    } else {
      const cleanedSeq = cleanSequence(sequence);
      if (cleanedSeq.length < MIN_SEQUENCE_BP) {
        setError(`Sequence length must be at least ${MIN_SEQUENCE_BP}bp (currently ${cleanedSeq.length}bp).`);
        return;
      }
      payload = { species, sequence: cleanedSeq };
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const data = await runPrediction(payload, ctrl.signal);
      setResult(data);
    } catch (err) {
      // User-initiated cancel: stay silent, just return to idle state.
      if (!isAbortError(err)) setError(describeError(err));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleDownload = () => {
    if (!result?.heatmapBase64) return;
    const link = document.createElement('a');
    link.href = result.heatmapBase64;
    link.download = `ism_heatmap_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isOpen = result?.classification === 'Open Chromatin';

  return (
    <div className="space-y-8 pb-12 animate-fade-in">
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 font-serif text-3xl font-bold text-journal-900">
          <Activity className="h-8 w-8 text-navy-700" />
          In-silico Mutagenesis Analysis
        </h1>
        <p className="font-serif text-lg text-journal-500">
          Predict chromatin accessibility and visualize critical motifs using our deep learning model.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* LEFT COLUMN: Input Form */}
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-md border border-journal-200 bg-white p-6">
            <h3 className="mb-4 flex items-center gap-2 font-serif font-bold text-journal-900">
              <Dna className="h-5 w-5 text-navy-700" />
              Model Configuration
            </h3>

            <form onSubmit={handlePredict} className="space-y-5">
              <div>
                <label className={labelClass} htmlFor="analysis-species">
                  Target Species
                </label>
                <select
                  id="analysis-species"
                  value={species}
                  onChange={(e) => {
                    setSpecies(e.target.value);
                    setChr('');
                  }}
                  disabled={modelsLoading || models.length === 0}
                  className={inputClass}
                >
                  {modelsLoading && <option>Loading models…</option>}
                  {!modelsLoading && models.length === 0 && (
                    <option>No models available</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                {modelsError && (
                  <div
                    className="mt-2 flex items-start justify-between gap-2 rounded-md border border-red-600/20 bg-red-600/5 p-3 text-sm text-red-600"
                    role="alert"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{modelsError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={loadModels}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-red-600/30 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Retry
                    </button>
                  </div>
                )}
              </div>

              {/* Input Mode Toggle */}
              <div>
                <span className={`${labelClass} mb-2`}>Input Mode</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setInputMode('sequence')}
                    aria-pressed={inputMode === 'sequence'}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors
                      ${
                        inputMode === 'sequence'
                          ? 'border-navy-600 bg-navy-50 text-navy-700'
                          : 'border-journal-200 bg-white text-journal-500 hover:border-journal-300'
                      }`}
                  >
                    <FileText className="h-4 w-4" />
                    Paste Sequence
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('region')}
                    aria-pressed={inputMode === 'region'}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors
                      ${
                        inputMode === 'region'
                          ? 'border-navy-600 bg-navy-50 text-navy-700'
                          : 'border-journal-200 bg-white text-journal-500 hover:border-journal-300'
                      }`}
                  >
                    <MapPin className="h-4 w-4" />
                    Genomic Region
                  </button>
                </div>
              </div>

              {/* Sequence Mode Input */}
              {inputMode === 'sequence' && (
                <div>
                  <label className={labelClass} htmlFor="analysis-sequence">
                    DNA Sequence (FASTA format supported)
                  </label>
                  <textarea
                    id="analysis-sequence"
                    value={sequence}
                    onChange={(e) => setSequence(e.target.value)}
                    rows={8}
                    className={`${inputClass} font-mono uppercase`}
                    placeholder=">Seq1&#10;ATCGATCG..."
                  />
                  <p
                    className={`tnum mt-1 text-right text-xs ${
                      cleanedLength > 0 && cleanedLength < MIN_SEQUENCE_BP
                        ? 'text-red-600'
                        : 'text-journal-500'
                    }`}
                  >
                    Valid length: {cleanedLength} bp
                    {cleanedLength > 0 && cleanedLength < MIN_SEQUENCE_BP
                      ? ` (minimum ${MIN_SEQUENCE_BP} bp)`
                      : ''}
                  </p>
                </div>
              )}

              {/* Region Mode Input */}
              {inputMode === 'region' && (
                <div className="space-y-3">
                  {chrError ? (
                    <div
                      className="flex items-start gap-2 rounded-md border border-red-600/20 bg-red-600/5 p-3 text-sm text-red-600"
                      role="alert"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{chrError}</span>
                    </div>
                  ) : !hasGenome ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      No genome reference available for {speciesLabel}. Please use "Paste
                      Sequence" mode instead.
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className={labelClass} htmlFor="analysis-chr">
                          Chromosome
                        </label>
                        <select
                          id="analysis-chr"
                          value={chr}
                          onChange={(e) => setChr(e.target.value)}
                          className={inputClass}
                        >
                          {chromosomes.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} ({(c.length / 1e6).toFixed(1)} Mb)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass} htmlFor="analysis-start">
                            Start Position
                          </label>
                          <input
                            id="analysis-start"
                            type="text"
                            inputMode="numeric"
                            value={start}
                            onChange={(e) => setStart(e.target.value)}
                            className={`${inputClass} tnum`}
                            placeholder="1"
                          />
                        </div>
                        <div>
                          <label className={labelClass} htmlFor="analysis-end">
                            End Position
                          </label>
                          <input
                            id="analysis-end"
                            type="text"
                            inputMode="numeric"
                            value={end}
                            onChange={(e) => setEnd(e.target.value)}
                            className={`${inputClass} tnum`}
                            placeholder="200"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-journal-500">
                        Region:{' '}
                        <span className="tnum">
                          {chr || '?'}:{start || '?'}–{end || '?'}
                        </span>
                        {' · '}Length:{' '}
                        <span className="tnum">
                          {startNum !== null && endNum !== null
                            ? `${(endNum - startNum + 1).toLocaleString()} bp`
                            : '—'}
                        </span>{' '}
                        (max {MAX_REGION_BP.toLocaleString()} bp)
                        {selectedChr && (
                          <>
                            {' · '}
                            {selectedChr.name} length:{' '}
                            <span className="tnum">
                              {selectedChr.length.toLocaleString()} bp
                            </span>
                          </>
                        )}
                      </p>

                      <button
                        type="button"
                        onClick={handleFillExample}
                        className="w-full rounded-md border border-navy-200 bg-navy-50 px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-100"
                      >
                        Example: {chromosomes[0]?.name ?? 'chr1'}:1-200
                      </button>
                    </>
                  )}
                </div>
              )}

              {error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-red-600/20 bg-red-600/5 p-3 text-sm text-red-600"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {loading && (
                <div
                  className="space-y-2 rounded-md border border-navy-100 bg-navy-50 p-3"
                  role="status"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-navy-800">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy-200 border-t-navy-700" />
                    Running inference…{' '}
                    <span className="tnum">{formatElapsed(elapsed)}</span> elapsed
                  </div>
                  <p className="text-xs text-navy-600">
                    Model inference may take 1–2 minutes on first run.
                  </p>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex items-center gap-1.5 rounded-md border border-journal-300 bg-white px-3 py-1.5 text-xs font-medium text-journal-700 transition-colors hover:bg-journal-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !species}
                className={`flex w-full items-center justify-center gap-2 rounded-md py-3 font-serif font-bold text-white transition-colors
                  ${
                    loading || !species
                      ? 'cursor-not-allowed bg-navy-800/50'
                      : 'bg-navy-800 hover:bg-navy-700'
                  }`}
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Running Inference…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    Run Prediction
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="rounded-md border border-navy-100 bg-navy-50 p-5 text-sm leading-relaxed text-navy-800">
            <h4 className="mb-2 flex items-center gap-2 font-serif font-bold text-navy-900">
              <HelpCircle className="h-4 w-4" />
              Methodology
            </h4>
            <p>
              This module uses the fine-tuned BERT-based model for{' '}
              <span className="font-semibold">{speciesLabel}</span> to predict chromatin
              accessibility probability. The heatmap visualizes in-silico mutagenesis (ISM)
              scores, highlighting nucleotides critical for accessibility.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Results */}
        <div className="lg:col-span-2">
          {result ? (
            <div className="space-y-6 animate-fade-in-up">
              {/* Score Card */}
              <div className="rounded-md border border-journal-200 bg-white p-6">
                <h3 className="mb-4 flex items-center gap-2 border-b border-journal-100 pb-2 font-serif font-bold text-journal-900">
                  <BarChart3 className="h-5 w-5 text-navy-700" />
                  Prediction Result
                </h3>

                <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="font-serif text-sm font-bold uppercase text-journal-500">
                      Chromatin State
                    </p>
                    <p>
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 font-serif text-lg font-bold ${
                          isOpen
                            ? 'border-navy-200 bg-navy-50 text-navy-700'
                            : 'border-burgundy-200 bg-burgundy-50 text-burgundy-700'
                        }`}
                      >
                        {result.classification}
                      </span>
                    </p>
                    <p className="text-sm text-journal-500">
                      Threshold: <span className="tnum">{SCORE_THRESHOLD}</span>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm font-bold text-journal-700">
                      <span>Accessibility Score</span>
                      <span className="tnum">{(result.score * 100).toFixed(1)}%</span>
                    </div>
                    <div className="relative">
                      <div className="h-3 w-full overflow-hidden rounded-full bg-journal-100">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ease-out ${
                            isOpen ? 'bg-green-600' : 'bg-burgundy-500'
                          }`}
                          style={{
                            width: `${Math.min(100, Math.max(0, result.score * 100))}%`,
                          }}
                        />
                      </div>
                      {/* 0.5 threshold marker */}
                      <div
                        className="absolute inset-y-0 left-1/2 w-px bg-journal-400"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="text-xs text-journal-500">
                      Scores above <span className="tnum">{SCORE_THRESHOLD}</span> are
                      classified as open chromatin.
                    </p>
                  </div>
                </div>
              </div>

              {/* Heatmap Card */}
              <div className="rounded-md border border-journal-200 bg-white p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-serif font-bold text-journal-900">
                    ISM Heatmap Analysis
                  </h3>
                  {result.heatmapBase64 && (
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="flex items-center gap-1.5 rounded-md border border-journal-300 bg-white px-3 py-1.5 text-sm font-medium text-journal-700 transition-colors hover:bg-journal-50"
                      title="Download PNG"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                  )}
                </div>

                {result.heatmapBase64 ? (
                  <button
                    type="button"
                    onClick={() => setIsLightboxOpen(true)}
                    aria-label="Enlarge ISM heatmap"
                    className="group relative block w-full cursor-zoom-in overflow-hidden rounded-md border border-journal-200 bg-journal-50 p-2"
                  >
                    <img
                      src={result.heatmapBase64}
                      alt="ISM Heatmap"
                      className="h-auto w-full object-contain"
                    />
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10">
                      <span className="flex translate-y-2 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-journal-700 opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100">
                        <ZoomIn className="h-4 w-4" />
                        Click to Enlarge
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-journal-300 bg-journal-50 font-serif text-journal-400">
                    No heatmap generated for this prediction
                  </div>
                )}
                <p className="fig-caption text-center">
                  * Red indicates mutations that decrease accessibility; blue indicates
                  mutations that increase accessibility.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-md border-2 border-dashed border-journal-200 bg-journal-50/50 px-6 text-center">
              <Activity className="mb-4 h-14 w-14 text-journal-300" />
              <p className="font-serif text-lg font-medium text-journal-600">
                No prediction yet
              </p>
              <p className="mt-1 max-w-sm text-sm text-journal-500">
                Paste a DNA sequence or choose a genomic region on the left, then run the
                prediction — the accessibility score and ISM heatmap will appear here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* HEATMAP LIGHTBOX */}
      <Modal
        open={isLightboxOpen && !!result?.heatmapBase64}
        onClose={() => setIsLightboxOpen(false)}
        title="ISM Heatmap"
        maxWidth="max-w-5xl"
      >
        {result?.heatmapBase64 && (
          <div className="space-y-4">
            <img
              src={result.heatmapBase64}
              alt="ISM heatmap, full size"
              className="h-auto w-full rounded-md border border-journal-200 bg-white"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-journal-500">
                Score{' '}
                <span className="tnum font-semibold text-journal-800">
                  {(result.score * 100).toFixed(2)}%
                </span>
                {' · '}
                {result.classification}
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-navy-700"
              >
                <Download className="h-4 w-4" />
                Download High-Res PNG
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Analysis;

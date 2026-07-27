import React, { useCallback, useEffect, useState } from 'react';
import {
  UploadCloud,
  CheckCircle,
  AlertCircle,
  FileText,
  Sprout,
  Table,
  Info,
  Download,
  Trash2,
  Database,
  X,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { uploadData, fetchStats, deleteSpecies, describeError, isAbortError, MAX_UPLOAD_BYTES } from '../services/api';
import type { SpeciesBreakdown } from '../types';

const ACCEPTED_EXTENSIONS = /\.(tsv|csv|txt)$/i;
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

interface ManageNotice {
  type: 'success' | 'error';
  text: string;
}

const Submit: React.FC = () => {
  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [species, setSpecies] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Dataset management state
  const [datasets, setDatasets] = useState<SpeciesBreakdown[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [confirmingSpecies, setConfirmingSpecies] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [deletingSpecies, setDeletingSpecies] = useState<string | null>(null);
  const [notice, setNotice] = useState<ManageNotice | null>(null);

  const loadDatasets = useCallback(async (signal?: AbortSignal) => {
    setLoadingDatasets(true);
    setDatasetsError(null);
    try {
      const stats = await fetchStats(signal);
      setDatasets(stats.breakdown ?? []);
    } catch (err) {
      if (isAbortError(err)) return;
      setDatasetsError(describeError(err));
    } finally {
      if (!signal?.aborted) setLoadingDatasets(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadDatasets(ctrl.signal);
    return () => ctrl.abort();
  }, [loadDatasets]);

  const trimmedSpecies = species.trim();
  const existingDataset = trimmedSpecies
    ? datasets.find((d) => d.species.trim().toLowerCase() === trimmedSpecies.toLowerCase())
    : undefined;

  const validateFile = (f: File): string | null => {
    if (!ACCEPTED_EXTENSIONS.test(f.name)) {
      return 'Unsupported file type. Please upload a .tsv, .csv, or .txt file.';
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      return `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). The maximum upload size is ${MAX_UPLOAD_MB} MB.`;
    }
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const problem = validateFile(selected);
    if (problem) {
      setFile(null);
      setUploadError(problem);
    } else {
      setFile(selected);
      setUploadError(null);
    }
    setUploadSuccess(null);
  };

  const handleRemoveFile = () => {
    setFile(null);
    setUploadError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;

    if (!trimmedSpecies) {
      setUploadError('Please enter a species name.');
      return;
    }
    if (!file) {
      setUploadError('Please select a data file to upload.');
      return;
    }
    const problem = validateFile(file);
    if (problem) {
      setUploadError(problem);
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      await uploadData(file, trimmedSpecies);
      setUploadSuccess(
        existingDataset
          ? `Records were appended to the existing dataset for ${existingDataset.species}.`
          : `Dataset for ${trimmedSpecies} was added to the database.`
      );
      setFile(null);
      setSpecies('');
      loadDatasets();
    } catch (err) {
      if (!isAbortError(err)) setUploadError(describeError(err));
    } finally {
      setUploading(false);
    }
  };

  const openConfirm = (speciesName: string) => {
    setConfirmingSpecies(speciesName);
    setConfirmInput('');
    setNotice(null);
  };

  const handleDelete = async (d: SpeciesBreakdown) => {
    if (deletingSpecies) return;
    if (confirmInput.trim() !== d.species) return;

    setDeletingSpecies(d.species);
    setNotice(null);
    try {
      await deleteSpecies(d.species);
      setNotice({
        type: 'success',
        text: `Deleted ${d.count.toLocaleString()} records for ${d.species}.`,
      });
      setConfirmingSpecies(null);
      setConfirmInput('');
      loadDatasets();
    } catch (err) {
      if (!isAbortError(err)) setNotice({ type: 'error', text: describeError(err) });
    } finally {
      setDeletingSpecies(null);
    }
  };

  const handleDownloadTemplate = () => {
    const headers = [
      'Peak_ID', 'Position', 'tissue', 'nearest gene', 'JBrowse_Link', 'Expression_TPM',
    ];
    const row = [
      'Sample_Peak_1', 'chr1A:100-200', 'Leaf', 'TraesCS1A02G...', 'http://...', '12.5',
    ];
    const content = `${headers.join('\t')}\n${row.join('\t')}`;
    const blob = new Blob([content], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_data.tsv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const displayHeaders = ['Peak_ID', 'Position', 'tissue', '...'];
  const displayRow = ['Peak_1', 'chr1:100...', 'Leaf', '...'];

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      {/* SECTION 1: UPLOAD */}
      <div className="space-y-8">
        <div>
          <h1 className="font-serif text-navy-900">Upload New Data</h1>
          <p className="mt-2 max-w-3xl text-journal-600">
            Add new genomic peak data. The system supports <strong>flexible formats</strong> (TSV, CSV) and will{' '}
            <strong>automatically detect columns</strong>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left column: format notes & template */}
          <div className="space-y-6 lg:col-span-1">
            <div className="rounded-md border border-journal-200 bg-white p-6">
              <h2 className="flex items-center gap-2 font-serif text-lg text-navy-900">
                <Table className="h-5 w-5 text-navy-600" />
                Flexible Format
              </h2>
              <p className="mb-4 text-sm text-journal-600">
                You can upload <strong>.tsv, .csv, or .txt</strong> files up to{' '}
                <strong>{MAX_UPLOAD_MB} MB</strong>. The first row will be used as headers.
              </p>

              <div className="mb-6 overflow-x-auto rounded-md border border-journal-200 bg-journal-50">
                <table className="w-full whitespace-nowrap text-left text-xs">
                  <thead className="border-b border-journal-200 bg-journal-100 font-semibold text-journal-700">
                    <tr>
                      {displayHeaders.map((h, i) => (
                        <th key={i} className="border-r border-journal-200 px-3 py-2 last:border-0">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-journal-600">
                    <tr>
                      {displayRow.map((c, i) => (
                        <td key={i} className="border-r border-journal-200 px-3 py-2 last:border-0">{c}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleDownloadTemplate}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-navy-200 bg-navy-50 px-4 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-100"
              >
                <Download className="h-4 w-4" />
                Download Example Template
              </button>

              <div className="mt-4 flex items-start gap-2 rounded-md bg-navy-50 p-3 text-xs text-navy-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Empty cells in your file are accepted and displayed as "-" in the viewer.</p>
              </div>
            </div>
          </div>

          {/* Right column: upload form */}
          <div className="lg:col-span-2">
            <div className="h-full rounded-md border border-journal-200 bg-white">
              <div className="flex h-full flex-col justify-center p-8">
                <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                  <div>
                    <label htmlFor="species-input" className="mb-2 flex items-center gap-2 font-serif text-lg font-bold text-navy-900">
                      <Sprout className="h-5 w-5 text-navy-600" />
                      Species Name
                    </label>
                    <input
                      id="species-input"
                      type="text"
                      value={species}
                      onChange={(e) => {
                        setSpecies(e.target.value);
                        setUploadSuccess(null);
                      }}
                      className="w-full rounded-md border border-journal-300 px-4 py-3 text-lg outline-none transition-colors placeholder:text-journal-300 focus:border-navy-500"
                      placeholder="e.g., Triticum aestivum"
                    />
                    <p className="mt-2 text-sm text-journal-500">This name will be used to tag all records.</p>
                    {existingDataset && (
                      <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        Records will be appended to the existing {existingDataset.count.toLocaleString()} records
                        for {existingDataset.species}.
                      </p>
                    )}
                  </div>

                  <div>
                    <span className="mb-2 block text-sm font-medium text-journal-700">Data File</span>
                    <div className="relative flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-journal-300 bg-journal-50 p-10 transition-colors hover:bg-navy-50">
                      <input
                        type="file"
                        accept=".tsv,.csv,.txt,text/*"
                        onChange={handleFileChange}
                        onClick={(e) => {
                          // Allow re-selecting the same file by clearing the value on click
                          (e.target as HTMLInputElement).value = '';
                        }}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        aria-label="Select data file"
                      />
                      <div className="mb-4 rounded-full bg-white p-4 shadow-sm">
                        {file ? (
                          <FileText className="h-8 w-8 text-navy-600" />
                        ) : (
                          <UploadCloud className="h-8 w-8 text-journal-400" />
                        )}
                      </div>
                      {file ? (
                        <div className="flex items-center gap-3">
                          <div className="text-center">
                            <p className="text-lg font-medium text-navy-900">{file.name}</p>
                            <p className="tnum mt-1 text-sm text-journal-500">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleRemoveFile}
                            className="z-10 rounded-full border border-journal-200 bg-white p-1.5 text-journal-500 transition-colors hover:bg-burgundy-50 hover:text-burgundy-700"
                            aria-label="Remove selected file"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-lg font-medium text-journal-700">Click to select data file</p>
                          <p className="mt-1 text-sm text-journal-500">TSV, CSV or TXT — up to {MAX_UPLOAD_MB} MB</p>
                        </>
                      )}
                    </div>
                  </div>

                  {uploadError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-burgundy-200 bg-burgundy-50 p-3 text-sm text-burgundy-800"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {uploadError}
                    </div>
                  )}

                  {uploadSuccess && (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"
                    >
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      {uploadSuccess}
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={!file || uploading || !trimmedSpecies}
                      className={`flex w-full items-center justify-center gap-2 rounded-md py-3.5 font-serif text-lg font-bold transition-colors ${
                        !file || uploading || !trimmedSpecies
                          ? 'cursor-not-allowed bg-journal-200 text-journal-500'
                          : 'bg-navy-800 text-white hover:bg-navy-700'
                      }`}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Uploading &amp; Processing…
                        </>
                      ) : (
                        'Upload Data'
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      <hr className="hr-journal" />

      {/* SECTION 2: MANAGE DATASETS */}
      <div className="space-y-6">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-navy-900">
            <Database className="h-6 w-6 text-navy-600" />
            Manage Existing Datasets
          </h2>
          <p className="mt-1 text-journal-600">
            View stored species and manage their data.{' '}
            <span className="font-medium text-burgundy-700">Deletions are permanent.</span>
          </p>
        </div>

        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              notice.type === 'error'
                ? 'border-burgundy-200 bg-burgundy-50 text-burgundy-800'
                : 'border-green-200 bg-green-50 text-green-800'
            }`}
          >
            {notice.type === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            )}
            {notice.text}
          </div>
        )}

        <div className="rounded-md border border-journal-200 bg-white">
          {loadingDatasets ? (
            <div className="flex items-center justify-center gap-2 p-8 text-journal-500" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading datasets…
            </div>
          ) : datasetsError ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
              <p className="flex items-center gap-2 text-burgundy-700">
                <AlertCircle className="h-4 w-4" />
                {datasetsError}
              </p>
              <button
                onClick={() => loadDatasets()}
                className="rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700"
              >
                Retry
              </button>
            </div>
          ) : datasets.length === 0 ? (
            <div className="p-8 text-center text-journal-500">
              No datasets found in the database. Upload one above to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="academic-table">
                <thead>
                  <tr>
                    <th>Species Name</th>
                    <th>Total Records</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((d) => {
                    const isConfirming = confirmingSpecies === d.species;
                    const isDeleting = deletingSpecies === d.species;
                    const confirmMatches = confirmInput.trim() === d.species;
                    return (
                      <React.Fragment key={d.species}>
                        <tr>
                          <td className="font-medium text-navy-900">
                            <span className="flex items-center gap-2">
                              <Sprout className="h-4 w-4 text-navy-600" />
                              {d.species}
                            </span>
                          </td>
                          <td className="tnum text-journal-700">{d.count.toLocaleString()}</td>
                          <td className="text-right">
                            {isConfirming ? (
                              <button
                                onClick={() => {
                                  setConfirmingSpecies(null);
                                  setConfirmInput('');
                                }}
                                disabled={isDeleting}
                                className="inline-flex items-center gap-1.5 rounded-md border border-journal-200 bg-white px-3 py-1.5 text-sm font-medium text-journal-600 transition-colors hover:bg-journal-50 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                onClick={() => openConfirm(d.species)}
                                disabled={deletingSpecies !== null}
                                className="inline-flex items-center gap-1.5 rounded-md border border-burgundy-200 bg-burgundy-50 px-3 py-1.5 text-sm font-medium text-burgundy-700 transition-colors hover:bg-burgundy-100 disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                        {isConfirming && (
                          <tr className="bg-burgundy-50/60">
                            <td colSpan={3} className="px-4 py-4">
                              <div className="flex flex-col gap-3">
                                <p className="flex items-start gap-2 text-sm text-burgundy-800">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                  <span>
                                    This will permanently delete all{' '}
                                    <strong className="tnum">{d.count.toLocaleString()}</strong> records for{' '}
                                    <strong>{d.species}</strong>. This action cannot be undone. Type the full
                                    species name <strong className="font-mono">{d.species}</strong> to confirm.
                                  </span>
                                </p>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                  <input
                                    type="text"
                                    value={confirmInput}
                                    onChange={(e) => setConfirmInput(e.target.value)}
                                    placeholder={d.species}
                                    disabled={isDeleting}
                                    aria-label={`Type ${d.species} to confirm deletion`}
                                    className="w-full rounded-md border border-burgundy-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-burgundy-500 sm:max-w-xs"
                                  />
                                  <button
                                    onClick={() => handleDelete(d)}
                                    disabled={!confirmMatches || isDeleting}
                                    className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors ${
                                      !confirmMatches || isDeleting
                                        ? 'cursor-not-allowed bg-burgundy-300'
                                        : 'bg-burgundy-700 hover:bg-burgundy-800'
                                    }`}
                                  >
                                    {isDeleting ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Deleting…
                                      </>
                                    ) : (
                                      'Confirm Delete'
                                    )}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Submit;

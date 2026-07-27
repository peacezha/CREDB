import React, { useEffect, useRef, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Sprout, X, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { MAX_UPLOAD_BYTES, describeError } from '../services/api';

/**
 * Upload dialog used by the Submit page.
 *
 * Interface (changed from the old `{ isOpen, onClose, onSuccess }`):
 * - `open` / `onClose` match the shared <Modal> naming.
 * - `onUpload(file, species)` performs the actual upload in the parent and
 *   returns a Promise. This component collects + validates the input, calls
 *   `onUpload`, and renders the uploading / error (via describeError) /
 *   success states. On success it does NOT auto-close — the user closes the
 *   dialog or chooses "Upload Another File".
 */
interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File, species: string) => Promise<void>;
}

const ACCEPTED_EXTENSIONS = '.tsv,.csv,.txt';
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const UploadModal: React.FC<UploadModalProps> = ({ open, onClose, onUpload }) => {
  const [file, setFile] = useState<File | null>(null);
  const [species, setSpecies] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset everything each time the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setSpecies('');
    setIsUploading(false);
    setIsDragging(false);
    setError(null);
    setSuccess(false);
  }, [open]);

  const acceptFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setError(
        `"${candidate.name}" is ${formatFileSize(candidate.size)} — the maximum upload size is ${MAX_UPLOAD_MB} MB.`
      );
      return;
    }
    setFile(candidate);
    setError(null);
  };

  const handleUpload = async () => {
    if (!species.trim()) {
      setError('Please enter a species name.');
      return;
    }
    if (!file) {
      setError('Please select a file first.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`The file exceeds the maximum upload size of ${MAX_UPLOAD_MB} MB.`);
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      await onUpload(file, species.trim());
      setSuccess(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsUploading(false);
    }
  };

  const resetForAnother = () => {
    setFile(null);
    setSpecies('');
    setError(null);
    setSuccess(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      title={
        <span className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-navy-700" />
          Upload Dataset
        </span>
      }
    >
      {success ? (
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle className="mb-3 h-14 w-14 text-green-600" />
          <p className="text-lg font-medium text-journal-900">Upload Successful!</p>
          <p className="mt-1 text-sm text-journal-600">The database has been updated.</p>
          <div className="mt-6 flex w-full gap-3">
            <button
              type="button"
              onClick={resetForAnother}
              className="flex-1 rounded-md border border-journal-300 px-4 py-2 text-sm font-medium text-journal-800 transition-colors hover:bg-journal-50"
            >
              Upload Another File
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-700"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Species name */}
          <div className="mb-4">
            <label
              htmlFor="upload-species"
              className="mb-1 block text-sm font-medium text-journal-800"
            >
              Species Name <span className="text-burgundy-600">*</span>
            </label>
            <div className="relative">
              <Sprout className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-journal-400" />
              <input
                id="upload-species"
                type="text"
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                disabled={isUploading}
                placeholder="e.g. Wheat"
                className="w-full rounded-md border border-journal-300 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-navy-600 focus:ring-2 focus:ring-navy-100 disabled:opacity-50"
              />
            </div>
          </div>

          {/* File drop zone (click to browse or drag & drop) */}
          <label
            htmlFor="upload-file"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              acceptFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-8 transition-colors ${
              isDragging
                ? 'border-navy-500 bg-navy-50'
                : 'border-journal-300 bg-journal-50 hover:bg-journal-100'
            } ${isUploading ? 'pointer-events-none opacity-50' : ''}`}
          >
            <input
              id="upload-file"
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              disabled={isUploading}
              onChange={(e) => {
                acceptFile(e.target.files?.[0]);
                // Allow re-selecting the same file after removal.
                e.target.value = '';
              }}
              className="sr-only"
            />
            {file ? (
              <div className="flex w-full items-center gap-3">
                <FileText className="h-8 w-8 flex-shrink-0 text-navy-700" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-journal-900">{file.name}</p>
                  <p className="tnum text-xs text-journal-500">{formatFileSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  aria-label="Remove selected file"
                  disabled={isUploading}
                  onClick={(e) => {
                    e.preventDefault();
                    setFile(null);
                  }}
                  className="rounded p-1 text-journal-400 transition-colors hover:bg-white hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <FileText className="mb-2 h-12 w-12 text-journal-400" />
                <p className="text-sm font-medium text-journal-800">
                  Drag &amp; drop a file here, or click to browse
                </p>
                <p className="mt-1 text-xs text-journal-500">
                  TSV / CSV / TXT — maximum size {MAX_UPLOAD_MB} MB
                </p>
              </>
            )}
          </label>

          {/* Inline validation / server errors */}
          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || !species.trim() || isUploading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-navy-800 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-journal-300"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading…
              </>
            ) : (
              'Upload to Database'
            )}
          </button>
        </>
      )}
    </Modal>
  );
};

export default UploadModal;

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';

/**
 * JBrowse 2 embedded genome browser — full-bleed page.
 * App.tsx gives this route the whole viewport below the navbar (no container,
 * no footer); this component fills it with a slim toolbar + the iframe.
 */
const JBrowse: React.FC = () => {
  const jbrowseUrl = 'http://yan-lab.hzau.edu.cn:3000/';
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);

  // ---- Fullscreen toggle (native Fullscreen API) ------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Slim toolbar — keeps the genome browser as large as possible */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-journal-200 bg-white px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="section-kicker shrink-0">03 — Genome Browser</span>
          <h1 className="mb-0 truncate text-base text-journal-900">Genome Browser (JBrowse 2)</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!warningDismissed && (
            <span className="hidden items-center gap-1.5 text-xs text-amber-700 md:inline-flex">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
              HTTP content may be blocked on HTTPS pages
            </span>
          )}
          <a
            href={jbrowseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-journal-300 px-3 py-1.5 text-xs font-bold text-journal-800 transition-colors hover:bg-journal-50 hover:no-underline"
          >
            Open in New Tab
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Dismissible mixed-content warning (slim single line) */}
      {!warningDismissed && (
        <div
          className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800"
          role="note"
        >
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            The browser is served over HTTP; if the area below stays blank on an HTTPS deployment,
            use "Open in New Tab" instead.
          </p>
          <button
            type="button"
            onClick={() => setWarningDismissed(true)}
            aria-label="Dismiss warning"
            className="rounded p-0.5 text-amber-700 transition-colors hover:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Genome browser fills all remaining viewport space */}
      <div
        ref={containerRef}
        className={`relative min-h-0 flex-1 ${isFullscreen ? 'bg-white' : 'bg-journal-50'}`}
      >
        {fullscreenSupported && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="absolute right-3 top-3 z-10 inline-flex items-center justify-center rounded-md border border-journal-200 bg-white/80 p-2 text-journal-600 backdrop-blur transition-colors hover:bg-white hover:text-navy-700"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
        {!iframeLoaded && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-journal-500"
            role="status"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-journal-300 border-t-navy-700" />
            <p className="text-sm">Loading genome browser…</p>
          </div>
        )}
        <iframe
          src={jbrowseUrl}
          onLoad={() => setIframeLoaded(true)}
          className="h-full w-full border-0"
          title="JBrowse 2 Genome Browser"
          allowFullScreen
        />
      </div>
    </div>
  );
};

export default JBrowse;

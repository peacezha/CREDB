import React, { useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

const JBrowse: React.FC = () => {
  const jbrowseUrl = 'http://yan-lab.hzau.edu.cn:3000/';
  const [iframeLoaded, setIframeLoaded] = useState(false);

  return (
    <div className="flex flex-1 flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-journal-900">
            Genome Browser (JBrowse 2)
          </h1>
          <p className="mt-1 text-journal-500">Interactive JBrowse 2 visualization.</p>
        </div>
        <a
          href={jbrowseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-navy-200 bg-navy-50 px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-100 hover:no-underline"
        >
          Open in New Tab
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
        <p>
          Note: Since the genome browser is hosted on an HTTP server, it might not load
          inside this HTTPS secure page due to browser security policies. If you see a
          blank area below, please click "Open in New Tab".
        </p>
      </div>

      <div className="relative min-h-[400px] flex-1 overflow-hidden rounded-md border border-journal-200 bg-journal-50">
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

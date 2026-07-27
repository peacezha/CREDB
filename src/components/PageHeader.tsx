import React from 'react';

interface PageHeaderProps {
  /** Small uppercase kicker line, e.g. "01 — Data". */
  kicker: string;
  title: string;
  description?: string;
  /** Optional right-aligned content (buttons, stats, chips). */
  actions?: React.ReactNode;
}

/**
 * Unified page header used by every route: kicker line, serif title,
 * optional description and a bottom hairline — keeps all pages visually
 * consistent with the Home page's section style.
 */
const PageHeader: React.FC<PageHeaderProps> = ({ kicker, title, description, actions }) => (
  <div className="mb-6 border-b border-journal-200 pb-4">
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="section-kicker">{kicker}</p>
        <h1 className="mb-0 mt-1 text-journal-900">{title}</h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-journal-600">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  </div>
);

export default PageHeader;

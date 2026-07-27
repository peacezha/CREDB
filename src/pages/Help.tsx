import React from 'react';
import {
  Search,
  Eye,
  ExternalLink,
  Download,
  FlaskConical,
  UploadCloud,
  List,
} from 'lucide-react';

interface HelpSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  paragraphs: string[];
}

const SECTIONS: HelpSection[] = [
  {
    id: 'searching',
    title: 'Searching the Database',
    icon: Search,
    paragraphs: [
      "Navigate to the 'Data Search' page and select a species from the dropdown menu. Use the search bar to query by Peak ID, Gene ID, or genomic location (e.g. chr1:1000-2000), and refine results with the tissue and chromosome filters. The results table updates in real-time as you type.",
      'Use the pagination controls below the table to browse large result sets. Click a column header in the results table to inspect values; long text fields are truncated for readability.',
    ],
  },
  {
    id: 'details',
    title: 'Viewing Details & Motifs',
    icon: Eye,
    paragraphs: [
      "Some columns, like 'Footprint', contain extensive data that is truncated in the main table view. Click on these truncated cells (indicated by an eye icon on hover) to open a modal window displaying the full list of identified motifs and sequences.",
    ],
  },
  {
    id: 'external-links',
    title: 'External Links',
    icon: ExternalLink,
    paragraphs: [
      "The database integrates with external tools. Links in the 'PAM Position Link' column take you to the CRISPR-Cereal database for guide RNA design, and links in the 'Expression Link' column open the expression browser for the corresponding species. All external links open in new tabs.",
    ],
  },
  {
    id: 'downloading',
    title: 'Downloading Data',
    icon: Download,
    paragraphs: [
      "To perform offline analysis, visit the 'Download' page. We provide full dataset dumps in TSV format for each species, generated on-demand so they always reflect the current database contents.",
      'All data is distributed under the Creative Commons Attribution 4.0 International License (CC BY 4.0). When using the data in a publication, please cite CREDB as described in the footer of every page.',
    ],
  },
  {
    id: 'analysis',
    title: 'Online Analysis (ISM)',
    icon: FlaskConical,
    paragraphs: [
      "The 'Analysis' page runs in silico mutagenesis (ISM) to predict the functional importance of each base in a sequence. Two input modes are supported: paste a raw sequence or FASTA entry directly, or select a genomic region by chromosome and coordinates.",
      'Sequences must be between 50 bp and 2000 bp. Prediction involves deep learning inference and typically takes 1–2 minutes; please do not close the page while a job is running. Results include an open/closed chromatin classification, a prediction score, and a per-base contribution heatmap.',
    ],
  },
  {
    id: 'submitting',
    title: 'Submitting & Managing Data',
    icon: UploadCloud,
    paragraphs: [
      "Use the 'Submit' page to add new datasets. Uploads accept .tsv, .csv, or .txt files up to 50 MB; the first row is used as column headers and columns are detected automatically. An example template is available for download on that page.",
      'If the species you submit already exists, the new records are appended to the existing dataset — the page shows the current record count before you upload. The "Manage Existing Datasets" table lists all stored species with their record counts. Deleting a species removes all of its records permanently; to prevent accidents, you must type the full species name to confirm a deletion.',
    ],
  },
];

const Help: React.FC = () => {
  const scrollTo = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    // HashRouter owns the location hash, so scroll manually instead of
    // letting the browser navigate to "#id".
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="font-serif text-navy-900">User Guide</h1>
        <p className="mt-2 max-w-3xl text-journal-600">
          Learn how to navigate and use the Cis-Regulatory Elements Database (CREDB) effectively across all
          supported species.
        </p>
      </div>

      <nav aria-label="Table of contents" className="rounded-md border border-journal-200 bg-white p-6">
        <h2 className="flex items-center gap-2 font-serif text-lg text-navy-900">
          <List className="h-5 w-5 text-navy-600" />
          Contents
        </h2>
        <ol className="grid list-decimal grid-cols-1 gap-x-8 gap-y-1 pl-5 text-sm sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} onClick={scrollTo(s.id)}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="card-hover scroll-mt-6 rounded-md border border-journal-200 bg-white p-6"
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="rounded-md bg-navy-50 p-2 text-navy-700">
                <section.icon className="h-5 w-5" />
              </div>
              <h2 className="font-serif text-lg text-navy-900">{section.title}</h2>
            </div>
            <div className="space-y-3 pl-0 sm:pl-12">
              {section.paragraphs.map((p, i) => (
                <p key={i} className="leading-relaxed text-journal-700">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default Help;

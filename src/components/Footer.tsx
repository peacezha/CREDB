import React from 'react';
import { Link } from 'react-router-dom';

const QUICK_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/data', label: 'Data Search' },
  { to: '/analysis', label: 'Online Analysis' },
  { to: '/jbrowse', label: 'JBrowse2' },
  { to: '/download', label: 'Download' },
  { to: '/submit', label: 'Submit' },
  { to: '/help', label: 'Help' },
];

const Footer: React.FC = () => {
  return (
    <footer className="mt-auto bg-journal-50">
      <div
        aria-hidden="true"
        className="h-0.5 bg-gradient-to-r from-navy-900 via-navy-700 to-burgundy-800"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* About + How to Cite */}
          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-journal-800">
              About CREDB
            </h3>
            <p className="text-sm leading-relaxed text-journal-700">
              CREDB is a comprehensive database of cis-regulatory elements in major crop
              species, integrating chromatin accessibility, histone modification, and
              transcription factor footprint data.
            </p>
            <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-journal-800">
              How to Cite
            </h4>
            <p className="text-sm leading-relaxed text-journal-600">
              If you use CREDB data in your research, please cite this resource. Formal
              citation information will be provided upon publication.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-journal-800">
              Quick Links
            </h3>
            <ul className="space-y-2 text-sm">
              {QUICK_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-journal-700 hover:text-navy-700">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-journal-800">
              Contact
            </h3>
            <p className="text-sm leading-relaxed text-journal-700">
              Lab of Functional Genomics
              <br />
              Huazhong Agricultural University
              <br />
              Wuhan, Hubei 430070, China
            </p>
          </div>
        </div>

        <hr className="my-6 border-t border-journal-100" />
        <p className="text-center text-xs text-journal-600">
          &copy; {new Date().getFullYear()} CREDB. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;

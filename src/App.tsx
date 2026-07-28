import React, { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';

const DataViewer = lazy(() => import('./pages/DataViewer'));
const Analysis = lazy(() => import('./pages/Analysis'));
const JBrowse = lazy(() => import('./pages/JBrowse'));
const Download = lazy(() => import('./pages/Download'));
const Submit = lazy(() => import('./pages/Submit'));
const Help = lazy(() => import('./pages/Help'));

const PageLoader: React.FC = () => (
  <div className="flex flex-1 items-center justify-center py-24" role="status" aria-label="Loading page">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-journal-300 border-t-navy-700" />
  </div>
);

const AppShell: React.FC = () => {
  const { pathname } = useLocation();
  // JBrowse gets a full-bleed layout: no container width cap, no page padding,
  // no footer — the genome browser fills the whole viewport below the navbar.
  const fullBleed = pathname === '/jbrowse';

  return (
    <div
      className={
        fullBleed
          ? 'flex h-screen flex-col overflow-hidden bg-paper text-neutral-900'
          : 'flex min-h-screen flex-col bg-paper text-neutral-900'
      }
    >
      <Navbar />
      <main
        className={
          fullBleed
            ? 'flex w-full min-h-0 flex-1 flex-col'
            : 'mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-10'
        }
      >
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/data" element={<DataViewer />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/jbrowse" element={<JBrowse />} />
            <Route path="/download" element={<Download />} />
            <Route path="/submit" element={<Submit />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {!fullBleed && <Footer />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
};

export default App;

import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

/** Single source of truth for nav entries — rendered for both desktop and mobile. */
const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/data', label: 'Data Search' },
  { to: '/analysis', label: 'Online Analysis' },
  { to: '/jbrowse', label: 'JBrowse2' },
  { to: '/download', label: 'Download' },
  { to: '/submit', label: 'Submit' },
  { to: '/help', label: 'Help' },
];

const linkClass = (isActive: boolean, mobile: boolean) =>
  [
    'rounded px-3 text-sm font-serif transition-all duration-150 hover:-translate-y-px',
    mobile ? 'block py-2' : 'inline-block py-1.5',
    isActive
      ? 'bg-navy-800 text-white'
      : 'text-navy-200 hover:bg-navy-800 hover:text-white',
  ].join(' ');

const Navbar: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Deepen the nav shadow once the page is scrolled.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ESC closes the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <nav
      className={`glass-nav sticky top-0 z-50 border-b border-white/10 text-navy-100 transition-shadow duration-300 ${
        scrolled ? 'shadow-lg' : ''
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="flex h-14 items-center justify-between">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-sm bg-navy-800 font-serif text-lg font-bold text-white ring-1 ring-navy-700"
            >
              C
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-serif text-base font-bold tracking-tight text-white">CREDB</span>
              <span className="hidden font-serif text-xs italic text-navy-300 sm:inline">
                Cis-Regulatory Elements Database
              </span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-0.5 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => linkClass(isActive, false)}
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              aria-label="Toggle navigation menu"
              className="btn-primary p-1.5"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      {menuOpen && (
        <div id="mobile-nav-menu" className="border-t border-navy-800 bg-navy-900 md:hidden">
          <div className="space-y-0.5 px-3 py-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => linkClass(isActive, true)}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;

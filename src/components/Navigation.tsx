'use client'

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun, Activity, Clock, HelpCircle, Info, FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';

export function TopNavigationBar() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-50 px-6 py-2.5 flex items-center justify-between shadow-subtle transition-all">
      {/* Left Logo & System Status */}
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 ring-1 ring-white/30">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" viewBox="0 0 24 24">
              <circle cx="12" cy="5" fill="white" r="2.5" stroke="currentColor"></circle>
              <circle cx="5" cy="18" fill="white" r="2.5" stroke="currentColor"></circle>
              <circle cx="19" cy="18" fill="white" r="2.5" stroke="currentColor"></circle>
              <line x1="12" x2="6.5" y1="7.5" y2="16"></line>
              <line x1="12" x2="17.5" y1="7.5" y2="16"></line>
              <line x1="7.5" x2="16.5" y1="18" y2="18"></line>
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
                Med<span className="text-blue-600 dark:text-blue-400">Graph</span>
              </h1>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200/70 dark:border-blue-700/50 tracking-wide font-mono uppercase">Medication Safety Intelligence</span>
            </div>
            <p className="text-[11px] font-medium text-slate-400 mt-0.5 tracking-tight flex items-center gap-1.5">
              <span>Evidence Behind Every Connection</span>
            </p>
          </div>
        </Link>

        {/* Live Synced Badge */}
        <div className="hidden xl:flex items-center gap-2 pl-4 border-l border-slate-200/80 dark:border-slate-800">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-800/50 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Live Evidence Source • openFDA
          </div>
        </div>
      </div>

      {/* Center & Right Navigation Controls */}
      <div className="flex items-center gap-5">
        <nav className="hidden md:flex items-center gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
          <Link href="/" className="px-3 py-1.5 rounded-lg hover:text-slate-900 hover:bg-slate-100/70 dark:hover:text-white dark:hover:bg-slate-800/70 transition-colors">Home</Link>
          <Link href="/how-it-works" className="px-3 py-1.5 rounded-lg hover:text-slate-900 hover:bg-slate-100/70 dark:hover:text-white dark:hover:bg-slate-800/70 transition-colors">How It Works</Link>
          <Link href="/about" className="px-3 py-1.5 rounded-lg hover:text-slate-900 hover:bg-slate-100/70 dark:hover:text-white dark:hover:bg-slate-800/70 transition-colors">About</Link>
        </nav>

        <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-800">
          {/* Dark Mode Toggle Button */}
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle dark mode"
              className="w-8 h-8 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}

          {/* New Analysis Primary CTA */}
          <Link href="/">
            <button type="button" className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-500/20 active:scale-95 transition-all ring-1 ring-blue-500/30">
              <FlaskConical className="w-3.5 h-3.5" />
              New Analysis
            </button>
          </Link>

        </div>
      </div>
    </header>
  );
}

export function LeftSidebar() {
  const pathname = usePathname();

  const getLinkClass = (path: string) => {
    const isActive = pathname === path;
    if (isActive) {
      return "flex items-center justify-between px-3 py-2 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50/40 dark:from-blue-900/20 dark:to-indigo-900/10 text-blue-700 dark:text-blue-400 font-semibold text-sm border border-blue-200/60 dark:border-blue-800/50 shadow-2xs group transition-all";
    }
    return "flex items-center justify-between px-3 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/70 font-medium text-sm transition-all group";
  };

  const getIconClass = (path: string) => {
    const isActive = pathname === path;
    if (isActive) {
      return "w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs";
    }
    return "w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 group-hover:bg-white dark:group-hover:bg-slate-700 text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white flex items-center justify-center transition-colors";
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-white/70 dark:bg-slate-950/70 backdrop-blur-md border-r border-slate-200/80 dark:border-slate-800/80 p-4 hidden lg:flex flex-col justify-between" data-purpose="primary-sidebar">
      <div className="space-y-6">
        <div className="px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">Workspace</span>
        </div>
        <nav className="space-y-1">
          <Link href="/" className={getLinkClass('/')}>
            <div className="flex items-center gap-3">
              <div className={getIconClass('/')}>
                <Activity className="w-4 h-4" />
              </div>
              <span>Analysis</span>
            </div>
            {pathname === '/' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
          </Link>

          <Link href="/history" className={getLinkClass('/history')}>
            <div className="flex items-center gap-3">
              <div className={getIconClass('/history')}>
                <Clock className="w-4 h-4" />
              </div>
              <span>History</span>
            </div>
            {pathname === '/history' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
          </Link>

          <Link href="/how-it-works" className={getLinkClass('/how-it-works')}>
            <div className="flex items-center gap-3">
              <div className={getIconClass('/how-it-works')}>
                <HelpCircle className="w-4 h-4" />
              </div>
              <span>How It Works</span>
            </div>
            {pathname === '/how-it-works' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
          </Link>

          <Link href="/about" className={getLinkClass('/about')}>
            <div className="flex items-center gap-3">
              <div className={getIconClass('/about')}>
                <Info className="w-4 h-4" />
              </div>
              <span>About</span>
            </div>
            {pathname === '/about' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
          </Link>
        </nav>
      </div>

      {/* Bottom Disclaimer Card */}
      <div className="rounded-2xl border border-blue-200/70 dark:border-blue-800/50 bg-gradient-to-b from-blue-50/80 to-blue-100/40 dark:from-blue-900/20 dark:to-blue-900/10 p-3.5 text-slate-600 dark:text-slate-300 shadow-2xs backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-1.5 text-blue-950 dark:text-blue-100 font-bold text-xs tracking-tight">
          <div className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">
            i
          </div>
          Not medical advice
        </div>
        <p className="text-[11px] leading-relaxed font-normal">
          MedGraph does not diagnose, treat, or prescribe. Information shown is based on retrieved drug labeling. Always consult a doctor or pharmacist.
        </p>
        <div className="mt-2.5 pt-2 border-t border-blue-200/50 dark:border-blue-800/50 flex items-center justify-between text-[10px] font-medium text-blue-700 dark:text-blue-400">
          <span>v2.4 FDA Pipeline</span>
          <span className="font-mono">HIPAA Ready</span>
        </div>
      </div>
    </aside>
  );
}

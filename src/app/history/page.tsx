'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Clock, Trash2, ArrowRight, AlertTriangle, CheckCircle2, HelpCircle, FlaskConical } from 'lucide-react';
import { HistoryEntry } from '../../types';
import { getHistoryEntries, deleteHistoryEntry, clearHistory } from '../../lib/history';

const STATUS_BADGE: Record<HistoryEntry['analysisStatus'], { label: string; className: string; icon: ReactNode }> = {
  completed: {
    label: 'Completed',
    className: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-800/50',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  partial: {
    label: 'Partially completed',
    className: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/50',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  unresolved: {
    label: 'Unresolved',
    className: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/60',
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setEntries(getHistoryEntries());
    setLoaded(true);
  }, []);

  const handleDelete = (id: string) => {
    deleteHistoryEntry(id);
    setEntries(getHistoryEntries());
  };

  const handleClearAll = () => {
    if (entries.length === 0) return;
    if (!window.confirm('Clear all analysis history? This cannot be undone.')) return;
    clearHistory();
    setEntries([]);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 relative">
      <div className="absolute inset-0 bg-dot-grid opacity-50"></div>
      <div className="relative h-full flex flex-col p-6 2xl:p-8 max-w-7xl mx-auto gap-6">

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-500" />
              Analysis History
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
              Every medication comparison you run is saved here on this device, so you can revisit it later.
            </p>
          </div>
          {entries.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200/70 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All
            </button>
          )}
        </div>

        {loaded && entries.length === 0 && (
          <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-10 text-center shadow-sm flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Clock className="w-6 h-6" />
            </div>
            <p className="text-slate-600 dark:text-slate-300 text-sm font-semibold">No history recorded yet.</p>
            <p className="text-slate-400 dark:text-slate-500 text-xs max-w-sm">
              Run a medication comparison from the Analysis tab — it will show up here automatically, along with every finding, so you never have to re-run the same check twice.
            </p>
            <Link
              href="/"
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg text-white bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Start an analysis
            </Link>
          </div>
        )}

        {entries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {entries.map((entry) => {
              const badge = STATUS_BADGE[entry.analysisStatus];
              return (
                <div
                  key={entry.id}
                  className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm p-5 flex flex-col gap-3.5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    {entry.demo && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">Demo</span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {entry.medications.map((name, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-800/50 text-xs font-semibold text-blue-700 dark:text-blue-400 capitalize"
                      >
                        {name}
                      </span>
                    ))}
                  </div>

                  <div className={`inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-md border text-xs font-bold ${badge.className}`}>
                    {badge.icon}
                    {badge.label}
                  </div>

                  <div className="flex items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400 flex-wrap">
                    <span className="text-rose-600 dark:text-rose-400">{entry.stats.signals} signal{entry.stats.signals !== 1 ? 's' : ''}</span>
                    <span>{entry.stats.checkedPairs}/{entry.stats.possiblePairs} pairs checked</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1 mt-auto">
                    <Link
                      href={`/?history=${entry.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg text-white bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors"
                    >
                      View
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      title="Delete this entry"
                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

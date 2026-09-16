'use client';

import { useState } from 'react';
import { ChevronDown, UserRound } from 'lucide-react';
import type { PatientProfile as Profile } from '../types';

export default function PatientProfile({ value, onChange }: { value: Profile; onChange: (next: Profile) => void }) {
  const [open, setOpen] = useState(true);
  const set = (key: keyof Profile, raw: string | boolean) => {
    const numeric = key === 'age' || key === 'weightKg';
    onChange({ ...value, [key]: numeric ? (raw === '' ? undefined : Number(raw)) : raw });
  };
  const input = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900';
  return <section className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/85">
    <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
      <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><UserRound className="h-4 w-4 text-blue-600" />Patient Profile <span className="text-xs font-normal text-slate-400">Optional for analysis; age and weight required only when provided</span></span>
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Age<input min="1" max="130" type="number" value={value.age ?? ''} onChange={e => set('age', e.target.value)} placeholder="e.g. 68" className={input} /></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Weight (kg)<input min="1" max="500" type="number" value={value.weightKg ?? ''} onChange={e => set('weightKg', e.target.value)} placeholder="e.g. 72" className={input} /></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Pregnancy<select value={value.pregnancyStatus ?? 'not_applicable'} onChange={e => set('pregnancyStatus', e.target.value)} className={input}><option value="not_applicable">Not applicable</option><option value="no">No</option><option value="yes">Yes</option></select></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Kidney condition<select value={value.kidneyCondition ? 'yes' : 'no'} onChange={e => set('kidneyCondition', e.target.value === 'yes')} className={input}><option value="no">No</option><option value="yes">Yes</option></select></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Liver condition<select value={value.liverCondition ? 'yes' : 'no'} onChange={e => set('liverCondition', e.target.value === 'yes')} className={input}><option value="no">No</option><option value="yes">Yes</option></select></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Allergies<input value={value.allergies ?? ''} onChange={e => set('allergies', e.target.value)} placeholder="e.g. Penicillin" className={input} /></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-3">Additional conditions<textarea value={value.additionalConditions ?? ''} onChange={e => set('additionalConditions', e.target.value)} placeholder="Optional information for your own record" className={input} rows={2} /></label>
    </div>}
  </section>;
}

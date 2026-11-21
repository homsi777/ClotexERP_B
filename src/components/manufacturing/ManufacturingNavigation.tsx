import { ChevronLeft, Factory, FileSpreadsheet, Gauge, ShieldCheck, Calculator, Truck, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

export type ManufacturingSection='machines'|'departments'|'downtime'|'defects'|'specifications'|'workOrders'|'warping'|'sizing'|'weaving'|'rawInspection'|'costing'|'reports'|'external';
export const manufacturingGroups=[
 {id:'planning',icon:FileSpreadsheet,sections:['specifications','workOrders']},
 {id:'operations',icon:Gauge,sections:['warping','sizing','weaving']},
 {id:'quality',icon:ShieldCheck,sections:['rawInspection']},
 {id:'costs',icon:Calculator,sections:['costing','reports']},
 {id:'external',icon:Truck,sections:['external']},
 {id:'settings',icon:Settings,sections:['machines','departments','downtime','defects']},
] as const;
export const manufacturingSections=manufacturingGroups.flatMap(g=>[...g.sections]) as ManufacturingSection[];
export function ManufacturingNavigation({section,group,onNavigate,t,allowed=manufacturingSections}:{section:ManufacturingSection|null;group:string|null;onNavigate:(section:ManufacturingSection|null,group?:string)=>void;t:TFunction<'manufacturing'>;allowed?:ManufacturingSection[]}){
 const groups=manufacturingGroups.map(g=>({...g,sections:g.sections.filter(s=>allowed.includes(s))})).filter(g=>g.sections.length);
 const selectedGroup=groups.find(g=>section?(g.sections as readonly string[]).includes(section):g.id===group);
 // نفس تصميم شاشة المخزون: شريط مجموعات أفقي ثابت، تحته أقسام المجموعة، ثم المحتوى — بلا حاجة للرجوع خطوة خطوة.
 return <nav aria-label={String(t('navigation.label'))} className="space-y-4">
  <div role="tablist" className="flex flex-wrap gap-x-2 border-b border-slate-200">
   <button type="button" onClick={()=>onNavigate(null)} className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${!selectedGroup?'border-indigo-600 text-indigo-700':'border-transparent text-slate-500 hover:text-slate-800'}`}><Factory className="h-5 w-5"/>{t('pageTitle')}</button>
   {groups.map(g=>{const on=selectedGroup?.id===g.id;return <button key={g.id} type="button" role="tab" aria-selected={on} data-manufacturing-group={g.id} onClick={()=>onNavigate(null,g.id)} className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${on?'border-indigo-600 text-indigo-700':'border-transparent text-slate-500 hover:text-slate-800'}`}><g.icon className="h-5 w-5"/>{t(`navigation.groups.${g.id}.title`)}<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{g.sections.length}</span></button>;})}
  </div>
  {!selectedGroup&&<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{groups.map(g=><button key={g.id} type="button" onClick={()=>onNavigate(null,g.id)} className="group rounded-2xl border bg-white p-5 text-right shadow-sm transition hover:border-indigo-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500">
   <g.icon className="mb-3 h-7 w-7 text-indigo-600"/><h2 className="font-bold text-slate-900">{t(`navigation.groups.${g.id}.title`)}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t(`navigation.groups.${g.id}.description`)}</p><span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-indigo-700">{t('navigation.open')}<ChevronLeft className="h-4 w-4"/></span>
  </button>)}</div>}
  {selectedGroup&&<div className="flex flex-wrap gap-2">{selectedGroup.sections.map(s=>{const on=section===s;return <button key={s} type="button" data-manufacturing-section={s} aria-current={on?'page':undefined} onClick={()=>onNavigate(s)} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${on?'border-indigo-600 bg-indigo-600 text-white':'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'}`}>{t(`navigation.sections.${s}.title`)}</button>;})}</div>}
  {selectedGroup&&!section&&<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{selectedGroup.sections.map(s=><button key={s} type="button" onClick={()=>onNavigate(s)} className="rounded-xl border bg-white p-5 text-right hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-500"><h2 className="font-bold">{t(`navigation.sections.${s}.title`)}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t(`navigation.sections.${s}.description`)}</p><span className="mt-3 inline-block text-sm font-bold text-indigo-700">{t('navigation.open')}</span></button>)}</div>}
  {selectedGroup&&section&&<div><h2 className="text-xl font-bold">{t(`navigation.sections.${section}.title`)}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{t(`navigation.sections.${section}.description`)}</p></div>}
 </nav>;
}

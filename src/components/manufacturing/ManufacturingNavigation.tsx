import { ArrowRight, ChevronLeft, Factory, FileSpreadsheet, Gauge, ShieldCheck, Calculator, Truck, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

export type ManufacturingSection='machines'|'departments'|'downtime'|'defects'|'specifications'|'workOrders'|'warping'|'sizing'|'weaving'|'rawInspection'|'costing'|'external';
export const manufacturingGroups=[
 {id:'planning',icon:FileSpreadsheet,sections:['specifications','workOrders']},
 {id:'operations',icon:Gauge,sections:['warping','sizing','weaving']},
 {id:'quality',icon:ShieldCheck,sections:['rawInspection']},
 {id:'costs',icon:Calculator,sections:['costing']},
 {id:'external',icon:Truck,sections:['external']},
 {id:'settings',icon:Settings,sections:['machines','departments','downtime','defects']},
] as const;
export const manufacturingSections=manufacturingGroups.flatMap(g=>[...g.sections]) as ManufacturingSection[];
export function ManufacturingNavigation({section,group,onNavigate,t,allowed=manufacturingSections}:{section:ManufacturingSection|null;group:string|null;onNavigate:(section:ManufacturingSection|null,group?:string)=>void;t:TFunction<'manufacturing'>;allowed?:ManufacturingSection[]}){
 const groups=manufacturingGroups.map(g=>({...g,sections:g.sections.filter(s=>allowed.includes(s))})).filter(g=>g.sections.length);
 const selectedGroup=groups.find(g=>section?(g.sections as readonly string[]).includes(section):g.id===group);
 return <nav aria-label={String(t('navigation.label'))} className="space-y-4">
  {selectedGroup&&<div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-sm">
   <button onClick={()=>onNavigate(null)} className="inline-flex items-center gap-1 font-bold text-indigo-700"><Factory className="h-4 w-4"/>{t('pageTitle')}</button><ChevronLeft className="h-4 w-4 text-slate-400"/>
   <button onClick={()=>onNavigate(null,selectedGroup.id)} className={section?'text-indigo-700':'font-bold text-slate-800'}>{t(`navigation.groups.${selectedGroup.id}.title`)}</button>
   {section&&<><ChevronLeft className="h-4 w-4 text-slate-400"/><span aria-current="page" className="font-bold">{t(`navigation.sections.${section}.title`)}</span></>}
  </div>}
  {!selectedGroup?<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{groups.map(g=><button key={g.id} data-manufacturing-group={g.id} onClick={()=>onNavigate(null,g.id)} className="group rounded-2xl border bg-white p-5 text-right shadow-sm transition hover:border-indigo-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500">
   <g.icon className="mb-3 h-7 w-7 text-indigo-600"/><h2 className="font-bold text-slate-900">{t(`navigation.groups.${g.id}.title`)}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t(`navigation.groups.${g.id}.description`)}</p><span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-indigo-700">{t('navigation.open')}<ChevronLeft className="h-4 w-4"/></span>
  </button>)}</div>:!section?<div className="space-y-4"><button onClick={()=>onNavigate(null)} className="flex items-center gap-2 text-sm text-slate-600"><ArrowRight className="h-4 w-4"/>{t('navigation.home')}</button><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{selectedGroup.sections.map(s=><button key={s} data-manufacturing-section={s} onClick={()=>onNavigate(s)} className="rounded-xl border bg-white p-5 text-right hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-500"><h2 className="font-bold">{t(`navigation.sections.${s}.title`)}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t(`navigation.sections.${s}.description`)}</p><span className="mt-3 inline-block text-sm font-bold text-indigo-700">{t('navigation.open')}</span></button>)}</div></div>:<div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{t(`navigation.sections.${section}.title`)}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{t(`navigation.sections.${section}.description`)}</p></div><button onClick={()=>onNavigate(null,selectedGroup.id)} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"><ArrowRight className="h-4 w-4"/>{t('navigation.backToGroup')}</button></div>}
 </nav>;
}

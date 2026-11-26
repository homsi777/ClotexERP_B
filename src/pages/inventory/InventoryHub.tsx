import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  BadgePercent,
  Boxes,
  Cable,
  FolderTree,
  History,
  PackagePlus,
  Scissors,
  Settings2,
  Trash2,
  Truck,
  Warehouse,
  Package,
  Grid3x3,
} from 'lucide-react';
import { fetchMe, type AuthUser } from '../../lib/api/authApi';
import { canSeePath } from '../../lib/permissionNav';

type Card = { to: string; icon: React.ElementType; labelKey: string };
type Section = { id: string; icon: React.ElementType; titleKey: string; descKey: string; cards: Card[] };

/** كل قسم = شريط أيقونات رئيسي أفقي، وتحته بطاقات الأقسام الفرعية. الصلاحيات والمسارات كما هي. */
const SECTIONS: Section[] = [
  {
    id: 'stock',
    icon: Package,
    titleKey: 'hub.stock.title',
    descKey: 'hub.stock.desc',
    cards: [
      { to: '/inventory', icon: Boxes, labelKey: 'inventory.rolls' },
      // «إنشاء مادة جديدة» مخفي من الواجهة: تحلّ محلّه «عملية إدخال خامة جديدة» (المسار /inventory/create يبقى لأنها تستخدمه داخلياً)
      { to: '/purchases/intake-operations/new', icon: PackagePlus, labelKey: 'inventory.intakeOperationNew' },
      { to: '/inventory/movements-log', icon: History, labelKey: 'inventory.movementsLog' },
      { to: '/inventory/roll-cut', icon: Scissors, labelKey: 'inventory.rollCut' },
      { to: '/inventory/yarn', icon: Cable, labelKey: 'inventory.yarn' },
    ],
  },
  {
    id: 'warehouses',
    icon: Warehouse,
    titleKey: 'hub.warehouses.title',
    descKey: 'hub.warehouses.desc',
    cards: [
      { to: '/inventory/warehouses', icon: Warehouse, labelKey: 'inventory.warehouses' },
      { to: '/inventory/zones', icon: Grid3x3, labelKey: 'inventory.zones' },
      { to: '/inventory/transfers', icon: ArrowRightLeft, labelKey: 'inventory.transfers' },
      { to: '/inventory/depreciation', icon: Trash2, labelKey: 'inventory.depreciation' },
    ],
  },
  {
    id: 'settings',
    icon: Settings2,
    titleKey: 'hub.settings.title',
    descKey: 'hub.settings.desc',
    cards: [
      { to: '/inventory/categories', icon: FolderTree, labelKey: 'inventory.categories' },
      { to: '/inventory/settings', icon: Settings2, labelKey: 'inventory.settings' },
      { to: '/inventory/bulk-pricing', icon: BadgePercent, labelKey: 'inventory.bulkPricing' },
    ],
  },
];

export const InventoryHub: React.FC = () => {
  const { t } = useTranslation('nav');
  const [params, setParams] = useSearchParams();
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    void fetchMe().then(setUser).catch(() => setUser(null));
  }, []);

  const visible = SECTIONS.map((s) => ({ ...s, cards: s.cards.filter((c) => canSeePath(user, c.to)) })).filter((s) => s.cards.length);
  const requested = params.get('tab');
  const active = visible.find((s) => s.id === requested) ?? visible[0];

  return (
    <div className="space-y-6 p-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('inventory')}</h1>
        <p className="text-sm text-slate-500">{t('hub.subtitle')}</p>
      </div>

      <div role="tablist" className="flex flex-wrap gap-2 border-b border-slate-200">
        {visible.map((s) => {
          const Icon = s.icon;
          const on = active?.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setParams({ tab: s.id }, { replace: true })}
              className={`-mb-px flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition ${
                on ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-5 w-5" />
              {t(s.titleKey)}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{s.cards.length}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <section className="space-y-4">
          <p className="text-sm text-slate-500">{t(active.descKey)}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {active.cards.map(({ to, icon: Icon, labelKey }) => (
              <Link
                key={to}
                to={to}
                className="group flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm transition hover:border-indigo-300 hover:shadow-md"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100">
                  <Icon className="h-7 w-7" />
                </span>
                <span className="text-sm font-bold text-slate-900">{t(labelKey)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

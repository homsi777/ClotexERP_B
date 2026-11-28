import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatWidget } from '../components/ChatWidget';
import { AiAssistantLauncher } from '../components/ai/AiAssistantLauncher';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Briefcase,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Factory,
  FileText,
  Handshake,
  Home,
  Layers,
  Menu,
  Network,
  Package,
  PieChart,
  Receipt,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  Wallet,
  X,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar, tr } from 'date-fns/locale';
import { useStore } from '../store/useStore';
import type { CustomerOrder } from '../types';
import { ORDER_STATUS_LABELS } from '../pages/orders/orderStatusUi';
import { useTranslation } from 'react-i18next';
import { BackendConnectionBadge } from '../components/BackendConnectionBadge';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ToastProvider } from '../components/NonBlockingToast';
import { SessionPresenceTracker } from '../components/SessionPresenceTracker';
import { CompanySwitcher } from '../components/companies/CompanySwitcher';
import { ActiveCompanyBanner } from '../components/companies/ActiveCompanyBanner';
import {OrderNotificationInbox} from '../components/orders/OrderNotificationInbox';
import { BRAND } from '../branding';
import { useAnchoredPopoverStyle } from '../lib/useAnchoredPopoverStyle';
import { fetchMe, type AuthUser } from '../lib/api/authApi';
import { canAccessRoute, canSeePath } from '../lib/permissionNav';
import { getCheckDueSummary, type CheckDueItem } from '../lib/api/checksApi';
import { fetchPricingQueue, type PricingQueueItem } from '../lib/api/pricingQueueApi';
import { pendingEditRequests, decideEditRequestApi, entityPath, ENTITY_AR, type EditRequestDto } from '../lib/api/editRequestsApi';
import { canPriceUser, canSeeFinanceUser, canApproveUser } from '../lib/priceAccess';
import { listInventoryWaste } from '../lib/api/inventoryWasteApi';
import { applyCompanyDefaultLanguage } from '../i18n/applyCompanyLanguage';

/** أيام حتى موعد التوريد المتوقع (تاريخ محلي) */
function daysUntilSupply(expectedDate: string): number {
  const target = new Date(`${expectedDate}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function selectNearPickupOrders(orders: CustomerOrder[]): CustomerOrder[] {
  return orders.filter((o) => {
    if (o.status === 'ready_pickup') return true;
    if (!o.expectedDate) return false;
    const days = daysUntilSupply(o.expectedDate);
    if (days < 0 || days > 7) return false;
    return o.status === 'pending_supply' || o.status === 'partial_ready';
  });
}

type NavSubItem = { labelKey: string; to: string };
type NavItem =
  | { labelKey: string; to: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }
  | {
      labelKey: string;
      icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
      subItems: NavSubItem[];
    };

/** سهم رجوع ثابت أعلى كل صفحة داخلية (عدا الرئيسية): يرجع للصفحة السابقة، وإن لم توجد سابقة (فتح رابط مباشر) يذهب للرئيسية. */
const BackButton: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  if (pathname === '/') return null;
  const rtl = i18n.dir() === 'rtl';
  const canGoBack = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}
      className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 print:hidden"
    >
      <ArrowRight className={`h-4 w-4 ${rtl ? '' : 'rotate-180'}`} />
      {rtl ? 'رجوع' : 'Geri'}
    </button>
  );
};

const Topbar = () => {
  const { t, i18n } = useTranslation(['nav', 'common']);
  const dateFnsLocale = i18n.language === 'ar' ? ar : tr;
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileExpandedKey, setMobileExpandedKey] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [navUser, setNavUser] = useState<AuthUser | null>(null);
  useEffect(() => { void fetchMe().then(setNavUser).catch(() => setNavUser(null)); }, []);
  const notifyRef = useRef<HTMLDivElement>(null);
  const notifyPanelRef = useRef<HTMLDivElement>(null);

  const customerOrders = useStore((s) => s.customerOrders);
  const customers = useStore((s) => s.customers);

  const pickupAlerts = useMemo(() => selectNearPickupOrders(customerOrders), [customerOrders]);
  const notifyPanelStyle = useAnchoredPopoverStyle(notifyRef, notifyOpen);
  const [checkDue, setCheckDue] = useState<{ overdue: number; dueSoon: number; items: CheckDueItem[] }>({ overdue: 0, dueSoon: 0, items: [] });
  useEffect(() => {
    let active = true;
    const load = () => getCheckDueSummary().then((r) => { if (active) setCheckDue(r.data); }).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(id); };
  }, [location.pathname]);
  const checkAlertCount = checkDue.overdue + checkDue.dueSoon;
  // مسودات فواتير بحاجة إلى تسعير: إشعار للمحاسب/المدير فقط.
  const [pricingQueue, setPricingQueue] = useState<PricingQueueItem[]>([]);
  const mayPrice = canPriceUser(navUser, 'sales.invoices') || canPriceUser(navUser, 'purchases.invoices');
  useEffect(() => {
    if (!mayPrice) { setPricingQueue([]); return; }
    let active = true;
    const load = () => fetchPricingQueue().then((r) => { if (active) setPricingQueue(r.items); }).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 2 * 60 * 1000);
    return () => { active = false; window.clearInterval(id); };
  }, [mayPrice, location.pathname]);
  const pricingCount = pricingQueue.length;
  // طلبات إذن التعديل الموجّهة لي كمسؤول (أو لكل مدير/محاسب إن لم يُعيَّن مسؤول).
  const [approvals, setApprovals] = useState<EditRequestDto[]>([]);
  const loadApprovals = useCallback(() => pendingEditRequests().then(setApprovals).catch(() => undefined), []);
  useEffect(() => {
    void loadApprovals();
    const id = window.setInterval(() => void loadApprovals(), 30 * 1000);
    return () => window.clearInterval(id);
  }, [loadApprovals, location.pathname]);
  const decide = async (id: string, approve: boolean) => {
    let note: string | undefined;
    if (!approve) note = window.prompt('سبب الرفض (اختياري)') ?? undefined;
    try {
      await decideEditRequestApi(id, approve, note);
      await loadApprovals();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'تعذّر تنفيذ القرار');
    }
  };
  const approvalCount = approvals.length;
  // مسودات إهلاك مادي بانتظار الاعتماد (للمدير/المحاسب أو من مُنح «اعتماد»).
  const [wasteDrafts, setWasteDrafts] = useState<{ id: string; waste_no: string; reason: string | null }[]>([]);
  const mayApproveWaste = canApproveUser(navUser, 'inventory.waste');
  useEffect(() => {
    if (!mayApproveWaste) { setWasteDrafts([]); return; }
    let active = true;
    const load = () => listInventoryWaste({ status: 'DRAFT', page: 1, pageSize: 20 }).then((r) => { if (active) setWasteDrafts((r.data ?? []) as never); }).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 2 * 60 * 1000);
    return () => { active = false; window.clearInterval(id); };
  }, [mayApproveWaste, location.pathname]);
  const wasteCount = wasteDrafts.length;
  const hasAlerts = pickupAlerts.length > 0 || checkAlertCount > 0 || pricingCount > 0 || approvalCount > 0 || wasteCount > 0;

  useEffect(() => {
    if (!notifyOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // اللوحة تُرسم في portal خارج notifyRef: يجب استثناؤها وإلا يُغلقها mousedown قبل وصول النقر للرابط.
      if (notifyRef.current?.contains(target) || notifyPanelRef.current?.contains(target)) return;
      setNotifyOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [notifyOpen]);

  const navItemsAll: NavItem[] = [
    { labelKey: 'home', to: '/', icon: Home },
    // لوحة المالك: لمدير المنصة فقط (نظرة موحّدة على كل الفروع).
    ...(navUser?.isPlatformAdmin ? [{ labelKey: 'platform', to: '/platform', icon: Network } as NavItem] : []),
    ...(navUser?.role === 'admin' || (navUser?.permMode === 'CUSTOM' ? (navUser?.permMatrix ?? []).includes('p:management.view') : (navUser?.permissions ?? []).includes('management.view')) ? [{ labelKey: 'branchManagement', to: '/management', icon: Network } as NavItem] : []),
    // المخزون: شاشة واحدة بشريط أيقونات أفقي (المخزون / المستودعات والتنظيم / الإعدادات) بدل القائمة المنسدلة.
    { labelKey: 'inventory', to: '/inventory-hub', icon: Package },
    {
      labelKey: 'stickers',
      icon: Tags,
      subItems: [
        { labelKey: 'stickers.labels', to: '/inventory/labels' },
        { labelKey: 'stickers.customLabel', to: '/inventory/custom-label' },
        { labelKey: 'stickers.printJobs', to: '/inventory/print-jobs' },
      ],
    },
    // قائمة مستقلة للكارتيلات (ملاحظة بشير): المكتبة والمخزون والتسليم والعهدة.
    {
      labelKey: 'cartelaMenu',
      icon: Layers,
      subItems: [
        { labelKey: 'cartelaMenu.generate', to: '/cartela' },
        { labelKey: 'cartelaMenu.library', to: '/cartela/library' },
        { labelKey: 'cartelaMenu.colors', to: '/cartela/colors' },
        { labelKey: 'cartelaMenu.stock', to: '/cartela/stock' },
        { labelKey: 'cartelaMenu.delivery', to: '/cartela/delivery' },
        { labelKey: 'cartelaMenu.custody', to: '/cartela/custody' },
      ],
    },
    {
      labelKey: 'invoices',
      icon: FileText,
      subItems: [
        { labelKey: 'invoices.sales', to: '/invoices/sales' },
        { labelKey: 'invoices.purchases', to: '/invoices/purchases' },
        { labelKey: 'invoices.dispatchSlips', to: '/inventory/intake-dispatch-slips' },
        { labelKey: 'invoices.purchaseReceiving', to: '/purchases/receiving' },
        { labelKey: 'invoices.operatingWarehouses', to: '/purchases/operating-warehouses' },
        { labelKey: 'invoices.purchaseNew', to: '/purchases/new-invoice' },
        { labelKey: 'invoices.externalJobs', to: '/purchases/external-jobs' },
        { labelKey: 'invoices.externalJobMatching', to: '/purchases/external-job-matching' },
        { labelKey: 'invoices.exchange', to: '/invoices/exchange' },
        { labelKey: 'invoices.returns', to: '/invoices/returns' },
        { labelKey: 'invoices.statement', to: '/invoices/statement' },
      ],
    },
    { labelKey: 'orders', to: '/orders', icon: ClipboardList },
    {
      labelKey: 'parties',
      icon: Users,
      subItems: [
        { labelKey: 'parties.customers', to: '/customers' },
        { labelKey: 'parties.suppliers', to: '/suppliers' },
        { labelKey: 'parties.customersLog', to: '/customers/log' },
        { labelKey: 'parties.suppliersLog', to: '/suppliers/log' },
        { labelKey: 'parties.customerBalances', to: '/customers/balances' },
        { labelKey: 'parties.customerStatement', to: '/customers/statement' },
        { labelKey: 'parties.supplierBalances', to: '/suppliers/balances' },
        { labelKey: 'parties.supplierStatement', to: '/suppliers/statement' },
      ],
    },
    {
      labelKey: 'treasury',
      icon: Wallet,
      subItems: [
        { labelKey: 'treasury.safes', to: '/treasury/safes' },
        { labelKey: 'treasury.checksVault', to: '/treasury/checks-vault' },
        { labelKey: 'treasury.log', to: '/treasury/log' },
        { labelKey: 'treasury.profitDetails', to: '/treasury/profit-details' },
        { labelKey: 'treasury.settings', to: '/treasury/settings' },
      ],
    },
    {
      labelKey: 'bonds',
      icon: Receipt,
      subItems: [
        { labelKey: 'bonds.payment', to: '/bonds/payment' },
        { labelKey: 'bonds.collection', to: '/bonds/collection' },
        { labelKey: 'bonds.records', to: '/bonds/records' },
      ],
    },
    { labelKey: 'expenses', to: '/expenses', icon: CreditCard },
    // HR: صفحة رئيسية مستقلة تدخل منها الأقسام (بدل القائمة المنسدلة).
    { labelKey: 'hr', to: '/hr', icon: Briefcase },
    { labelKey: 'reports', to: '/reports', icon: PieChart },
    { labelKey: 'chartOfAccounts', to: '/chart-of-accounts', icon: Network },
    { labelKey: 'journal', to: '/journal', icon: BookOpen },
    { labelKey: 'manufacturing', to: '/manufacturing', icon: Factory },
    { labelKey: 'partners', to: '/partners', icon: Handshake },
    ...(navUser && (['admin', 'manager', 'accountant'].includes(navUser.role) || navUser.permissions.includes('users.manage')) ? [{ labelKey: 'permissions', to: '/permissions', icon: ShieldCheck } as NavItem] : []),
    ...(navUser && (navUser.role === 'admin' || navUser.permissions.includes('users.manage')) ? [{ labelKey: 'approvalsCenter', to: '/approvals-center', icon: ShieldCheck } as NavItem] : []),
    { labelKey: 'settings', to: '/settings', icon: Settings },
  ];
  const navItems: NavItem[] = navItemsAll.flatMap((item): NavItem[] => {
    if ('subItems' in item && item.subItems) {
      const subItems = item.subItems.filter((sub) => {
        // كشوف الحساب مالية: لا تظهر لمن لا يملك «الأمور المالية» للعملاء/الموردين.
        if ((sub.to === '/customers/statement' || sub.to === '/customers/balances') && !canSeeFinanceUser(navUser, 'customers')) return false;
        if ((sub.to === '/suppliers/statement' || sub.to === '/suppliers/balances') && !canSeeFinanceUser(navUser, 'suppliers')) return false;
        return canAccessRoute(navUser, sub.to);
      });
      return subItems.length ? [{ ...item, subItems }] : [];
    }
    return canAccessRoute(navUser, (item as { to: string }).to) ? [item] : [];
  });

  const isRouteActive = (to?: string) => {
    if (!to) return false;
    if (to === '/') return location.pathname === '/';
    if (to === '/inventory-hub') {
      const p = location.pathname;
      const isSticker = ['/inventory/labels', '/inventory/custom-label', '/inventory/print-jobs', '/inventory/intake-dispatch-slips'].some((x) => p === x || p.startsWith(`${x}/`));
      return p === to || (!isSticker && (p === '/inventory' || p.startsWith('/inventory/') || p.startsWith('/purchases/intake-operations')));
    }
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  };

  /** رابط فرعي نشط، دون تفعيل رابط الأب (مثل /cartela) حين يكون أحد إخوته الأدق هو الحالي. */
  const isSubActive = (siblings: NavSubItem[], to: string) =>
    isRouteActive(to) && !siblings.some((o) => o.to !== to && o.to.startsWith(`${to}/`) && isRouteActive(o.to));

  const isParentActive = (item: NavItem) => {
    if ('subItems' in item && item.subItems) {
      return item.subItems.some((sub) => isRouteActive(sub.to));
    }
    if ('to' in item) return isRouteActive(item.to);
    return false;
  };

  const parentBtn = (parentActive: boolean) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-xl transition-colors font-medium text-sm border ${
      parentActive
        ? 'bg-[var(--ui-accent)] text-white border-transparent shadow-md shadow-[var(--ui-accent)]/25'
        : 'text-[var(--text-muted)] border-transparent hover:bg-[var(--border-subtle)] hover:text-[var(--text-heading)]'
    }`;

  const parentIcon = (parentActive: boolean) =>
    parentActive ? 'text-white' : '';

  const chevronCls = (parentActive: boolean) =>
    `w-3 h-3 transition-transform group-hover:rotate-180 ${
      parentActive ? 'text-white/80' : 'text-[var(--text-muted)] group-hover:text-[var(--text-heading)]'
    }`;

  const linkTopCls = (parentActive: boolean) =>
    `flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl transition-colors font-medium text-sm border ${
      parentActive
        ? 'bg-[var(--ui-accent)] text-white border-transparent shadow-md shadow-[var(--ui-accent)]/25'
        : 'text-[var(--text-muted)] border-transparent hover:bg-[var(--border-subtle)] hover:text-[var(--text-heading)]'
    }`;

  const subLinkCls = (isActive: boolean) =>
    `px-4 py-2 text-sm text-right transition-colors ${
      isActive
        ? 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] font-medium'
        : 'text-[var(--text-muted)] hover:bg-[var(--ui-dropdown-hover-bg)] hover:text-[var(--ui-accent-hover)]'
    }`;

  useEffect(() => {
    if (!mobileMenuOpen) {
      setMobileExpandedKey(null);
      return;
    }
    const activeGroup = navItems.find(
      (item) => 'subItems' in item && item.subItems?.some((sub) => isRouteActive(sub.to)),
    );
    if (activeGroup && 'labelKey' in activeGroup) {
      setMobileExpandedKey(activeGroup.labelKey);
    }
  }, [mobileMenuOpen, location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  const renderNotificationBell = (buttonClassName = 'relative rounded-xl p-2.5 transition border') => (
    <div ref={notifyRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setNotifyOpen((v) => !v)}
        className={`${buttonClassName} ${
          notifyOpen
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] hover:text-[var(--text-heading)] hover:border-[var(--border-default)]'
        } ${hasAlerts && !notifyOpen ? 'notify-bell-glow bg-amber-50/80 text-amber-700 border-amber-200/80' : ''}`}
        title={t('notifications.title')}
        aria-expanded={notifyOpen}
        aria-haspopup="true"
      >
        <Bell className={`w-5 h-5 ${hasAlerts ? 'text-amber-600' : ''}`} strokeWidth={2} />
        {hasAlerts && (
          <span className="notify-badge-pulse absolute -top-0.5 -start-0.5 min-w-[18px] h-[18px] px-0.5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[9px] font-bold text-white flex items-center justify-center shadow-md ring-2 ring-white md:min-w-[20px] md:h-5 md:px-1 md:text-[10px]">
            {pickupAlerts.length + checkAlertCount + pricingCount + approvalCount + wasteCount > 99 ? '99+' : pickupAlerts.length + checkAlertCount + pricingCount + approvalCount + wasteCount}
          </span>
        )}
      </button>
      {notifyOpen && notifyPanelStyle && createPortal(
        <div
          ref={notifyPanelRef}
          style={notifyPanelStyle}
          className={`rounded-2xl border border-amber-200/80 bg-[var(--surface-header)] overflow-hidden ${hasAlerts ? 'notify-panel-glow' : 'shadow-2xl ring-1 ring-black/5'}`}
          role="dialog"
          aria-label={t('notifications.title')}
        >
          <div className="px-4 py-3.5 border-b border-amber-100 bg-gradient-to-l from-amber-50 via-[var(--surface-muted-nav)] to-[var(--surface-header)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black text-[var(--text-heading)]">{t('notifications.pickupTitle')}</p>
              {hasAlerts && (
                <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {pickupAlerts.length}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
              {t('notifications.pickupSubtitle')}
            </p>
          </div>
          <OrderNotificationInbox/>
          {wasteCount > 0 && (
            <div className="border-b border-rose-100 bg-rose-50/60 px-3 py-2">
              <p className="mb-1 text-xs font-black text-rose-900">إهلاك مادي بانتظار الاعتماد ({wasteCount})</p>
              <ul className="space-y-1">
                {wasteDrafts.slice(0, 8).map((w) => (
                  <li key={w.id}>
                    <Link to={`/inventory/depreciation?search=${encodeURIComponent(w.waste_no)}`} onClick={() => setNotifyOpen(false)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-rose-100/70">
                      <span className="truncate font-mono font-bold">{w.waste_no}</span>
                      <span className="shrink-0 truncate text-slate-600">{w.reason || ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {approvalCount > 0 && (
            <div className="border-b border-violet-100 bg-violet-50/60 px-3 py-2">
              <p className="mb-1 text-xs font-black text-violet-900">طلبات إذن تعديل ({approvalCount})</p>
              <ul className="space-y-1.5">
                {approvals.slice(0, 8).map((r) => (
                  <li key={r.id} className="rounded-lg bg-white/70 px-2 py-1.5 text-xs">
                    <Link to={entityPath(r)} onClick={() => setNotifyOpen(false)} className="block font-bold text-violet-900 hover:underline">{r.requestedByName} يطلب تعديل {ENTITY_AR[r.entityType]} «{r.entityLabel}»</Link>
                    <div className="text-slate-600">{r.reason}</div>
                    <div className="mt-1 flex gap-1.5">
                      <button type="button" onClick={() => void decide(r.id, true)} className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700">موافقة</button>
                      <button type="button" onClick={() => void decide(r.id, false)} className="rounded bg-rose-600 px-2 py-0.5 font-bold text-white hover:bg-rose-700">رفض</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pricingCount > 0 && (
            <div className="border-b border-orange-100 bg-orange-50/60 px-3 py-2">
              <p className="mb-1 text-xs font-black text-orange-900">فواتير بحاجة إلى تسعير ({pricingCount})</p>
              <ul className="space-y-1">
                {pricingQueue.slice(0, 8).map((q) => (
                  <li key={`${q.kind}:${q.id}`}>
                    <Link to={q.kind === 'SALES' ? `/invoices/sales/${q.id}/edit` : q.kind === 'EXTERNAL' ? `/purchases/external-jobs/${q.id}?tab=pricing` : `/invoices/purchases/${q.id}/edit`} onClick={() => setNotifyOpen(false)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-orange-100/70">
                      <span className="truncate font-mono font-bold">{q.invoiceNo} · {q.partyName}</span>
                      <span className="shrink-0 font-bold text-orange-800">{q.kind === 'SALES' ? 'بيع' : q.kind === 'EXTERNAL' ? 'مصنعية' : 'شراء'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {checkAlertCount > 0 && (
            <div className="border-b border-amber-100 bg-amber-50/50 px-3 py-2">
              <p className="mb-1 text-xs font-black text-amber-900">{t('dueNotice.title', { ns: 'checksVault' })} ({checkAlertCount})</p>
              <ul className="space-y-1">
                {checkDue.items.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link to={`/treasury/checks-vault?check=${c.id}&search=${encodeURIComponent(c.check_no)}`} onClick={() => setNotifyOpen(false)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-amber-100/60">
                      <span className="truncate font-mono font-bold">{c.check_no} · {c.party_name || c.bank_name}</span>
                      <span className={`shrink-0 font-bold ${c.days_remaining < 0 ? 'text-rose-700' : 'text-amber-800'}`}>
                        {c.days_remaining === 0 ? t('countdown.today', { ns: 'checksVault' }) : c.days_remaining > 0 ? t('countdown.in', { ns: 'checksVault', count: c.days_remaining }) : t('countdown.overdue', { ns: 'checksVault', count: -c.days_remaining })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="max-h-[min(22rem,55vh)] overflow-y-auto custom-scrollbar">
            {!hasAlerts ? (
              <p className="px-4 py-8 text-sm text-center text-[var(--text-muted)]">{t('noAlertsCurrently', { ns: 'common' })}</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] p-2 space-y-1">
                {pickupAlerts.slice(0, 12).map((o) => {
                  const c = customers.find((x) => x.id === o.customerId);
                  return (
                    <li key={o.id}>
                      <Link
                        to={`/orders?order=${o.id}`}
                        className="block rounded-xl border border-transparent px-3 py-3 hover:border-amber-200/80 hover:bg-amber-50/60 transition text-right"
                        onClick={() => setNotifyOpen(false)}
                      >
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-mono font-bold text-[var(--ui-accent)] text-sm truncate">
                              {o.orderNumber}
                            </span>
                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200/80">
                              {ORDER_STATUS_LABELS[o.status]}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-[var(--text-heading)] truncate">{c?.name ?? t('customerFallback', { ns: 'common' })}</p>
                          {o.expectedDate && (
                            <p className="text-[11px] text-[var(--text-muted)]">
                              {t('expectedSupplyDate', { ns: 'common', date: format(new Date(o.expectedDate), 'PP', { locale: dateFnsLocale }) })}
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {hasAlerts && (
            <div className="px-3 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-muted-nav)]">
              <Link
                to="/orders"
                className="block text-center text-xs font-bold text-[var(--ui-accent)] hover:underline py-1.5 rounded-lg hover:bg-[var(--ui-accent-soft-bg)]"
                onClick={() => setNotifyOpen(false)}
              >
                {t('notifications.openOrders')}
              </Link>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );

  return (
    <header className="bg-[var(--surface-header)] border-b border-[var(--border-default)] shadow-sm sticky top-0 z-50 transition-colors duration-300 [--mobile-nav-top:3.75rem] md:[--mobile-nav-top:4.5rem]">
      <ActiveCompanyBanner />
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] relative z-20 bg-[var(--surface-header)] md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-3 md:px-6 md:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:order-2 md:justify-center md:gap-3">
          <button
            type="button"
            className="p-2 lg:hidden text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] rounded-lg transition shrink-0"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? t('closeMenu', { ns: 'nav', defaultValue: 'إغلاق القائمة' }) : t('openMenu', { ns: 'nav', defaultValue: 'فتح القائمة' })}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 md:flex-none md:gap-3 rounded-xl transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
            aria-label={t('home', { ns: 'nav', defaultValue: 'الصفحة الرئيسية' })}
          >
            <img
              src={BRAND.logoPng}
              alt={BRAND.name}
              className="h-12 w-auto select-none object-contain md:h-[4.25rem]"
              draggable={false}
            />
            <h1 className="sr-only">{BRAND.name}</h1>
          </Link>
        </div>
        <div className="flex items-center gap-2 shrink-0 md:order-1 md:justify-self-start md:gap-3">
          <LanguageSwitcher />
          {renderNotificationBell('relative rounded-xl p-2 md:p-2.5 transition border')}
          <Link
            to="/login"
            className="hidden md:inline text-xs font-bold text-[var(--ui-accent)] hover:underline px-1"
          >
            {t('apiLogin', { ns: 'common' })}
          </Link>
          <BackendConnectionBadge />
          <CompanySwitcher />
          <div className="hidden sm:flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--ui-accent-soft-bg)] flex items-center justify-center text-[var(--ui-accent)] font-bold border border-[var(--ui-accent-border)] uppercase">
              {(navUser?.fullName?.trim() || navUser?.username || 'M').charAt(0)}
            </div>
            <div className="text-sm leading-tight" title={navUser?.username ?? ''}>
              <p className="font-medium text-[var(--text-heading)]">{navUser ? (navUser.fullName?.trim() || navUser.username) : t('systemAdmin', { ns: 'common' })}</p>
              {navUser && navUser.fullName?.trim() && navUser.fullName.trim() !== navUser.username ? <p className="text-[11px] text-slate-500" dir="ltr">@{navUser.username}</p> : null}
            </div>
          </div>
        </div>
        <div className="hidden md:block md:order-3" aria-hidden="true" />
      </div>

      <nav className="px-6 py-2 hidden lg:flex flex-wrap gap-1 items-center bg-[var(--surface-muted-nav)] relative z-10 w-full transition-colors duration-300">
        {navItems.map((item, idx) => {
          const parentActive = isParentActive(item);

          if ('subItems' in item && item.subItems) {
            return (
              <div key={idx} className="relative group shrink-0">
                <button type="button" className={parentBtn(parentActive)}>
                  <item.icon className={`w-4 h-4 ${parentIcon(parentActive)}`} strokeWidth={2} />
                  <span>{t(item.labelKey, { ns: 'nav' })}</span>
                  <ChevronDown className={chevronCls(parentActive)} />
                </button>
                <div className="absolute end-0 mt-1 w-56 bg-[var(--surface-header)] border border-[var(--border-default)] shadow-xl rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] flex flex-col py-1">
                  {item.subItems.map((sub, sIdx) => {
                    const isActive = isSubActive(item.subItems, sub.to);
                    return (
                      <Link key={sIdx} to={sub.to} className={subLinkCls(isActive)}>
                        {t(sub.labelKey, { ns: 'nav' })}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (!('to' in item)) return null;

          return (
            <Link key={idx} to={item.to} className={linkTopCls(parentActive)}>
              <item.icon className={`w-4 h-4 ${parentIcon(parentActive)}`} strokeWidth={2} />
              <span>{t(item.labelKey, { ns: 'nav' })}</span>
            </Link>
          );
        })}
      </nav>

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            aria-label={t('closeMenu', { ns: 'nav', defaultValue: 'إغلاق القائمة' })}
            className="lg:hidden fixed inset-0 top-[var(--mobile-nav-top,4.5rem)] z-40 bg-black/30 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav className="lg:hidden fixed inset-x-0 top-[var(--mobile-nav-top,4.5rem)] z-50 max-h-[calc(100dvh-var(--mobile-nav-top,4.5rem))] overflow-y-auto overscroll-contain border-b border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl">
            <div className="divide-y divide-[var(--border-subtle)]">
              {navItems.map((item, idx) => {
                const parentActive = isParentActive(item);

                if ('subItems' in item && item.subItems) {
                  const expanded = mobileExpandedKey === item.labelKey;
                  return (
                    <div key={idx}>
                      <button
                        type="button"
                        onClick={() =>
                          setMobileExpandedKey((prev) => (prev === item.labelKey ? null : item.labelKey))
                        }
                        className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-right transition-colors ${
                          parentActive
                            ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)]'
                            : 'text-[var(--text-heading)] hover:bg-[var(--border-subtle)]'
                        }`}
                      >
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${
                            expanded ? 'rotate-180' : ''
                          } ${parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--text-muted)]'}`}
                        />
                        <span className="flex min-w-0 flex-1 items-center justify-end gap-2.5 font-semibold text-sm">
                          <span className="truncate">{t(item.labelKey, { ns: 'nav' })}</span>
                          <item.icon
                            className={`h-[18px] w-[18px] shrink-0 ${
                              parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--ui-accent-muted)]'
                            }`}
                            strokeWidth={2}
                          />
                        </span>
                      </button>
                      {expanded && (
                        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] py-1">
                          {item.subItems.map((sub, sIdx) => {
                            const isActive = isSubActive(item.subItems, sub.to);
                            return (
                              <Link
                                key={sIdx}
                                to={sub.to}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`block px-4 py-2.5 text-sm text-right transition-colors border-s-2 ${
                                  isActive
                                    ? 'border-[var(--ui-mobile-accent-border)] bg-[var(--ui-accent-soft-bg)] font-bold text-[var(--ui-accent)]'
                                    : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--border-subtle)]'
                                }`}
                              >
                                {t(sub.labelKey, { ns: 'nav' })}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                if (!('to' in item)) return null;

                return (
                  <Link
                    key={idx}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-end gap-2.5 px-4 py-3 text-sm font-semibold transition-colors ${
                      parentActive
                        ? 'bg-[var(--ui-nav-active-bg)] text-[var(--ui-nav-active-text)]'
                        : 'text-[var(--text-heading)] hover:bg-[var(--border-subtle)]'
                    }`}
                  >
                    <span>{t(item.labelKey, { ns: 'nav' })}</span>
                    <item.icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        parentActive ? 'text-[var(--ui-nav-active-icon)]' : 'text-[var(--ui-accent-muted)]'
                      }`}
                      strokeWidth={2}
                    />
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </header>
  );
};

export const DashboardLayout = () => {
  const location = useLocation();
  const isReports = location.pathname === '/reports' || location.pathname.startsWith('/reports/');
  const [guardUser, setGuardUser] = useState<AuthUser | null>(null);

  // عند فتح التطبيق أو تحديث الصفحة (جلسة مستمرة، بدون تسجيل دخول جديد)،
  // اضبطي لغة الواجهة حسب لغة الفرع الحالي — ما لم يكن المستخدم قد بدّل
  // اللغة يدوياً من قبل، فحينها لا نُعيد الكتابة فوق اختياره.
  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((user) => {
        if (!cancelled) {
          setGuardUser(user);
          void applyCompanyDefaultLanguage(user.companyDefaultLanguage);
        }
      })
      .catch(() => {
        /* غير مسجّل دخول أو فشل الطلب — لا حاجة لأي إجراء هنا */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const mainClass = isReports
    ? 'flex-1 p-0 overflow-y-auto w-full max-w-none'
    : 'flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto w-full max-w-[1600px] mx-auto';
  return (
    <div className="min-h-screen bg-[var(--page-bg)] flex flex-col transition-colors duration-300">
      <Topbar />
      <main className={mainClass}>
        <ToastProvider>
          <SessionPresenceTracker />
          <BackButton />
          {guardUser && !canAccessRoute(guardUser, location.pathname) ? (
            <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
              <p className="text-lg font-black text-rose-800">ليست لديك صلاحية على هذه الصفحة</p>
              <p className="mt-2 text-sm text-rose-700">راجع المدير إن كنت تحتاجها.</p>
            </div>
          ) : <Outlet />}
          <ChatWidget />
          <AiAssistantLauncher />
        </ToastProvider>
      </main>
    </div>
  );
};

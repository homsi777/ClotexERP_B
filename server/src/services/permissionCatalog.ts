/**
 * كتالوج الصلاحيات التفصيلية: وحدة (module) × إجراء (action).
 * المصدر الوحيد للواجهة (مصفوفة الصلاحيات) وللحارس المركزي بالخادم، ولربطها بأكواد الصلاحيات القديمة
 * (inventory.manage …) كي تبقى فحوصات المسارات الحالية صحيحة لمن يُضبط له وضع «مخصّص».
 *
 * القاعدة: المستخدم بوضع ROLE (الافتراضي) يسلك كما كان تماماً حسب دوره. المستخدم بوضع CUSTOM تُحصر صلاحياته
 * بما ظُلِّل له في المصفوفة فقط (والمدير admin لا يُقيَّد أبداً).
 */

export type ActionKey = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'print' | 'export' | 'price' | 'costView' | 'disburse';

export const ACTION_LABELS: Record<ActionKey, string> = {
  view: 'عرض',
  create: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف / إلغاء',
  approve: 'اعتماد / ترحيل',
  print: 'طباعة',
  export: 'تصدير',
  price: 'تسعير',
  costView: 'رؤية التكلفة',
  disburse: 'صرف',
};

export type PermissionModule = {
  code: string;
  name: string;
  group: string;
  /** بيانات مالية: تُخفى كلها بإلغاء «عرض» أو بزر «بدون بيانات مالية». */
  financial?: boolean;
  actions: ActionKey[];
  /** بادئات مسارات API التي تتبع هذه الوحدة (الأطول يربح). */
  prefixes: string[];
  /** قراءة المسارات (GET) متاحة لكل مستخدم مسجَّل — بيانات مرجعية لازمة لعمل النماذج وغير حساسة. */
  openRead?: boolean;
  /** وحدات يلزم عرضها ضمنياً عند منح أي إجراء كتابة هنا (قوائم الاختيار بالنماذج). */
  needsView?: string[];
  /** ربط إجراءات المصفوفة بأكواد الصلاحيات القديمة. */
  legacy?: Partial<Record<ActionKey, string[]>>;
};

const W = (...codes: string[]) => codes;

export const PERMISSION_GROUPS: { code: string; name: string }[] = [
  { code: 'general', name: 'عام' },
  { code: 'sales', name: 'المبيعات والعملاء' },
  { code: 'purchases', name: 'المشتريات والموردون' },
  { code: 'inventory', name: 'المخزون والمستودعات' },
  { code: 'treasury', name: 'الخزينة والمالية' },
  { code: 'hr', name: 'الموارد البشرية' },
  { code: 'manufacturing', name: 'التصنيع' },
  { code: 'external', name: 'المصنعية الخارجية' },
  { code: 'system', name: 'النظام والإدارة' },
];

export const PERMISSION_MODULES: PermissionModule[] = [
  { code: 'dashboard', name: 'لوحة التحكم', group: 'general', actions: ['view'], prefixes: [], legacy: { view: W('dashboard.view') } },
  { code: 'reports', name: 'التقارير', group: 'general', financial: true, actions: ['view', 'print', 'export'], prefixes: ['/api/reports'], legacy: { view: W('reports.view') } },

  { code: 'customers', name: 'العملاء', group: 'sales', actions: ['view', 'create', 'edit', 'delete', 'print', 'export'], prefixes: ['/api/customers', '/api/customer-discounts', '/api/party-logs'],
    legacy: { view: W('customers.view'), create: W('customers.manage'), edit: W('customers.manage'), delete: W('customers.manage') } },
  { code: 'orders', name: 'أوردرات العملاء', group: 'sales', actions: ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export', 'price'], prefixes: ['/api/customer-orders'],
    needsView: ['customers', 'inventory.items'], legacy: { price: W('orders.price') } },
  { code: 'sales.invoices', name: 'فواتير البيع', group: 'sales', financial: true, actions: ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export', 'price'], prefixes: ['/api/sales-invoices'],
    needsView: ['customers', 'inventory.items', 'inventory.rolls'], legacy: { price: W('invoices.price') } },
  { code: 'sales.returns', name: 'مرتجعات البيع', group: 'sales', financial: true, actions: ['view', 'create', 'edit', 'delete', 'approve', 'print'], prefixes: ['/api/returns'], needsView: ['customers', 'sales.invoices'] },
  { code: 'cartela', name: 'الكارتيلات', group: 'sales', actions: ['view', 'create', 'edit', 'delete', 'print'], prefixes: ['/api/cartela', '/api/cartela-custody'], needsView: ['customers', 'inventory.items'] },

  { code: 'suppliers', name: 'الموردون', group: 'purchases', actions: ['view', 'create', 'edit', 'delete', 'print', 'export'], prefixes: ['/api/suppliers'],
    legacy: { view: W('suppliers.view'), create: W('suppliers.manage'), edit: W('suppliers.manage'), delete: W('suppliers.manage') } },
  { code: 'purchases.invoices', name: 'فواتير الشراء', group: 'purchases', financial: true, actions: ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'], prefixes: ['/api/purchase-invoices'],
    needsView: ['suppliers', 'inventory.items'], legacy: { view: W('purchases.view'), create: W('purchases.manage'), edit: W('purchases.manage'), delete: W('purchases.manage'), approve: W('purchases.manage') } },
  { code: 'purchases.import', name: 'استيراد المشتريات (Excel)', group: 'purchases', financial: true, actions: ['view', 'create', 'approve'], prefixes: ['/api/purchases/import'],
    needsView: ['suppliers'], legacy: { view: W('purchases.view'), create: W('purchases.manage'), approve: W('purchases.manage') } },

  { code: 'inventory.items', name: 'تعريف الخامات والتصنيفات', group: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'print', 'export'], prefixes: ['/api/fabric', '/api/inventory/fabric-classification'],
    legacy: { view: W('inventory.view'), create: W('inventory.manage'), edit: W('inventory.manage'), delete: W('inventory.manage') } },
  { code: 'inventory.rolls', name: 'الأتواب (الرولات) والجرد', group: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'print', 'export', 'costView'], prefixes: ['/api/inventory/rolls', '/api/inventory/stock-import', '/api/labels', '/api/intake-operations', '/api/intake-dispatch-slips'],
    needsView: ['inventory.items', 'inventory.warehouses'], legacy: { view: W('inventory.view'), create: W('inventory.manage'), edit: W('inventory.manage'), delete: W('inventory.manage') } },
  { code: 'inventory.yarn', name: 'الخيوط', group: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'print', 'export', 'costView'], prefixes: ['/api/inventory/yarn-lots'],
    legacy: { view: W('inventory.view'), create: W('inventory.manage'), edit: W('inventory.manage'), delete: W('inventory.manage'), costView: W('inventory.yarn.cost.view') } },
  { code: 'inventory.transfers', name: 'تحويلات المخزون', group: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'approve', 'print'], prefixes: ['/api/inventory/transfers'], needsView: ['inventory.rolls', 'inventory.warehouses'],
    legacy: { view: W('inventory.view'), create: W('inventory.manage'), edit: W('inventory.manage'), approve: W('inventory.manage') } },
  { code: 'inventory.waste', name: 'الهالك والإتلاف', group: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'approve'], prefixes: ['/api/inventory/waste'], needsView: ['inventory.rolls'],
    legacy: { view: W('inventory.view'), create: W('inventory.manage'), edit: W('inventory.manage'), approve: W('inventory.manage') } },
  { code: 'inventory.warehouses', name: 'المستودعات والمواقع والمناطق', group: 'inventory', actions: ['view', 'create', 'edit', 'delete'], prefixes: ['/api/warehouses', '/api/warehouse-locations', '/api/warehouse-zones'], openRead: true,
    legacy: { create: W('inventory.manage'), edit: W('inventory.manage'), delete: W('inventory.manage') } },
  { code: 'inventory.movements', name: 'سجل حركة المخزون', group: 'inventory', actions: ['view', 'print', 'export'], prefixes: ['/api/inventory-movements-log'] },

  { code: 'treasury.cashboxes', name: 'الصناديق والتحويلات بينها', group: 'treasury', financial: true, actions: ['view', 'create', 'edit', 'delete', 'print', 'export'], prefixes: ['/api/cashboxes', '/api/cashbox-transfers'] },
  { code: 'treasury.vouchers', name: 'سندات القبض والصرف', group: 'treasury', financial: true, actions: ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'], prefixes: ['/api/vouchers'], needsView: ['customers', 'suppliers', 'treasury.cashboxes'] },
  { code: 'treasury.checks', name: 'خزينة الشيكات', group: 'treasury', financial: true, actions: ['view', 'create', 'edit', 'approve', 'print', 'export'], prefixes: ['/api/checks'], needsView: ['treasury.cashboxes'] },
  { code: 'treasury.exchange', name: 'أسعار الصرف', group: 'treasury', financial: true, actions: ['view', 'edit'], prefixes: ['/api/exchange-rates'], openRead: true },
  { code: 'finance.expenses', name: 'المصاريف التشغيلية', group: 'treasury', financial: true, actions: ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'], prefixes: ['/api/expenses'], needsView: ['treasury.cashboxes'] },
  { code: 'finance.ledger', name: 'القيود المحاسبية والتدقيق المالي', group: 'treasury', financial: true, actions: ['view', 'create', 'approve', 'print', 'export'], prefixes: ['/api/finance', '/api/financial-audit'] },

  { code: 'hr.payroll', name: 'الرواتب', group: 'hr', financial: true, actions: ['view', 'create', 'edit', 'delete', 'approve', 'disburse', 'print', 'export'], prefixes: ['/api/payroll'],
    legacy: { view: W('payroll.view'), create: W('payroll.manage'), edit: W('payroll.manage'), delete: W('payroll.manage'), approve: W('payroll.approve'), disburse: W('payroll.disburse') } },
  { code: 'hr.attendance', name: 'الحضور والانصراف', group: 'hr', actions: ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'], prefixes: ['/api/attendance'],
    legacy: { create: W('attendance.manage'), edit: W('attendance.manage'), delete: W('attendance.manage'), approve: W('attendance.approve') } },

  { code: 'manufacturing.dashboard', name: 'لوحة التصنيع', group: 'manufacturing', actions: ['view'], prefixes: [], legacy: { view: W('manufacturing.dashboard.view') } },
  { code: 'manufacturing.reference', name: 'تعريفات التصنيع والمواصفات', group: 'manufacturing', actions: ['view', 'create', 'edit', 'delete', 'approve'], prefixes: ['/api/manufacturing/reference', '/api/manufacturing'],
    legacy: { view: W('manufacturing.reference.view', 'manufacturing.specifications.view'), create: W('manufacturing.reference.manage', 'manufacturing.specifications.import', 'manufacturing.quality.catalog.manage'), edit: W('manufacturing.reference.manage', 'manufacturing.quality.catalog.manage'), delete: W('manufacturing.reference.manage'), approve: W('manufacturing.specifications.approve') } },
  { code: 'manufacturing.workorders', name: 'أوامر الإنتاج', group: 'manufacturing', actions: ['view', 'create', 'edit', 'delete', 'approve', 'print'], prefixes: ['/api/manufacturing/work-orders'],
    legacy: { view: W('manufacturing.work_orders.view'), create: W('manufacturing.work_orders.manage'), edit: W('manufacturing.work_orders.manage'), delete: W('manufacturing.work_orders.manage'), approve: W('manufacturing.work_orders.release') } },
  { code: 'manufacturing.warping', name: 'التسدية', group: 'manufacturing', actions: ['view', 'create', 'edit', 'delete', 'approve', 'print'], prefixes: ['/api/manufacturing/warping'],
    legacy: { view: W('manufacturing.warping.view'), create: W('manufacturing.warping.manage'), edit: W('manufacturing.warping.manage'), delete: W('manufacturing.warping.manage'), approve: W('manufacturing.warping.quality', 'manufacturing.yarn_issue.approve') } },
  { code: 'manufacturing.sizing', name: 'التصميغ', group: 'manufacturing', actions: ['view', 'create', 'edit', 'delete', 'print'], prefixes: ['/api/manufacturing/sizing'],
    legacy: { view: W('manufacturing.sizing.view'), create: W('manufacturing.sizing.manage'), edit: W('manufacturing.sizing.manage'), delete: W('manufacturing.sizing.manage') } },
  { code: 'manufacturing.weaving', name: 'النسج والإنتاج', group: 'manufacturing', actions: ['view', 'create', 'edit', 'delete', 'approve', 'print'], prefixes: ['/api/manufacturing/weaving'],
    legacy: { view: W('manufacturing.weaving.view'), create: W('manufacturing.weaving.manage'), edit: W('manufacturing.weaving.manage'), delete: W('manufacturing.weaving.manage'), approve: W('manufacturing.raw_inspection.manage') } },
  { code: 'manufacturing.quality', name: 'الجودة والفحص', group: 'manufacturing', actions: ['view', 'create', 'edit', 'approve'], prefixes: ['/api/manufacturing/quality'],
    legacy: { create: W('manufacturing.raw_inspection.manage'), edit: W('manufacturing.raw_inspection.manage'), approve: W('manufacturing.raw_inspection.manage', 'manufacturing.warping.quality') } },
  { code: 'manufacturing.costing', name: 'تكاليف الإنتاج', group: 'manufacturing', financial: true, actions: ['view', 'edit', 'approve', 'print', 'export'], prefixes: ['/api/manufacturing/costing'],
    legacy: { view: W('manufacturing.cost.view'), edit: W('manufacturing.cost.manage'), approve: W('manufacturing.cost.manage') } },
  { code: 'manufacturing.reports', name: 'تقارير الإنتاج', group: 'manufacturing', actions: ['view', 'print', 'export'], prefixes: ['/api/manufacturing/print'],
    legacy: { view: W('manufacturing.reports.view'), print: W('manufacturing.reports.print'), export: W('manufacturing.reports.export') } },

  { code: 'external.jobs', name: 'مهام المصنعية الخارجية', group: 'external', actions: ['view', 'create', 'edit', 'delete', 'approve', 'price', 'print'], prefixes: ['/api/external-jobs'], needsView: ['suppliers', 'inventory.rolls'], legacy: { view: W('inventory.view'), create: W('inventory.manage'), edit: W('inventory.manage') } },
  { code: 'external.matching', name: 'تسوية إرساليات المصنعية', group: 'external', financial: true, actions: ['view', 'approve'], prefixes: ['/api/external-job-matching'] },

  { code: 'system.settings', name: 'إعدادات النظام', group: 'system', actions: ['view', 'edit'], prefixes: [], legacy: { view: W('settings.view'), edit: W('settings.manage') } },
  { code: 'system.users', name: 'المستخدمون والصلاحيات', group: 'system', actions: ['view', 'create', 'edit', 'delete'], prefixes: [], legacy: { view: W('users.manage'), create: W('users.manage'), edit: W('users.manage'), delete: W('users.manage') } },
  { code: 'system.ai', name: 'المساعد الذكي', group: 'system', actions: ['view'], prefixes: ['/api/ai', '/api/v1/ai'] },
];

export const permissionCode = (moduleCode: string, action: ActionKey) => `p:${moduleCode}.${action}`;

export const ALL_MATRIX_CODES: string[] = PERMISSION_MODULES.flatMap((m) => m.actions.map((a) => permissionCode(m.code, a)));
const VALID = new Set(ALL_MATRIX_CODES);
export const isMatrixCode = (c: string) => VALID.has(c);

const byCode = new Map(PERMISSION_MODULES.map((m) => [m.code, m]));

/** يكمّل المجموعة: أي كتابة تستلزم «عرض» الوحدة نفسها وعرض الوحدات التي تحتاجها نماذجها. */
export function expandImplied(codes: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const c of codes) if (VALID.has(c)) out.add(c);
  for (const code of [...out]) {
    const [mod, action] = [code.slice(2, code.lastIndexOf('.')), code.slice(code.lastIndexOf('.') + 1)];
    const m = byCode.get(mod);
    if (!m) continue;
    if (action !== 'view' && m.actions.includes('view')) out.add(permissionCode(mod, 'view'));
    if (action !== 'view') for (const dep of m.needsView ?? []) if (byCode.get(dep)?.actions.includes('view')) out.add(permissionCode(dep, 'view'));
  }
  return out;
}

/** الأكواد القديمة التي يجب أن يحملها المستخدم ليعمل أي فحص `requirePermission` موجود بالمسارات. */
export function legacyCodesFor(codes: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    if (!VALID.has(c)) continue;
    const mod = c.slice(2, c.lastIndexOf('.'));
    const action = c.slice(c.lastIndexOf('.') + 1) as ActionKey;
    for (const l of byCode.get(mod)?.legacy?.[action] ?? []) out.add(l);
  }
  return [...out];
}

/** الأكواد التي يحملها المستخدم بوضع CUSTOM: المصفوفة بعد الاستكمال + الأكواد القديمة المقابلة. */
export function effectiveCustomPermissions(selected: Iterable<string>): string[] {
  const matrix = expandImplied(selected);
  return [...matrix, ...legacyCodesFor(matrix)];
}

const OPEN_PATH_PARTS = /\/(search|preview|lookup|resolve|calculate|calc|validate|check-duplicate|next-barcode|next-no|suggest)(\/|$|\?)/i;
const APPROVE_PARTS = /\/(confirm|approve|post|finalize|close|transition|release|resolve-defect|settlements|inventory-complete|inventory-reopen|clear|deposit|return|settle|approve-shortage|approve-charge|service-pricing|cost-allocation)(\/|$|\?)/i;
const PRINT_PARTS = /\/(print|pdf)(\/|$|\?)/i;
const EXPORT_PARTS = /\/(export|excel|xlsx|download)(\/|$|\?)/i;
const CANCEL_PARTS = /\/(cancel|void|delete|remove)(\/|$|\?)/i;

export type RoutePolicy = { module: PermissionModule; action: ActionKey; code: string; open: boolean } | null;

function moduleFor(url: string): PermissionModule | null {
  let best: { m: PermissionModule; len: number } | null = null;
  for (const m of PERMISSION_MODULES) for (const p of m.prefixes) {
    if ((url === p || url.startsWith(p + '/') || url.startsWith(p + '?')) && (!best || p.length > best.len)) best = { m, len: p.length };
  }
  return best?.m ?? null;
}

/** يحدد الصلاحية المطلوبة لمسار + طريقة HTTP. null = غير مقيَّد مركزياً (مصادقة فقط). */
export function resolveRoutePolicy(routeUrl: string, method: string): RoutePolicy {
  const m = moduleFor(routeUrl);
  if (!m) return null;
  const prefix = m.prefixes.filter((p) => routeUrl === p || routeUrl.startsWith(p + '/')).sort((a, b) => b.length - a.length)[0] ?? '';
  const rest = routeUrl.slice(prefix.length) || '/';
  const verb = method.toUpperCase();
  let action: ActionKey;
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') {
    action = EXPORT_PARTS.test(rest) ? 'export' : PRINT_PARTS.test(rest) ? 'print' : 'view';
  } else if (OPEN_PATH_PARTS.test(rest) && verb === 'POST') {
    action = 'view';
  } else if (verb === 'DELETE' || CANCEL_PARTS.test(rest)) {
    action = 'delete';
  } else if (APPROVE_PARTS.test(rest)) {
    action = 'approve';
  } else if (PRINT_PARTS.test(rest)) {
    action = 'print';
  } else if (EXPORT_PARTS.test(rest)) {
    action = 'export';
  } else {
    action = verb === 'POST' ? 'create' : 'edit';
  }
  // إجراء غير مُعرَّف للوحدة ← أقرب إجراء متاح.
  const fallback: Partial<Record<ActionKey, ActionKey>> = { approve: 'edit', delete: 'edit', print: 'view', export: 'view', create: 'edit', price: 'edit', costView: 'view', disburse: 'approve' };
  let guard = 0;
  while (!m.actions.includes(action) && fallback[action] && guard++ < 4) action = fallback[action]!;
  if (!m.actions.includes(action)) action = 'view';
  return { module: m, action, code: permissionCode(m.code, action), open: Boolean(m.openRead) && action === 'view' };
}

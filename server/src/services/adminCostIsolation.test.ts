import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * التكلفة الإدارية سرّية للمالك: لا يجوز لأي ملف غير adminCostService قراءة جداولها، فلا تتسرب لتقرير أو تصدير أو API آخر.
 * (جداول الأمثلة: admin_cost_rates / admin_cost_delegates / sales_line_admin_cost.)
 */
const SECRET = /admin_cost_rates|admin_cost_delegates|sales_line_admin_cost/;
const ALLOWED = new Set(['adminCostService.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'migrations') walk(p, out); }
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

test('only adminCostService touches the secret admin-cost tables', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const offenders = walk(root).filter((f) => SECRET.test(readFileSync(f, 'utf8')) && !ALLOWED.has(f.split(/[\\/]/).pop()!));
  assert.deepEqual(offenders, [], 'ملفات تقرأ التكلفة الإدارية خارج الخدمة المخصّصة');
});

test('only the sales confirmation hook and the owner routes import the admin-cost service', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const importers = walk(root).filter((f) => /adminCostService\.js/.test(readFileSync(f, 'utf8'))).map((f) => f.split(/[\\/]/).pop()!).sort();
  assert.deepEqual(importers, ['platformRoutes.ts', 'salesInvoiceService.ts'], 'لا تقارير ولا تصديرات تستورد الخدمة السرّية');
});

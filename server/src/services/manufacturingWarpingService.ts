import type { PoolClient } from 'pg';
import type { ManufacturingSpecificationWorkbookPreview } from './manufacturingSpecificationWorkbook.js';

async function nextNumber(client: PoolClient, companyId: string, table: string, column: string, prefix: string, lock: string): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [companyId, lock]);
  const result = await client.query<{ max_seq: string | null }>(
    `SELECT MAX((substring(${column} from $2))::int)::text AS max_seq FROM ${table}
     WHERE company_id=$1 AND ${column} ~ $3`,
    [companyId, prefix.length + 1, `^${prefix}[0-9]{7}$`],
  );
  return `${prefix}${String(Number(result.rows[0]?.max_seq ?? 0) + 1).padStart(7, '0')}`;
}

export const generateWarpingOrderNo = (client: PoolClient, companyId: string) =>
  nextNumber(client, companyId, 'manufacturing_warping_orders', 'warping_order_no', 'WRP', 'MANUFACTURING_WARPING_ORDER_NUM');

export const generateWarpCardNo = (client: PoolClient, companyId: string) =>
  nextNumber(client, companyId, 'manufacturing_warp_cards', 'card_no', 'WC', 'MANUFACTURING_WARP_CARD_NUM');

export const WARPING_STATUSES = ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type WarpingStatus = (typeof WARPING_STATUSES)[number];

const transitions: Record<WarpingStatus, readonly WarpingStatus[]> = {
  DRAFT: ['RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED', 'CANCELLED'],
  COMPLETED: [], REJECTED: [], CANCELLED: [],
};

export const canTransitionWarpingOrder = (from: WarpingStatus, to: WarpingStatus) =>
  from !== to && transitions[from].includes(to);

const normalize = (value: string) => value.trim().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\s_:/-]+/g, '');

function technicalValue(fields: Record<string, string | number | boolean>, aliases: string[]): string | number | boolean | null {
  const wanted = aliases.map(normalize);
  const match = Object.entries(fields).find(([key]) => wanted.some((alias) => normalize(key).includes(alias)));
  return match?.[1] ?? null;
}

export interface WarpCardDataInput {
  specificationSnapshot: Record<string, unknown>;
  plannedLengthM: number;
  loomLabel?: string | null;
  operatorName?: string | null;
  shiftName?: string | null;
  tieCount?: number | null;
  issuedAt: Date;
}

export function buildWarpCardData(input: WarpCardDataInput) {
  const parsed = (input.specificationSnapshot.parsed_data ?? {}) as Partial<ManufacturingSpecificationWorkbookPreview>;
  const fields = parsed.technicalFields ?? {};
  const colors = new Set((parsed.warp?.pattern ?? []).map((line) => normalize(line.colorName)).filter(Boolean));
  return {
    itemCode: input.specificationSnapshot.code ?? null,
    mirageCount: colors.size,
    plannedLengthM: input.plannedLengthM,
    loom: input.loomLabel ?? null,
    issuedAt: input.issuedAt.toISOString(),
    reedWidth: technicalValue(fields, ['عرض مشط النسيج', 'العرض في المشط', 'عرض المشط']),
    totalWarpThreads: technicalValue(fields, ['اجمالي عدد الخيوط', 'اجمالي فتل السداء', 'عدد خيوط السداء']),
    tieCount: input.tieCount ?? null,
    warpYarnCount: parsed.warp?.yarnCount ?? technicalValue(fields, ['نمره السداء', 'نمرة السداء']),
    operatorName: input.operatorName ?? null,
    shiftName: input.shiftName ?? null,
    warpPattern: parsed.warp?.pattern ?? [],
  };
}

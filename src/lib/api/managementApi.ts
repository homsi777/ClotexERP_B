import {apiFetch} from './client';

export type PeriodKind='today'|'yesterday'|'week'|'month'|'year'|'custom';
export interface PeriodQuery{period:PeriodKind;from?:string;to?:string}
export interface SoldQty{meters:number;kg:number;invoices:number}
export interface Money{currency:string;total:number;count?:number}
export interface BranchMetrics{
  period:{kind:PeriodKind;from:string;to:string;prevFrom:string;prevTo:string;label:string};
  sales:{quantity:{current:SoldQty;previous:SoldQty};current:Money[];previous:Money[];topCustomers:Array<{name:string;currency:string;total:number}>;byItem:Array<{name:string;currency:string;total:number;meters:number}>;byColor:Array<{name:string;currency:string;total:number}>;byCreator:Array<{name:string;currency:string;total:number;count:number}>};
  purchases:{current:Money[];previous:Money[]};
  inactiveCustomers:{thresholdDays:number;count:number;items:Array<{id:string;name:string;lastPurchase:string}>};
  orders:{inPreparation:number;awaitingDelivery:number;open:number;late:number};
  balances:{customers:Array<{currency:string;owedToUs:number;weOwe:number;pendingCheques:number}>;suppliers:Array<{currency:string;owedToUs:number;weOwe:number}>;customerAlerts:{promiseOverdue:number;limitExceeded:number};supplierPromiseOverdue:number};
  cash:Money[];
  cheques:{pending:number;overdue:number;pendingByCurrency:Money[]};
  inventory:{available:{rolls:number;meters:number};reserved:{rolls:number;meters:number};quarantined:{rolls:number;meters:number};withoutLocation:number;slowMoving:{thresholdDays:number;rolls:number;meters:number};pendingTransfers:number};
  external:{open:number;late:number;lateThresholdDays:number;partiallyReceived:number;metersSent:number;metersReceived:number;metersRemaining:number;settlementsInPeriod:Array<{category:string;meters:number}>};
  production:{open:number;late:number;byStatus:Array<{status:string;count:number}>};
  waiting:{salesDrafts:number;purchaseDrafts:number;pricingQueue:number;editRequests:number;wasteDrafts:number};
  users:{active:number;onlineNow:number};
  unavailable:Array<{key:string;label:string;reason:string}>;
}
export interface BranchOverview{id:string;code:string;name:string;isActive:boolean;metrics:BranchMetrics;lastActivityAt:string|null;users:{custom:number}}
export interface Overview{generatedAt:string;period:BranchMetrics['period'];branches:BranchOverview[];recentActivity:Array<{at:string;branch:string|null;username:string;action:string;entity_type:string|null}>}
export interface AlertType{type:string;label:string;dept:string;optional?:boolean}
export type Severity='HIGH'|'MEDIUM'|'LOW';
export type AlertStatus='OPEN'|'ACKNOWLEDGED'|'SNOOZED'|'RESOLVED';
export interface AlertRow{department:string;updatedByName:string|null;updatedAt:string|null;key:string;type:string;severity:Severity;title:string;detail:string;href:string;status:AlertStatus;assigneeUserId:string|null;assigneeName:string|null;snoozedUntil:string|null;note:string|null;firstSeenAt:string;lastSeenAt:string;resolvedAt:string|null}
export interface AlertSettings{inactiveCustomerDays:number;slowStockDays:number;externalLateDays:number;draftAgeDays:number;chequeDueSoonDays:number;disabledTypes:string[];enabledOptionalTypes:string[]}
export interface DecisionItem{kind:'EDIT_REQUEST'|'WASTE_DRAFT'|'PRICING'|'TRANSFER_DRAFT';id:string;title:string;detail:string;by:string|null;at:string|null;href:string;editRequestId?:string}
export interface LiquidityForecast{horizons:Array<{days:number;byCurrency:Array<{currency:string;confirmedCash:number;confirmedChequesDue:number;confirmedTotal:number;forecastCollections:number;forecastPayments:number;forecastTotal:number}>}>;undatedPayables:Array<{currency:string;total:number}>;notes:string[]}
export interface Oversight{users:Array<{id:string;branch:string;branchName:string;username:string;fullName:string|null;role:string;permMode:string;isActive:boolean;grants:number;open:{salesDrafts:number;purchaseDrafts:number;editRequests:number;followUpsOverdue:number;alertsAssigned:number};lastActivityAt:string|null}>;permissionLog:Array<{at:string;branch:string;target:string;changed_by:string;mode:string;granted_count:number;added:number;removed:number}>;exceptions:Array<{at:string;branch:string;kind:string;ref:string;amount:number|null;currency:string|null;user:string|null;detail:string|null}>}
export interface CostGroup{weightKg?:number;itemId:string;itemName:string;itemCode:string|null;colorId:string|null;colorName:string|null;rolls:number;meters:number;officialPricedRolls:number;adminRate:{scope:string;unitCostPerMeter:number;basis:'METER'|'KG';currency:string;since:string}|null}
export type ProfitDimension='item'|'color'|'roll'|'customer'|'invoice'|'creator';
export interface ProfitBreakdownRow{label:string;currency:string;revenue:number;cost:number;profit:number;marginPct:number|null;lines:number}
export interface Profitability{period:{from:string;to:string};byCurrency:Array<{currency:string;revenue:number;cost:number;profit:number;marginPct:number|null;pricedLines:number}>;unpriced:Array<{currency:string;lines:number;revenue:number;totalRevenue:number;sharePct:number|null}>;currencyMismatch:number;returns:{counted:Array<{currency:string;revenue:number;cost:number}>;excluded:number};belowCost:Array<{currency:string;lines:number;loss:number}>;by:ProfitDimension;breakdown:ProfitBreakdownRow[];notes:string[]}
export interface SeriesPoint{bucket:string;currency:string;total:number}
export interface Analytics{period:BranchMetrics['period'];bucketUnit:'day'|'month';sales:SeriesPoint[];purchases:SeriesPoint[];receipts:SeriesPoint[];payments:SeriesPoint[];cashMovement:{current:Array<{currency:string;receipts:number;payments:number}>;previous:Array<{currency:string;receipts:number;payments:number}>};customerAging:Array<{currency:string;d0_30:number;d31_60:number;d61_90:number;d90plus:number;unallocated:number}>;agingNote:string;inventoryByStatus:Array<{status:string;rolls:number;meters:number;kg:number}>;inventoryByWarehouse:Array<{warehouse:string;rolls:number;meters:number}>}
export interface DashPrefs{hidden:string[];order:string[];defaultTab?:string;defaultPeriod?:Exclude<PeriodKind,'custom'>}
export interface CostRoll{rollId:string;barcode:string;meters:number;kg:number|null;officialPriced:boolean;rate:{scope:string;cost:number;basis:'METER'|'KG';currency:string}|null}
export interface RateHistoryRow{scope:string;cost:number;basis:string;currency:string;since:string;by:string|null;note:string|null;color:string|null;barcode:string|null}

const qs=(p:PeriodQuery,extra:Record<string,string|undefined>={})=>{
  const q=new URLSearchParams({period:p.period});
  if(p.period==='custom'){if(p.from)q.set('from',p.from);if(p.to)q.set('to',p.to);}
  for(const [k,v] of Object.entries(extra))if(v)q.set(k,v);
  return `?${q}`;
};
export type Scope='owner'|'branch';
const base=(s:Scope)=>s==='owner'?'/api/platform':'/api/management';
export const fetchOverview=async(s:Scope,p:PeriodQuery)=>(await apiFetch<{ok:boolean;data:Overview}>(`${base(s)}/overview${qs(p)}`)).data;
export const fetchAlerts=async(status?:string)=>(await apiFetch<{ok:boolean;data:{types:AlertType[];alerts:AlertRow[]}}>(`/api/management/alerts${status?`?status=${status}`:''}`)).data;
export const alertAction=(body:{key:string;action:'ack'|'snooze'|'assign'|'reopen'|'note';until?:string;assigneeUserId?:string|null;note?:string})=>apiFetch<{ok:boolean}>('/api/management/alerts/action',{method:'POST',body:JSON.stringify(body)});
export const fetchAlertSettings=async()=>(await apiFetch<{ok:boolean;data:{settings:AlertSettings;types:AlertType[]}}>('/api/management/alert-settings')).data;
export const saveAlertSettings=async(b:Partial<AlertSettings>)=>(await apiFetch<{ok:boolean;data:AlertSettings}>('/api/management/alert-settings',{method:'PUT',body:JSON.stringify(b)})).data;
export const fetchDecisions=async()=>(await apiFetch<{ok:boolean;data:DecisionItem[]}>('/api/management/decisions')).data;
export const fetchLiquidity=async()=>(await apiFetch<{ok:boolean;data:LiquidityForecast}>('/api/management/liquidity')).data;
export const fetchSummary=async(kind:'daily'|'weekly'|'monthly')=>(await apiFetch<{ok:boolean;data:{text:string;alerts:{opened:number;resolved:number;active:number;high:number};pendingDecisions:number}}>(`/api/management/summary?kind=${kind}`)).data;
export const fetchOversight=async(s:Scope)=>(await apiFetch<{ok:boolean;data:Oversight}>(s==='owner'?'/api/platform/users':'/api/management/oversight')).data;
export const fetchOwnerAlerts=async()=>(await apiFetch<{ok:boolean;data:Array<{branchId:string;branch:string;alerts:AlertRow[];decisions:DecisionItem[];liquidity:LiquidityForecast}>}>('/api/platform/alerts')).data;
export const fetchCostGroups=async(branchId:string,o:{onlyMissing?:boolean;search?:string}={})=>(await apiFetch<{ok:boolean;data:CostGroup[]}>(`/api/platform/admin-cost/groups?branchId=${branchId}${o.onlyMissing?'&onlyMissing=true':''}${o.search?`&search=${encodeURIComponent(o.search)}`:''}`)).data;
export const saveCostRates=(branchId:string,rates:Array<{scope:'ITEM'|'ITEM_COLOR'|'ROLL';itemId?:string|null;colorId?:string|null;rollId?:string|null;unitCostPerMeter:number;basis?:'METER'|'KG';currency:string}>)=>apiFetch<{ok:boolean}>(`/api/platform/admin-cost/rates?branchId=${branchId}`,{method:'PUT',body:JSON.stringify({rates})});
export const fetchProfitability=async(branchId:string,p:PeriodQuery,by:ProfitDimension='item')=>(await apiFetch<{ok:boolean;data:Profitability}>(`/api/platform/admin-cost/profitability${qs(p,{branchId,by})}`)).data;
export const fetchDelegates=async(branchId:string)=>(await apiFetch<{ok:boolean;data:Array<{user_id:string;name:string}>}>(`/api/platform/admin-cost/delegates?branchId=${branchId}`)).data;
export const saveDelegates=(branchId:string,userIds:string[])=>apiFetch<{ok:boolean}>(`/api/platform/admin-cost/delegates?branchId=${branchId}`,{method:'PUT',body:JSON.stringify({userIds})});

// ── تحليلات الرسوم، التخصيص، وإجراءات المالك على أي فرع ──
export const fetchAnalytics=async(s:Scope,p:PeriodQuery,branchId?:string)=>(await apiFetch<{ok:boolean;data:Analytics}>(`${base(s)}/analytics${qs(p,{branchId:s==='owner'?branchId:undefined})}`)).data;
const pbase=(s:Scope)=>`${base(s)}/preferences`;
export const fetchPrefs=async(s:Scope)=>(await apiFetch<{ok:boolean;data:DashPrefs|null}>(pbase(s))).data;
export const savePrefs=async(s:Scope,p:DashPrefs)=>(await apiFetch<{ok:boolean;data:DashPrefs}>(pbase(s),{method:'PUT',body:JSON.stringify(p)})).data;
export const resetPrefs=(s:Scope)=>apiFetch<{ok:boolean}>(pbase(s),{method:'DELETE'});
export const ownerAlertAction=(branchId:string,body:Parameters<typeof alertAction>[0])=>apiFetch<{ok:boolean}>(`/api/platform/alerts/action?branchId=${branchId}`,{method:'POST',body:JSON.stringify(body)});
export const ownerAlertSettings=async(branchId:string)=>(await apiFetch<{ok:boolean;data:{settings:AlertSettings;types:AlertType[]}}>(`/api/platform/alert-settings?branchId=${branchId}`)).data;
export const ownerSaveAlertSettings=async(branchId:string,b:Partial<AlertSettings>)=>(await apiFetch<{ok:boolean;data:AlertSettings}>(`/api/platform/alert-settings?branchId=${branchId}`,{method:'PUT',body:JSON.stringify(b)})).data;
export const fetchBranchUsers=async(branchId:string)=>(await apiFetch<{ok:boolean;data:Array<{id:string;name:string}>}>(`/api/platform/branch-users?branchId=${branchId}`)).data;
export const fetchOwnerSummary=async(branchId:string,kind:'daily'|'weekly'|'monthly')=>(await apiFetch<{ok:boolean;data:{text:string}}>(`/api/platform/summary?branchId=${branchId}&kind=${kind}`)).data;
export const fetchCostRolls=async(branchId:string,itemId:string,colorId:string|null,onlyMissing:boolean)=>(await apiFetch<{ok:boolean;data:CostRoll[]}>(`/api/platform/admin-cost/rolls?branchId=${branchId}&itemId=${itemId}${colorId?`&colorId=${colorId}`:''}${onlyMissing?'&onlyMissing=true':''}`)).data;
export const fetchRateHistory=async(branchId:string,itemId:string)=>(await apiFetch<{ok:boolean;data:RateHistoryRow[]}>(`/api/platform/admin-cost/history?branchId=${branchId}&itemId=${itemId}`)).data;

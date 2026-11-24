import {apiFetch} from './client';

export type PeriodKind='today'|'yesterday'|'week'|'month'|'year'|'custom';
export interface PeriodQuery{period:PeriodKind;from?:string;to?:string}
export interface Money{currency:string;total:number;count?:number}
export interface BranchMetrics{
  period:{kind:PeriodKind;from:string;to:string;prevFrom:string;prevTo:string;label:string};
  sales:{current:Money[];previous:Money[];topCustomers:Array<{name:string;currency:string;total:number}>;byItem:Array<{name:string;currency:string;total:number;meters:number}>;byColor:Array<{name:string;currency:string;total:number}>;byCreator:Array<{name:string;currency:string;total:number;count:number}>};
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
export type Severity='HIGH'|'MEDIUM'|'LOW';
export type AlertStatus='OPEN'|'ACKNOWLEDGED'|'SNOOZED'|'RESOLVED';
export interface AlertRow{key:string;type:string;severity:Severity;title:string;detail:string;href:string;status:AlertStatus;assigneeUserId:string|null;assigneeName:string|null;snoozedUntil:string|null;note:string|null;firstSeenAt:string;lastSeenAt:string;resolvedAt:string|null}
export interface AlertSettings{inactiveCustomerDays:number;slowStockDays:number;externalLateDays:number;draftAgeDays:number;chequeDueSoonDays:number;disabledTypes:string[]}
export interface DecisionItem{kind:'EDIT_REQUEST'|'WASTE_DRAFT'|'PRICING'|'TRANSFER_DRAFT';id:string;title:string;detail:string;by:string|null;at:string|null;href:string;editRequestId?:string}
export interface LiquidityForecast{horizons:Array<{days:number;byCurrency:Array<{currency:string;confirmedCash:number;confirmedChequesDue:number;confirmedTotal:number;forecastCollections:number;forecastPayments:number;forecastTotal:number}>}>;undatedPayables:Array<{currency:string;total:number}>;notes:string[]}
export interface Oversight{users:Array<{id:string;branch:string;branchName:string;username:string;fullName:string|null;role:string;permMode:string;isActive:boolean;grants:number;open:{salesDrafts:number;purchaseDrafts:number;editRequests:number;followUpsOverdue:number;alertsAssigned:number};lastActivityAt:string|null}>;permissionLog:Array<{at:string;branch:string;target:string;changed_by:string;mode:string;granted_count:number;added:number;removed:number}>;exceptions:Array<{at:string;branch:string;kind:string;ref:string;amount:number|null;currency:string|null;user:string|null;detail:string|null}>}
export interface CostGroup{itemId:string;itemName:string;itemCode:string|null;colorId:string|null;colorName:string|null;rolls:number;meters:number;officialPricedRolls:number;adminRate:{scope:string;unitCostPerMeter:number;currency:string;since:string}|null}
export interface Profitability{period:{from:string;to:string};byCurrency:Array<{currency:string;revenue:number;cost:number;profit:number;marginPct:number|null;pricedLines:number}>;unpriced:Array<{currency:string;lines:number;revenue:number}>;currencyMismatch:number;byItem:Array<{itemName:string;currency:string;revenue:number;cost:number;profit:number}>;notes:string[]}

const qs=(p:PeriodQuery,extra:Record<string,string|undefined>={})=>{
  const q=new URLSearchParams({period:p.period});
  if(p.period==='custom'){if(p.from)q.set('from',p.from);if(p.to)q.set('to',p.to);}
  for(const [k,v] of Object.entries(extra))if(v)q.set(k,v);
  return `?${q}`;
};
export type Scope='owner'|'branch';
const base=(s:Scope)=>s==='owner'?'/api/platform':'/api/management';
export const fetchOverview=async(s:Scope,p:PeriodQuery)=>(await apiFetch<{ok:boolean;data:Overview}>(`${base(s)}/overview${qs(p)}`)).data;
export const fetchAlerts=async(status?:string)=>(await apiFetch<{ok:boolean;data:{types:Array<{type:string;label:string}>;alerts:AlertRow[]}}>(`/api/management/alerts${status?`?status=${status}`:''}`)).data;
export const alertAction=(body:{key:string;action:'ack'|'snooze'|'assign'|'reopen'|'note';until?:string;assigneeUserId?:string|null;note?:string})=>apiFetch<{ok:boolean}>('/api/management/alerts/action',{method:'POST',body:JSON.stringify(body)});
export const fetchAlertSettings=async()=>(await apiFetch<{ok:boolean;data:{settings:AlertSettings;types:Array<{type:string;label:string}>}}>('/api/management/alert-settings')).data;
export const saveAlertSettings=async(b:Partial<AlertSettings>)=>(await apiFetch<{ok:boolean;data:AlertSettings}>('/api/management/alert-settings',{method:'PUT',body:JSON.stringify(b)})).data;
export const fetchDecisions=async()=>(await apiFetch<{ok:boolean;data:DecisionItem[]}>('/api/management/decisions')).data;
export const fetchLiquidity=async()=>(await apiFetch<{ok:boolean;data:LiquidityForecast}>('/api/management/liquidity')).data;
export const fetchSummary=async(kind:'daily'|'weekly'|'monthly')=>(await apiFetch<{ok:boolean;data:{text:string;alerts:{opened:number;resolved:number;active:number;high:number};pendingDecisions:number}}>(`/api/management/summary?kind=${kind}`)).data;
export const fetchOversight=async(s:Scope)=>(await apiFetch<{ok:boolean;data:Oversight}>(s==='owner'?'/api/platform/users':'/api/management/oversight')).data;
export const fetchOwnerAlerts=async()=>(await apiFetch<{ok:boolean;data:Array<{branchId:string;branch:string;alerts:AlertRow[];decisions:DecisionItem[];liquidity:LiquidityForecast}>}>('/api/platform/alerts')).data;
export const fetchCostGroups=async(branchId:string,o:{onlyMissing?:boolean;search?:string}={})=>(await apiFetch<{ok:boolean;data:CostGroup[]}>(`/api/platform/admin-cost/groups?branchId=${branchId}${o.onlyMissing?'&onlyMissing=true':''}${o.search?`&search=${encodeURIComponent(o.search)}`:''}`)).data;
export const saveCostRates=(branchId:string,rates:Array<{scope:'ITEM'|'ITEM_COLOR'|'ROLL';itemId?:string|null;colorId?:string|null;rollId?:string|null;unitCostPerMeter:number;currency:string}>)=>apiFetch<{ok:boolean}>(`/api/platform/admin-cost/rates?branchId=${branchId}`,{method:'PUT',body:JSON.stringify({rates})});
export const fetchProfitability=async(branchId:string,p:PeriodQuery)=>(await apiFetch<{ok:boolean;data:Profitability}>(`/api/platform/admin-cost/profitability${qs(p,{branchId})}`)).data;
export const fetchDelegates=async(branchId:string)=>(await apiFetch<{ok:boolean;data:Array<{user_id:string;name:string}>}>(`/api/platform/admin-cost/delegates?branchId=${branchId}`)).data;
export const saveDelegates=(branchId:string,userIds:string[])=>apiFetch<{ok:boolean}>(`/api/platform/admin-cost/delegates?branchId=${branchId}`,{method:'PUT',body:JSON.stringify({userIds})});

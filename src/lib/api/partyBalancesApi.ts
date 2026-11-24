import {apiFetch} from './client';

export type BalanceKind='customers'|'suppliers';
export interface Aging{d0_30:number;d31_60:number;d61_90:number;d90plus:number;unallocated:number}
export interface CurrencyBalance{
  currency:string;balance:number;side:'OWES_US'|'WE_OWE'|'ZERO';pendingCheques:number;expectedBalance:number;aging:Aging;
  openInvoices:number;sales12m:number;lastOperationDate:string|null;lastPaymentDate:string|null;creditLimit:number|null;limitExceeded:boolean;
}
export interface PartyBalanceRow{
  id:string;code:string|null;name:string;phone:string|null;isActive:boolean;telegramEnabled:boolean;telegramChatId:string|null;
  currencies:CurrencyBalance[];
  profile:{ownerUserId:string|null;ownerName:string|null;expectedCollectionDate:string|null;promisedAmount:number|null;promisedCurrency:string|null;creditLimit:number|null;creditLimitCurrency:string|null}|null;
  alerts:{promiseOverdue:boolean;limitExceeded:boolean};lastOperationDate:string|null;lastPaymentDate:string|null;
}
export interface PartyBalancesResult{
  agingBasis:'INVOICE_DATE';dueDatesAvailable:false;note:string;rows:PartyBalanceRow[];
  totals:Array<{currency:string;owedToUs:number;weOwe:number;pendingCheques:number;parties:number}>;
}
export interface BalanceQuery{search?:string;currency?:string;onlyWithBalance?:boolean;onlyAlerts?:boolean;sort?:'name'|'balance'|'lastPayment'|'lastOperation';dir?:'asc'|'desc'}
export interface ProfileInput{
  ownerUserId?:string|null;creditLimit?:number|null;creditLimitCurrency?:string|null;
  expectedCollectionDate?:string|null;promisedAmount?:number|null;promisedCurrency?:string|null;
}
export interface PartyNote{id:string;note:string;created_at:string;author:string|null}

export async function getPartyBalances(kind:BalanceKind,q:BalanceQuery={}){
  const p=new URLSearchParams();
  if(q.search)p.set('search',q.search);if(q.currency)p.set('currency',q.currency);
  if(q.onlyWithBalance)p.set('onlyWithBalance','true');if(q.onlyAlerts)p.set('onlyAlerts','true');
  if(q.sort)p.set('sort',q.sort);if(q.dir)p.set('dir',q.dir);
  return (await apiFetch<{ok:boolean;data:PartyBalancesResult}>(`/api/party-balances/${kind}${p.toString()?`?${p}`:''}`)).data;
}
export async function savePartyProfile(kind:BalanceKind,id:string,input:ProfileInput){
  return apiFetch<{ok:boolean}>(`/api/party-balances/${kind}/${id}/profile`,{method:'PUT',body:JSON.stringify(input)});
}
export async function listPartyNotes(kind:BalanceKind,id:string){
  return (await apiFetch<{ok:boolean;data:PartyNote[]}>(`/api/party-balances/${kind}/${id}/notes`)).data;
}
export async function addPartyNote(kind:BalanceKind,id:string,note:string){
  return apiFetch<{ok:boolean}>(`/api/party-balances/${kind}/${id}/notes`,{method:'POST',body:JSON.stringify({note})});
}

import type { CustomerOrderMetadata } from '../types';
export const sampleStatusLabels: Record<string,string> = {requested:'مطلوبة',received:'مستلمة',approved:'معتمدة',rejected:'مرفوضة'};
export function orderMetadataRows(order: CustomerOrderMetadata): [string,string][] {
 return [
  ['المكتب / الفرع المستلم',order.receivedOfficeName || ''],
  ['الموظف الآخذ للطلب',order.takenByEmployeeName || ''],
  ['موظف المتابعة',order.followUpEmployeeName || ''],
  ['مستخدم المتابعة (الإشعارات)',order.followUpUserName || ''],
  ['نوع العينة',order.sampleKind || ''],
  ['حالة العينة',sampleStatusLabels[order.sampleStatus || ''] || ''],
  ['تاريخ طلب العينة',order.sampleRequestedDate || ''],
  ['تاريخ استلام العينة',order.sampleReceivedDate || ''],
  ['تاريخ اعتماد العينة',order.sampleApprovedDate || ''],
 ];
}

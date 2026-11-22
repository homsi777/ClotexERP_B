import { apiFetch, setEditGrant } from './client';

export type EditEntityType = 'CUSTOMER' | 'SUPPLIER' | 'SALES_INVOICE' | 'PURCHASE_INVOICE';

export interface EditRequestDto {
  id: string;
  entityType: EditEntityType;
  entityId: string;
  entityLabel: string;
  requestedBy: string;
  requestedByName: string;
  supervisorId: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'CANCELLED';
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export const ENTITY_AR: Record<EditEntityType, string> = { CUSTOMER: 'عميل', SUPPLIER: 'مورد', SALES_INVOICE: 'فاتورة بيع', PURCHASE_INVOICE: 'فاتورة شراء' };

export function requestEditPermission(entityType: EditEntityType, entityId: string, reason: string) {
  return apiFetch<{ ok: boolean; data: EditRequestDto }>('/api/edit-requests', { method: 'POST', body: JSON.stringify({ entityType, entityId, reason }) }).then((r) => r.data);
}

export function myEditRequests(entityType: EditEntityType, entityId: string) {
  return apiFetch<{ ok: boolean; data: EditRequestDto[] }>(`/api/edit-requests/mine?entityType=${entityType}&entityId=${entityId}`).then((r) => r.data);
}

export function pendingEditRequests() {
  return apiFetch<{ ok: boolean; data: EditRequestDto[] }>('/api/edit-requests/pending').then((r) => r.data);
}

export function decideEditRequestApi(id: string, approve: boolean, note?: string) {
  return apiFetch<{ ok: boolean; data: EditRequestDto }>(`/api/edit-requests/${id}/decision`, { method: 'PUT', body: JSON.stringify({ approve, note: note ?? null }) }).then((r) => r.data);
}

export interface SupervisorAssignment { userId: string; name: string; username: string; role: string; supervisorId: string | null }
export function listSupervisorAssignmentsApi() {
  return apiFetch<{ ok: boolean; data: SupervisorAssignment[] }>('/api/edit-requests/supervisors').then((r) => r.data);
}
export function setSupervisorApi(userId: string, supervisorId: string | null) {
  return apiFetch<{ ok: boolean }>(`/api/edit-requests/supervisors/${userId}`, { method: 'PUT', body: JSON.stringify({ supervisorId }) });
}

export { setEditGrant };

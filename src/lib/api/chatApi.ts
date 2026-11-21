import { apiFetch } from './client';

export interface ChatPeer {
  key: string; // 'room' أو معرّف المستخدم
  name: string;
  kind: 'room' | 'user';
  role?: string;
  online?: boolean;
  unread: number;
  lastMessage: string | null;
  lastAt: string | null;
  lastId: number;
}

export interface ChatMessageDto {
  id: number;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  body: string;
  createdAt: string;
}

export function fetchChatPeers() {
  return apiFetch<{ ok: boolean; data: { peers: ChatPeer[]; unreadTotal: number } }>('/api/chat/peers');
}

export function fetchChatMessages(peer: string, afterId = 0) {
  const qs = new URLSearchParams({ peer, ...(afterId ? { after: String(afterId) } : {}) });
  return apiFetch<{ ok: boolean; data: ChatMessageDto[] }>(`/api/chat/messages?${qs}`);
}

export function sendChatMessage(peer: string, body: string) {
  return apiFetch<{ ok: boolean; data: ChatMessageDto }>('/api/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ peer, body }),
  });
}

export function markChatRead(peer: string) {
  return apiFetch<{ ok: boolean }>('/api/chat/read', { method: 'POST', body: JSON.stringify({ peer }) });
}

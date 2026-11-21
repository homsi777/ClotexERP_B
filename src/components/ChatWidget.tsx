import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Send, Users, X } from 'lucide-react';
import { fetchMe } from '../lib/api/authApi';
import {
  fetchChatMessages,
  fetchChatPeers,
  markChatRead,
  sendChatMessage,
  type ChatMessageDto,
  type ChatPeer,
} from '../lib/api/chatApi';

const IDLE_POLL_MS = 15_000;
const OPEN_POLL_MS = 5_000;
const CONVO_POLL_MS = 3_000;

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit' });
}

/** دردشة داخلية على مستوى الفرع: زر عائم أسفل يسار الشاشة، غرفة «كل الفرع» + محادثات فردية. */
export const ChatWidget: React.FC = () => {
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<ChatPeer[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [active, setActive] = useState<ChatPeer | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const stickBottomRef = useRef(true);

  useEffect(() => {
    void fetchMe().then((u) => setMe(u.id)).catch(() => setMe(null));
    const closeMe = () => setOpen(false);
    window.addEventListener('clotex:close-chat', closeMe);
    return () => window.removeEventListener('clotex:close-chat', closeMe);
  }, []);

  const loadPeers = useCallback(async () => {
    try {
      const res = await fetchChatPeers();
      setPeers(res.data.peers);
      setUnreadTotal(res.data.unreadTotal);
    } catch {
      /* انقطاع مؤقت */
    }
  }, []);

  // قائمة المحادثات + شارة غير المقروء (أبطأ والنافذة مغلقة).
  useEffect(() => {
    if (!me) return;
    void loadPeers();
    const id = window.setInterval(() => {
      if (!document.hidden) void loadPeers();
    }, open ? OPEN_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(id);
  }, [me, open, loadPeers]);

  // رسائل المحادثة المفتوحة: أول تحميل ثم استعلام تدرّجي.
  const peerKey = active?.key ?? null;
  useEffect(() => {
    lastIdRef.current = 0;
    setMessages([]);
    setError('');
    if (!peerKey || !open) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetchChatMessages(peerKey, lastIdRef.current);
        if (cancelled || !res.data.length) return;
        lastIdRef.current = res.data[res.data.length - 1].id;
        setMessages((prev) => [...prev, ...res.data]);
        void markChatRead(peerKey).then(loadPeers).catch(() => undefined);
      } catch {
        /* تجاهل */
      }
    };
    void pull();
    const id = window.setInterval(() => {
      if (!document.hidden) void pull();
    }, CONVO_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [peerKey, open, loadPeers]);

  // نزول تلقائي لآخر رسالة إلا إن كان المستخدم يقرأ فوق.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, active]);

  if (!me) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text || !active || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await sendChatMessage(active.key, text);
      setDraft('');
      stickBottomRef.current = true;
      if (!messages.some((m) => m.id === res.data.id)) {
        lastIdRef.current = Math.max(lastIdRef.current, res.data.id);
        setMessages((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
      }
      void loadPeers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر الإرسال');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[1100] print:hidden" dir="rtl">
      {open && (
        <div className="mb-3 flex h-[min(520px,calc(100vh-6rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-indigo-600 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2">
              {active && (
                <button type="button" onClick={() => setActive(null)} aria-label="رجوع" className="rounded-lg p-1 hover:bg-white/20">
                  <ArrowRight className="h-5 w-5" />
                </button>
              )}
              <span className="truncate font-bold">{active ? active.name : 'المحادثات'}</span>
              {active?.kind === 'user' && (
                <span className={`h-2 w-2 shrink-0 rounded-full ${active.online ? 'bg-emerald-300' : 'bg-slate-300'}`} title={active.online ? 'متصل' : 'غير متصل'} />
              )}
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-1 hover:bg-white/20">
              <X className="h-5 w-5" />
            </button>
          </div>

          {!active ? (
            <div className="flex-1 overflow-y-auto">
              {peers.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    stickBottomRef.current = true;
                    setActive(p);
                  }}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-right hover:bg-slate-50"
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-black text-indigo-700">
                    {p.kind === 'room' ? <Users className="h-5 w-5" /> : p.name.trim().charAt(0)}
                    {p.kind === 'user' && (
                      <span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-white ${p.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{timeLabel(p.lastAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">{p.lastMessage ?? (p.kind === 'room' ? 'رسالة لكل مستخدمي الفرع' : 'ابدأ المحادثة')}</span>
                      {p.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">{p.unread}</span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
              {peers.length <= 1 && <p className="p-6 text-center text-xs text-slate-400">لا يوجد مستخدمون آخرون بالفرع بعد.</p>}
            </div>
          ) : (
            <>
              <div
                ref={listRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
                className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3"
              >
                {messages.length === 0 && <p className="pt-10 text-center text-xs text-slate-400">لا رسائل بعد — اكتب أول رسالة.</p>}
                {messages.map((m) => {
                  const mine = m.senderId === me;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-900'}`}>
                        {!mine && active.kind === 'room' && <div className="mb-0.5 text-[11px] font-bold text-indigo-600">{m.senderName}</div>}
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`mt-1 text-[10px] ${mine ? 'text-indigo-200' : 'text-slate-400'}`}>{timeLabel(m.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {error && <p className="bg-rose-50 px-3 py-1 text-xs text-rose-700">{error}</p>}
              <div className="flex items-end gap-2 border-t border-slate-200 p-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder="اكتب رسالة…"
                  className="max-h-24 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!draft.trim() || sending}
                  aria-label="إرسال"
                  className="rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Send className="h-4 w-4 -scale-x-100" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (!open) window.dispatchEvent(new Event('clotex:close-ai'));
          setOpen((v) => !v);
        }}
        aria-label="المحادثات"
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl transition hover:bg-indigo-700"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && unreadTotal > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-rose-500 px-1 text-center text-[11px] font-black leading-5 text-white">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>
    </div>
  );
};

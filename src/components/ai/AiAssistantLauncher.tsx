import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getAiSettings } from '../../lib/api/aiApi';
import { ClotexAssistantPanel } from './ClotexAssistantPanel';

export const AI_SETTINGS_CHANGED_EVENT = 'clotex-ai-settings-changed';
export const CHAT_CLOSE_EVENT = 'clotex:close-chat';
export const AI_CLOSE_EVENT = 'clotex:close-ai';

/** زر عائم للمساعد الذكي (أسفل يسار الشاشة بجانب زر الدردشة)؛ يظهر فقط حين يكون المساعد مفعَّلاً من الإعدادات (يحلّ محل زر الشريط العلوي). */
export const AiAssistantLauncher: React.FC = () => {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    void getAiSettings()
      .then((s) => setAvailable(Boolean(s.enabled)))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    const closeMe = () => setOpen(false);
    window.addEventListener(AI_CLOSE_EVENT, closeMe);
    return () => {
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(AI_CLOSE_EVENT, closeMe);
    };
  }, [refresh]);

  if (!available) return null;

  return (
    <>
      <ClotexAssistantPanel open={open} onClose={() => setOpen(false)} />
      <button
        type="button"
        onClick={() => {
          if (!open) window.dispatchEvent(new Event(CHAT_CLOSE_EVENT));
          setOpen((v) => !v);
        }}
        aria-label="مساعد CLOTEX الذكي"
        title="مساعد CLOTEX الذكي"
        className="fixed bottom-4 left-[5.25rem] z-[1100] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-xl transition hover:brightness-110 print:hidden"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    </>
  );
};

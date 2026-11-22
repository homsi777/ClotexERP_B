import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { isoToDmy, maskDmyTyping, parseDmy, withinRange } from '../../lib/dateInputFormat';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'defaultValue'> & {
  /** القيمة بصيغة ISO (yyyy-mm-dd) كحقل date الأصلي. */
  value?: string | null;
  /** يُستدعى بحدث يحمل target.value = ISO (أو '' عند المسح)، كي تعمل كل المعالجات الحالية كما هي. */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

const CALENDAR_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cpath d='M16 2v4M8 2v4M3 10h18'/%3E%3C/svg%3E\")";
const ICON_HIT_PX = 34;

/**
 * حقل تاريخ بصيغة «يوم/شهر/سنة» (dd/mm/yyyy) في كل المشروع — بدل حقل date الأصلي الذي يتبع لغة المتصفح (شهر/يوم/سنة).
 * يقبل الكتابة بالأرقام (فواصل تلقائية) ويفتح تقويم المتصفح بالنقر على الأيقونة أو F4/السهم لأسفل.
 * يحافظ على تواقع الاستخدام: value ISO، وonChange بحدث target.value = ISO.
 */
export const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput(
  { value, onChange, onBlur, onKeyDown, onClick, className, style, placeholder, min, max, disabled, readOnly, ...rest },
  ref,
) {
  const textRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => textRef.current as HTMLInputElement);
  const [text, setText] = useState(isoToDmy(value));
  const [invalid, setInvalid] = useState(false);

  // تغيّر القيمة من الخارج (مثلاً زر «اليوم» أو تحميل سجل): تُعرض بالصيغة الجديدة.
  useEffect(() => {
    const current = parseDmy(text);
    const incoming = String(value ?? '').slice(0, 10);
    if (incoming !== (current ?? '')) {
      setText(isoToDmy(incoming));
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (iso: string) => {
    if (!onChange) return;
    const target = { value: iso, name: rest.name ?? '', id: rest.id ?? '' } as unknown as HTMLInputElement;
    onChange({ target, currentTarget: target, type: 'change' } as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  const handleTyping = (raw: string) => {
    const masked = maskDmyTyping(raw);
    setText(masked);
    if (masked === '') {
      setInvalid(false);
      emit('');
      return;
    }
    if (masked.length === 10) {
      const iso = parseDmy(masked);
      if (iso && withinRange(iso, min as string | undefined, max as string | undefined)) {
        setInvalid(false);
        emit(iso);
      } else {
        setInvalid(true);
      }
    } else {
      setInvalid(false);
    }
  };

  const openPicker = () => {
    const n = nativeRef.current;
    if (!n || disabled || readOnly) return;
    try {
      if (typeof n.showPicker === 'function') n.showPicker();
      else n.click();
    } catch {
      n.click();
    }
  };

  return (
    <>
      <input
        {...rest}
        ref={textRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={10}
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder ?? 'يوم/شهر/سنة'}
        aria-invalid={invalid || undefined}
        title={rest.title ?? 'يوم/شهر/سنة — مثال 21/11/2026'}
        className={`${className ?? ''}${invalid ? ' !border-rose-400 !ring-1 !ring-rose-300' : ''}`}
        style={{
          textAlign: 'left',
          backgroundImage: CALENDAR_ICON,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.6rem center',
          paddingRight: '2.2rem',
          ...style,
        }}
        onChange={(e) => handleTyping(e.target.value)}
        onBlur={(e) => {
          // تاريخ ناقص/غير صالح عند مغادرة الحقل: يرجع للقيمة المحفوظة بدل ترك نص مضلِّل.
          if (parseDmy(text) === null && text !== '') {
            setText(isoToDmy(value));
            setInvalid(false);
          }
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'F4' || (e.key === 'ArrowDown' && e.altKey)) {
            e.preventDefault();
            openPicker();
          }
          onKeyDown?.(e);
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX >= r.right - ICON_HIT_PX) openPicker();
          onClick?.(e);
        }}
      />
      {/* حقل أصلي مخفي لفتح التقويم فقط؛ لا يظهر ولا يأخذ التركيز */}
      <input
        ref={nativeRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        value={String(value ?? '').slice(0, 10)}
        disabled={disabled}
        onChange={(e) => {
          const iso = e.target.value;
          setText(isoToDmy(iso));
          setInvalid(false);
          emit(iso);
        }}
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none', overflow: 'hidden', border: 0, padding: 0 }}
      />
    </>
  );
});

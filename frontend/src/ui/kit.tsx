import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons.tsx';

// ---------- Toast ----------

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = (m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2800);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          <Icon name="check" />
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---------- Sheet (bottom sheet on phones, dialog on wide screens) ----------

export function Sheet({ title, onClose, onBack, wide, children, label }: { title: ReactNode; onClose: () => void; onBack?: () => void; wide: boolean; children: ReactNode; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className={`sheet-wrap ${wide ? 'center' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : 'Dialog')}>
        {!wide && <span className="grab" />}
        <div className="sheet-head">
          {onBack ? (
            <button className="back" onClick={onBack}>
              <Icon name="back" /> {title}
            </button>
          ) : (
            <h2 className="h2">{title}</h2>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Form pieces ----------

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function AmountInput({ id, value, onChange, symbol = '৳', label = 'Amount', autoFocus }: { id: string; value: string; onChange: (v: string) => void; symbol?: string; label?: string; autoFocus?: boolean }) {
  return (
    <div className="amount-input">
      <span>{symbol}</span>
      <input id={id} inputMode="decimal" autoComplete="off" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus={autoFocus} />
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Busy({ busy, children, ...rest }: { busy: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} disabled={busy || rest.disabled}>
      {busy ? <Spinner /> : null} {children}
    </button>
  );
}

// ---------- Tooltips for charts: any element with data-tip ----------

export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | SVGElement | null;
      const cross = document.getElementById('cross');
      if (!el) {
        tip.hidden = true;
        cross?.setAttribute('visibility', 'hidden');
        return;
      }
      tip.innerHTML = el.dataset.tip ?? '';
      tip.hidden = false;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let x = e.clientX + 14;
      let y = e.clientY - h - 12;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y < 8) y = e.clientY + 16;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      if (cross) {
        if (el.classList.contains('hit')) {
          cross.setAttribute('visibility', 'visible');
          for (const [id, attr] of [['cross-l', 'x1'], ['cross-l', 'x2'], ['cross-a', 'cx'], ['cross-b', 'cx']] as const) document.getElementById(id)?.setAttribute(attr, el.dataset.cx!);
          document.getElementById('cross-a')?.setAttribute('cy', el.dataset.ya!);
          document.getElementById('cross-b')?.setAttribute('cy', el.dataset.yb!);
        } else cross.setAttribute('visibility', 'hidden');
      }
    };
    const hide = () => {
      tip.hidden = true;
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('scroll', hide, { passive: true });
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('scroll', hide);
    };
  }, []);
  return <div className="tip" ref={ref} hidden />;
}

/** Re-renders on resize; wide = sidebar layout, xl = three columns. */
export function useViewport() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => setW(window.innerWidth), 100);
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return { wide: w >= 900, xl: w >= 1280 };
}

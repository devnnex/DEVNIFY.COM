import { useEffect, useRef, useId } from 'react';
import { X, Music2 } from 'lucide-react';
import type { ReactNode } from 'react';
export const artUrl = `${import.meta.env.BASE_URL}assets/devnify-art.svg`;
export const brandLogoUrl = `${import.meta.env.BASE_URL}assets/brand-logo.png`;
export function Cover({
  src,
  title = '',
  className = '',
}: {
  src?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={`cover ${className}`}>
      {src ? (
        <img src={src} alt={title} loading="lazy" />
      ) : (
        <div className="cover-placeholder">
          <Music2 aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  accent,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  accent?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={wide ? 'wide' : ''}
      style={
        accent
          ? { backgroundImage: `radial-gradient(ellipse at 50% 10%,${accent}66,transparent 70%)` }
          : undefined
      }
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Music2 />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

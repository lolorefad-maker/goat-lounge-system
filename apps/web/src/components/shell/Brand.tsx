import { clsx } from 'clsx';
import { useT } from '../../i18n';

/** The shop's mark: GOAT logo with graceful fallback to game controller icon. */
export function LogoMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div
      className={clsx(
        'relative shrink-0 overflow-hidden bg-black/40 border border-white/10 flex items-center justify-center',
        size === 'lg'
          ? 'size-16 rounded-2xl shadow-[0_12px_44px_-10px_rgba(30,144,255,0.4)]'
          : 'size-9 rounded-xl shadow-sm',
      )}
    >
      <img
        src="/logo.png"
        alt="GOAT"
        className="size-full object-cover"
        onError={(e) => {
          // fallback to controller svg if logo fails to load
          e.currentTarget.style.display = 'none';
        }}
      />
      <svg
        viewBox="0 0 24 24"
        className={clsx('absolute -z-10 text-accent', size === 'lg' ? 'size-8' : 'size-5')}
        fill="currentColor"
        aria-hidden
      >
        <path d="M7 8h10a4 4 0 0 1 4 4v1.5a2.5 2.5 0 0 1-4.4 1.6L15.5 14h-7l-1.1 1.1A2.5 2.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4Zm0 2.5a.9.9 0 0 0-.9.9v.6h-.6a.9.9 0 0 0 0 1.8h.6v.6a.9.9 0 0 0 1.8 0v-.6h.6a.9.9 0 0 0 0-1.8h-.6v-.6a.9.9 0 0 0-.9-.9Zm9.5.3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
      </svg>
    </div>
  );
}

/** "GOAT GAMING" wordmark. Latin brand name, so it is isolated and never mirrored. */
export function Wordmark({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <bdi dir="ltr" className={clsx('font-black uppercase tracking-[0.14em]', className)}>
      {t('app.name')}
    </bdi>
  );
}

import { clsx } from 'clsx';
import { AArrowDown, AArrowUp, Baseline, Check, ChevronDown, PaintBucket, RotateCcw, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { CSSProperties } from 'react';
import { Num } from '../../components/ui/primitives';
import { useT } from '../../i18n';
import { FILL_HUES, FONT_MAX, FONT_MIN, TEXT_HUES, useSheetFormat, type ColFormat, type Hue, type SheetCol } from './sheetFormat';

const hueVar = (h: Hue) => `var(--pal-${h})`;

type CellFx = {
  'data-sheet-fill'?: '';
  'data-sheet-text'?: '';
  'data-col-sel'?: '';
  style?: CSSProperties;
};

/** Attributes for every cell of a column (header, rows, totals): its colors and the selection mark. */
export function cellFx(c: ColFormat | undefined, selected: boolean): CellFx {
  const out: CellFx = {};
  const style: Record<string, string> = {};
  if (c?.fill) {
    out['data-sheet-fill'] = '';
    style['--sheet-fill'] = hueVar(c.fill);
  }
  if (c?.text) {
    out['data-sheet-text'] = '';
    style['--sheet-text'] = hueVar(c.text);
  }
  if (selected) out['data-col-sel'] = '';
  if (c) out.style = style as CSSProperties;
  return out;
}

const iconBtn =
  'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-control px-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40';

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden />;
}

/**
 * Spreadsheet-style format bar above the floor sheet: text size (A− / 100% / A+) for the whole
 * grid, and a fill / text color for the column picked by its letter. Saved on this device.
 */
export function SheetFormatBar({ selCol, onClearCol }: { selCol: SheetCol | null; onClearCol: () => void }) {
  const { t } = useT();
  const fontScale = useSheetFormat((s) => s.fontScale);
  const cols = useSheetFormat((s) => s.cols);
  const { bigger, smaller, resetFont, setFill, setText, resetAll } = useSheetFormat.getState();
  const cur = selCol ? cols[selCol] : undefined;
  const pct = Math.round(fontScale * 100);
  const changed = fontScale !== 1 || Object.keys(cols).length > 0;

  return (
    <div
      role="toolbar"
      aria-label={t('sheetFmt.toolbar')}
      className="flex flex-wrap items-center gap-1 rounded-card border border-line bg-surface-1 px-2 py-1 shadow-sm"
    >
      {/* Text size */}
      <div className="flex items-center" role="group" aria-label={t('sheetFmt.fontSize')}>
        <button
          type="button"
          className={iconBtn}
          onClick={smaller}
          disabled={fontScale <= FONT_MIN}
          title={t('sheetFmt.fontSmaller')}
          aria-label={t('sheetFmt.fontSmaller')}
        >
          <AArrowDown className="size-5" />
        </button>
        <button
          type="button"
          onClick={resetFont}
          title={t('sheetFmt.fontReset')}
          aria-label={`${t('sheetFmt.fontSize')}: ${pct}%`}
          className="h-9 min-w-14 rounded-control px-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-2"
        >
          <Num>{pct}%</Num>
        </button>
        <button
          type="button"
          className={iconBtn}
          onClick={bigger}
          disabled={fontScale >= FONT_MAX}
          title={t('sheetFmt.fontBigger')}
          aria-label={t('sheetFmt.fontBigger')}
        >
          <AArrowUp className="size-5" />
        </button>
      </div>

      <Divider />

      {/* Column picked by its letter */}
      {selCol ? (
        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent/10 pe-1 ps-2.5 text-xs font-semibold text-accent">
          {t('sheetFmt.column', { col: selCol })}
          <button
            type="button"
            onClick={onClearCol}
            className="rounded-full p-0.5 transition-colors hover:bg-accent/15"
            title={t('sheetFmt.unselect')}
            aria-label={t('sheetFmt.unselect')}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <span className="px-1 text-xs text-muted">{t('sheetFmt.pickColumn')}</span>
      )}

      <ColorPicker kind="fill" value={cur?.fill} disabled={!selCol} onPick={(h) => selCol && setFill(selCol, h)} />
      <ColorPicker kind="text" value={cur?.text} disabled={!selCol} onPick={(h) => selCol && setText(selCol, h)} />

      <Divider />

      <button
        type="button"
        className={clsx(iconBtn, 'text-xs font-semibold')}
        onClick={resetAll}
        disabled={!changed}
        title={t('sheetFmt.resetAllHint')}
      >
        <RotateCcw className="size-4" />
        <span>{t('sheetFmt.resetAll')}</span>
      </button>

      <span className="ms-auto hidden px-1 text-[11px] text-faint lg:inline">{t('sheetFmt.savedHere')}</span>
    </div>
  );
}

function ColorPicker({
  kind,
  value,
  disabled,
  onPick,
}: {
  kind: 'fill' | 'text';
  value: Hue | undefined;
  disabled: boolean;
  onPick: (hue: Hue | null) => void;
}) {
  const { t } = useT();
  const label = kind === 'fill' ? t('sheetFmt.fill') : t('sheetFmt.text');
  const hues = kind === 'fill' ? FILL_HUES : TEXT_HUES;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={iconBtn}
          disabled={disabled}
          title={disabled ? t('sheetFmt.pickColumn') : label}
          aria-label={label}
        >
          <span className="flex flex-col items-center">
            {kind === 'fill' ? <PaintBucket className="size-4" /> : <Baseline className="size-4" />}
            <span
              className="mt-0.5 h-1 w-4 rounded-full border border-line-strong"
              style={value ? { background: hueVar(value), borderColor: 'transparent' } : undefined}
            />
          </span>
          <span className="text-xs font-semibold max-sm:sr-only">{label}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          collisionPadding={12}
          className="anim-pop z-50 w-64 rounded-card border border-line bg-surface-1 p-2.5 shadow-[var(--shadow-float)] focus:outline-none"
        >
          <div className="mb-2 text-xs font-semibold text-muted">{label}</div>
          <Popover.Close asChild>
            <button
              type="button"
              onClick={() => onPick(null)}
              className={clsx(
                'mb-2 flex h-9 w-full items-center gap-2 rounded-control border px-2 text-xs font-semibold transition-colors',
                value ? 'border-line text-fg hover:bg-surface-2' : 'border-accent text-accent',
              )}
            >
              <span className="relative size-5 shrink-0 overflow-hidden rounded border border-line-strong bg-surface-1" aria-hidden>
                <span className="absolute -inset-x-1 top-1/2 h-0.5 -rotate-45 bg-danger" />
              </span>
              {kind === 'fill' ? t('sheetFmt.noFill') : t('sheetFmt.defaultText')}
            </button>
          </Popover.Close>
          <div className={clsx('grid gap-1.5', kind === 'fill' ? 'grid-cols-5' : 'grid-cols-6')}>
            {hues.map((h) => {
              const on = value === h;
              const name = t(`sheetFmt.colors.${h}`);
              return (
                <Popover.Close asChild key={h}>
                  <button
                    type="button"
                    onClick={() => onPick(h)}
                    title={name}
                    aria-label={name}
                    aria-pressed={on}
                    className={clsx(
                      'flex h-9 items-center justify-center rounded-control border text-sm font-bold transition-transform hover:scale-105',
                      kind === 'text' && 'bg-surface-2',
                      on && 'ring-2 ring-fg ring-offset-1 ring-offset-surface-1',
                    )}
                    {...(kind === 'fill'
                      ? { 'data-sheet-fill': '', style: { '--sheet-fill': hueVar(h), borderColor: hueVar(h) } as CSSProperties }
                      : { 'data-sheet-text': '', style: { '--sheet-text': hueVar(h), borderColor: 'var(--border)' } as CSSProperties })}
                  >
                    {kind === 'text' ? 'A' : on ? <Check className="size-4 text-fg" /> : null}
                  </button>
                </Popover.Close>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

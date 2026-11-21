import type { BillingContext } from '@lounge/core';
import { clsx } from 'clsx';
import {
  Banknote,
  BarChart3,
  Boxes,
  ChevronDown,
  CircleCheck,
  Clock,
  Coffee,
  Edit2,
  FileSpreadsheet,
  Gift,
  Gamepad2,
  Hourglass,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  SlidersHorizontal,
  Smartphone,
  Square,
  Timer,
  Trash2,
  User,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { TypeIcon } from '../../components/station/status';
import { Button } from '../../components/ui/button';
import { toastError, useAction } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/overlays';
import { Field, Input, Money, Num, Row, Segmented, Skeleton } from '../../components/ui/primitives';
import { useT } from '../../i18n';
import { ApiError, post } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useFmt } from '../../lib/format';
import { rateNow, type StationView } from '../../lib/live';
import { useProducts, useSessionBill } from '../../lib/queries';
import type { Floor, FloorSession, Product, Station } from '../../lib/types';
import { announceStock, useCart } from '../cafe/products';
import { BillWhatsAppButton } from '../checkout/BillWhatsAppButton';
import { WhatsAppButton } from '../rewards/WhatsAppButton';
import { SheetFormatBar, cellFx } from './SheetFormatBar';
import { useSheetFormat, type SheetCol } from './sheetFormat';
import { SHEET_NAME_MAX, useSheetNames, useTodayNames } from './sheetNames';

/** Column letters row (click a letter to select the column for coloring). */
const LETTER_HEADS: { col: SheetCol; cls: string; label?: string }[] = [
  { col: 'A', cls: 'w-10' },
  { col: 'B', cls: 'w-48' },
  { col: 'C', cls: 'w-28' },
  { col: 'D', cls: 'w-40' },
  { col: 'E', cls: 'w-44' },
  { col: 'F', cls: 'w-52 bg-amber-500/15 font-black text-amber-800 dark:text-amber-300', label: 'F [كافيتريا]' },
  { col: 'G', cls: 'w-28' },
  { col: 'H', cls: 'w-32' },
  { col: 'I', cls: 'w-32' },
  { col: 'J', cls: 'w-36 bg-accent/10 font-bold text-accent', label: 'J [تلقائي]' },
  { col: 'K', cls: 'w-44' },
  { col: 'L', cls: 'w-24' },
];

interface FloorSheetViewProps {
  floor: Floor;
  ctx: BillingContext;
  now: number;
  views: StationView[];
  rateLabels: Map<string, string | null>;
  onOpenStation: (stationId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onCheckout: (sessionId: string) => void;
  onQuickStart: (station: Station, kind: 'open' | 'fixed', minutes?: number, mode?: string, startedMinutesAgo?: number) => Promise<void>;
  onTogglePause: (view: StationView) => Promise<void>;
  onQuickCheckout: (sessionId: string) => Promise<void>;
  onChangeMode?: (sessionId: string, nextMode: string) => Promise<void>;
  onAdjustTime?: (sessionId: string, playedMinutes: number) => Promise<void>;
}

export function FloorSheetView({
  floor,
  ctx,
  now,
  views,
  rateLabels,
  onOpenStation,
  onOpenSession,
  onCheckout,
  onQuickStart,
  onTogglePause,
  onQuickCheckout,
  onChangeMode,
  onAdjustTime,
}: FloorSheetViewProps) {
  const { t } = useT();
  const f = useFmt();
  const role = useAuth((s) => s.user?.role);
  const canManage = can.manageSessions(role);

  // Device names the cashier typed today (the column starts empty each new day)
  const todayNames = useTodayNames(floor.day);
  const setSheetName = useSheetNames((st) => st.setName);
  const nameOf = (st: Station) => todayNames[st.id]?.trim() || st.name;

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'free' | 'ending' | 'overtime'>('all');

  // Mode selection state per station (defaults to 'single' or station.modes[0])
  const [selectedModes, setSelectedModes] = useState<Record<string, string>>({});
  const [startModalStation, setStartModalStation] = useState<{ station: Station; defaultMode: string } | null>(null);

  // Modals state
  const [cafeSession, setCafeSession] = useState<{ session: FloorSession; stationName: string } | null>(null);
  const [settle, setSettle] = useState<{ sessionId: string; stationName: string; method: 'cash' | 'card' } | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<{ sessionId: string; currentPhone: string; currentName: string } | null>(null);
  const [adjustingSession, setAdjustingSession] = useState<{ sessionId: string; stationName: string; currentPlayedMinutes: number } | null>(null);

  // Sheet format (text size + per-column colors), saved on this device
  const fontScale = useSheetFormat((st) => st.fontScale);
  const colFormats = useSheetFormat((st) => st.cols);
  const [selCol, setSelCol] = useState<SheetCol | null>(null);
  const fx = (col: SheetCol) => cellFx(colFormats[col], selCol === col);

  // Filter views
  const filteredViews = useMemo(() => {
    return views.filter((v) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !['active', 'ending', 'overtime', 'paused'].includes(v.status)) return false;
        if (statusFilter === 'free' && v.status !== 'free') return false;
        if (statusFilter === 'ending' && v.status !== 'ending') return false;
        if (statusFilter === 'overtime' && v.status !== 'overtime') return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const sName = `${v.station.name} ${todayNames[v.station.id] ?? ''}`.toLowerCase();
        const cName = (v.session?.customer?.name ?? '').toLowerCase();
        const cPhone = (v.session?.customer?.phone ?? '').toLowerCase();
        const label = (v.session?.label ?? '').toLowerCase();
        if (!sName.includes(q) && !cName.includes(q) && !cPhone.includes(q) && !label.includes(q)) return false;
      }
      return true;
    });
  }, [views, statusFilter, search, todayNames]);

  // Aggregate totals (like Google Sheets SUM formulas)
  const totals = useMemo(() => {
    let playTotal = 0;
    let cafeTotal = 0;
    let grandTotal = 0;
    let paidTotal = 0;
    let dueTotal = 0;
    let activeCount = 0;
    let freeCount = 0;

    for (const v of views) {
      if (v.status === 'free') {
        freeCount++;
        continue;
      }
      activeCount++;
      const play = v.bill?.total ?? 0;
      const cafe = v.session?.itemsTotal ?? 0;
      const paid = v.session?.paid ?? 0;
      const tot = play + cafe;
      const due = Math.max(0, tot - paid);

      playTotal += play;
      cafeTotal += cafe;
      grandTotal += tot;
      paidTotal += paid;
      dueTotal += due;
    }

    return {
      totalStations: views.length,
      activeCount,
      freeCount,
      playTotal,
      cafeTotal,
      grandTotal,
      paidTotal,
      dueTotal,
    };
  }, [views]);

  return (
    <div className="flex flex-col gap-3 font-sans">
      {/* Google Sheets Header & Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-1 p-3 shadow-sm">
        {/* Sheet title & live status */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <FileSpreadsheet className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-fg">جدول إدارة الأجهزة (Google Sheet View)</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                حساب تلقائي مباشر
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>الصيغة:</span>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-faint">
                fx = (وقت_اللعب × سعر_الساعة) + كافيتريا - المدفوع
              </code>
            </div>
          </div>
        </div>

        {/* Quick filters, Shift info & Reports */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Shift status pill */}
          {floor.shift ? (
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Wallet className="size-3.5" />
              <span className="font-semibold">الوردية: {floor.shift.userName}</span>
              <span>· بالدرج:</span>
              <Money value={floor.shift.expectedCash} className="font-bold font-mono" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <Wallet className="size-3.5" />
              <span>الوردية مغلقة</span>
            </div>
          )}

          {/* Direct Link to Reports (الجرد) */}
          <Link
            to="/reports"
            className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-xs font-semibold text-muted hover:border-accent hover:text-accent transition-colors shadow-xs"
            title="فتح صفحة الجرد والتقارير اليومية والشهرية"
          >
            <BarChart3 className="size-3.5" />
            <span>الجرد والتقارير</span>
          </Link>

          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في الجدول..."
              className="h-8 w-44 rounded-md border border-line bg-surface-2 pe-3 ps-8 text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-line bg-surface-2 p-0.5 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={clsx('rounded px-2.5 py-1 font-medium transition-colors', statusFilter === 'all' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
            >
              الكل ({views.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={clsx('rounded px-2.5 py-1 font-medium transition-colors', statusFilter === 'active' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
            >
              شغال ({totals.activeCount})
            </button>
            <button
              onClick={() => setStatusFilter('free')}
              className={clsx('rounded px-2.5 py-1 font-medium transition-colors', statusFilter === 'free' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
            >
              متاح ({totals.freeCount})
            </button>
          </div>
        </div>
      </div>

      {/* Format bar: text size + column fill / text color */}
      <SheetFormatBar selCol={selCol} onClearCol={() => setSelCol(null)} />

      {/* Spreadsheet Table Container */}
      <div className="overflow-x-auto rounded-card border-2 border-line-strong bg-surface-1 shadow-sm">
        <table
          className="sheet-grid w-full min-w-[1100px] border-collapse text-start text-xs border border-line-strong"
          style={{ '--sheet-fs': fontScale } as React.CSSProperties}
        >
          {/* Table Header with Column Letters (Google Sheets Style) */}
          <thead>
            {/* Letters Row — a letter selects its column for coloring */}
            <tr className="border-b-2 border-line-strong bg-surface-2/90 text-center font-mono sheet-text-10 text-faint select-none">
              {LETTER_HEADS.map(({ col, cls, label }, i) => (
                <th key={col} className={clsx(cls, 'p-0', i < LETTER_HEADS.length - 1 && 'border-e border-line-strong')}>
                  <button
                    type="button"
                    onClick={() => setSelCol((c) => (c === col ? null : col))}
                    aria-pressed={selCol === col}
                    title={t('sheetFmt.selectColumn', { col })}
                    className={clsx(
                      'block w-full cursor-pointer p-1 transition-colors',
                      selCol === col ? 'bg-accent text-accent-fg' : 'hover:bg-surface-3 hover:text-fg',
                    )}
                  >
                    {label ?? col}
                  </button>
                </th>
              ))}
            </tr>
            {/* Arabic Descriptive Header */}
            <tr className="border-b-2 border-line-strong bg-surface-2 text-muted font-bold sheet-text-12">
              <th {...fx('A')} className="border-e border-line-strong px-2 py-2.5 text-center">#</th>
              <th {...fx('B')} className="border-e border-line-strong px-3 py-2.5 text-start">الجهاز / الطاولة</th>
              <th {...fx('C')} className="border-e border-line-strong px-3 py-2.5 text-center">الحالة</th>
              <th {...fx('D')} className="border-e border-line-strong px-3 py-2.5 text-start">العميل / الحساب</th>
              <th {...fx('E')} className="border-e border-line-strong px-3 py-2.5 text-center bg-emerald-500/5 text-emerald-700 dark:text-emerald-400">
                بدء اللعب ⏱️
              </th>
              <th {...fx('F')} className="border-e border-line-strong px-3 py-2.5 text-start bg-amber-500/15 text-amber-900 dark:text-amber-200 font-black sheet-text-13 tracking-wide border-x-2 border-amber-500/40">
                كافيتريا وطلبات 🥤🍟
              </th>
              <th {...fx('G')} className="border-e border-line-strong px-3 py-2.5 text-center bg-rose-500/5 text-rose-700 dark:text-rose-400">
                إنهاء اللعب ⏹️
              </th>
              <th {...fx('H')} className="border-e border-line-strong px-3 py-2.5 text-end font-mono">حساب اللعب</th>
              <th {...fx('I')} className="border-e border-line-strong px-3 py-2.5 text-end font-mono">حساب الكافيتريا</th>
              <th {...fx('J')} className="border-e border-line-strong px-3 py-2.5 text-end font-mono bg-accent/15 text-accent font-black">
                المجموع الكلي 💰
              </th>
              <th {...fx('K')} className="border-e border-line-strong px-3 py-2.5 text-center">{t('sheetPay.header')} 💳</th>
              <th {...fx('L')} className="px-3 py-2.5 text-center">إجراءات</th>
            </tr>
          </thead>

          {/* Table Body (Spreadsheet Rows) */}
          <tbody className="divide-y divide-line-strong">
            {filteredViews.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-8 text-center text-sm text-faint">
                  لا توجد أجهزة مطابقة لخيارات البحث
                </td>
              </tr>
            ) : (
              filteredViews.map((v, idx) => {
                const s = v.station;
                const session = v.session;
                const isRunning = session && session.status === 'running';
                const isEnded = session && session.status === 'ended';
                const hasSession = !!session;
                const live = v.live;

                // Monetary calculations
                const playCost = v.bill?.total ?? 0;
                const cafeCost = session?.itemsTotal ?? 0;
                const totalCost = playCost + cafeCost;

                // Mode logic (فردي / زوجي)
                const curSegment = session?.segments.find((seg) => seg.endedAt === null);
                const currentSessionMode = curSegment?.mode ?? session?.segments.at(-1)?.mode ?? 'single';
                const selectedMode = selectedModes[s.id] ?? (s.modes.includes('single') ? 'single' : (s.modes[0] ?? 'single'));
                const singleRateQuote = s.modes.includes('single') ? rateNow(ctx, s, 'single', now) : null;
                const multiRateQuote = s.modes.includes('multi') ? rateNow(ctx, s, 'multi', now) : null;

                // Rate string
                const rateStr = rateLabels.get(s.id) ?? '';

                return (
                  <tr
                    key={s.id}
                    className={clsx(
                      'transition-colors hover:bg-surface-2/60',
                      isRunning ? 'bg-surface-1' : 'bg-surface-1/40',
                      v.status === 'overtime' && 'bg-rose-500/5',
                      v.status === 'ending' && 'bg-amber-500/5',
                    )}
                  >
                    {/* Column A: Row Number */}
                    <td {...fx('A')} className="border-e border-line-strong px-2 py-2.5 text-center font-mono sheet-text-11 text-faint">
                      {idx + 1}
                    </td>

                    {/* Column B: Station Name & Info */}
                    <td {...fx('B')} className="border-e border-line-strong px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <TypeIcon type={s.type} className="size-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            {/* The cashier types the device's name: empty at the start of each day */}
                            <input
                              type="text"
                              value={todayNames[s.id] ?? ''}
                              onChange={(e) => setSheetName(floor.day, s.id, e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                              maxLength={SHEET_NAME_MAX}
                              placeholder={t('sheetNames.placeholder')}
                              aria-label={t('sheetNames.label', { name: s.name })}
                              title={t('sheetNames.hint')}
                              className="w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-bold text-fg transition-colors placeholder:font-normal placeholder:text-faint hover:border-line focus:border-accent focus:bg-surface-1 focus:outline-none"
                            />
                            {s.tier === 'vip' && (
                              <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.2 sheet-text-9 font-bold text-amber-600 dark:text-amber-400">
                                VIP
                              </span>
                            )}
                          </div>
                          <div className="truncate ps-1.5 sheet-text-10 text-faint">
                            <span className="font-mono">{s.name}</span>
                            {s.zone ? <span> · {s.zone}</span> : null}
                            <span className="font-mono"> · {rateStr}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column C: Status Badge */}
                    <td {...fx('C')} className="border-e border-line-strong px-2 py-2 text-center">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 sheet-text-11 font-semibold',
                          v.status === 'free' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                          v.status === 'active' && 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
                          v.status === 'paused' && 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
                          v.status === 'ending' && 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
                          v.status === 'overtime' && 'bg-rose-500/20 text-rose-600 dark:text-rose-400 animate-pulse',
                        )}
                      >
                        {v.status === 'free' && <CircleCheck className="size-3" />}
                        {v.status === 'active' && <Gamepad2 className="size-3" />}
                        {v.status === 'paused' && <Pause className="size-3" />}
                        {v.status === 'ending' && <Hourglass className="size-3" />}
                        {v.status === 'overtime' && <Timer className="size-3" />}
                        <span>
                          {v.status === 'free'
                            ? 'متاح'
                            : v.status === 'active'
                              ? 'يلعب'
                              : v.status === 'paused'
                                ? 'متوقف'
                                : v.status === 'ending'
                                  ? 'ينتهي قريباً'
                                  : v.status === 'overtime'
                                    ? 'وقت إضافي'
                                    : v.status}
                        </span>
                      </span>
                    </td>

                    {/* Column D: Customer */}
                    <td {...fx('D')} className="border-e border-line-strong px-3 py-2">
                      {session?.customer ? (
                        <div className="flex items-center justify-between gap-1">
                          <div>
                            <div className="font-medium text-fg">{session.customer.name || 'عميل'}</div>
                            <div className="font-mono sheet-text-10 text-muted">+{session.customer.phone}</div>
                          </div>
                          {canManage && (
                            <button
                              onClick={() =>
                                setEditingCustomer({
                                   sessionId: session.id,
                                   currentPhone: session.customer?.phone ?? '',
                                   currentName: session.customer?.name ?? '',
                                })
                              }
                              className="rounded p-1 text-faint hover:bg-surface-2 hover:text-fg"
                              title="تعديل العميل"
                            >
                              <Edit2 className="size-3" />
                            </button>
                          )}
                        </div>
                      ) : session ? (
                        <button
                          onClick={() =>
                            setEditingCustomer({
                              sessionId: session.id,
                              currentPhone: '',
                              currentName: session.label ?? '',
                            })
                          }
                          className="flex items-center gap-1 sheet-text-11 text-muted hover:text-accent"
                        >
                          <User className="size-3" />
                          <span>{session.label ? session.label : '+ إضافة اسم/رقم'}</span>
                        </button>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>

                    {/* Column E: Start Cell (بدء اللعب مع خيار فردي / زوجي) */}
                    <td {...fx('E')} className="border-e border-line-strong px-2 py-1.5 text-center bg-emerald-500/5">
                      {isRunning ? (
                        <div className="flex flex-col items-center justify-center gap-1">
                          {/* Current Mode Badge + Quick 1-click Switch */}
                          <div className="flex items-center gap-1">
                            <span
                              data-solid
                              className={clsx(
                                'inline-flex items-center gap-1 rounded px-2 py-0.5 sheet-text-10 font-bold text-white shadow-xs',
                                currentSessionMode === 'gta6'
                                  ? 'bg-amber-600'
                                  : currentSessionMode === 'multi'
                                    ? 'bg-purple-600'
                                    : 'bg-blue-600',
                              )}
                            >
                              {currentSessionMode === 'gta6' ? (
                                <Gamepad2 className="size-3" />
                              ) : currentSessionMode === 'multi' ? (
                                <Users className="size-3" />
                              ) : (
                                <User className="size-3" />
                              )}
                              <span>{currentSessionMode === 'gta6' ? 'GTA 6' : currentSessionMode === 'multi' ? 'زوجي' : 'فردي'}</span>
                            </span>

                            {canManage && onChangeMode && (
                              <div className="flex items-center gap-0.5">
                                {currentSessionMode !== 'single' && (
                                  <button
                                    type="button"
                                    onClick={() => onChangeMode(session.id, 'single')}
                                    className="rounded border border-line bg-surface-2 px-1 py-0.5 sheet-text-9 font-semibold text-muted hover:border-accent hover:text-accent transition-colors"
                                    title="تبديل اللعب إلى فردي"
                                  >
                                    فردي
                                  </button>
                                )}
                                {currentSessionMode !== 'multi' && (
                                  <button
                                    type="button"
                                    onClick={() => onChangeMode(session.id, 'multi')}
                                    className="rounded border border-line bg-surface-2 px-1 py-0.5 sheet-text-9 font-semibold text-muted hover:border-accent hover:text-accent transition-colors"
                                    title="تبديل اللعب إلى زوجي"
                                  >
                                    زوجي
                                  </button>
                                )}
                                {currentSessionMode !== 'gta6' && (
                                  <button
                                    type="button"
                                    onClick={() => onChangeMode(session.id, 'gta6')}
                                    className="rounded border border-amber-500/50 bg-amber-500/10 px-1 py-0.5 sheet-text-9 font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
                                    title="تبديل اللعب إلى GTA 6 (2.50 د.أ)"
                                  >
                                    GTA 6
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 font-mono font-bold text-fg">
                            <span className="text-sm">{live ? f.duration(live.playedMs) : '--:--'}</span>
                            {canManage && (
                              <button
                                onClick={() => onTogglePause(v)}
                                className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
                                title={v.status === 'paused' ? 'استئناف' : 'إيقاف مؤقت'}
                              >
                                {v.status === 'paused' ? <Play className="size-3 text-emerald-600" /> : <Pause className="size-3 text-amber-600" />}
                              </button>
                            )}
                            {canManage && onAdjustTime && (
                              <button
                                onClick={() => {
                                  const playedMin = Math.ceil((live?.playedMs ?? 0) / 60_000);
                                  setAdjustingSession({
                                    sessionId: session.id,
                                    stationName: nameOf(s),
                                    currentPlayedMinutes: playedMin,
                                  });
                                }}
                                className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-accent transition-colors"
                                title="تعديل وقت اللعب (في حال بلشوا قبل أو حابب تعدل الدقائق)"
                              >
                                <Clock className="size-3 text-amber-600" />
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (canManage && onAdjustTime) {
                                const playedMin = Math.ceil((live?.playedMs ?? 0) / 60_000);
                                setAdjustingSession({
                                  sessionId: session.id,
                                  stationName: nameOf(s),
                                  currentPlayedMinutes: playedMin,
                                });
                              }
                            }}
                            className="sheet-text-10 text-muted hover:text-accent flex items-center gap-0.5 transition-colors cursor-pointer"
                            title="اضغط لتعديل وقت البدء أو الدقائق"
                          >
                            <span>بدء: {f.time(session.startedAt)}</span>
                            <Edit2 className="size-2.5 opacity-60" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center py-1">
                          <button
                            type="button"
                            onClick={() => setStartModalStation({ station: s, defaultMode: 'single' })}
                            data-solid
                            className="inline-flex min-h-8 whitespace-nowrap items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-4 text-xs font-black text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition-all"
                            title="بدء تشغيل الجهاز واختيار نوع اللعبة (فردي / زوجي / GTA 6)"
                          >
                            <Play className="size-3.5 fill-current" />
                            <span>بدء اللعب ⏱️</span>
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Column F: Cafeteria (كافيتريا بين البدء والإنهاء بخط عريض وواضح) */}
                    <td {...fx('F')} className="border-e border-line-strong px-2.5 py-1.5 bg-amber-500/10 dark:bg-amber-500/15">
                      {hasSession ? (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => setCafeSession({ session, stationName: nameOf(s) })}
                            className="inline-flex min-h-8 whitespace-nowrap flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-amber-500/70 bg-amber-500/25 px-2.5 text-xs font-black text-amber-950 dark:text-amber-100 hover:bg-amber-500/40 active:scale-95 transition-all shadow-xs"
                            title="فتح قائمة الكافيتريا لاختيار الطلبات"
                          >
                            <Coffee className="size-4 text-amber-700 dark:text-amber-300 stroke-[2.5]" />
                            <span className="font-black text-xs tracking-wide">كافيتريا</span>
                            <Plus className="size-3.5 stroke-[3]" />
                          </button>

                          {session.itemsCount > 0 && (
                            <span
                              onClick={() => setCafeSession({ session, stationName: nameOf(s) })}
                              className="cursor-pointer rounded-md bg-amber-500/35 border-2 border-amber-500/60 px-2 py-0.5 font-mono text-xs font-black text-amber-950 dark:text-amber-100 hover:underline shrink-0 shadow-xs"
                              title="عرض الطلبات الحالية"
                            >
                              <Num>{session.itemsCount}</Num> طلب
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            toast.info('قم ببدء الجهاز أولاً لإضافة طلبات كافيتريا إليه أو افتح صفحة الكافيتيريا للبيع المباشر');
                          }}
                          className="inline-flex min-h-8 whitespace-nowrap w-full items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-amber-500/40 text-xs font-black text-muted/70 hover:text-fg hover:border-amber-500/70"
                        >
                          <Coffee className="size-3.5 opacity-50" />
                          <span className="font-black text-xs">كافيتريا</span>
                        </button>
                      )}
                    </td>

                    {/* Column G: End Cell (إنهاء اللعب) */}
                    <td {...fx('G')} className="border-e border-line-strong px-2 py-1.5 text-center bg-rose-500/5">
                      {isRunning ? (
                        <button
                          onClick={() => onQuickCheckout(session.id)}
                          data-solid
                          className="inline-flex min-h-7 whitespace-nowrap items-center gap-1 rounded bg-rose-600 px-3 sheet-text-11 font-bold text-white shadow-sm hover:bg-rose-700 active:scale-95 transition-all"
                          title="إنهاء الجلسة وحساب الوقت"
                        >
                          <Square className="size-3 fill-current" />
                          <span>إنهاء ⏹️</span>
                        </button>
                      ) : isEnded ? (
                        <div className="flex flex-col items-center sheet-text-10 text-muted">
                          <span className="font-semibold text-rose-600">منتهي</span>
                          <span>{session.endedAt ? f.time(session.endedAt) : ''}</span>
                        </div>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>

                    {/* Column H: Play Cost (حساب اللعب) */}
                    <td {...fx('H')} className="border-e border-line-strong px-3 py-2 text-end font-mono font-semibold">
                      {hasSession ? <Money value={playCost} /> : <span className="text-faint">0.00</span>}
                      {/* What the time is billed as (hour rule: 5 min → 1 h, 1:21 → 2 h) */}
                      {hasSession && v.bill && v.bill.billableMs !== v.bill.playedMs && (
                        <div className="mt-0.5 whitespace-nowrap font-sans sheet-text-10 font-medium text-muted">
                          {t('sheetPay.billedAs', { d: f.span(v.bill.billableMs) })}
                        </div>
                      )}
                    </td>

                    {/* Column I: Cafeteria Cost (حساب الكافيتريا) */}
                    <td {...fx('I')} className="border-e border-line-strong px-3 py-2 text-end font-mono font-bold text-amber-700 dark:text-amber-400">
                      {hasSession && cafeCost > 0 ? <Money value={cafeCost} /> : <span className="text-faint">0.00</span>}
                    </td>

                    {/* Column J: Total Bill (المجموع الكلي - يحسب لحاله) */}
                    <td {...fx('J')} className="border-e border-line-strong px-3 py-2 text-end font-mono font-black text-sm bg-accent/10 text-accent">
                      {hasSession ? <Money value={totalCost} /> : <span className="text-faint">0.00</span>}
                    </td>

                    {/* Column K: Payment type (كاش / كليك) — pays the whole bill and closes it */}
                    <td {...fx('K')} className="border-e border-line-strong px-2 py-1.5">
                      {hasSession ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            data-solid
                            onClick={() => setSettle({ sessionId: session.id, stationName: nameOf(s), method: 'cash' })}
                            className="inline-flex min-h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95"
                            title={t('sheetPay.payCash')}
                          >
                            <Banknote className="size-3.5" />
                            <span>{t('sheetPay.cash')}</span>
                          </button>
                          <button
                            type="button"
                            data-solid
                            onClick={() => setSettle({ sessionId: session.id, stationName: nameOf(s), method: 'card' })}
                            className="inline-flex min-h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-sky-600 px-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-sky-700 active:scale-95"
                            title={t('sheetPay.payCliq')}
                          >
                            <Smartphone className="size-3.5" />
                            <span>{t('sheetPay.cliq')}</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>

                    {/* Column L: Actions */}
                    <td {...fx('L')} className="px-2 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            if (session) onOpenSession(session.id);
                            else onOpenStation(s.id);
                          }}
                          className="rounded border border-line bg-surface-2 p-1.5 text-muted hover:border-accent hover:text-accent active:scale-95 transition-all"
                          title="فتح تفاصيل الجهاز والتحكم المتقدم"
                        >
                          <SlidersHorizontal className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Table Footer: Totals Row (Google Sheets Formula Sum) */}
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-surface-2 font-bold text-xs">
              <td {...fx('A')} className="border-e border-line-strong px-2 py-3 text-center font-mono">Σ</td>
              <td {...fx('B')} className="border-e border-line-strong px-3 py-3 text-start">
                <span>المجموع الكلي ({totals.totalStations} أجهزة)</span>
              </td>
              <td {...fx('C')} className="border-e border-line-strong px-2 py-3 text-center text-muted">
                <span>{totals.activeCount} شغال · {totals.freeCount} متاح</span>
              </td>
              <td {...fx('D')} className="border-e border-line-strong px-3 py-3 text-muted">-</td>
              <td {...fx('E')} className="border-e border-line-strong px-2 py-3 text-center text-emerald-600">-</td>
              <td {...fx('F')} className="border-e border-line-strong px-2 py-3 text-center text-amber-700 dark:text-amber-400 font-black">-</td>
              <td {...fx('G')} className="border-e border-line-strong px-2 py-3 text-center text-rose-600">-</td>
              <td {...fx('H')} className="border-e border-line-strong px-3 py-3 text-end font-mono">
                <Money value={totals.playTotal} />
              </td>
              <td {...fx('I')} className="border-e border-line-strong px-3 py-3 text-end font-mono text-amber-700 dark:text-amber-400 font-bold">
                <Money value={totals.cafeTotal} />
              </td>
              <td {...fx('J')} className="border-e border-line-strong px-3 py-3 text-end font-mono text-sm bg-accent/15 text-accent font-black">
                <Money value={totals.grandTotal} />
              </td>
              <td {...fx('K')} className="border-e border-line-strong px-3 py-3">
                <div className="flex flex-col sheet-text-11">
                  <span className="text-muted">{t('sheetPay.toCollect')}</span>
                  <Money value={totals.dueTotal} className="font-mono" />
                </div>
              </td>
              <td {...fx('L')} className="px-2 py-3 text-center text-faint">✓</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Quick Cafeteria Dialog */}
      {cafeSession && (
        <QuickCafeDialog
          sessionId={cafeSession.session.id}
          stationName={cafeSession.stationName}
          onClose={() => setCafeSession(null)}
        />
      )}

      {/* Pay the whole bill (cash / CliQ) and close it — WhatsApp bill after, when the number is known */}
      {settle && (
        <QuickSettleDialog
          key={settle.sessionId}
          sessionId={settle.sessionId}
          stationName={settle.stationName}
          initialMethod={settle.method}
          hasOpenShift={!!floor.shift}
          onClose={() => setSettle(null)}
          onFullCheckout={() => {
            const sid = settle.sessionId;
            setSettle(null);
            onCheckout(sid);
          }}
        />
      )}

      {/* Quick Customer Dialog */}
      {editingCustomer && (
        <QuickCustomerDialog
          sessionId={editingCustomer.sessionId}
          initialPhone={editingCustomer.currentPhone}
          initialName={editingCustomer.currentName}
          onClose={() => setEditingCustomer(null)}
        />
      )}

      {/* Quick Start Modal (Choose Single vs Multi, Open vs Fixed, Late Start Minutes) */}
      {startModalStation && (
        <QuickStartCustomModal
          station={startModalStation.station}
          defaultMode={startModalStation.defaultMode}
          ctx={ctx}
          now={now}
          onClose={() => setStartModalStation(null)}
          onStart={onQuickStart}
        />
      )}

      {/* Adjust Played Time Modal (لعبوا قبل كذا دقائق / تعديل الوقت) */}
      {adjustingSession && onAdjustTime && (
        <AdjustSessionTimeModal
          sessionId={adjustingSession.sessionId}
          stationName={adjustingSession.stationName}
          currentPlayedMinutes={adjustingSession.currentPlayedMinutes}
          now={now}
          onClose={() => setAdjustingSession(null)}
          onSave={onAdjustTime}
        />
      )}
    </div>
  );
}

/**
 * Quick Cafeteria Modal: Cashier can quickly pick products (drinks, snacks) and add to the station bill
 */
function QuickCafeDialog({
  sessionId,
  stationName,
  onClose,
}: {
  sessionId: string;
  stationName: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const products = useProducts();
  const productList = products.data ?? [];
  const activeProducts = useMemo(() => productList.filter((p) => p.active), [productList]);
  const categories = useMemo(() => [...new Set(activeProducts.map((p) => p.category))], [activeProducts]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const cart = useCart();
  const { busy, run } = useAction();
  const bill = useSessionBill(sessionId);
  const existingItems = bill.data?.items ?? [];

  // Filter products by category
  const displayedProducts = useMemo(() => {
    if (!selectedCat) return activeProducts;
    return activeProducts.filter((p) => p.category === selectedCat);
  }, [activeProducts, selectedCat]);

  // Cart total
  const cartTotalAmount = useMemo(() => {
    return cart.items.reduce((sum, item) => {
      const prod = activeProducts.find((p) => p.id === item.productId);
      return sum + (prod?.price ?? 0) * item.qty;
    }, 0);
  }, [cart.items, activeProducts]);

  // Add items to session
  const handleAddOrders = async () => {
    if (cart.items.length === 0) return;
    const res = await run(() => post<{ id: string; stock: any[] }>('/api/orders', { sessionId, items: cart.items }));
    if (res) {
      cart.clear();
      toast.success(`تمت إضافة الطلبات لحساب ${stationName} ✓`);
      onClose();
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`كافيتريا الجهاز: ${stationName}`} size="md">
      <div className="flex flex-col gap-4 font-sans text-xs">
        {/* Categories Bar */}
        <div className="flex flex-wrap gap-1 border-b border-line pb-2.5">
          <button
            onClick={() => setSelectedCat(null)}
            className={clsx(
              'h-7 rounded-full border px-3 text-xs font-medium transition-colors',
              selectedCat === null ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted hover:text-fg',
            )}
          >
            كل المنتجات
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedCat(c)}
              className={clsx(
                'h-7 rounded-full border px-3 text-xs font-medium transition-colors',
                selectedCat === c ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted hover:text-fg',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 p-1">
          {displayedProducts.map((p) => {
            const inCart = cart.lines.get(p.id) ?? 0;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => cart.add(p.id, 1)}
                className={clsx(
                  'relative flex flex-col items-start justify-between rounded-lg border p-2 text-start transition-all active:scale-95',
                  inCart > 0 ? 'border-amber-500 bg-amber-500/10' : 'border-line bg-surface-2 hover:border-line-strong',
                )}
              >
                <span className="w-full truncate font-medium text-fg">{p.name}</span>
                <span className="mt-1 flex w-full items-center justify-between text-[11px] font-mono font-semibold text-muted">
                  <Money value={p.price} />
                  {inCart > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                      +{inCart}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Cart Review if any selected */}
        {cart.count > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between font-semibold text-amber-800 dark:text-amber-300">
              <span>الطلبات المحددة ({cart.count}):</span>
              <span className="font-mono text-sm">
                <Money value={cartTotalAmount} />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cart.items.map((i) => {
                const prod = activeProducts.find((p) => p.id === i.productId);
                return (
                  <div
                    key={i.productId}
                    className="flex items-center gap-1.5 rounded bg-surface-1 px-2 py-1 border border-line text-[11px]"
                  >
                    <span>{prod?.name}</span>
                    <span className="font-bold text-amber-600">×{i.qty}</span>
                    <button onClick={() => cart.add(i.productId, -1)} className="text-rose-500 hover:bg-rose-500/10 rounded p-0.5">
                      <Minus className="size-3" />
                    </button>
                    <button onClick={() => cart.add(i.productId, 1)} className="text-emerald-500 hover:bg-emerald-500/10 rounded p-0.5">
                      <Plus className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Existing Items on this Session */}
        {existingItems.length > 0 && (
          <div className="border-t border-line pt-2 text-[11px]">
            <span className="font-semibold text-muted">الطلبات المسجلة سابقاً على الجهاز:</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {existingItems.map((item) => (
                <span
                  key={item.id}
                  className={clsx(
                    'rounded border px-2 py-0.5',
                    item.voided ? 'border-line line-through text-faint' : 'border-line bg-surface-2 text-fg',
                  )}
                >
                  {item.qty}× {item.name} (<Money value={item.qty * item.unitPrice} />)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" size="md" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={busy}
            disabled={cart.count === 0}
            onClick={handleAddOrders}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            إضافة للحساب ✓ (<Money value={cartTotalAmount} />)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Pay the whole bill from the sheet in one go (cash or CliQ). Shows what is charged first — played
 * vs billed time, play, cafeteria, what was paid before, the amount due — then checks out (a device
 * still playing ends now). With a phone number on the device, the bill goes out on WhatsApp after.
 */
function QuickSettleDialog({
  sessionId,
  stationName,
  initialMethod,
  hasOpenShift,
  onClose,
  onFullCheckout,
}: {
  sessionId: string;
  stationName: string;
  initialMethod: 'cash' | 'card';
  hasOpenShift: boolean;
  onClose: () => void;
  onFullCheckout: () => void;
}) {
  const { t } = useT();
  const f = useFmt();
  const bill = useSessionBill(sessionId);
  const [method, setMethod] = useState<'cash' | 'card'>(initialMethod);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SettleDone | null>(null);

  // A running device is priced "as of now": take fresh numbers when the window opens.
  useEffect(() => {
    void bill.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = bill.data;
  const totals = data?.totals;
  const due = totals?.due ?? 0;
  const running = data?.session.status === 'running';
  const methodLabel = method === 'cash' ? t('sheetPay.cash') : t('sheetPay.cliq');
  const blocked = !totals || due < 0 || (due > 0 && !hasOpenShift);
  const title = t('sheetPay.title', { name: stationName });

  const confirm = async () => {
    if (!totals || blocked) return;
    setBusy(true);
    try {
      const res = await post<SettleDone>(`/api/sessions/${sessionId}/checkout`, {
        payments: due === 0 ? [] : [{ method, amount: due }],
        expectedTotal: totals.total,
      });
      const phone = res.reward?.phone ?? data?.customer?.phone ?? null;
      if (phone || res.reward) {
        setDone({ ...res, phone });
      } else {
        toast.success(t('sheetPay.done', { n: res.number }));
        onClose();
      }
    } catch (err) {
      toastError(err);
      if (err instanceof ApiError && err.code === 'bill_changed') void bill.refetch();
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal open onOpenChange={(o) => !o && onClose()} title={title} size="sm">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-st-free/15 text-st-free">
            <CircleCheck className="size-8" />
          </span>
          <p className="text-base font-semibold">{t('sheetPay.done', { n: done.number })}</p>
          {done.phone && <BillWhatsAppButton billId={done.billId} phone={done.phone} block />}
          {done.reward && (
            <div data-status="free" className="tint flex w-full flex-col gap-2 rounded-card border p-3 text-start text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <Gift className="size-4 shrink-0" aria-hidden />
                {t('rewards.earned', { free: f.span(done.reward.minutes * 60_000) })}
              </div>
              <WhatsAppButton reward={done.reward} variant="outline" block />
            </div>
          )}
          <Button block size="lg" variant="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} size="sm">
      <div className="flex flex-col gap-3 font-sans">
        {!data || !totals ? (
          <Skeleton className="h-56" />
        ) : (
          <>
            {running && (
              <p className="rounded-control border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                {t('sheetPay.endsNow')}
              </p>
            )}

            <div className="flex flex-col rounded-card border border-line bg-surface-2 px-3 py-1.5">
              <Row label={t('sheetPay.played')} value={<span className="text-fg">{f.span(data.time.playedMs)}</span>} />
              {data.time.billableMs !== data.time.playedMs && (
                <Row label={t('sheetPay.billed')} value={<span className="font-semibold text-fg">{f.span(data.time.billableMs)}</span>} />
              )}
              <Row label={t('sheetPay.play')} value={<Money value={data.time.total} className="text-fg" />} />
              {totals.itemsTotal > 0 && <Row label={t('sheetPay.cafe')} value={<Money value={totals.itemsTotal} className="text-fg" />} />}
              {totals.rounding !== 0 && <Row muted label={t('checkout.rounding')} value={<Money value={totals.rounding} />} />}
              {totals.paid > 0 && (
                <Row
                  label={t('sheetPay.paidBefore')}
                  value={
                    <span className="text-st-free">
                      −<Money value={totals.paid} />
                    </span>
                  }
                />
              )}
            </div>

            <div className="text-center">
              <div className="text-xs text-muted">{t('sheetPay.due')}</div>
              <div className="mt-1 font-mono text-3xl font-bold text-accent">
                <Money value={Math.max(0, due)} currency />
              </div>
            </div>

            <Segmented
              size="lg"
              value={method}
              onChange={setMethod}
              ariaLabel={t('sheetPay.header')}
              options={[
                {
                  value: 'cash',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Banknote className="size-4" /> {t('sheetPay.cash')}
                    </span>
                  ),
                },
                {
                  value: 'card',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Smartphone className="size-4" /> {t('sheetPay.cliq')}
                    </span>
                  ),
                },
              ]}
            />

            {due > 0 && !hasOpenShift && (
              <p data-status="ending" className="tint rounded-control border px-3 py-2 text-xs font-semibold st-fg">
                {t('sheetPay.noShift')}
              </p>
            )}
            {due < 0 && <p className="rounded-control border border-line px-3 py-2 text-xs text-muted">{t('sheetPay.refundFull')}</p>}
            {data.reward && (
              <p data-status="free" className="tint flex items-center gap-1.5 rounded-control border px-3 py-2 text-xs font-semibold">
                <Gift className="size-3.5 shrink-0" aria-hidden /> {t('sheetPay.rewardWaiting')}
              </p>
            )}

            <Button variant="primary" size="lg" block loading={busy} disabled={blocked} onClick={confirm}>
              {t('sheetPay.confirm', { method: methodLabel })}
            </Button>
            <Button variant="ghost" size="sm" block onClick={onFullCheckout} className="text-muted">
              {t('sheetPay.fullCheckout')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** What a checkout answers, plus the number to send the bill to. */
interface SettleDone {
  billId: string;
  number: number;
  reward?: { id: string; minutes: number; playedMinutes: number; name: string; phone: string } | null;
  phone?: string | null;
}

/**
 * Quick Customer Dialog: Attach customer phone/name to session
 */
function QuickCustomerDialog({
  sessionId,
  initialPhone,
  initialName,
  onClose,
}: {
  sessionId: string;
  initialPhone: string;
  initialName: string;
  onClose: () => void;
}) {
  const { busy, run } = useAction();
  const [phone, setPhone] = useState(initialPhone);
  const [label, setLabel] = useState(initialName);

  const handleSubmit = async () => {
    const ok = await run(
      () =>
        post(`/api/sessions/${sessionId}/customer`, {
          phone: phone.trim() || null,
          name: label.trim() || null,
        }),
      { success: 'تم تحديث بيانات العميل للجلسة ✓' },
    );
    if (ok) onClose();
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="تسجيل العميل للجلسة" size="sm">
      <div className="flex flex-col gap-3 font-sans text-xs">
        <Field label="رقم الهاتف (لكسب الساعات والنقاط)" htmlFor="c-phone">
          <Input
            id="c-phone"
            autoFocus
            dir="ltr"
            placeholder="07xxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <Field label="اسم العميل أو ملاحظة" htmlFor="c-name">
          <Input
            id="c-name"
            placeholder="مثال: أحمد، طاولة الشباب..."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" size="md" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" size="md" loading={busy} onClick={handleSubmit}>
            حفظ البيانات ✓
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Quick Start Modal: choose Single vs Multi, Open or Fixed Duration, and Late Start (لعبوا كذا دقائق سابقاً)
 */
function QuickStartCustomModal({
  station,
  defaultMode,
  ctx,
  now,
  onClose,
  onStart,
}: {
  station: Station;
  defaultMode: string;
  ctx: BillingContext;
  now: number;
  onClose: () => void;
  onStart: (station: Station, kind: 'open' | 'fixed', minutes?: number, mode?: string, startedMinutesAgo?: number) => Promise<void>;
}) {
  const f = useFmt();
  const [mode, setMode] = useState(defaultMode);
  const [kind, setKind] = useState<'open' | 'fixed'>('open');
  const [minutes, setMinutes] = useState(60);
  const [startedMinutesAgo, setStartedMinutesAgo] = useState(0);
  const [busy, setBusy] = useState(false);

  const quote = rateNow(ctx, station, mode, now);
  const singleRateQuote = rateNow(ctx, station, 'single', now);
  const multiRateQuote = rateNow(ctx, station, 'multi', now);
  const simulatedStartTime = now - startedMinutesAgo * 60_000;

  const handleStart = async () => {
    setBusy(true);
    try {
      await onStart(
        station,
        kind,
        kind === 'fixed' ? minutes : undefined,
        mode,
        startedMinutesAgo > 0 ? startedMinutesAgo : undefined,
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleQuickStartDirect = async (chosenMode: string) => {
    setBusy(true);
    try {
      await onStart(
        station,
        'open',
        undefined,
        chosenMode,
        startedMinutesAgo > 0 ? startedMinutesAgo : undefined,
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`تشغيل جهاز: ${station.name}`} size="md">
      <div className="flex flex-col gap-4 font-sans text-xs">
        {/* Mode Selector */}
        <div>
          <label className="mb-2 block font-black text-sm text-fg">شو بده يلعب الزبون؟ (اختر نوع اللعب):</label>
          <div className="grid grid-cols-3 gap-2.5">
            {/* Single Card */}
            <div
              onClick={() => setMode('single')}
              className={clsx(
                'flex flex-col items-center justify-between rounded-xl border-2 p-3 transition-all cursor-pointer text-center relative shadow-xs',
                mode === 'single'
                  ? 'border-blue-600 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/30'
                  : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:bg-surface-3',
              )}
            >
              <User className="size-6 mb-1 text-blue-600" />
              <span className="text-sm font-black text-fg">فردي</span>
              <span className="font-mono text-xs font-semibold my-1 text-muted">
                {singleRateQuote ? f.rate(singleRateQuote.perHour) : '2.000 د.أ'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickStartDirect('single');
                }}
                className="mt-1 w-full rounded bg-blue-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-blue-700 shadow-xs active:scale-95 transition-all"
                title="بدء مفتوح فوراً فردي"
              >
                بدء مفتوح ⚡
              </button>
            </div>

            {/* Multi Card */}
            <div
              onClick={() => setMode('multi')}
              className={clsx(
                'flex flex-col items-center justify-between rounded-xl border-2 p-3 transition-all cursor-pointer text-center relative shadow-xs',
                mode === 'multi'
                  ? 'border-purple-600 bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500/30'
                  : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:bg-surface-3',
              )}
            >
              <Users className="size-6 mb-1 text-purple-600" />
              <span className="text-sm font-black text-fg">زوجي</span>
              <span className="font-mono text-xs font-semibold my-1 text-muted">
                {multiRateQuote ? f.rate(multiRateQuote.perHour) : '3.000 د.أ'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickStartDirect('multi');
                }}
                className="mt-1 w-full rounded bg-purple-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-purple-700 shadow-xs active:scale-95 transition-all"
                title="بدء مفتوح فوراً زوجي"
              >
                بدء مفتوح ⚡
              </button>
            </div>

            {/* GTA 6 Card */}
            <div
              onClick={() => setMode('gta6')}
              className={clsx(
                'flex flex-col items-center justify-between rounded-xl border-2 p-3 transition-all cursor-pointer text-center relative shadow-xs',
                mode === 'gta6'
                  ? 'border-amber-600 bg-amber-500/15 text-amber-900 dark:text-amber-100 ring-2 ring-amber-500/30'
                  : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:border-amber-500/70 hover:bg-amber-500/10',
              )}
            >
              <Gamepad2 className="size-6 mb-1 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-black text-amber-950 dark:text-amber-100">GTA 6 🚗</span>
              <span className="font-mono text-xs font-black my-1 text-amber-700 dark:text-amber-300">
                2.500 د.أ / س
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickStartDirect('gta6');
                }}
                className="mt-1 w-full rounded bg-amber-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-amber-700 shadow-xs active:scale-95 transition-all"
                title="بدء مفتوح فوراً GTA 6"
              >
                بدء مفتوح ⚡
              </button>
            </div>
          </div>
        </div>

        {/* Kind Selector: Open vs Fixed */}
        <div>
          <label className="mb-1 block font-bold text-fg">نوع الوقت:</label>
          <Segmented
            size="md"
            value={kind}
            onChange={(k) => setKind(k as 'open' | 'fixed')}
            options={[
              { value: 'open', label: '⏱️ وقت مفتوح' },
              { value: 'fixed', label: '⏳ وقت محدد' },
            ]}
          />
        </div>

        {/* Fixed Minutes presets */}
        {kind === 'fixed' && (
          <div>
            <label className="mb-1 block font-medium text-muted">مدة اللعب:</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[30, 60, 90, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinutes(m)}
                  className={clsx(
                    'rounded-md border py-2 text-center font-bold text-xs transition-colors',
                    minutes === m
                      ? 'border-accent bg-accent text-accent-fg'
                      : 'border-line bg-surface-2 text-muted hover:text-fg',
                  )}
                >
                  {m >= 60 ? `${m / 60} س` : `${m} د`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Started Late Feature (بدء متأخر / لعبوا كذا دقائق سابقاً) */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <Clock className="size-3.5" />
              <span>هل بلشوا يلعبوا من قبل؟ (بدء متأخر)</span>
            </label>
            {startedMinutesAgo > 0 && (
              <span className="font-mono font-bold text-amber-600 bg-amber-500/20 px-2 py-0.5 rounded-full text-[10px]">
                لعبوا {startedMinutesAgo} دقيقة
              </span>
            )}
          </div>

          <div className="grid grid-cols-5 gap-1 mb-2">
            {[0, 5, 10, 15, 20].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setStartedMinutesAgo(m)}
                className={clsx(
                  'rounded border py-1 text-center font-bold text-[11px] transition-colors',
                  startedMinutesAgo === m
                    ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                    : 'border-line bg-surface-1 text-muted hover:text-fg',
                )}
              >
                {m === 0 ? 'الآن' : `${m} د`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted shrink-0">أو إدخال يدوي:</span>
            <Input
              type="number"
              min={0}
              max={720}
              placeholder="0 دقيقة"
              value={startedMinutesAgo || ''}
              onChange={(e) => setStartedMinutesAgo(Math.max(0, parseInt(e.target.value) || 0))}
              className="h-8 font-mono text-center text-xs font-bold"
            />
            <span className="text-[11px] text-muted">دقيقة</span>
          </div>

          {startedMinutesAgo > 0 && (
            <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-400 font-medium">
              ✓ سيبدأ العداد ومعه ({startedMinutesAgo} دقيقة)، ويُحسب وقت البدء عند {f.time(simulatedStartTime)}.
            </div>
          )}
        </div>

        {/* Hourly Rate preview */}
        {quote && (
          <div className="rounded bg-surface-2 p-2.5 text-center border border-line text-xs">
            <span className="text-muted">سعر الساعة المحدد: </span>
            <span className="font-mono font-bold text-fg">{f.rate(quote.perHour)}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" size="md" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={handleStart}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            بدء تشغيل الجهاز الآن ✓
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Adjust Session Time Modal: change elapsed minutes or adjust start time of an active session
 */
function AdjustSessionTimeModal({
  sessionId,
  stationName,
  currentPlayedMinutes,
  now,
  onClose,
  onSave,
}: {
  sessionId: string;
  stationName: string;
  currentPlayedMinutes: number;
  now: number;
  onClose: () => void;
  onSave: (sessionId: string, playedMinutes: number) => Promise<void>;
}) {
  const f = useFmt();
  const [playedMinutes, setPlayedMinutes] = useState(currentPlayedMinutes);
  const [busy, setBusy] = useState(false);

  const delta = playedMinutes - currentPlayedMinutes;
  const simulatedStart = now - playedMinutes * 60_000;

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await onSave(sessionId, Math.max(0, playedMinutes));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`تعديل وقت اللعب: ${stationName}`} size="sm">
      <div className="flex flex-col gap-4 font-sans text-xs">
        <div className="rounded-lg bg-surface-2 p-3 text-center border border-line">
          <div className="text-muted">الوقت المسجل حالياً في العداد</div>
          <div className="mt-1 font-mono text-2xl font-bold text-fg">
            {currentPlayedMinutes} دقيقة ({f.minutes(currentPlayedMinutes)})
          </div>
        </div>

        <div>
          <label className="mb-1.5 block font-bold text-fg">زيادة سريعة (في حال بلشوا يلعبوا قبل):</label>
          <div className="grid grid-cols-5 gap-1.5">
            {[5, 10, 15, 20, 30].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPlayedMinutes((prev) => prev + m)}
                className="rounded border border-line bg-surface-2 py-2 text-center text-xs font-bold text-muted hover:border-accent hover:text-accent active:scale-95 transition-all shadow-xs"
              >
                +{m} د
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block font-bold text-fg">أو حدد إجمالي عدد الدقائق التي لعبوها بالضبط:</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={1440}
              value={playedMinutes}
              onChange={(e) => setPlayedMinutes(Math.max(0, parseInt(e.target.value) || 0))}
              className="h-11 font-mono text-center text-lg font-bold"
            />
            <span className="text-sm font-semibold text-muted">دقيقة</span>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface-1 p-2.5 text-[11px] text-muted flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span>الفرق عن الوقت السابق:</span>
            <span className={clsx('font-mono font-bold', delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-muted')}>
              {delta > 0 ? `+${delta} دقيقة` : delta < 0 ? `${delta} دقيقة` : 'بدون تغيير'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>وقت البدء الفعلي الجديد:</span>
            <span className="font-mono font-semibold text-fg">{f.time(simulatedStart)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" size="md" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={handleSubmit}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            حفظ وتعديل الوقت ✓
          </Button>
        </div>
      </div>
    </Modal>
  );
}

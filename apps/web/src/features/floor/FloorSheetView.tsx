import { parseMoney, type BillingContext } from '@lounge/core';
import { clsx } from 'clsx';
import {
  Banknote,
  BarChart3,
  Boxes,
  Check,
  ChevronDown,
  CircleCheck,
  Coffee,
  CreditCard,
  Edit2,
  FileSpreadsheet,
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
  Square,
  Timer,
  Trash2,
  User,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { TypeIcon } from '../../components/station/status';
import { Button } from '../../components/ui/button';
import { toastError, useAction } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/overlays';
import { Field, Input, Money, Num, Segmented } from '../../components/ui/primitives';
import { useT } from '../../i18n';
import { post } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useFmt } from '../../lib/format';
import { rateNow, type StationView } from '../../lib/live';
import { useProducts, useSessionBill } from '../../lib/queries';
import type { Floor, FloorSession, Product, Station } from '../../lib/types';
import { announceStock, useCart } from '../cafe/products';

interface FloorSheetViewProps {
  floor: Floor;
  ctx: BillingContext;
  now: number;
  views: StationView[];
  rateLabels: Map<string, string | null>;
  onOpenStation: (stationId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onCheckout: (sessionId: string) => void;
  onQuickStart: (station: Station, kind: 'open' | 'fixed', minutes?: number, mode?: string) => Promise<void>;
  onTogglePause: (view: StationView) => Promise<void>;
  onQuickCheckout: (sessionId: string) => Promise<void>;
  onChangeMode?: (sessionId: string, nextMode: string) => Promise<void>;
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
}: FloorSheetViewProps) {
  const { t } = useT();
  const f = useFmt();
  const role = useAuth((s) => s.user?.role);
  const canManage = can.manageSessions(role);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'free' | 'ending' | 'overtime'>('all');

  // Mode selection state per station (defaults to 'single' or station.modes[0])
  const [selectedModes, setSelectedModes] = useState<Record<string, string>>({});
  const [startModalStation, setStartModalStation] = useState<{ station: Station; defaultMode: string } | null>(null);

  // Modals state
  const [cafeSession, setCafeSession] = useState<{ session: FloorSession; stationName: string } | null>(null);
  const [paySession, setPaySession] = useState<{ session: FloorSession; stationName: string; due: number } | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<{ sessionId: string; currentPhone: string; currentName: string } | null>(null);

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
        const sName = v.station.name.toLowerCase();
        const cName = (v.session?.customer?.name ?? '').toLowerCase();
        const cPhone = (v.session?.customer?.phone ?? '').toLowerCase();
        const label = (v.session?.label ?? '').toLowerCase();
        if (!sName.includes(q) && !cName.includes(q) && !cPhone.includes(q) && !label.includes(q)) return false;
      }
      return true;
    });
  }, [views, statusFilter, search]);

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

      {/* Spreadsheet Table Container */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface-1 shadow-sm">
        <table className="w-full min-w-[1100px] border-collapse text-start text-xs">
          {/* Table Header with Column Letters (Google Sheets Style) */}
          <thead>
            {/* Letters Row */}
            <tr className="border-b border-line bg-surface-2/70 text-center font-mono text-[10px] text-faint select-none">
              <th className="w-10 border-e border-line p-1">A</th>
              <th className="w-48 border-e border-line p-1">B</th>
              <th className="w-28 border-e border-line p-1">C</th>
              <th className="w-40 border-e border-line p-1">D</th>
              <th className="w-44 border-e border-line p-1">E</th>
              <th className="w-28 border-e border-line p-1">F</th>
              <th className="w-48 border-e border-line p-1">G</th>
              <th className="w-32 border-e border-line p-1">H</th>
              <th className="w-32 border-e border-line p-1">I</th>
              <th className="w-36 border-e border-line p-1 bg-accent/5 font-semibold text-accent">J [تلقائي]</th>
              <th className="w-44 border-e border-line p-1">K</th>
              <th className="w-24 p-1">L</th>
            </tr>
            {/* Arabic Descriptive Header */}
            <tr className="border-b-2 border-line-strong bg-surface-2 text-muted font-semibold text-[12px]">
              <th className="border-e border-line px-2 py-2.5 text-center">#</th>
              <th className="border-e border-line px-3 py-2.5 text-start">الجهاز / الطاولة</th>
              <th className="border-e border-line px-3 py-2.5 text-center">الحالة</th>
              <th className="border-e border-line px-3 py-2.5 text-start">العميل / الحساب</th>
              <th className="border-e border-line px-3 py-2.5 text-center bg-emerald-500/5 text-emerald-700 dark:text-emerald-400">
                بدء اللعب ⏱️
              </th>
              <th className="border-e border-line px-3 py-2.5 text-center bg-rose-500/5 text-rose-700 dark:text-rose-400">
                إنهاء اللعب ⏹️
              </th>
              <th className="border-e border-line px-3 py-2.5 text-start bg-amber-500/5 text-amber-700 dark:text-amber-400">
                كافيتريا وطلبات 🥤🍟
              </th>
              <th className="border-e border-line px-3 py-2.5 text-end font-mono">حساب اللعب</th>
              <th className="border-e border-line px-3 py-2.5 text-end font-mono">حساب الكافيتريا</th>
              <th className="border-e border-line px-3 py-2.5 text-end font-mono bg-accent/10 text-accent font-bold">
                المجموع الكلي 💰
              </th>
              <th className="border-e border-line px-3 py-2.5 text-start">قديه حاسبه / التحصيل</th>
              <th className="px-3 py-2.5 text-center">إجراءات</th>
            </tr>
          </thead>

          {/* Table Body (Spreadsheet Rows) */}
          <tbody className="divide-y divide-line">
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
                const paid = session?.paid ?? 0;
                const due = Math.max(0, totalCost - paid);

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
                    <td className="border-e border-line px-2 py-2.5 text-center font-mono text-[11px] text-faint">
                      {idx + 1}
                    </td>

                    {/* Column B: Station Name & Info */}
                    <td className="border-e border-line px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TypeIcon type={s.type} className="size-4 shrink-0 text-muted" />
                        <div>
                          <div className="flex items-center gap-1.5 font-bold text-fg">
                            <span>{s.name}</span>
                            {s.tier === 'vip' && (
                              <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                VIP
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted">
                            {s.zone ? <span>{s.zone} · </span> : null}
                            <span className="font-mono text-[10px] text-faint">{rateStr}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column C: Status Badge */}
                    <td className="border-e border-line px-2 py-2 text-center">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
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
                    <td className="border-e border-line px-3 py-2">
                      {session?.customer ? (
                        <div className="flex items-center justify-between gap-1">
                          <div>
                            <div className="font-medium text-fg">{session.customer.name || 'عميل'}</div>
                            <div className="font-mono text-[10px] text-muted">+{session.customer.phone}</div>
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
                          className="flex items-center gap-1 text-[11px] text-muted hover:text-accent"
                        >
                          <User className="size-3" />
                          <span>{session.label ? session.label : '+ إضافة اسم/رقم'}</span>
                        </button>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>

                    {/* Column E: Start Cell (بدء اللعب مع خيار فردي / زوجي) */}
                    <td className="border-e border-line px-2 py-1.5 text-center bg-emerald-500/5">
                      {isRunning ? (
                        <div className="flex flex-col items-center justify-center gap-1">
                          {/* Current Mode Badge + Quick 1-click Switch */}
                          <div className="flex items-center gap-1">
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold text-white shadow-xs',
                                currentSessionMode === 'multi' ? 'bg-purple-600' : 'bg-blue-600',
                              )}
                            >
                              {currentSessionMode === 'multi' ? <Users className="size-3" /> : <User className="size-3" />}
                              <span>{currentSessionMode === 'multi' ? 'زوجي' : 'فردي'}</span>
                            </span>

                            {canManage && onChangeMode && s.modes.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = currentSessionMode === 'multi' ? 'single' : 'multi';
                                  onChangeMode(session.id, next);
                                }}
                                className="rounded border border-line bg-surface-2 px-1 py-0.5 text-[9px] font-semibold text-muted hover:border-accent hover:text-accent transition-colors flex items-center gap-0.5"
                                title={`تبديل اللعب الآن إلى ${currentSessionMode === 'multi' ? 'فردي' : 'زوجي'}`}
                              >
                                <Repeat className="size-2.5" />
                                <span>{currentSessionMode === 'multi' ? 'لفردي' : 'لزوجي'}</span>
                              </button>
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
                          </div>
                          <span className="text-[10px] text-muted">بدء: {f.time(session.startedAt)}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1.5 py-0.5">
                          {/* Mode Choice: فردي / زوجي */}
                          {s.modes.length > 1 && (
                            <div className="flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-[10px] shadow-xs">
                              <button
                                type="button"
                                onClick={() => setSelectedModes((prev) => ({ ...prev, [s.id]: 'single' }))}
                                className={clsx(
                                  'flex items-center gap-0.5 rounded px-2 py-0.5 font-bold transition-all',
                                  selectedMode === 'single'
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'text-muted hover:text-fg hover:bg-surface-3',
                                )}
                                title={singleRateQuote ? `سعر الساعة: ${f.rate(singleRateQuote.perHour)}` : 'فردي'}
                              >
                                <User className="size-2.5" />
                                <span>فردي</span>
                                {singleRateQuote && <span className="font-mono text-[9px] opacity-80 font-normal">({f.rate(singleRateQuote.perHour)})</span>}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedModes((prev) => ({ ...prev, [s.id]: 'multi' }))}
                                className={clsx(
                                  'flex items-center gap-0.5 rounded px-2 py-0.5 font-bold transition-all',
                                  selectedMode === 'multi'
                                    ? 'bg-purple-600 text-white shadow-xs'
                                    : 'text-muted hover:text-fg hover:bg-surface-3',
                                )}
                                title={multiRateQuote ? `سعر الساعة: ${f.rate(multiRateQuote.perHour)}` : 'زوجي'}
                              >
                                <Users className="size-2.5" />
                                <span>زوجي</span>
                                {multiRateQuote && <span className="font-mono text-[9px] opacity-80 font-normal">({f.rate(multiRateQuote.perHour)})</span>}
                              </button>
                            </div>
                          )}

                          {/* Quick Start Buttons */}
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => onQuickStart(s, 'open', undefined, selectedMode)}
                              className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition-all"
                              title={`بدء وقت مفتوح (${selectedMode === 'multi' ? 'زوجي' : 'فردي'})`}
                            >
                              <Play className="size-3 fill-current" />
                              <span>بدء مفتوح</span>
                            </button>
                            <button
                              onClick={() => onQuickStart(s, 'fixed', 60, selectedMode)}
                              className="inline-flex h-7 items-center rounded border border-emerald-600/30 bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
                              title={`تشغيل 1 ساعة (${selectedMode === 'multi' ? 'زوجي' : 'فردي'})`}
                            >
                              1 س
                            </button>
                            <button
                              onClick={() => onQuickStart(s, 'fixed', 120, selectedMode)}
                              className="inline-flex h-7 items-center rounded border border-emerald-600/30 bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
                              title={`تشغيل ساعتين (${selectedMode === 'multi' ? 'زوجي' : 'فردي'})`}
                            >
                              2 س
                            </button>
                            <button
                              onClick={() => setStartModalStation({ station: s, defaultMode: selectedMode })}
                              className="inline-flex h-7 items-center rounded border border-line bg-surface-2 px-1 text-[10px] font-bold text-muted hover:text-fg hover:border-accent"
                              title="بدء مخصص..."
                            >
                              ...
                            </button>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Column F: End Cell (إنهاء اللعب) */}
                    <td className="border-e border-line px-2 py-1.5 text-center bg-rose-500/5">
                      {isRunning ? (
                        <button
                          onClick={() => onQuickCheckout(session.id)}
                          className="inline-flex h-7 items-center gap-1 rounded bg-rose-600 px-3 text-[11px] font-bold text-white shadow-sm hover:bg-rose-700 active:scale-95 transition-all"
                          title="إنهاء الجلسة وحساب الوقت"
                        >
                          <Square className="size-3 fill-current" />
                          <span>إنهاء ⏹️</span>
                        </button>
                      ) : isEnded ? (
                        <div className="flex flex-col items-center text-[10px] text-muted">
                          <span className="font-semibold text-rose-600">منتهي</span>
                          <span>{session.endedAt ? f.time(session.endedAt) : ''}</span>
                        </div>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>

                    {/* Column G: Cafeteria (كافيتريا كبسة بقدر يختار) */}
                    <td className="border-e border-line px-2 py-1.5 bg-amber-500/5">
                      {hasSession ? (
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            onClick={() => setCafeSession({ session, stationName: s.name })}
                            className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/15 px-2 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-500/25 active:scale-95 transition-all"
                            title="فتح قائمة الكافيتريا لاختيار الطلبات"
                          >
                            <Coffee className="size-3.5 text-amber-600" />
                            <span>كافيتريا</span>
                            <Plus className="size-3" />
                          </button>

                          {session.itemsCount > 0 && (
                            <span
                              onClick={() => setCafeSession({ session, stationName: s.name })}
                              className="cursor-pointer rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline"
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
                          className="inline-flex h-7 w-full items-center justify-center gap-1 rounded border border-dashed border-line text-[11px] text-faint hover:text-muted"
                        >
                          <Coffee className="size-3 opacity-40" />
                          <span>كافيتريا</span>
                        </button>
                      )}
                    </td>

                    {/* Column H: Play Cost (حساب اللعب) */}
                    <td className="border-e border-line px-3 py-2 text-end font-mono font-semibold">
                      {hasSession ? <Money value={playCost} /> : <span className="text-faint">0.00</span>}
                    </td>

                    {/* Column I: Cafeteria Cost (حساب الكافيتريا) */}
                    <td className="border-e border-line px-3 py-2 text-end font-mono font-semibold text-amber-700 dark:text-amber-400">
                      {hasSession && cafeCost > 0 ? <Money value={cafeCost} /> : <span className="text-faint">0.00</span>}
                    </td>

                    {/* Column J: Total Bill (المجموع الكلي - يحسب لحاله) */}
                    <td className="border-e border-line px-3 py-2 text-end font-mono font-bold text-sm bg-accent/10 text-accent">
                      {hasSession ? <Money value={totalCost} /> : <span className="text-faint">0.00</span>}
                    </td>

                    {/* Column K: Paid & Accounting (قديه حاسبه) */}
                    <td className="border-e border-line px-2 py-1.5">
                      {hasSession ? (
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex flex-col text-[11px]">
                            <span className="text-muted">
                              المدفوع: <Money value={paid} className="font-semibold text-fg" />
                            </span>
                            {due > 0 ? (
                              <span className="font-semibold text-rose-600 dark:text-rose-400">
                                المتبقي: <Money value={due} />
                              </span>
                            ) : (
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                                <Check className="size-3" /> تم الدفع
                              </span>
                            )}
                          </div>

                          {due > 0 && (
                            <button
                              onClick={() => setPaySession({ session, stationName: s.name, due })}
                              className="inline-flex h-7 items-center gap-1 rounded bg-surface-2 border border-line px-2 text-[10px] font-bold text-fg hover:border-accent hover:text-accent active:scale-95 transition-all shadow-sm"
                              title="تسجيل دفعة نقدية أو فيزا"
                            >
                              <Banknote className="size-3" />
                              <span>دفع</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>

                    {/* Column L: Actions */}
                    <td className="px-2 py-1.5 text-center">
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
              <td className="border-e border-line px-2 py-3 text-center font-mono">Σ</td>
              <td className="border-e border-line px-3 py-3 text-start">
                <span>المجموع الكلي ({totals.totalStations} أجهزة)</span>
              </td>
              <td className="border-e border-line px-2 py-3 text-center text-muted">
                <span>{totals.activeCount} شغال · {totals.freeCount} متاح</span>
              </td>
              <td className="border-e border-line px-3 py-3 text-muted">-</td>
              <td className="border-e border-line px-2 py-3 text-center text-emerald-600">-</td>
              <td className="border-e border-line px-2 py-3 text-center text-rose-600">-</td>
              <td className="border-e border-line px-2 py-3 text-start text-amber-600">-</td>
              <td className="border-e border-line px-3 py-3 text-end font-mono">
                <Money value={totals.playTotal} />
              </td>
              <td className="border-e border-line px-3 py-3 text-end font-mono text-amber-700 dark:text-amber-400">
                <Money value={totals.cafeTotal} />
              </td>
              <td className="border-e border-line px-3 py-3 text-end font-mono text-sm bg-accent/15 text-accent">
                <Money value={totals.grandTotal} />
              </td>
              <td className="border-e border-line px-3 py-3">
                <div className="flex flex-col text-[11px]">
                  <span>المقبوض: <Money value={totals.paidTotal} /></span>
                  <span className="text-rose-600 dark:text-rose-400">المتبقي: <Money value={totals.dueTotal} /></span>
                </div>
              </td>
              <td className="px-2 py-3 text-center text-faint">✓</td>
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

      {/* Quick Pay Dialog */}
      {paySession && (
        <QuickPayDialog
          sessionId={paySession.session.id}
          stationName={paySession.stationName}
          suggestedDue={paySession.due}
          hasOpenShift={!!floor.shift}
          onClose={() => setPaySession(null)}
          onCheckout={() => {
            const sid = paySession.session.id;
            setPaySession(null);
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

      {/* Quick Start Modal (Choose Single vs Multi, Open vs Fixed) */}
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
 * Quick Pay Dialog: Collect cash or card immediately
 */
function QuickPayDialog({
  sessionId,
  stationName,
  suggestedDue,
  hasOpenShift,
  onClose,
  onCheckout,
}: {
  sessionId: string;
  stationName: string;
  suggestedDue: number;
  hasOpenShift: boolean;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const { t } = useT();
  const f = useFmt();
  const { busy, run } = useAction();
  const [amountStr, setAmountStr] = useState('');
  const [method, setMethod] = useState<'cash' | 'card'>('cash');

  const minor = amountStr === '' ? suggestedDue : parseMoney(amountStr, f.decimals);

  const handleSubmitPay = async () => {
    if (!minor || minor <= 0) return;
    const ok = await run(
      () => post(`/api/sessions/${sessionId}/payments`, { amount: minor, method }),
      { success: `تم تسجيل دفعة بقيمة ${f.money(minor)} لجهاز ${stationName} ✓` },
    );
    if (ok) {
      onClose();
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`تحصيل حساب: ${stationName}`} size="sm">
      <div className="flex flex-col gap-4 font-sans text-xs">
        {!hasOpenShift && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-800 dark:text-amber-300">
            ⚠️ <strong>تنبيه: الوردية مغلقة!</strong> يجب فتح الوردية أولاً من زر الصندوق أعلى الشاشة لتسجيل المقبوضات في الصندوق وحفظ الجرد اليومي.
          </div>
        )}

        <div className="rounded-lg bg-surface-2 p-3 text-center border border-line">
          <div className="text-muted">المبلغ المتبقي المطلوب</div>
          <div className="mt-1 font-mono text-2xl font-bold text-accent">
            <Money value={suggestedDue} />
          </div>
        </div>

        <Field label="المبلغ المدفوع الآن" htmlFor="sheet-pay-amount">
          <Input
            id="sheet-pay-amount"
            autoFocus
            inputMode="decimal"
            className="h-12 text-center text-xl font-mono font-bold"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder={f.money(suggestedDue)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitPay()}
          />
        </Field>

        <Segmented
          size="md"
          value={method}
          onChange={setMethod}
          options={[
            {
              value: 'cash',
              label: (
                <span className="flex items-center gap-1.5">
                  <Banknote className="size-4" /> كاش
                </span>
              ),
            },
            {
              value: 'card',
              label: (
                <span className="flex items-center gap-1.5">
                  <CreditCard className="size-4" /> فيزا / كليك
                </span>
              ),
            },
          ]}
        />

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!hasOpenShift || !minor || minor <= 0}
            onClick={handleSubmitPay}
            block
          >
            {hasOpenShift ? (
              <>تأكيد استلام المبلغ (<Money value={minor || 0} />) ✓</>
            ) : (
              'يجب فتح الوردية أولاً'
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCheckout} block className="text-muted text-[11px]">
            فتح شاشة المحاسبة والطباعة الكاملة...
          </Button>
        </div>
      </div>
    </Modal>
  );
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
 * Quick Start Modal: choose Single vs Multi, Open or Fixed Duration, customer note
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
  onStart: (station: Station, kind: 'open' | 'fixed', minutes?: number, mode?: string) => Promise<void>;
}) {
  const f = useFmt();
  const [mode, setMode] = useState(defaultMode);
  const [kind, setKind] = useState<'open' | 'fixed'>('open');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);

  const quote = rateNow(ctx, station, mode, now);

  const handleStart = async () => {
    setBusy(true);
    try {
      await onStart(station, kind, kind === 'fixed' ? minutes : undefined, mode);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`تشغيل جهاز: ${station.name}`} size="sm">
      <div className="flex flex-col gap-4 font-sans text-xs">
        {/* Mode Selector */}
        <div>
          <label className="mb-1.5 block font-bold text-fg">اختر نوع اللعب:</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={clsx(
                'flex flex-col items-center justify-center rounded-lg border p-3 transition-all',
                mode === 'single'
                  ? 'border-blue-600 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/20 shadow-xs'
                  : 'border-line bg-surface-2 text-muted hover:border-line-strong',
              )}
            >
              <User className="size-5 mb-1" />
              <span className="text-sm font-bold">فردي (Single)</span>
              {station.modes.includes('single') && (
                <span className="font-mono text-xs opacity-80">
                  {rateNow(ctx, station, 'single', now) ? f.rate(rateNow(ctx, station, 'single', now)!.perHour) : ''}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMode('multi')}
              className={clsx(
                'flex flex-col items-center justify-center rounded-lg border p-3 transition-all',
                mode === 'multi'
                  ? 'border-purple-600 bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500/20 shadow-xs'
                  : 'border-line bg-surface-2 text-muted hover:border-line-strong',
              )}
            >
              <Users className="size-5 mb-1" />
              <span className="text-sm font-bold">زوجي (Multi)</span>
              {station.modes.includes('multi') && (
                <span className="font-mono text-xs opacity-80">
                  {rateNow(ctx, station, 'multi', now) ? f.rate(rateNow(ctx, station, 'multi', now)!.perHour) : ''}
                </span>
              )}
            </button>
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

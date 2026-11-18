import { parseMoney } from '@lounge/core';
import { clsx } from 'clsx';
import { Package, Pencil, Plus, Tag, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useAction } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/overlays';
import { Card, Field, Input, Money, Num, Segmented, Switch } from '../../components/ui/primitives';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { useFmt } from '../../lib/format';
import type { SettingsBundle } from '../../lib/queries';
import type { RawPackage, RawRule, Station } from '../../lib/types';
import { ChipGroup } from './CatalogTabs';

interface RuleForm {
  name: string;
  priority: number;
  active: boolean;
  kind: 'rate' | 'percent';
  /** Always a positive number in the form; the direction says discount or increase. */
  value: string;
  direction: 'down' | 'up';
  stationTypes: string[];
  tiers: string[];
  modes: string[];
  daysOfWeek: number[];
  timeFrom: string;
  timeTo: string;
}

const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export function PricingTab({ data }: { data: SettingsBundle }) {
  const { t, tk, lang } = useT();
  const f = useFmt();
  const { busy, run } = useAction();
  const [rule, setRule] = useState<{ id: string | null; form: RuleForm } | null>(null);
  const [pkg, setPkg] = useState<{ id: string | null; form: { name: string; minutes: number; price: string; active: boolean; stationTypes: string[]; tiers: string[]; modes: string[] } } | null>(null);
  const [stationModal, setStationModal] = useState<{ station: Station; single: string; multi: string; singleRuleId: string | null; multiRuleId: string | null } | null>(null);

  const getStationRates = (station: Station) => {
    let single: number | null = null;
    let multi: number | null = null;
    let singleRuleId: string | null = null;
    let multiRuleId: string | null = null;

    for (const r of data.rules) {
      if (!r.active || (r.effect as { kind: string }).kind !== 'rate') continue;
      const m = r.match as { stationIds?: string[]; modes?: string[] };
      if (m.stationIds?.includes(station.id)) {
        if (m.modes?.includes('single')) {
          single = (r.effect as { perHour?: number }).perHour ?? null;
          singleRuleId = r.id;
        }
        if (m.modes?.includes('multi')) {
          multi = (r.effect as { perHour?: number }).perHour ?? null;
          multiRuleId = r.id;
        }
      }
    }
    // Fallback to tier/type default
    if (single == null) {
      for (const r of data.rules) {
        if (!r.active || (r.effect as { kind: string }).kind !== 'rate') continue;
        const m = r.match as { stationIds?: string[]; modes?: string[]; tiers?: string[]; stationTypes?: string[] };
        if (m.stationIds?.length) continue;
        const tierMatch = !m.tiers?.length || m.tiers.includes(station.tier);
        const typeMatch = !m.stationTypes?.length || m.stationTypes.includes(station.type);
        const modeMatch = !m.modes?.length || m.modes.includes('single');
        if (tierMatch && typeMatch && modeMatch && (r.effect as { perHour?: number }).perHour != null) {
          single = (r.effect as { perHour?: number }).perHour!;
          break;
        }
      }
    }
    if (multi == null) {
      for (const r of data.rules) {
        if (!r.active || (r.effect as { kind: string }).kind !== 'rate') continue;
        const m = r.match as { stationIds?: string[]; modes?: string[]; tiers?: string[]; stationTypes?: string[] };
        if (m.stationIds?.length) continue;
        const tierMatch = !m.tiers?.length || m.tiers.includes(station.tier);
        const typeMatch = !m.stationTypes?.length || m.stationTypes.includes(station.type);
        const modeMatch = !m.modes?.length || m.modes.includes('multi');
        if (tierMatch && typeMatch && modeMatch && (r.effect as { perHour?: number }).perHour != null) {
          multi = (r.effect as { perHour?: number }).perHour!;
          break;
        }
      }
    }
    return { single, multi, singleRuleId, multiRuleId };
  };

  const openStationPricing = (s: Station) => {
    const rates = getStationRates(s);
    setStationModal({
      station: s,
      single: rates.single != null ? String(f.toMajor(rates.single)) : '',
      multi: rates.multi != null ? String(f.toMajor(rates.multi)) : '',
      singleRuleId: rates.singleRuleId,
      multiRuleId: rates.multiRuleId,
    });
  };

  const saveStationPricing = async () => {
    if (!stationModal) return;
    const ok = await run(async () => {
      const stationId = stationModal.station.id;
      if (stationModal.single.trim()) {
        const perHour = parseMoney(stationModal.single, f.decimals);
        if (perHour != null && perHour >= 0) {
          const ruleBody = {
            name: `${stationModal.station.name} - فردي`,
            priority: 10,
            active: true,
            match: { stationIds: [stationId], modes: ['single'] },
            effect: { kind: 'rate', perHour },
          };
          if (stationModal.singleRuleId) {
            await api('PUT', `/api/settings/rules/${stationModal.singleRuleId}`, ruleBody);
          } else {
            await api('POST', `/api/settings/rules`, ruleBody);
          }
        }
      }
      if (stationModal.multi.trim()) {
        const perHour = parseMoney(stationModal.multi, f.decimals);
        if (perHour != null && perHour >= 0) {
          const ruleBody = {
            name: `${stationModal.station.name} - زوجي`,
            priority: 10,
            active: true,
            match: { stationIds: [stationId], modes: ['multi'] },
            effect: { kind: 'rate', perHour },
          };
          if (stationModal.multiRuleId) {
            await api('PUT', `/api/settings/rules/${stationModal.multiRuleId}`, ruleBody);
          } else {
            await api('POST', `/api/settings/rules`, ruleBody);
          }
        }
      }
    }, { success: t('common.saved') });
    if (ok) setStationModal(null);
  };

  const types = [...new Set(data.stations.map((s) => s.type))];
  const typeOpts = types.map((x) => ({ value: x, label: tk('types', x) }));
  const tierOpts = ['regular', 'vip', 'big'].map((x) => ({ value: x, label: tk('tiers', x) }));
  const modeOpts = [...new Set(data.stations.flatMap((s) => s.modes))].map((x) => ({ value: x, label: tk('modes', x) }));
  const dayOrder = lang === 'ar' ? [6, 7, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7];
  const dayOpts = dayOrder.map((d) => ({ value: String(d), label: t(`weekdays.${d}`) }));

  const summary = (r: RawRule) => {
    const m = r.match as Record<string, unknown>;
    const parts: string[] = [];
    const scope = [...arr(m.stationTypes).map((x) => tk('types', x)), ...arr(m.tiers).map((x) => tk('tiers', x)), ...arr(m.modes).map((x) => tk('modes', x))];
    parts.push(scope.length ? scope.join(' · ') : t('settings.rule.summaryAll'));
    const days = (Array.isArray(m.daysOfWeek) ? (m.daysOfWeek as number[]) : []).map((d) => t(`weekdays.${d}`));
    if (days.length && days.length < 7) parts.push(days.join('، '));
    return (
      <>
        {parts.join(' — ')}
        {(m.timeFrom || m.timeTo) && (
          <>
            {' — '}
            {/* Time ranges are isolated LTR so "12:00–16:00" never flips inside Arabic text. */}
            <Num>
              {String(m.timeFrom ?? '00:00')}–{String(m.timeTo ?? '24:00')}
            </Num>
          </>
        )}
      </>
    );
  };
  const effectLabel = (r: RawRule) => {
    const e = r.effect as { kind: string; perHour?: number; percent?: number };
    return e.kind === 'rate' ? (
      <span>
        <Money value={e.perHour ?? 0} /> <span className="text-xs font-normal text-muted">{t('common.perHour')}</span>
      </span>
    ) : (
      // Words, not signs: "خصم 20%" / "زيادة 25%".
      <span className={(e.percent ?? 0) < 0 ? 'text-st-free' : 'text-st-ending'}>
        {(e.percent ?? 0) < 0 ? t('settings.rule.discount') : t('settings.rule.increase')} <Num>{`${Math.abs(e.percent ?? 0)}%`}</Num>
      </span>
    );
  };

  const openRule = (r: RawRule | null) => {
    const m = (r?.match ?? {}) as Record<string, unknown>;
    const e = (r?.effect ?? { kind: 'rate', perHour: 0 }) as { kind: 'rate' | 'percent'; perHour?: number; percent?: number };
    setRule({
      id: r?.id ?? null,
      form: {
        name: r?.name ?? '',
        priority: r?.priority ?? 0,
        active: r?.active ?? true,
        kind: e.kind,
        value: e.kind === 'rate' ? (r ? String(f.toMajor(e.perHour ?? 0)) : '') : String(Math.abs(e.percent ?? 0) || ''),
        direction: e.kind === 'percent' && (e.percent ?? 0) > 0 ? 'up' : 'down',
        stationTypes: arr(m.stationTypes),
        tiers: arr(m.tiers),
        modes: arr(m.modes),
        daysOfWeek: Array.isArray(m.daysOfWeek) ? (m.daysOfWeek as number[]) : [],
        timeFrom: (m.timeFrom as string) ?? '',
        timeTo: (m.timeTo as string) ?? '',
      },
    });
  };

  const ruleValue = rule
    ? rule.form.kind === 'rate'
      ? parseMoney(rule.form.value || '', f.decimals)
      : rule.form.value !== '' && Number(rule.form.value) > 0 && Number(rule.form.value) <= 100
        ? (rule.form.direction === 'down' ? -1 : 1) * Number(rule.form.value)
        : null
    : null;

  const saveRule = async () => {
    if (!rule || ruleValue == null) return;
    const fm = rule.form;
    const body = {
      name: fm.name.trim(),
      priority: fm.priority,
      active: fm.active,
      effect: fm.kind === 'rate' ? { kind: 'rate', perHour: ruleValue } : { kind: 'percent', percent: ruleValue },
      match: {
        stationTypes: fm.stationTypes.length ? fm.stationTypes : null,
        tiers: fm.tiers.length ? fm.tiers : null,
        modes: fm.modes.length ? fm.modes : null,
        daysOfWeek: fm.daysOfWeek.length ? fm.daysOfWeek : null,
        timeFrom: fm.timeFrom || null,
        timeTo: fm.timeTo || null,
      },
    };
    const ok = await run(() => (rule.id ? api('PUT', `/api/settings/rules/${rule.id}`, body) : api('POST', '/api/settings/rules', body)), { success: t('common.saved') });
    if (ok) setRule(null);
  };

  const openPkg = (p: RawPackage | null) => {
    const m = (p?.match ?? {}) as Record<string, unknown>;
    setPkg({
      id: p?.id ?? null,
      form: {
        name: p?.name ?? '',
        minutes: p?.minutes ?? 180,
        price: p ? String(f.toMajor(p.price)) : '',
        active: p?.active ?? true,
        stationTypes: arr(m.stationTypes),
        tiers: arr(m.tiers),
        modes: arr(m.modes),
      },
    });
  };
  const pkgPrice = pkg ? parseMoney(pkg.form.price || '', f.decimals) : null;
  const savePkg = async () => {
    if (!pkg || pkgPrice == null) return;
    const fm = pkg.form;
    const body = {
      name: fm.name.trim(),
      minutes: fm.minutes,
      price: pkgPrice,
      active: fm.active,
      match: { stationTypes: fm.stationTypes.length ? fm.stationTypes : null, tiers: fm.tiers.length ? fm.tiers : null, modes: fm.modes.length ? fm.modes : null },
    };
    const ok = await run(() => (pkg.id ? api('PUT', `/api/settings/packages/${pkg.id}`, body) : api('POST', '/api/settings/packages', body)), { success: t('common.saved') });
    if (ok) setPkg(null);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Direct Station Pricing Card */}
      <Card className="p-5">
        <div className="mb-3">
          <h3 className="font-semibold text-fg">🎮 تسعير الأجهزة المباشر (سعر الساعة فردي وزوجي)</h3>
          <p className="text-xs text-muted">اضغط على أي جهاز لتحديد سعر ساعة الفردي والزوجي له مباشرة وبشكل مخصص:</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.stations.map((s) => {
            const rates = getStationRates(s);
            return (
              <div key={s.id} className="flex items-center justify-between rounded-card border border-line bg-surface-2 p-3 hover:border-line-strong">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-fg">{s.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 font-bold text-accent">
                      فردي: {rates.single != null ? f.moneyC(rates.single) : '—'}
                    </span>
                    <span className="rounded bg-st-active/10 px-1.5 py-0.5 font-bold text-st-active">
                      زوجي: {rates.multi != null ? f.moneyC(rates.multi) : '—'}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openStationPricing(s)}
                  className="text-xs font-bold text-accent hover:bg-accent/10"
                >
                  <Pencil className="size-3.5 me-1" /> تحديد السعر
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">{t('settings.pricing')}</h3>
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => openRule(null)}>
            {t('settings.rule.add')}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {[...data.rules]
            .sort((a, b) => b.priority - a.priority)
            .map((r) => (
              <button key={r.id} onClick={() => openRule(r)} className={clsx('flex items-center gap-3 rounded-card border border-line bg-surface-2 p-3.5 text-start hover:border-line-strong', !r.active && 'opacity-50')}>
                <Tag className={clsx('size-5 shrink-0', (r.effect as { kind: string }).kind === 'percent' ? 'text-st-paused' : 'text-accent')} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted">{summary(r)}</div>
                </div>
                <span className="shrink-0 font-semibold">{effectLabel(r)}</span>
                <Pencil className="size-4 shrink-0 text-faint" />
              </button>
            ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">{t('start.packages')}</h3>
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => openPkg(null)}>
            {t('settings.pkg.add')}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.packages.map((p) => (
            <button key={p.id} onClick={() => openPkg(p)} className={clsx('flex items-center gap-3 rounded-card border border-line bg-surface-2 p-3.5 text-start hover:border-line-strong', !p.active && 'opacity-50')}>
              <Package className="size-5 text-st-free" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted">{f.minutes(p.minutes)}</div>
              </div>
              <Money value={p.price} className="font-semibold" />
            </button>
          ))}
        </div>
      </Card>

      {rule && (
        <Modal
          open
          onOpenChange={(o) => !o && setRule(null)}
          title={rule.id ? rule.form.name : t('settings.rule.add')}
          size="lg"
          footer={
            <Button variant="primary" loading={busy} disabled={!rule.form.name.trim() || ruleValue == null} onClick={saveRule}>
              {t('common.save')}
            </Button>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {rule.id && <p className="rounded-control bg-surface-2 px-3 py-2 text-xs text-muted sm:col-span-2">{t('settings.rule.fromNow')}</p>}
            <Field label={t('settings.rule.name')} htmlFor="rule-name" className="sm:col-span-2">
              <Input id="rule-name" value={rule.form.name} onChange={(e) => setRule({ ...rule, form: { ...rule.form, name: e.target.value } })} />
            </Field>
            <Field label="" className="sm:col-span-2">
              <Segmented
                value={rule.form.kind}
                onChange={(kind) => setRule({ ...rule, form: { ...rule.form, kind, value: '' } })}
                options={[
                  { value: 'rate', label: t('settings.rule.kindRate') },
                  { value: 'percent', label: t('settings.rule.kindPercent') },
                ]}
              />
            </Field>
            {rule.form.kind === 'percent' && (
              <Field label="" className="sm:col-span-2">
                <Segmented
                  value={rule.form.direction}
                  onChange={(direction) => setRule({ ...rule, form: { ...rule.form, direction } })}
                  options={[
                    { value: 'down', label: <span className="flex items-center gap-1.5 text-st-free"><TrendingDown className="size-4" /> {t('settings.rule.discount')}</span> },
                    { value: 'up', label: <span className="flex items-center gap-1.5 text-st-ending"><TrendingUp className="size-4" /> {t('settings.rule.increase')}</span> },
                  ]}
                />
              </Field>
            )}
            <Field label={rule.form.kind === 'rate' ? t('settings.rule.perHour') : t('settings.rule.percent')} htmlFor="rule-value">
              <Input
                id="rule-value"
                inputMode="decimal"
                className="num"
                value={rule.form.value}
                onChange={(e) => setRule({ ...rule, form: { ...rule.form, value: rule.form.kind === 'percent' ? e.target.value.replace(/[^\d]/g, '') : e.target.value } })}
              />
            </Field>
            <Field label={t('settings.rule.priority')} hint={t('settings.rule.priorityHint')} htmlFor="rule-prio">
              <Input id="rule-prio" inputMode="numeric" className="num" value={rule.form.priority} onChange={(e) => setRule({ ...rule, form: { ...rule.form, priority: Number(e.target.value.replace(/[^\d-]/g, '')) || 0 } })} />
            </Field>
            <Field label={`${t('settings.rule.appliesTo')} — ${t('settings.station.type')}`} hint={t('settings.rule.any')} className="sm:col-span-2">
              <ChipGroup options={typeOpts} value={rule.form.stationTypes} onChange={(v) => setRule({ ...rule, form: { ...rule.form, stationTypes: v } })} />
            </Field>
            <Field label={t('settings.station.tier')} className="sm:col-span-2">
              <ChipGroup options={tierOpts} value={rule.form.tiers} onChange={(v) => setRule({ ...rule, form: { ...rule.form, tiers: v } })} />
            </Field>
            <Field label={t('settings.station.modes')} className="sm:col-span-2">
              <ChipGroup options={modeOpts} value={rule.form.modes} onChange={(v) => setRule({ ...rule, form: { ...rule.form, modes: v } })} />
            </Field>
            <Field label={t('settings.rule.days')} className="sm:col-span-2">
              <ChipGroup
                options={dayOpts}
                value={rule.form.daysOfWeek.map(String)}
                onChange={(v) => setRule({ ...rule, form: { ...rule.form, daysOfWeek: v.map(Number) } })}
              />
            </Field>
            <Field label={t('settings.rule.from')} htmlFor="rule-from" hint={!rule.form.timeFrom && !rule.form.timeTo ? t('settings.rule.allDay') : undefined}>
              <Input id="rule-from" type="time" className="num" value={rule.form.timeFrom} onChange={(e) => setRule({ ...rule, form: { ...rule.form, timeFrom: e.target.value } })} />
            </Field>
            <Field label={t('settings.rule.to')} htmlFor="rule-to">
              <Input id="rule-to" type="time" className="num" value={rule.form.timeTo} onChange={(e) => setRule({ ...rule, form: { ...rule.form, timeTo: e.target.value } })} />
            </Field>
            <div className="sm:col-span-2">
              <Switch checked={rule.form.active} onChange={(v) => setRule({ ...rule, form: { ...rule.form, active: v } })} label={t('common.active')} />
            </div>
          </div>
        </Modal>
      )}

      {pkg && (
        <Modal
          open
          onOpenChange={(o) => !o && setPkg(null)}
          title={pkg.id ? pkg.form.name : t('settings.pkg.add')}
          footer={
            <Button variant="primary" loading={busy} disabled={!pkg.form.name.trim() || pkgPrice == null || pkg.form.minutes < 15} onClick={savePkg}>
              {t('common.save')}
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.pkg.name')} htmlFor="pkg-name" className="sm:col-span-2">
              <Input id="pkg-name" value={pkg.form.name} onChange={(e) => setPkg({ ...pkg, form: { ...pkg.form, name: e.target.value } })} />
            </Field>
            <Field label={t('settings.pkg.minutes')} htmlFor="pkg-min" hint={<Num>{f.minutes(pkg.form.minutes)}</Num>}>
              <Input id="pkg-min" inputMode="numeric" className="num" value={pkg.form.minutes} onChange={(e) => setPkg({ ...pkg, form: { ...pkg.form, minutes: Number(e.target.value.replace(/\D/g, '')) || 0 } })} />
            </Field>
            <Field label={t('settings.pkg.price')} htmlFor="pkg-price">
              <Input id="pkg-price" inputMode="decimal" className="num" value={pkg.form.price} onChange={(e) => setPkg({ ...pkg, form: { ...pkg.form, price: e.target.value } })} />
            </Field>
            <Field label={t('settings.station.type')} className="sm:col-span-2">
              <ChipGroup options={typeOpts} value={pkg.form.stationTypes} onChange={(v) => setPkg({ ...pkg, form: { ...pkg.form, stationTypes: v } })} />
            </Field>
            <Field label={t('settings.station.tier')} className="sm:col-span-2">
              <ChipGroup options={tierOpts} value={pkg.form.tiers} onChange={(v) => setPkg({ ...pkg, form: { ...pkg.form, tiers: v } })} />
            </Field>
            <Field label={t('settings.station.modes')} className="sm:col-span-2">
              <ChipGroup options={modeOpts} value={pkg.form.modes} onChange={(v) => setPkg({ ...pkg, form: { ...pkg.form, modes: v } })} />
            </Field>
            <div className="sm:col-span-2">
              <Switch checked={pkg.form.active} onChange={(v) => setPkg({ ...pkg, form: { ...pkg.form, active: v } })} label={t('common.active')} />
            </div>
          </div>
        </Modal>
      )}

      {stationModal && (
        <Modal
          open
          onOpenChange={(o) => !o && setStationModal(null)}
          title={`تسعير جهاز ${stationModal.station.name}`}
          footer={
            <Button variant="primary" size="lg" loading={busy} onClick={saveStationPricing}>
              {t('common.save')}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted">
              حدد سعر ساعة اللعب لهذا الجهاز لوضع اللعب الفردي ووضع اللعب الزوجي:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="سعر الساعة - فردي" htmlFor="sp-single">
                <div className="relative flex items-center">
                  <Input
                    id="sp-single"
                    dir="ltr"
                    className="num pe-12 font-bold text-accent"
                    placeholder="1.500"
                    value={stationModal.single}
                    onChange={(e) => setStationModal({ ...stationModal, single: e.target.value })}
                  />
                  <span className="pointer-events-none absolute end-3 text-xs text-muted">{f.currencyLabel}</span>
                </div>
              </Field>
              <Field label="سعر الساعة - زوجي" htmlFor="sp-multi">
                <div className="relative flex items-center">
                  <Input
                    id="sp-multi"
                    dir="ltr"
                    className="num pe-12 font-bold text-st-active"
                    placeholder="2.000"
                    value={stationModal.multi}
                    onChange={(e) => setStationModal({ ...stationModal, multi: e.target.value })}
                  />
                  <span className="pointer-events-none absolute end-3 text-xs text-muted">{f.currencyLabel}</span>
                </div>
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

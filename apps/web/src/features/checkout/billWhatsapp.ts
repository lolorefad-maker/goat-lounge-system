import { arabicDuration, whatsappUrl } from '@lounge/core';
import { translate } from '../../i18n';
import type { Fmt } from '../../lib/format';
import type { Bill } from '../../lib/types';

/**
 * A paid bill as a WhatsApp message for the customer. Like the reward message it is always in
 * Arabic (it is the customer's), whatever language the screen is in. Nothing is sent by the system:
 * the cashier opens the chat and presses send.
 */
export function billWhatsappText(bill: Bill, opts: { shop: string; f: Fmt }): string {
  const t = (k: string, v?: Record<string, string | number>) => translate('ar', k, v);
  const { f } = opts;
  const b = bill.breakdown;
  const lines: string[] = [t('billWa.title', { shop: opts.shop, n: bill.number })];

  const where = [b.stationName, b.label].filter(Boolean).join(' · ');
  if (where) lines.push(t('billWa.device', { name: where }));
  if (b.startedAt && b.endedAt) lines.push(t('billWa.fromTo', { from: f.time(b.startedAt), to: f.time(b.endedAt) }));

  if (b.time) {
    const played = Math.round(b.time.playedMs / 60_000);
    const billed = Math.round(b.time.billableMs / 60_000);
    const billedNote = billed !== played ? ` · ${t('billWa.billed', { d: arabicDuration(billed) })}` : '';
    lines.push(t('billWa.played', { d: arabicDuration(played) }) + billedNote);
    lines.push(t('billWa.play', { amount: f.money(b.time.total) }));
  }
  for (const i of b.items.filter((x) => !x.voided)) lines.push(`${i.qty}× ${i.name}: ${f.money(i.qty * i.unitPrice)}`);
  if (b.totals.discountAmount) lines.push(`${t('checkout.discount')}: -${f.money(b.totals.discountAmount)}`);
  if (b.totals.rounding) lines.push(`${t('checkout.rounding')}: ${f.money(b.totals.rounding)}`);

  lines.push(t('billWa.total', { amount: f.moneyC(b.totals.total) }));
  if (b.totals.paid) lines.push(`${t('checkout.prepaid')}: ${f.money(b.totals.paid)}`);
  for (const p of b.payments) lines.push(t('billWa.paid', { method: t(`checkout.${p.method}`), amount: f.money(p.amount) }));
  lines.push('', t('billWa.thanks'));
  return lines.join('\n');
}

export function billWhatsappUrl(phone: string, bill: Bill, opts: { shop: string; f: Fmt }): string {
  return whatsappUrl(phone, billWhatsappText(bill, opts));
}

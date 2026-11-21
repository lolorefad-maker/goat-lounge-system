import { describe, expect, it } from 'vitest';
import type { Fmt } from '../../lib/format';
import type { Bill } from '../../lib/types';
import { billWhatsappText, billWhatsappUrl } from './billWhatsapp';

const f = {
  money: (m: number) => (m / 1000).toFixed(3),
  moneyC: (m: number) => `${(m / 1000).toFixed(3)} د.أ`,
  time: (ms: number) => new Date(ms).toISOString().slice(11, 16),
} as unknown as Fmt;

const H = 3_600_000;
const bill = {
  id: 'b1',
  number: 42,
  businessDay: '2026-11-22',
  sessionId: 's1',
  timeCharge: 4000,
  itemsTotal: 1500,
  discountAmount: 0,
  discountReason: null,
  rounding: 0,
  total: 5500,
  status: 'paid',
  breakdown: {
    time: { playedMs: H + 5 * 60_000, billableMs: 2 * H, total: 4000 },
    items: [
      { qty: 2, name: 'بيبسي', unitPrice: 750, voided: false },
      { qty: 1, name: 'شيبس', unitPrice: 500, voided: true },
    ],
    totals: { subtotal: 5500, discountAmount: 0, rounding: 0, total: 5500, paid: 0, due: 5500 },
    payments: [{ method: 'cash', amount: 5500 }],
    stationName: 'PS-01',
    startedAt: Date.UTC(2026, 10, 22, 18, 0),
    endedAt: Date.UTC(2026, 10, 22, 19, 5),
  },
  createdAt: '2026-11-22T19:05:00Z',
} as unknown as Bill;

describe('billWhatsappText', () => {
  const text = billWhatsappText(bill, { shop: 'GOAT Gaming Center', f });

  it('lists the device, time, drinks, total and payment in Arabic', () => {
    expect(text).toContain('فاتورة GOAT Gaming Center رقم 42');
    expect(text).toContain('PS-01');
    expect(text).toContain('من 18:00 لـ 19:05');
    expect(text).toContain('وقت اللعب: ساعة و5 دقائق · المحسوب: ساعتين');
    expect(text).toContain('حساب اللعب: 4.000');
    expect(text).toContain('2× بيبسي: 1.500');
    expect(text).not.toContain('شيبس'); // voided
    expect(text).toContain('المجموع: 5.500 د.أ');
    expect(text).toContain('الدفع: كاش 5.500');
  });

  it('opens the customer number on wa.me with the text encoded', () => {
    const url = billWhatsappUrl('962791234567', bill, { shop: 'GOAT', f });
    expect(url.startsWith('https://wa.me/962791234567?text=')).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1]!)).toContain('رقم 42');
  });
});

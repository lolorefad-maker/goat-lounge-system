var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/index.ts
import { networkInterfaces } from "node:os";

// src/app.ts
import { timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";

// ../../node_modules/@lounge/core/src/errors.ts
var DomainError = class extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
};

// ../../node_modules/@lounge/core/src/money.ts
function roundToUnit(value, unit) {
  if (!unit || unit <= 1) return Math.round(value);
  return Math.round(value / unit) * unit;
}
function allocate(total, exact) {
  const out = exact.map((v) => Math.round(v));
  let diff = total - out.reduce((a, b) => a + b, 0);
  if (diff === 0 || out.length === 0) return out;
  const order = exact.map((v, i) => ({ i, err: v - (out[i] ?? 0) })).sort((a, b) => diff > 0 ? b.err - a.err : a.err - b.err);
  let k = 0;
  while (diff !== 0) {
    const idx = order[k % order.length].i;
    out[idx] = (out[idx] ?? 0) + Math.sign(diff);
    diff -= Math.sign(diff);
    k++;
  }
  return out;
}

// ../../node_modules/@lounge/core/src/pricing.ts
import { z } from "zod";

// ../../node_modules/@lounge/core/src/time.ts
import { DateTime } from "luxon";
var MINUTE = 6e4;
var HOUR = 36e5;
function parseHHmm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:mm`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || h === 24 && min !== 0) throw new Error(`Invalid time "${value}"`);
  return h * 60 + min;
}
function toLocal(t, tz) {
  return DateTime.fromMillis(t, { zone: tz });
}
function minutesOfDay(dt) {
  return dt.hour * 60 + dt.minute + dt.second / 60 + dt.millisecond / 6e4;
}
function atLocalMinutes(day, minutes) {
  const base = day.startOf("day");
  if (minutes >= 1440) return base.plus({ days: 1 });
  return base.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 });
}
function businessDayOf(t, tz, cutoff) {
  const dt = toLocal(t, tz);
  const shifted = minutesOfDay(dt) < parseHHmm(cutoff) ? dt.minus({ days: 1 }) : dt;
  return shifted.toISODate();
}
function businessDayRange(day, tz, cutoff) {
  const date = DateTime.fromISO(day, { zone: tz });
  if (!date.isValid) throw new Error(`Invalid business day "${day}"`);
  const cut = parseHHmm(cutoff);
  const start = atLocalMinutes(date, cut);
  const end = atLocalMinutes(date.plus({ days: 1 }), cut);
  return { start: start.toMillis(), end: end.toMillis() };
}

// ../../node_modules/@lounge/core/src/pricing.ts
var hhmm = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "HH:mm");
var isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
var ruleMatchSchema = z.object({
  stationIds: z.array(z.string()).nullish(),
  stationTypes: z.array(z.string()).nullish(),
  tiers: z.array(z.string()).nullish(),
  modes: z.array(z.string()).nullish(),
  /** ISO weekdays: 1 = Monday … 7 = Sunday. For windows crossing midnight, the day the window started. */
  daysOfWeek: z.array(z.number().int().min(1).max(7)).nullish(),
  /** Local time window [from, to). If to ≤ from the window crosses midnight. */
  timeFrom: hhmm.nullish(),
  timeTo: hhmm.nullish(),
  dateFrom: isoDate.nullish(),
  dateTo: isoDate.nullish(),
  /**
   * Validity in absolute time [startsAt, endsAt) (epoch ms). Set by the server: an edited price
   * ends the old version *now* and starts the new one *now*, so time already played keeps the
   * price it was played at. Also used by the owner's one-tap "discount now".
   */
  startsAt: z.number().int().nullish(),
  endsAt: z.number().int().nullish()
});
var ruleEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rate"), perHour: z.number().int().min(0) }),
  z.object({ kind: z.literal("percent"), percent: z.number().min(-100).max(500) })
]);
var pricingRuleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
  match: ruleMatchSchema.prefault({}),
  effect: ruleEffectSchema
});
var packageMatchSchema = z.object({
  stationTypes: z.array(z.string()).nullish(),
  tiers: z.array(z.string()).nullish(),
  modes: z.array(z.string()).nullish()
});
var pricePackageSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  minutes: z.number().int().min(1),
  price: z.number().int().min(0),
  active: z.boolean().default(true),
  match: packageMatchSchema.prefault({})
});
var inList = (list, v) => !list || list.length === 0 || list.includes(v);
function specificity(m) {
  let n = 0;
  if (m.stationIds?.length) n += 4;
  if (m.stationTypes?.length) n++;
  if (m.tiers?.length) n++;
  if (m.modes?.length) n++;
  if (m.daysOfWeek?.length) n++;
  if (m.timeFrom || m.timeTo) n++;
  if (m.dateFrom || m.dateTo) n++;
  return n;
}
function ruleAppliesAt(rule, station2, mode, t, tz) {
  const m = rule.match;
  if (!inList(m.stationIds, station2.id)) return false;
  if (!inList(m.stationTypes, station2.type)) return false;
  if (!inList(m.tiers, station2.tier)) return false;
  if (!inList(m.modes, mode)) return false;
  if (m.startsAt != null && t < m.startsAt) return false;
  if (m.endsAt != null && t >= m.endsAt) return false;
  const dt = toLocal(t, tz);
  let anchor = dt;
  if (m.timeFrom || m.timeTo) {
    const from = parseHHmm(m.timeFrom ?? "00:00");
    const to = parseHHmm(m.timeTo ?? "24:00");
    const now = minutesOfDay(dt);
    if (from < to) {
      if (now < from || now >= to) return false;
    } else if (from > to) {
      if (now >= from) anchor = dt;
      else if (now < to) anchor = dt.minus({ days: 1 });
      else return false;
    }
  }
  if (m.daysOfWeek?.length && !m.daysOfWeek.includes(anchor.weekday)) return false;
  const date = anchor.toISODate();
  if (m.dateFrom && date < m.dateFrom) return false;
  if (m.dateTo && date > m.dateTo) return false;
  return true;
}
function pickTop(rules) {
  return [...rules].sort(
    (a, b) => b.priority - a.priority || specificity(b.match) - specificity(a.match) || a.id.localeCompare(b.id)
  )[0];
}
function quoteRate(rules, station2, mode, t, tz) {
  const applicable = rules.filter((r) => r.active && ruleAppliesAt(r, station2, mode, t, tz));
  const base = pickTop(applicable.filter((r) => r.effect.kind === "rate"));
  if (!base || base.effect.kind !== "rate") return null;
  const pct = pickTop(applicable.filter((r) => r.effect.kind === "percent"));
  let perHour = base.effect.perHour;
  if (pct && pct.effect.kind === "percent") perHour = perHour * (1 + pct.effect.percent / 100);
  return { perHour: Math.max(0, perHour), baseRuleId: base.id, percentRuleId: pct?.id ?? null };
}
function rateBoundaries(rules, a, b, tz) {
  if (b <= a) return [];
  const edges = /* @__PURE__ */ new Set([0]);
  for (const r of rules) {
    if (!r.active) continue;
    if (r.match.timeFrom) edges.add(parseHHmm(r.match.timeFrom) % 1440);
    if (r.match.timeTo) edges.add(parseHHmm(r.match.timeTo) % 1440);
  }
  const out = /* @__PURE__ */ new Set();
  for (const r of rules) {
    if (!r.active) continue;
    for (const edge of [r.match.startsAt, r.match.endsAt]) if (edge != null && edge > a && edge < b) out.add(edge);
  }
  let day = toLocal(a, tz).startOf("day");
  while (day.toMillis() < b) {
    for (const minutes of edges) {
      const inst = atLocalMinutes(day, minutes).toMillis();
      if (inst > a && inst < b) out.add(inst);
    }
    day = day.plus({ days: 1 }).startOf("day");
  }
  return [...out].sort((x, y) => x - y);
}
function packageMatches(pkg, station2, mode) {
  return inList(pkg.match.stationTypes, station2.type) && inList(pkg.match.tiers, station2.tier) && inList(pkg.match.modes, mode);
}

// ../../node_modules/@lounge/core/src/session.ts
function currentSegment(segments2) {
  const last = segments2.at(-1);
  return last && last.endedAt === null ? last : void 0;
}
function planAction(segments2, action, now) {
  const cur = currentSegment(segments2);
  if (!cur) throw new DomainError("session_not_running", "Session is not running");
  if (now < cur.startedAt) throw new DomainError("clock_skew", "Action time is before the current segment start");
  const close = { ...cur, endedAt: now };
  const next = (patch) => ({ ...cur, ...patch, startedAt: now, endedAt: null });
  switch (action.type) {
    case "pause":
      if (cur.paused) throw new DomainError("already_paused", "Session is already paused");
      return { close, open: next({ paused: true }) };
    case "resume":
      if (!cur.paused) throw new DomainError("not_paused", "Session is not paused");
      return { close, open: next({ paused: false }) };
    case "mode":
      if (action.mode === cur.mode) throw new DomainError("same_mode", "Session is already in this mode");
      return { close, open: next({ mode: action.mode }) };
    case "transfer":
      if (action.stationId === cur.stationId) throw new DomainError("same_station", "Session is already on this station");
      return { close, open: next({ stationId: action.stationId }) };
    case "end":
      return { close, open: null };
  }
}
function playedAndPaused(segments2, asOf) {
  let playedMs = 0;
  let pausedMs = 0;
  for (const s of segments2) {
    const end = Math.min(s.endedAt ?? asOf, asOf);
    const len = Math.max(0, end - s.startedAt);
    if (s.paused) pausedMs += len;
    else playedMs += len;
  }
  return { playedMs, pausedMs };
}
function liveState(timeline, asOf, endingSoonMinutes) {
  const { playedMs, pausedMs } = playedAndPaused(timeline.segments, asOf);
  const cur = currentSegment(timeline.segments);
  const remainingMs = timeline.kind === "fixed" && timeline.plannedMinutes != null ? timeline.plannedMinutes * MINUTE - playedMs : null;
  const overtimeMs = remainingMs != null && remainingMs < 0 ? -remainingMs : 0;
  let status;
  if (!cur) status = "ended";
  else if (cur.paused) status = "paused";
  else if (remainingMs != null && remainingMs <= 0) status = "overtime";
  else if (remainingMs != null && remainingMs <= endingSoonMinutes * MINUTE) status = "ending";
  else status = "active";
  return { status, playedMs, pausedMs, remainingMs, overtimeMs };
}

// ../../node_modules/@lounge/core/src/billing.ts
function roundMs(ms, unitMinutes, mode) {
  const unit = Math.max(1, unitMinutes) * MINUTE;
  const q = ms / unit;
  const eps = 1e-9;
  if (mode === "down") return Math.floor(q + eps) * unit;
  if (mode === "nearest") return Math.round(q) * unit;
  return Math.ceil(q - eps) * unit;
}
function station(ctx2, id) {
  const s = ctx2.stations[id];
  if (!s) throw new DomainError("unknown_station", `Unknown station ${id}`);
  return s;
}
function buildPieces(timeline, ctx2, asOf) {
  const pieces = [];
  for (const seg of timeline.segments) {
    if (seg.paused) continue;
    const start = seg.startedAt;
    const end = Math.min(seg.endedAt ?? asOf, asOf);
    if (end <= start) continue;
    const st = station(ctx2, seg.stationId);
    const cuts = [start, ...rateBoundaries(ctx2.rules, start, end, ctx2.tz), end];
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i];
      const to = cuts[i + 1];
      const q = quoteRate(ctx2.rules, st, seg.mode, from, ctx2.tz);
      const piece = {
        stationId: seg.stationId,
        mode: seg.mode,
        from,
        to,
        perHour: q?.perHour ?? null,
        baseRuleId: q?.baseRuleId ?? null,
        percentRuleId: q?.percentRuleId ?? null
      };
      const prev = pieces.at(-1);
      if (prev && prev.to === piece.from && prev.stationId === piece.stationId && prev.mode === piece.mode && prev.perHour === piece.perHour && prev.baseRuleId === piece.baseRuleId && prev.percentRuleId === piece.percentRuleId) {
        prev.to = piece.to;
      } else {
        pieces.push(piece);
      }
    }
  }
  return pieces;
}
function costOfPlayRange(pieces, fromMs, toMs, tailRate) {
  if (toMs <= fromMs) return 0;
  let offset = 0;
  let cost = 0;
  for (const p of pieces) {
    const len = p.to - p.from;
    const s = Math.max(fromMs, offset);
    const e = Math.min(toMs, offset + len);
    if (e > s) cost += (p.perHour ?? 0) * (e - s) / HOUR;
    offset += len;
  }
  if (toMs > offset) cost += tailRate * (toMs - Math.max(fromMs, offset)) / HOUR;
  return cost;
}
function computeTimeBill(timeline, ctx2, asOf) {
  const p = ctx2.policy;
  const pieces = buildPieces(timeline, ctx2, asOf);
  const { playedMs, pausedMs } = playedAndPaused(timeline.segments, asOf);
  const last = timeline.segments.at(-1);
  const ended = !!last && last.endedAt !== null && last.endedAt <= asOf;
  const cur = currentSegment(timeline.segments);
  const quoteFor = (seg, t) => quoteRate(ctx2.rules, station(ctx2, seg.stationId), seg.mode, t, ctx2.tz);
  const lastPiece = pieces.at(-1);
  let tailRate = lastPiece?.perHour ?? null;
  if (tailRate == null && last) tailRate = quoteFor(last, Math.min(last.endedAt ?? asOf, asOf))?.perHour ?? null;
  let missingRate = pieces.some((x) => x.perHour == null) || playedMs === 0 && last != null && tailRate == null;
  const rate = tailRate ?? 0;
  let base = playedMs;
  let reason = null;
  const plannedMs = timeline.kind === "fixed" && timeline.plannedMinutes != null ? timeline.plannedMinutes * MINUTE : null;
  if (plannedMs != null && playedMs < plannedMs) {
    if (p.earlyEnd === "charge_full") base = plannedMs;
    else if (p.earlyEnd === "actual_with_min") base = Math.max(playedMs, p.earlyEndMinMinutes * MINUTE);
    if (base > playedMs) reason = "early_end";
  }
  let billableMs;
  if (base === playedMs && p.graceMinutes > 0 && playedMs <= p.graceMinutes * MINUTE) {
    billableMs = 0;
    if (playedMs > 0) reason = "grace";
  } else {
    const minMs = p.minimumMinutes * MINUTE;
    const withMin = Math.max(base, minMs);
    if (withMin > base && !reason) reason = "minimum";
    billableMs = Math.max(roundMs(withMin, p.roundingMinutes, p.roundingMode), minMs);
    if (billableMs !== withMin && !reason) reason = "rounding";
  }
  const lineExact = pieces.map((x) => (x.perHour ?? 0) * (x.to - x.from) / HOUR);
  const playedExact = lineExact.reduce((a, b) => a + b, 0);
  const normalExact = costOfPlayRange(pieces, 0, billableMs, rate);
  const adjustmentExact = normalExact - playedExact;
  const subtotal = Math.max(0, Math.round(normalExact));
  const amounts = allocate(subtotal, [...lineExact, adjustmentExact]);
  const lines = pieces.map((x, i) => ({
    stationId: x.stationId,
    mode: x.mode,
    from: x.from,
    to: x.to,
    ms: x.to - x.from,
    perHour: x.perHour ?? 0,
    amount: amounts[i] ?? 0,
    baseRuleId: x.baseRuleId,
    percentRuleId: x.percentRuleId
  }));
  const adjustment = {
    reason: billableMs !== playedMs ? reason : null,
    ms: billableMs - playedMs,
    amount: amounts[pieces.length] ?? 0
  };
  let total = subtotal;
  let pkg = null;
  const withPackage = (pk) => Math.round(pk.price + costOfPlayRange(pieces, pk.minutes * MINUTE, billableMs, rate));
  if (timeline.packageId) {
    const forced = ctx2.packages.find((x) => x.id === timeline.packageId);
    if (!forced) throw new DomainError("unknown_package", `Unknown package ${timeline.packageId}`);
    total = withPackage(forced);
    pkg = { id: forced.id, name: forced.name, minutes: forced.minutes, price: forced.price, forced: true };
  } else if (p.autoBestPackage && pieces.length > 0) {
    for (const pk of ctx2.packages) {
      if (!pk.active) continue;
      if (!pieces.every((x) => packageMatches(pk, station(ctx2, x.stationId), x.mode))) continue;
      const candidate = withPackage(pk);
      if (candidate < total) {
        total = candidate;
        pkg = { id: pk.id, name: pk.name, minutes: pk.minutes, price: pk.price, forced: false };
      }
    }
  }
  let capApplied = false;
  if (p.sessionCap != null && total > p.sessionCap) {
    total = p.sessionCap;
    capApplied = true;
  }
  const currentPerHour = cur && !cur.paused && !ended ? quoteFor(cur, asOf)?.perHour ?? null : null;
  if (cur && !cur.paused && currentPerHour == null) missingRate = true;
  return {
    asOf,
    ended,
    playedMs,
    pausedMs,
    billableMs,
    lines,
    adjustment,
    subtotal,
    package: pkg,
    capApplied,
    savings: subtotal - total,
    total,
    currentPerHour,
    missingRate,
    remainingMs: plannedMs != null ? plannedMs - playedMs : null,
    overtimeMs: plannedMs != null ? Math.max(0, playedMs - plannedMs) : 0
  };
}

// ../../node_modules/@lounge/core/src/checkout.ts
function discountPercentOf(discount, subtotal) {
  if (!discount || subtotal <= 0) return 0;
  return discount.kind === "percent" ? discount.value : discount.value / subtotal * 100;
}
function computeCheckout(input) {
  const { timeCharge, items, discount, cashRounding, paid } = input;
  for (const it of items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new DomainError("invalid_qty", "Quantity must be a positive integer");
  }
  const itemsTotal = items.filter((i) => !i.voided).reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  const subtotal = timeCharge + itemsTotal;
  let discountAmount = 0;
  if (discount) {
    if (discount.value < 0) throw new DomainError("invalid_discount", "Discount cannot be negative");
    if (discount.kind === "percent" && discount.value > 100) throw new DomainError("invalid_discount", "Discount over 100%");
    discountAmount = discount.kind === "amount" ? discount.value : Math.round(subtotal * discount.value / 100);
    discountAmount = Math.min(Math.max(0, discountAmount), subtotal);
  }
  const afterDiscount = subtotal - discountAmount;
  const total = Math.max(0, roundToUnit(afterDiscount, cashRounding));
  return {
    timeCharge,
    itemsTotal,
    subtotal,
    discountAmount,
    rounding: total - afterDiscount,
    total,
    paid,
    due: total - paid
  };
}

// ../../node_modules/@lounge/core/src/controllers.ts
function isCharged(c, now) {
  return c.status === "charging" && c.readyAt != null && now >= c.readyAt;
}

// ../../node_modules/@lounge/core/src/policies.ts
import { z as z2 } from "zod";
var hhmm2 = z2.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm");
var billingPolicySchema = z2.object({
  /** Played time ≤ grace is free ("changed their mind"). Only when no early-end rule forces a charge. */
  graceMinutes: z2.number().int().min(0).max(60).default(0),
  /** Minimum billable time once past grace. */
  minimumMinutes: z2.number().int().min(0).max(600).default(0),
  /** Billing unit: 1 = per minute, 15 = blocks of 15 minutes. */
  roundingMinutes: z2.number().int().min(1).max(60).default(1),
  roundingMode: z2.enum(["up", "nearest", "down"]).default("up"),
  /** What a fixed (pre-booked) session pays when it ends before its planned time. */
  earlyEnd: z2.enum(["charge_actual", "charge_full", "actual_with_min"]).default("charge_actual"),
  earlyEndMinMinutes: z2.number().int().min(0).max(600).default(30),
  /** Maximum time charge for a single session (minor units). null = no cap. */
  sessionCap: z2.number().int().min(0).nullable().default(null),
  /** Automatically apply a package when it is cheaper than the hourly price. */
  autoBestPackage: z2.boolean().default(true),
  /** Fixed sessions show "ending soon" this many minutes before the end. */
  endingSoonMinutes: z2.number().int().min(1).max(60).default(5),
  /** End fixed sessions automatically at their planned time (otherwise they run into overtime). */
  autoEndFixed: z2.boolean().default(false)
});
var reservationPolicySchema = z2.object({
  /** Cancelling at least this long before the start is free. */
  freeCancelMinutes: z2.number().int().min(0).max(10080).default(120),
  lateCancelFeeKind: z2.enum(["fixed", "percent_deposit"]).default("percent_deposit"),
  /** Minor units for "fixed", 0–100 for "percent_deposit". */
  lateCancelFeeValue: z2.number().int().min(0).default(50),
  /** After this many minutes without check-in the reservation becomes a no-show and the station is released. */
  noShowGraceMinutes: z2.number().int().min(0).max(240).default(15),
  noShowForfeitDeposit: z2.boolean().default(true),
  /** Station shows "reserved" this many minutes before the reservation starts. */
  holdMinutesBefore: z2.number().int().min(0).max(240).default(15)
});
var checkoutPolicySchema = z2.object({
  /** Round bill totals to this many minor units (e.g. 50 = nearest 0.050). 0 = exact. */
  cashRounding: z2.number().int().min(0).default(0),
  /** Cashiers may discount up to this percent without a manager PIN. */
  maxCashierDiscountPercent: z2.number().min(0).max(100).default(100),
  /** Refunds above this amount (minor units) need a manager PIN. */
  refundApprovalAbove: z2.number().int().min(0).default(0),
  /** Voiding an order item needs a manager PIN. */
  voidNeedsApproval: z2.boolean().default(true)
});
var dayPolicySchema = z2.object({
  /** Local time the business day rolls over (a lounge open until 03:00 uses e.g. 06:00). */
  cutoff: hhmm2.default("06:00"),
  /** Generate the end-of-day report automatically at the cutoff. */
  autoCloseDay: z2.boolean().default(false)
});
var controllerPolicySchema = z2.object({
  /** A controller put on charge becomes ready again automatically after this long. */
  chargeMinutes: z2.number().int().min(5).max(24 * 60).default(60),
  /** Controllers handed out with a session go back to the shelf when it ends. Off = they live at the station. */
  returnOnEnd: z2.boolean().default(true)
});
var DEFAULT_REWARD_MESSAGE = [
  "\u0623\u0647\u0644\u0627\u064B {name} \u{1F44B}",
  "\u0634\u0643\u0631\u0627\u064B \u0644\u0632\u064A\u0627\u0631\u062A\u0643 {shop}! \u0644\u0639\u0628\u062A {played} \u0648\u0643\u0633\u0628\u062A {free} \u0645\u062C\u0627\u0646\u0627\u064B \u{1F381}",
  "\u0628\u062A\u0633\u062A\u062E\u062F\u0645\u0647\u0627 \u0628\u0632\u064A\u0627\u0631\u062A\u0643 \u0627\u0644\u062C\u0627\u064A\u0629\u060C \u0628\u0633 \u0639\u0637\u064A\u0646\u0627 \u0647\u0627\u0644\u0631\u0642\u0645 \u0644\u0645\u0627 \u062A\u064A\u062C\u064A."
].join("\n");
var rewardPolicySchema = z2.object({
  /** A session of more than `afterMinutes` earns a free time for the phone number it was registered with. */
  enabled: z2.boolean().default(true),
  afterMinutes: z2.number().int().min(30).max(24 * 60).default(240),
  /** The free time one reward gives. */
  freeMinutes: z2.number().int().min(5).max(24 * 60).default(60),
  /** Added to numbers typed without a country code ("079…"): 962 = Jordan. */
  countryCode: z2.string().regex(/^\d{1,4}$/).default("962"),
  /** The WhatsApp message: {name} {played} {free} {shop}. */
  message: z2.string().trim().min(5).max(600).default(DEFAULT_REWARD_MESSAGE)
});
var branchSettingsSchema = z2.object({
  billing: billingPolicySchema.prefault({}),
  reservations: reservationPolicySchema.prefault({}),
  checkout: checkoutPolicySchema.prefault({}),
  day: dayPolicySchema.prefault({}),
  controllers: controllerPolicySchema.prefault({}),
  rewards: rewardPolicySchema.prefault({})
});
function parseBranchSettings(raw) {
  return branchSettingsSchema.parse(raw ?? {});
}
var defaultBranchSettings = () => branchSettingsSchema.parse({});

// ../../node_modules/@lounge/core/src/reservations.ts
function evaluateCancellation(r, now, policy) {
  const late = r.startAt - now < policy.freeCancelMinutes * MINUTE;
  let fee = 0;
  if (late) {
    fee = policy.lateCancelFeeKind === "fixed" ? policy.lateCancelFeeValue : Math.round(r.deposit * Math.min(100, policy.lateCancelFeeValue) / 100);
  }
  fee = Math.min(fee, r.deposit);
  return { late, fee, refund: r.deposit - fee };
}
function isNoShow(r, now, policy) {
  return r.status === "confirmed" && now >= r.startAt + policy.noShowGraceMinutes * MINUTE;
}
function noShowOutcome(r, policy) {
  const fee = policy.noShowForfeitDeposit ? r.deposit : 0;
  return { late: true, fee, refund: r.deposit - fee };
}
function isHolding(r, now, policy) {
  if (r.status !== "confirmed") return false;
  return now >= r.startAt - policy.holdMinutesBefore * MINUTE && now < r.startAt + policy.noShowGraceMinutes * MINUTE;
}
function overlaps(aStart, aMinutes, bStart, bMinutes) {
  const aEnd = aStart + aMinutes * MINUTE;
  const bEnd = bStart + bMinutes * MINUTE;
  return aStart < bEnd && bStart < aEnd;
}

// ../../node_modules/@lounge/core/src/rewards.ts
function normalizePhone(raw, countryCode) {
  const text2 = (raw ?? "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  if (!text2) return null;
  const cc = countryCode.replace(/\D/g, "");
  let digits = text2.replace(/\D/g, "");
  if (!digits) return null;
  if (text2.startsWith("+")) {
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = cc + digits.replace(/^0+/, "");
  } else if (!(cc && digits.startsWith(cc) && digits.length >= cc.length + 8)) {
    digits = cc + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
function freeTimeValue(timeCharge, billableMs, freeMinutes) {
  if (timeCharge <= 0 || billableMs <= 0 || freeMinutes <= 0) return 0;
  const share = Math.min(1, freeMinutes * 6e4 / billableMs);
  return Math.min(timeCharge, Math.round(timeCharge * share));
}
function earnsReward(playedMs, afterMinutes) {
  return playedMs > afterMinutes * 6e4;
}

// src/app.ts
import { and as and20, desc as desc5, eq as eq20, inArray as inArray15, isNull as isNull8, or as or4 } from "drizzle-orm";
import Fastify from "fastify";
import { z as z17, ZodError } from "zod";

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  bills: () => bills,
  branches: () => branches,
  businessDays: () => businessDays,
  cashWithdrawals: () => cashWithdrawals,
  controllers: () => controllers,
  customers: () => customers,
  dayCarries: () => dayCarries,
  events: () => events,
  orderItems: () => orderItems,
  orders: () => orders,
  organizations: () => organizations,
  packages: () => packages,
  payments: () => payments,
  pricingRules: () => pricingRules,
  products: () => products,
  reservations: () => reservations,
  rewards: () => rewards,
  segments: () => segments,
  sessions: () => sessions,
  shifts: () => shifts,
  stations: () => stations,
  stockMovements: () => stockMovements,
  users: () => users,
  walletTransactions: () => walletTransactions
});
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
var ts = (name) => timestamp(name, { withTimezone: true, mode: "date" });
var createdAt = () => ts("created_at").notNull().defaultNow();
var updatedAt = () => ts("updated_at").notNull().defaultNow();
var organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt()
});
var branches = pgTable("branches", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull(),
  currencyDecimals: integer("currency_decimals").notNull(),
  locale: text("locale").notNull().default("ar"),
  /** BranchSettings (policies) — validated by @lounge/core on every read. */
  settings: jsonb("settings").$type().notNull().default({}),
  billSeq: integer("bill_seq").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
var users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    /** null = every branch (owner). */
    branchId: uuid("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    role: text("role").$type().notNull(),
    pinHash: text("pin_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("users_org_idx").on(t.orgId)]
);
var stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    /** ps5 | vr | … (free text so new device kinds need no migration). */
    type: text("type").notNull(),
    /** regular | vip */
    tier: text("tier").notNull(),
    zone: text("zone").notNull().default(""),
    /** Play modes this station offers, e.g. ["single","multi"] or ["standard"]. */
    modes: jsonb("modes").$type().notNull(),
    sort: integer("sort").notNull().default(0),
    maintenance: boolean("maintenance").notNull().default(false),
    maintenanceNote: text("maintenance_note"),
    /** Hardware control config (smart plug / TV) — Phase 3. */
    device: jsonb("device").$type(),
    active: boolean("active").notNull().default(true),
    /** "Deleted" by the owner: gone from every list, kept so past sessions and bills keep its name. */
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("stations_branch_idx").on(t.branchId)]
);
var pricingRules = pgTable("pricing_rules", {
  id: uuid("id").primaryKey(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  /** manual = edited in Settings → Pricing; quick = the owner's one-tap "discount now". */
  source: text("source").$type().notNull().default("manual"),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(0),
  active: boolean("active").notNull().default(true),
  match: jsonb("match").$type().notNull(),
  effect: jsonb("effect").$type().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
var packages = pgTable("packages", {
  id: uuid("id").primaryKey(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  name: text("name").notNull(),
  minutes: integer("minutes").notNull(),
  price: integer("price").notNull(),
  active: boolean("active").notNull().default(true),
  match: jsonb("match").$type().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
var customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    phone: text("phone"),
    walletBalance: integer("wallet_balance").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("customers_phone_idx").on(t.phone), uniqueIndex("customers_org_phone_uq").on(t.orgId, t.phone)]
);
var walletTransactions = pgTable("wallet_transactions", {
  id: uuid("id").primaryKey(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  refId: uuid("ref_id"),
  createdBy: uuid("created_by"),
  createdAt: createdAt()
});
var sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    kind: text("kind").$type().notNull(),
    plannedMinutes: integer("planned_minutes"),
    packageId: uuid("package_id"),
    customerId: uuid("customer_id"),
    label: text("label"),
    status: text("status").$type().notNull(),
    /** Station the session is on now (or ended on). */
    stationId: uuid("station_id").notNull(),
    reservationId: uuid("reservation_id"),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    closedAt: ts("closed_at"),
    billId: uuid("bill_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index("sessions_branch_status_idx").on(t.branchId, t.status),
    // The database itself guarantees one running session per station, even if two cashiers click at once.
    uniqueIndex("sessions_station_running_uq").on(t.stationId).where(sql`status = 'running'`)
  ]
);
var segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id),
    stationId: uuid("station_id").notNull(),
    mode: text("mode").notNull(),
    paused: boolean("paused").notNull().default(false),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at")
  },
  (t) => [index("segments_session_idx").on(t.sessionId)]
);
var products = pgTable("products", {
  id: uuid("id").primaryKey(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: integer("price").notNull(),
  trackStock: boolean("track_stock").notNull().default(false),
  stockQty: integer("stock_qty").notNull().default(0),
  lowStockAt: integer("low_stock_at").notNull().default(0),
  /** Pieces per carton, remembered from the last delivery so the next one is prefilled. */
  packSize: integer("pack_size"),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  /** "Deleted" by the owner: gone from every list; sold items keep their own name and price. */
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
var orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    /** null = walk-in (counter) order. */
    sessionId: uuid("session_id"),
    billId: uuid("bill_id"),
    status: text("status").$type().notNull(),
    kitchenStatus: text("kitchen_status").$type().notNull().default("new"),
    label: text("label"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("orders_branch_status_idx").on(t.branchId, t.status), index("orders_session_idx").on(t.sessionId)]
);
var orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    unitPrice: integer("unit_price").notNull(),
    qty: integer("qty").notNull(),
    voided: boolean("voided").notNull().default(false),
    voidReason: text("void_reason"),
    voidedBy: uuid("voided_by"),
    voidedAt: ts("voided_at"),
    createdAt: createdAt()
  },
  (t) => [index("order_items_order_idx").on(t.orderId)]
);
var bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    number: integer("number").notNull(),
    businessDay: text("business_day").notNull(),
    sessionId: uuid("session_id"),
    customerId: uuid("customer_id"),
    shiftId: uuid("shift_id"),
    timeCharge: integer("time_charge").notNull(),
    itemsTotal: integer("items_total").notNull(),
    discountAmount: integer("discount_amount").notNull(),
    discountReason: text("discount_reason"),
    rounding: integer("rounding").notNull(),
    total: integer("total").notNull(),
    paid: integer("paid").notNull(),
    status: text("status").$type().notNull(),
    /** Full snapshot: time bill lines, items, checkout totals — the receipt is rebuilt from this. */
    breakdown: jsonb("breakdown").$type().notNull(),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex("bills_branch_number_uq").on(t.branchId, t.number),
    index("bills_branch_day_idx").on(t.branchId, t.businessDay)
  ]
);
var cashWithdrawals = pgTable(
  "cash_withdrawals",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    shiftId: uuid("shift_id").notNull(),
    businessDay: text("business_day").notNull(),
    /** Positive minor units. */
    amount: integer("amount").notNull(),
    note: text("note"),
    status: text("status").$type().notNull().default("active"),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt()
  },
  (t) => [index("cash_withdrawals_shift_idx").on(t.shiftId), index("cash_withdrawals_branch_day_idx").on(t.branchId, t.businessDay)]
);
var payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    businessDay: text("business_day").notNull(),
    shiftId: uuid("shift_id"),
    billId: uuid("bill_id"),
    sessionId: uuid("session_id"),
    reservationId: uuid("reservation_id"),
    method: text("method").$type().notNull(),
    kind: text("kind").$type().notNull(),
    /** Negative for refunds. */
    amount: integer("amount").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    createdAt: createdAt()
  },
  (t) => [
    index("payments_branch_day_idx").on(t.branchId, t.businessDay),
    index("payments_shift_idx").on(t.shiftId),
    index("payments_session_idx").on(t.sessionId)
  ]
);
var shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    userId: uuid("user_id").notNull(),
    businessDay: text("business_day").notNull(),
    status: text("status").$type().notNull(),
    openedAt: ts("opened_at").notNull(),
    openingFloat: integer("opening_float").notNull(),
    closedAt: ts("closed_at"),
    closedBy: uuid("closed_by"),
    expectedCash: integer("expected_cash"),
    countedCash: integer("counted_cash"),
    variance: integer("variance"),
    note: text("note")
  },
  (t) => [index("shifts_branch_status_idx").on(t.branchId, t.status)]
);
var reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    stationId: uuid("station_id").notNull(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    customerId: uuid("customer_id"),
    startAt: ts("start_at").notNull(),
    minutes: integer("minutes").notNull(),
    mode: text("mode").notNull(),
    deposit: integer("deposit").notNull().default(0),
    status: text("status").$type().notNull(),
    sessionId: uuid("session_id"),
    /** Part of the deposit kept by the shop (late cancel / no-show). */
    fee: integer("fee").notNull().default(0),
    /** Part of the deposit already given back. */
    refunded: integer("refunded").notNull().default(0),
    cancelledAt: ts("cancelled_at"),
    note: text("note"),
    /** "Deleted" from the bookings list. Any deposit money stays in the ledger. */
    archivedAt: ts("archived_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("reservations_branch_start_idx").on(t.branchId, t.startAt)]
);
var stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    productId: uuid("product_id").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").$type().notNull(),
    refId: uuid("ref_id"),
    /** Deliveries: how many cartons of how many pieces, at what price per piece. */
    cartons: integer("cartons"),
    packSize: integer("pack_size"),
    unitPrice: integer("unit_price"),
    note: text("note"),
    businessDay: text("business_day").notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt()
  },
  (t) => [index("stock_movements_branch_day_idx").on(t.branchId, t.businessDay)]
);
var controllers = pgTable(
  "controllers",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    number: integer("number").notNull(),
    stationId: uuid("station_id"),
    status: text("status").$type().notNull().default("ready"),
    chargingSince: ts("charging_since"),
    readyAt: ts("ready_at"),
    note: text("note"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex("controllers_branch_number_uq").on(t.branchId, t.number)]
);
var dayCarries = pgTable(
  "day_carries",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    sessionId: uuid("session_id").notNull(),
    /** The business day this part belongs to. */
    businessDay: text("business_day").notNull(),
    time: integer("time").notNull(),
    items: integer("items").notNull(),
    /** Play time in this part (for the stations' minutes). */
    ms: integer("ms").notNull().default(0),
    createdAt: createdAt()
  },
  (t) => [index("day_carries_branch_day_idx").on(t.branchId, t.businessDay), index("day_carries_session_idx").on(t.sessionId)]
);
var rewards = pgTable(
  "rewards",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    /** The session that earned it — one reward per session. */
    earnedSessionId: uuid("earned_session_id").notNull(),
    earnedDay: text("earned_day").notNull(),
    /** The free time (minutes) and how long the session played (for the message). */
    minutes: integer("minutes").notNull(),
    playedMinutes: integer("played_minutes").notNull(),
    status: text("status").$type().notNull().default("available"),
    usedAt: ts("used_at"),
    usedSessionId: uuid("used_session_id"),
    usedBillId: uuid("used_bill_id"),
    /** When the cashier opened WhatsApp with the message (we cannot know it was sent). */
    notifiedAt: ts("notified_at"),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("rewards_earned_session_uq").on(t.earnedSessionId),
    index("rewards_branch_status_idx").on(t.branchId, t.status),
    index("rewards_customer_idx").on(t.customerId)
  ]
);
var businessDays = pgTable(
  "business_days",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    day: text("day").notNull(),
    status: text("status").$type().notNull(),
    openedAt: ts("opened_at").notNull(),
    closedAt: ts("closed_at"),
    closedBy: uuid("closed_by"),
    auto: boolean("auto").notNull().default(false),
    /** Hidden from the ledger by "start from now" (the rows stay). */
    archived: boolean("archived").notNull().default(false),
    report: jsonb("report").$type()
  },
  (t) => [uniqueIndex("business_days_branch_day_uq").on(t.branchId, t.day)]
);
var events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey(),
    branchId: uuid("branch_id").notNull(),
    type: text("type").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    payload: jsonb("payload").$type().notNull().default({}),
    actorId: uuid("actor_id"),
    approvedBy: uuid("approved_by"),
    reason: text("reason"),
    createdAt: createdAt(),
    syncedAt: ts("synced_at")
  },
  (t) => [index("events_branch_created_idx").on(t.branchId, t.createdAt), index("events_synced_idx").on(t.syncedAt)]
);

// src/lib/auth.ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { jwtVerify, SignJWT } from "jose";

// src/lib/errors.ts
var HttpError = class extends Error {
  status;
  code;
  details;
  constructor(status, code, message, details) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var notFound = (what) => new HttpError(404, "not_found", `${what} not found`, { what });
var unauthorized = (msg = "Login required") => new HttpError(401, "unauthorized", msg);
var forbidden = (msg = "Not allowed for your role") => new HttpError(403, "forbidden", msg);

// src/lib/auth.ts
var scrypt = promisify(scryptCb);
async function hashPin(pin2) {
  const salt = randomBytes(16);
  const hash = await scrypt(pin2, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
async function verifyPin(pin2, stored) {
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(pin2, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
var SYSTEM_ID = "00000000-0000-0000-0000-000000000000";
async function signToken(actor, secret) {
  return new SignJWT({ org: actor.orgId, br: actor.branchId, role: actor.role, name: actor.name }).setProtectedHeader({ alg: "HS256" }).setSubject(actor.id).setIssuedAt().setExpirationTime("14h").sign(new TextEncoder().encode(secret));
}
async function verifyToken(token, secret) {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return {
      id: String(payload.sub),
      orgId: String(payload.org),
      branchId: String(payload.br),
      role: payload.role,
      name: String(payload.name ?? "")
    };
  } catch {
    throw unauthorized("Session expired, please log in again");
  }
}
var ALL = ["owner", "manager", "cashier", "waiter"];
var DESK = ["owner", "manager", "cashier"];
var MGMT = ["owner", "manager"];
var PERMISSIONS = {
  "floor.view": ALL,
  "session.manage": DESK,
  "order.create": ALL,
  "controllers.manage": ALL,
  checkout: DESK,
  "reservation.manage": DESK,
  "shift.manage": DESK,
  "stock.view": DESK,
  "stock.manage": DESK,
  "reports.view": MGMT,
  "day.close": MGMT,
  "settings.manage": MGMT,
  "staff.manage": MGMT,
  "audit.view": MGMT
};
function can(role, perm) {
  return PERMISSIONS[perm].includes(role);
}
function requirePerm(actor, perm) {
  if (!can(actor.role, perm)) throw forbidden();
}
var isManager = (role) => role === "owner" || role === "manager";
var failures = /* @__PURE__ */ new Map();
function checkLockout(userId, now) {
  const f = failures.get(userId);
  return f && f.until > now ? f.until - now : 0;
}
function recordFailure(userId, now) {
  const f = failures.get(userId) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) {
    f.until = now + 6e4 * Math.min(15, 2 ** (f.count - 5));
  }
  failures.set(userId, f);
}
function clearFailures(userId) {
  failures.delete(userId);
}

// src/services/checkout.ts
import { and as and11, desc as desc3, eq as eq11, inArray as inArray8, isNull as isNull3, lt as lt4, or as or2, sql as sql4 } from "drizzle-orm";
import { z as z9 } from "zod";

// src/context.ts
import { EventEmitter } from "node:events";

// src/lib/ids.ts
import { v7 } from "uuid";
var newId = () => v7();

// src/context.ts
var systemClock = { now: () => Date.now() };
var Bus = class extends EventEmitter {
  publish(e) {
    this.emit("event", e);
  }
  onEvent(fn) {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
};
async function mutate(ctx2, actor, fn) {
  const pending = [];
  const result = await ctx2.db.transaction(async (tx) => {
    const record = async (e) => {
      const row = {
        id: newId(),
        branchId: e.branchId ?? actor.branchId,
        type: e.type,
        entity: e.entity,
        entityId: e.entityId ?? null,
        payload: e.payload ?? {},
        actorId: actor.id,
        approvedBy: e.approvedBy ?? null,
        reason: e.reason ?? null,
        createdAt: new Date(ctx2.clock.now())
      };
      await tx.insert(events).values(row);
      pending.push(row);
    };
    return fn(tx, record);
  });
  for (const e of pending) ctx2.bus.publish(e);
  return result;
}

// src/services/common.ts
import { and, asc, eq, inArray, or } from "drizzle-orm";
async function getBranch(q, branchId) {
  const [row] = await q.select().from(branches).where(eq(branches.id, branchId));
  if (!row) throw notFound("branch");
  return { ...row, settings: parseBranchSettings(row.settings) };
}
async function loadBillingContext(q, branch) {
  const [st, rules, pkgs] = await Promise.all([
    q.select({ id: stations.id, type: stations.type, tier: stations.tier }).from(stations).where(eq(stations.branchId, branch.id)),
    q.select().from(pricingRules).where(eq(pricingRules.branchId, branch.id)),
    q.select().from(packages).where(eq(packages.branchId, branch.id))
  ]);
  return {
    tz: branch.timezone,
    stations: Object.fromEntries(st.map((s) => [s.id, s])),
    rules: rules.map((r) => pricingRuleSchema.parse(r)),
    packages: pkgs.map((p) => pricePackageSchema.parse(p)),
    policy: branch.settings.billing
  };
}
function toTimeline(s, segs) {
  return {
    kind: s.kind,
    plannedMinutes: s.plannedMinutes,
    packageId: s.packageId,
    segments: segs.map((g) => ({
      stationId: g.stationId,
      mode: g.mode,
      paused: g.paused,
      startedAt: g.startedAt.getTime(),
      endedAt: g.endedAt ? g.endedAt.getTime() : null
    }))
  };
}
async function loadSegments(q, sessionIds) {
  const out = /* @__PURE__ */ new Map();
  if (sessionIds.length === 0) return out;
  const rows = await q.select().from(segments).where(inArray(segments.sessionId, sessionIds)).orderBy(asc(segments.startedAt), asc(segments.id));
  for (const r of rows) {
    const list = out.get(r.sessionId) ?? [];
    list.push(r);
    out.set(r.sessionId, list);
  }
  return out;
}
async function getSession(q, branchId, id) {
  const [s] = await q.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.branchId, branchId)));
  if (!s) throw notFound("session");
  return s;
}
async function currentDay(q, branch, now) {
  const [open] = await q.select({ day: businessDays.day }).from(businessDays).where(and(eq(businessDays.branchId, branch.id), eq(businessDays.status, "open")));
  if (open) return open.day;
  const day = businessDayOf(now, branch.timezone, branch.settings.day.cutoff);
  await q.insert(businessDays).values({ id: newId(), branchId: branch.id, day, status: "open", openedAt: new Date(now) }).onConflictDoNothing();
  return day;
}
async function openShift(q, branchId) {
  const [s] = await q.select().from(shifts).where(and(eq(shifts.branchId, branchId), eq(shifts.status, "open")));
  return s ?? null;
}
async function requireOpenShift(q, branchId) {
  const s = await openShift(q, branchId);
  if (!s) throw new DomainError("no_open_shift", "Open a shift before taking payments");
  return s;
}
async function sessionPaidByMethod(q, s) {
  const conds = [eq(payments.sessionId, s.id)];
  if (s.reservationId) conds.push(and(eq(payments.reservationId, s.reservationId), inArray(payments.kind, ["deposit"])));
  const rows = await q.select({ amount: payments.amount, billId: payments.billId, method: payments.method }).from(payments).where(or(...conds));
  const byMethod2 = {};
  let total = 0;
  for (const r of rows) {
    if (r.billId) continue;
    total += r.amount;
    byMethod2[r.method] = (byMethod2[r.method] ?? 0) + r.amount;
  }
  return { total, byMethod: byMethod2 };
}
async function sessionPaid(q, s) {
  return (await sessionPaidByMethod(q, s)).total;
}
async function resolveApproval(q, actor, needed, pin2, what) {
  if (!needed) return null;
  if (isManager(actor.role)) return actor.id;
  if (!pin2) throw new DomainError("approval_required", `Manager approval required: ${what}`, { what });
  const managers = await q.select({ id: users.id, pinHash: users.pinHash, branchId: users.branchId }).from(users).where(and(eq(users.orgId, actor.orgId), eq(users.active, true), inArray(users.role, ["owner", "manager"])));
  for (const m of managers) {
    if (m.branchId && m.branchId !== actor.branchId) continue;
    if (await verifyPin(pin2, m.pinHash)) return m.id;
  }
  throw new DomainError("approval_invalid", "Manager PIN is not valid");
}

// src/services/carries.ts
import { and as and2, eq as eq2, inArray as inArray2, lt } from "drizzle-orm";
var AFTER_DAY_END = "after_day_end";
var ZERO = { time: 0, items: 0, ms: 0 };
function timelineAsOf(t, asOf) {
  return {
    ...t,
    segments: t.segments.filter((g) => g.startedAt < asOf).map((g) => ({ ...g, endedAt: g.endedAt == null || g.endedAt > asOf ? asOf : g.endedAt }))
  };
}
async function carriedSoFar(q, sessionIds) {
  const out = /* @__PURE__ */ new Map();
  if (sessionIds.length === 0) return out;
  const rows = await q.select().from(dayCarries).where(inArray2(dayCarries.sessionId, sessionIds));
  for (const r of rows) {
    const c = out.get(r.sessionId) ?? { ...ZERO };
    c.time += r.time;
    c.items += r.items;
    c.ms += r.ms;
    out.set(r.sessionId, c);
  }
  return out;
}
async function valueAsOf(q, bctx, s, segs, asOf) {
  const until = s.status === "ended" && s.endedAt ? Math.min(s.endedAt.getTime(), asOf) : asOf;
  let time = 0;
  let ms = 0;
  if (s.startedAt.getTime() < until) {
    try {
      const bill = computeTimeBill(timelineAsOf(toTimeline(s, segs), until), bctx, until);
      time = bill.total;
      ms = bill.playedMs;
    } catch {
    }
  }
  const rows = await q.select({ qty: orderItems.qty, unitPrice: orderItems.unitPrice }).from(orderItems).innerJoin(orders, eq2(orders.id, orderItems.orderId)).where(and2(eq2(orders.sessionId, s.id), eq2(orders.status, "open"), eq2(orderItems.voided, false), lt(orderItems.createdAt, new Date(asOf))));
  const items = rows.reduce((sum, r) => sum + r.qty * r.unitPrice, 0);
  return { time, items, ms };
}
async function carryOpenSessions(tx, branch, day, asOf) {
  const open = await tx.select().from(sessions).where(and2(eq2(sessions.branchId, branch.id), inArray2(sessions.status, ["running", "ended"])));
  if (open.length === 0) return 0;
  const bctx = await loadBillingContext(tx, branch);
  const segs = await loadSegments(tx, open.map((s) => s.id));
  const before = await carriedSoFar(tx, open.map((s) => s.id));
  let n = 0;
  for (const s of open) {
    const now = await valueAsOf(tx, bctx, s, segs.get(s.id) ?? [], asOf);
    const prev = before.get(s.id) ?? ZERO;
    const part = { time: now.time - prev.time, items: now.items - prev.items, ms: now.ms - prev.ms };
    if (part.time === 0 && part.items === 0) continue;
    await tx.insert(dayCarries).values({ id: newId(), branchId: branch.id, sessionId: s.id, businessDay: day, ...part });
    n++;
  }
  return n;
}
async function reverseCarries(tx, branchId, sessionId, day) {
  const prev = (await carriedSoFar(tx, [sessionId])).get(sessionId);
  if (!prev || prev.time === 0 && prev.items === 0) return;
  await tx.insert(dayCarries).values({ id: newId(), branchId, sessionId, businessDay: day, time: -prev.time, items: -prev.items, ms: -prev.ms });
}
async function carriesOnDays(q, branchId, days) {
  if (days.length === 0) return [];
  return q.select().from(dayCarries).where(and2(eq2(dayCarries.branchId, branchId), inArray2(dayCarries.businessDay, days)));
}

// src/services/controllers.ts
import { and as and4, asc as asc2, eq as eq4, inArray as inArray4, lte, max } from "drizzle-orm";
import { z as z3 } from "zod";

// src/services/stations.ts
import { and as and3, eq as eq3, inArray as inArray3 } from "drizzle-orm";
async function getStation(q, branchId, id) {
  const [s] = await q.select().from(stations).where(and3(eq3(stations.id, id), eq3(stations.branchId, branchId)));
  if (!s) throw notFound("station");
  return s;
}
function assertUsable(st, mode) {
  if (!st.active) throw new DomainError("station_inactive", "Station is not active");
  if (st.maintenance) throw new DomainError("station_maintenance", "Station is under maintenance");
  if (mode && !st.modes.includes(mode)) throw new DomainError("invalid_mode", `Station does not offer mode "${mode}"`, { mode });
}
async function assertFree(q, stationId) {
  const [busy] = await q.select({ id: sessions.id }).from(sessions).where(and3(eq3(sessions.stationId, stationId), eq3(sessions.status, "running")));
  if (busy) throw new DomainError("station_busy", "Station already has a running session", { sessionId: busy.id });
}
async function holdingReservation(q, branch, stationId, now) {
  const rows = await q.select().from(reservations).where(
    and3(
      eq3(reservations.branchId, branch.id),
      eq3(reservations.stationId, stationId),
      inArray3(reservations.status, ["confirmed"])
    )
  );
  return rows.find(
    (r) => isHolding(
      { startAt: r.startAt.getTime(), minutes: r.minutes, deposit: r.deposit, status: r.status },
      now,
      branch.settings.reservations
    )
  ) ?? null;
}

// src/services/controllers.ts
var addControllersInput = z3.object({ count: z3.number().int().min(1).max(50) });
var chargeInput = z3.object({ minutes: z3.number().int().min(5).max(24 * 60).optional() });
var assignInput = z3.object({ stationId: z3.uuid().nullable() });
var brokenInput = z3.object({ broken: z3.boolean(), note: z3.string().trim().max(200).nullish() });
async function listControllers(q, branchId) {
  return q.select().from(controllers).where(and4(eq4(controllers.branchId, branchId), eq4(controllers.active, true))).orderBy(asc2(controllers.number));
}
async function getController(q, branchId, id) {
  const [c] = await q.select().from(controllers).where(and4(eq4(controllers.id, id), eq4(controllers.branchId, branchId)));
  if (!c) throw notFound("controller");
  return c;
}
var like = (c) => ({ status: c.status, stationId: c.stationId, readyAt: c.readyAt?.getTime() ?? null });
async function addControllers(ctx2, actor, raw) {
  const input = addControllersInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const [{ top } = { top: 0 }] = await tx.select({ top: max(controllers.number) }).from(controllers).where(eq4(controllers.branchId, actor.branchId));
    const first = (top ?? 0) + 1;
    const rows = Array.from({ length: input.count }, (_, i) => ({ id: newId(), branchId: actor.branchId, number: first + i }));
    await tx.insert(controllers).values(rows);
    await record({ type: "controller.added", entity: "controller", payload: { from: first, to: first + input.count - 1 } });
    return { from: first, to: first + input.count - 1 };
  });
}
async function deleteController(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const c = await getController(tx, actor.branchId, id);
    if (c.stationId) throw new DomainError("controller_in_use", `Controller ${c.number} is with a station \u2014 put it back on the shelf first`, { number: c.number });
    await tx.delete(controllers).where(eq4(controllers.id, id));
    await record({ type: "controller.deleted", entity: "controller", entityId: id, payload: { number: c.number } });
    return { id, number: c.number };
  });
}
async function chargeController(ctx2, actor, id, raw) {
  const input = chargeInput.parse(raw ?? {});
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const c = await getController(tx, branch.id, id);
    if (c.status === "broken") throw new DomainError("controller_broken", "Controller is marked broken");
    const minutes = input.minutes ?? branch.settings.controllers.chargeMinutes;
    const readyAt = now + minutes * MINUTE;
    await tx.update(controllers).set({ status: "charging", stationId: null, chargingSince: new Date(now), readyAt: new Date(readyAt), updatedAt: new Date(now) }).where(eq4(controllers.id, id));
    await record({
      type: "controller.charging",
      entity: "controller",
      entityId: id,
      payload: { number: c.number, fromStationId: c.stationId, readyAt, minutes }
    });
    return { id, readyAt };
  });
}
async function readyController(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const c = await getController(tx, actor.branchId, id);
    if (c.status !== "charging") throw new DomainError("controller_not_charging", "Controller is not charging");
    await tx.update(controllers).set({ status: "ready", chargingSince: null, readyAt: null, updatedAt: new Date(now) }).where(eq4(controllers.id, id));
    await record({ type: "controller.charged", entity: "controller", entityId: id, payload: { number: c.number, early: true } });
    return { id };
  });
}
async function assignController(ctx2, actor, id, raw) {
  const input = assignInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const c = await getController(tx, actor.branchId, id);
    if (c.status === "broken") throw new DomainError("controller_broken", "Controller is marked broken");
    if (c.status === "charging" && !isCharged(like(c), now)) {
      throw new DomainError("controller_charging", "Controller is still charging", { readyAt: c.readyAt?.getTime() ?? null });
    }
    if (input.stationId) await getStation(tx, actor.branchId, input.stationId);
    await tx.update(controllers).set({ status: "ready", stationId: input.stationId, chargingSince: null, readyAt: null, updatedAt: new Date(now) }).where(eq4(controllers.id, id));
    await record({
      type: "controller.assigned",
      entity: "controller",
      entityId: id,
      payload: { number: c.number, stationId: input.stationId, fromStationId: c.stationId }
    });
    return { id };
  });
}
async function setControllerBroken(ctx2, actor, id, raw) {
  const input = brokenInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const c = await getController(tx, actor.branchId, id);
    await tx.update(controllers).set({
      status: input.broken ? "broken" : "ready",
      stationId: input.broken ? null : c.stationId,
      chargingSince: null,
      readyAt: null,
      note: input.broken ? input.note ?? null : null,
      updatedAt: new Date(now)
    }).where(eq4(controllers.id, id));
    await record({
      type: input.broken ? "controller.broken" : "controller.fixed",
      entity: "controller",
      entityId: id,
      payload: { number: c.number },
      reason: input.note ?? null
    });
    return { id };
  });
}
async function handOverControllers(tx, record, branchId, stationId, ids, now, sessionId) {
  if (ids.length === 0) return;
  const rows = await tx.select().from(controllers).where(and4(eq4(controllers.branchId, branchId), inArray4(controllers.id, ids)));
  if (rows.length !== new Set(ids).size) throw notFound("controller");
  for (const c of rows) {
    if (!c.active || c.status === "broken") throw new DomainError("controller_broken", `Controller ${c.number} is broken`, { number: c.number });
    if (c.status === "charging" && !isCharged(like(c), now)) {
      throw new DomainError("controller_charging", `Controller ${c.number} is still charging`, { number: c.number });
    }
  }
  await tx.update(controllers).set({ status: "ready", stationId, chargingSince: null, readyAt: null, updatedAt: new Date(now) }).where(inArray4(controllers.id, ids));
  await record({
    type: "controller.assigned",
    entity: "session",
    entityId: sessionId,
    payload: { numbers: rows.map((c) => c.number), stationId }
  });
}
async function moveStationControllers(tx, from, to, now) {
  await tx.update(controllers).set({ stationId: to, updatedAt: new Date(now) }).where(eq4(controllers.stationId, from));
}
async function returnStationControllers(tx, record, branch, stationId, now, sessionId) {
  if (!branch.settings.controllers.returnOnEnd) return;
  const back = await tx.update(controllers).set({ stationId: null, updatedAt: new Date(now) }).where(and4(eq4(controllers.branchId, branch.id), eq4(controllers.stationId, stationId))).returning({ number: controllers.number });
  if (back.length) {
    await record({ type: "controller.returned", entity: "session", entityId: sessionId, payload: { numbers: back.map((c) => c.number) } });
  }
}
async function sweepCharged(ctx2, branchId) {
  const now = ctx2.clock.now();
  const due = await ctx2.db.select().from(controllers).where(and4(eq4(controllers.branchId, branchId), eq4(controllers.status, "charging"), lte(controllers.readyAt, new Date(now))));
  for (const c of due) {
    await mutate(ctx2, { id: null, branchId }, async (tx, record) => {
      const res = await tx.update(controllers).set({ status: "ready", chargingSince: null, readyAt: null, updatedAt: new Date(now) }).where(and4(eq4(controllers.id, c.id), eq4(controllers.status, "charging"))).returning({ id: controllers.id });
      if (res.length) await record({ type: "controller.charged", entity: "controller", entityId: c.id, payload: { number: c.number } });
    });
  }
  return due.length;
}

// src/services/days.ts
import { and as and7, eq as eq7, gte as gte2, inArray as inArray6, lt as lt3 } from "drizzle-orm";
import { DateTime as DateTime3 } from "luxon";
import { z as z5 } from "zod";

// src/services/shifts.ts
import { and as and6, desc, eq as eq6, isNull } from "drizzle-orm";
import { z as z4 } from "zod";

// src/services/ledger.ts
import { and as and5, asc as asc3, eq as eq5, gte, inArray as inArray5, lt as lt2 } from "drizzle-orm";
import { DateTime as DateTime2 } from "luxon";
async function archivedDays(q, branchId) {
  const rows = await q.select({ day: businessDays.day }).from(businessDays).where(and5(eq5(businessDays.branchId, branchId), eq5(businessDays.archived, true)));
  return new Set(rows.map((r) => r.day));
}
async function isArchived(q, branchId, day) {
  return (await archivedDays(q, branchId)).has(day);
}
function byMethod(rows) {
  const out = {};
  for (const r of rows) out[r.method] = (out[r.method] ?? 0) + r.amount;
  return out;
}
async function sessionsLog(q, branchId, day) {
  if (await isArchived(q, branchId, day)) return [];
  const rows = await q.select().from(bills).where(and5(eq5(bills.branchId, branchId), eq5(bills.businessDay, day), eq5(bills.status, "paid"))).orderBy(asc3(bills.createdAt));
  const pays = rows.length ? await q.select({ billId: payments.billId, method: payments.method, amount: payments.amount, day: payments.businessDay }).from(payments).where(inArray5(payments.billId, rows.map((b) => b.id))) : [];
  const earlier = await carriedSoFar(q, rows.map((b) => b.sessionId).filter((x) => !!x));
  const billRows = rows.map((b) => {
    const bd = b.breakdown;
    const items = /* @__PURE__ */ new Map();
    for (const i of bd.items ?? []) if (!i.voided) items.set(i.name, (items.get(i.name) ?? 0) + i.qty);
    return {
      billId: b.id,
      number: b.number,
      stationName: bd.stationName ?? null,
      label: bd.label ?? null,
      startedAt: bd.startedAt ?? null,
      endedAt: bd.endedAt ?? null,
      playedMs: bd.time?.playedMs ?? 0,
      timeCharge: b.timeCharge,
      items: [...items.entries()].map(([name, qty]) => ({ name, qty })),
      itemsTotal: b.itemsTotal,
      discount: b.discountAmount,
      total: b.total,
      // This day's money only: a part an earlier day earned was paid into that day's drawer.
      paidByMethod: byMethod(pays.filter((p) => p.billId === b.id && p.day === day)),
      /** A cafeteria sale (no device). */
      counter: !!bd.counter,
      paidAt: null,
      billTotal: null,
      billPaidByMethod: null,
      voided: false,
      /** Already counted on an earlier day (what was played and taken before that day ended). */
      carriedOutTime: b.sessionId ? earlier.get(b.sessionId)?.time ?? 0 : 0,
      carriedOutItems: b.sessionId ? earlier.get(b.sessionId)?.items ?? 0 : 0,
      carried: false
    };
  });
  const carries = await carriesOnDays(q, branchId, [day]);
  const carriedRows = [];
  if (carries.length) {
    const sess = await q.select({ id: sessions.id, label: sessions.label, startedAt: sessions.startedAt, status: sessions.status, billId: sessions.billId, closedAt: sessions.closedAt, sessionEnd: sessions.endedAt, stationName: stations.name }).from(sessions).leftJoin(stations, eq5(stations.id, sessions.stationId)).where(inArray5(sessions.id, carries.map((c) => c.sessionId)));
    const byId = new Map(sess.map((x) => [x.id, x]));
    const billIds = sess.map((x) => x.billId).filter((x) => !!x);
    const [billRows2, billPays] = billIds.length ? await Promise.all([
      q.select({ id: bills.id, total: bills.total }).from(bills).where(inArray5(bills.id, billIds)),
      q.select({ billId: payments.billId, method: payments.method, amount: payments.amount, day: payments.businessDay }).from(payments).where(inArray5(payments.billId, billIds))
    ]) : [[], []];
    const billOf = new Map(billRows2.map((b) => [b.id, b]));
    const until = await dayEnd(q, branchId, day);
    for (const c of carries) {
      const x = byId.get(c.sessionId);
      const bill = x?.billId ? billOf.get(x.billId) : void 0;
      carriedRows.push({
        billId: c.id,
        number: 0,
        stationName: x?.stationName ?? null,
        label: x?.label ?? null,
        startedAt: x?.startedAt.getTime() ?? null,
        // Until the day's end — or until it stopped, if it stopped before (and was paid after).
        // A negative share is a void giving back what an earlier day counted: no time range.
        endedAt: c.time + c.items < 0 ? null : x?.sessionEnd && until != null ? Math.min(x.sessionEnd.getTime(), until) : until,
        playedMs: c.ms,
        timeCharge: c.time,
        items: [],
        itemsTotal: c.items,
        discount: 0,
        total: c.time + c.items,
        // What was paid into this day's drawer for its share (when the session was paid later).
        paidByMethod: bill ? byMethod(billPays.filter((p) => p.billId === bill.id && p.day === day)) : {},
        counter: false,
        carriedOutTime: 0,
        carriedOutItems: 0,
        carried: true,
        /** When the session was paid (on a later day, in that day's shift), with the whole bill. */
        paidAt: bill ? x?.closedAt?.getTime() ?? null : null,
        billTotal: bill?.total ?? null,
        billPaidByMethod: bill ? byMethod(billPays.filter((p) => p.billId === bill.id)) : null,
        voided: x?.status === "void"
      });
    }
  }
  return [...billRows, ...carriedRows];
}
async function dayEnd(q, branchId, day) {
  const [row] = await q.select().from(businessDays).where(and5(eq5(businessDays.branchId, branchId), eq5(businessDays.day, day)));
  if (!row?.closedAt) return null;
  if (!row.auto) return row.closedAt.getTime();
  const branch = await getBranch(q, branchId);
  return Math.min(row.closedAt.getTime(), businessDayRange(day, branch.timezone, branch.settings.day.cutoff).end);
}
async function monthReport(q, branchId, month) {
  const start = DateTime2.fromISO(`${month}-01`);
  if (!start.isValid) throw new Error("Invalid month");
  const report = await rangeReport(q, branchId, start.toISODate(), start.endOf("month").toISODate());
  return { month, days: report.days, totals: report.totals };
}
var MAX_RANGE_DAYS = 366;
async function rangeReport(q, branchId, from, to) {
  const start = DateTime2.fromISO(from);
  const end = DateTime2.fromISO(to);
  if (!start.isValid || !end.isValid) throw new DomainError("invalid_range", "Invalid dates");
  if (end < start) throw new DomainError("invalid_range", "The period ends before it starts");
  if (end.diff(start, "days").days + 1 > MAX_RANGE_DAYS) throw new DomainError("range_too_long", "Pick a period of at most a year");
  const until = end.plus({ days: 1 }).toISODate();
  const [rangeBills, rangePayments] = await Promise.all([
    q.select({
      sessionId: bills.sessionId,
      day: bills.businessDay,
      timeCharge: bills.timeCharge,
      itemsTotal: bills.itemsTotal,
      discount: bills.discountAmount,
      total: bills.total
    }).from(bills).where(and5(eq5(bills.branchId, branchId), eq5(bills.status, "paid"), gte(bills.businessDay, from), lt2(bills.businessDay, until))),
    q.select({ day: payments.businessDay, method: payments.method, amount: payments.amount }).from(payments).where(and5(eq5(payments.branchId, branchId), gte(payments.businessDay, from), lt2(payments.businessDay, until)))
  ]);
  const days = /* @__PURE__ */ new Map();
  const row = (day) => {
    let r = days.get(day);
    if (!r) {
      r = { day, sessions: 0, time: 0, items: 0, discounts: 0, total: 0, received: {} };
      days.set(day, r);
    }
    return r;
  };
  for (const b of rangeBills) {
    const r = row(b.day);
    r.sessions++;
    r.time += b.timeCharge;
    r.items += b.itemsTotal;
    r.discounts += b.discount;
    r.total += b.total;
  }
  for (const p of rangePayments) {
    const r = row(p.day);
    r.received[p.method] = (r.received[p.method] ?? 0) + p.amount;
  }
  const earlier = await carriedSoFar(q, rangeBills.map((b) => b.sessionId).filter((x) => !!x));
  for (const b of rangeBills) {
    const c = b.sessionId ? earlier.get(b.sessionId) : void 0;
    if (!c) continue;
    const r = row(b.day);
    r.time -= c.time;
    r.items -= c.items;
    r.total -= c.time + c.items;
  }
  const rangeDays = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) rangeDays.push(d.toISODate());
  for (const c of await carriesOnDays(q, branchId, rangeDays)) {
    const r = row(c.businessDay);
    r.time += c.time;
    r.items += c.items;
    r.total += c.time + c.items;
  }
  const hidden = await archivedDays(q, branchId);
  const list = [...days.values()].filter((r) => !hidden.has(r.day)).sort((a, b) => a.day.localeCompare(b.day));
  const totals = list.reduce(
    (t, r) => {
      t.sessions += r.sessions;
      t.time += r.time;
      t.items += r.items;
      t.discounts += r.discounts;
      t.total += r.total;
      for (const [m, v] of Object.entries(r.received)) t.received[m] = (t.received[m] ?? 0) + v;
      return t;
    },
    { sessions: 0, time: 0, items: 0, discounts: 0, total: 0, received: {} }
  );
  return { from, to, days: list, totals };
}

// src/services/shifts.ts
var openShiftInput = z4.object({ openingFloat: z4.number().int().min(0) });
function closeShiftInputBase() {
  return z4.object({
    countedCash: z4.number().int().min(0),
    note: z4.string().trim().max(300).nullish()
  });
}
var closeShiftInput = closeShiftInputBase();
async function shiftSummary(q, shiftId) {
  const [s] = await q.select().from(shifts).where(eq6(shifts.id, shiftId));
  if (!s) return null;
  const rows = await q.select().from(payments).where(eq6(payments.shiftId, shiftId));
  const byMethod2 = { cash: 0, card: 0, wallet: 0 };
  let refunds = 0;
  for (const p of rows) {
    byMethod2[p.method] = (byMethod2[p.method] ?? 0) + p.amount;
    if (p.amount < 0) refunds += -p.amount;
  }
  const [u] = await q.select({ name: users.name }).from(users).where(eq6(users.id, s.userId));
  const taken = await q.select({ id: cashWithdrawals.id, amount: cashWithdrawals.amount, note: cashWithdrawals.note, createdAt: cashWithdrawals.createdAt }).from(cashWithdrawals).where(and6(eq6(cashWithdrawals.shiftId, shiftId), eq6(cashWithdrawals.status, "active"))).orderBy(cashWithdrawals.createdAt);
  const withdrawn = taken.reduce((a, w) => a + w.amount, 0);
  return {
    ...s,
    userName: u?.name ?? "",
    byMethod: byMethod2,
    refunds,
    transactions: rows.length,
    withdrawn,
    withdrawals: taken.map((w) => ({ id: w.id, amount: w.amount, note: w.note, createdAt: w.createdAt.getTime() })),
    expectedCash: s.openingFloat + (byMethod2.cash ?? 0) - withdrawn
  };
}
async function uncountedShifts(q, branchId) {
  const rows = await q.select({ id: shifts.id, userId: shifts.userId, businessDay: shifts.businessDay, closedAt: shifts.closedAt, expectedCash: shifts.expectedCash, userName: users.name }).from(shifts).leftJoin(users, eq6(users.id, shifts.userId)).where(and6(eq6(shifts.branchId, branchId), eq6(shifts.status, "closed"), isNull(shifts.countedCash), isNull(shifts.closedBy))).orderBy(desc(shifts.closedAt)).limit(5);
  const hidden = await archivedDays(q, branchId);
  return rows.filter((r) => !hidden.has(r.businessDay)).map((r) => ({ id: r.id, userName: r.userName ?? "", businessDay: r.businessDay, closedAt: r.closedAt?.getTime() ?? null, expectedCash: r.expectedCash ?? 0 }));
}
async function currentShift(q, branchId) {
  const s = await openShift(q, branchId);
  return s ? shiftSummary(q, s.id) : null;
}
async function startShift(ctx2, actor, raw) {
  const input = openShiftInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    if (await openShift(tx, branch.id)) throw new DomainError("shift_already_open", "A shift is already open");
    const id = newId();
    await tx.insert(shifts).values({
      id,
      branchId: branch.id,
      userId: actor.id,
      businessDay: await currentDay(tx, branch, now),
      status: "open",
      openedAt: new Date(now),
      openingFloat: input.openingFloat
    });
    await record({ type: "shift.opened", entity: "shift", entityId: id, payload: { openingFloat: input.openingFloat } });
    return { id };
  });
}
async function endShift(ctx2, actor, raw) {
  const input = closeShiftInput.parse(raw);
  return mutate(ctx2, actor, (tx, record) => closeOpenShift(tx, record, actor, input, ctx2.clock.now()));
}
async function rollShiftAtDayEnd(tx, record, branchId, nextDay2, now) {
  const s = await openShift(tx, branchId);
  if (!s) return null;
  const summary = await shiftSummary(tx, s.id);
  await tx.update(shifts).set({ status: "closed", closedAt: new Date(now), closedBy: null, expectedCash: summary.expectedCash, countedCash: null, variance: null }).where(and6(eq6(shifts.id, s.id), eq6(shifts.status, "open")));
  await record({ type: "shift.closed", entity: "shift", entityId: s.id, payload: { expectedCash: summary.expectedCash, auto: true } });
  const id = newId();
  await tx.insert(shifts).values({
    id,
    branchId,
    userId: s.userId,
    businessDay: nextDay2,
    status: "open",
    openedAt: new Date(now),
    openingFloat: 0
  });
  await record({ type: "shift.opened", entity: "shift", entityId: id, payload: { openingFloat: 0, auto: true, after: s.id } });
  return { closed: s.id, opened: id };
}
var countShiftInput = closeShiftInputBase();
async function countClosedShift(ctx2, actor, shiftId, raw) {
  const input = countShiftInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const [s] = await tx.select().from(shifts).where(and6(eq6(shifts.id, shiftId), eq6(shifts.branchId, actor.branchId)));
    if (!s) throw notFound("shift");
    if (s.status !== "closed") throw new DomainError("shift_not_closed", "This shift is still open \u2014 close it with a count instead");
    if (s.countedCash != null) throw new DomainError("shift_already_counted", "This shift was already counted");
    const expected = s.expectedCash ?? (await shiftSummary(tx, s.id)).expectedCash;
    const variance = input.countedCash - expected;
    await tx.update(shifts).set({ countedCash: input.countedCash, variance, expectedCash: expected, note: input.note ?? s.note }).where(and6(eq6(shifts.id, s.id), isNull(shifts.countedCash)));
    await record({ type: "shift.counted", entity: "shift", entityId: s.id, payload: { expectedCash: expected, countedCash: input.countedCash, variance }, reason: input.note ?? null });
    return { id: s.id, expectedCash: expected, countedCash: input.countedCash, variance };
  });
}
async function closeOpenShift(tx, record, actor, input, now) {
  const s = await openShift(tx, actor.branchId);
  if (!s) throw new DomainError("no_open_shift", "No shift is open");
  const summary = await shiftSummary(tx, s.id);
  const variance = input.countedCash - summary.expectedCash;
  await tx.update(shifts).set({
    status: "closed",
    closedAt: new Date(now),
    closedBy: actor.id,
    expectedCash: summary.expectedCash,
    countedCash: input.countedCash,
    variance,
    note: input.note ?? null
  }).where(and6(eq6(shifts.id, s.id), eq6(shifts.status, "open")));
  await record({
    type: "shift.closed",
    entity: "shift",
    entityId: s.id,
    payload: { expectedCash: summary.expectedCash, countedCash: input.countedCash, variance },
    reason: input.note ?? null
  });
  return { id: s.id, expectedCash: summary.expectedCash, countedCash: input.countedCash, variance };
}

// src/services/days.ts
var closeDayInput = z5.object({
  counts: z5.array(z5.object({ productId: z5.uuid(), countedQty: z5.number().int().min(0) })).max(500).default([]),
  /** The cash counted in the drawer: closes the open shift in the same step ("end the day"). */
  shift: closeShiftInput.nullish()
});
async function getDayRow(q, branchId, day) {
  const [row] = await q.select().from(businessDays).where(and7(eq7(businessDays.branchId, branchId), eq7(businessDays.day, day)));
  return row ?? null;
}
async function buildDayReport(q, branch, day, now) {
  const row = await getDayRow(q, branch.id, day);
  if (!row) throw notFound("business day");
  const until = row.closedAt ?? new Date(now);
  const [dayBills, dayPayments, dayShifts, allStations, counts] = await Promise.all([
    q.select().from(bills).where(and7(eq7(bills.branchId, branch.id), eq7(bills.businessDay, day), eq7(bills.status, "paid"))),
    q.select().from(payments).where(and7(eq7(payments.branchId, branch.id), eq7(payments.businessDay, day))),
    q.select().from(shifts).where(and7(eq7(shifts.branchId, branch.id), eq7(shifts.businessDay, day))),
    q.select().from(stations).where(eq7(stations.branchId, branch.id)),
    q.select().from(stockMovements).where(and7(eq7(stockMovements.branchId, branch.id), eq7(stockMovements.businessDay, day), eq7(stockMovements.reason, "count")))
  ]);
  const revenue = { bills: dayBills.length, time: 0, items: 0, discounts: 0, rounding: 0, total: 0, carriedIn: 0, carriedOut: 0 };
  for (const b of dayBills) {
    revenue.time += b.timeCharge;
    revenue.items += b.itemsTotal;
    revenue.discounts += b.discountAmount;
    revenue.rounding += b.rounding;
    revenue.total += b.total;
  }
  const billedSessions = dayBills.map((b) => b.sessionId).filter((x) => !!x);
  const [earlier, here2] = await Promise.all([carriedSoFar(q, billedSessions), carriesOnDays(q, branch.id, [day])]);
  for (const c of earlier.values()) {
    revenue.time -= c.time;
    revenue.items -= c.items;
    revenue.total -= c.time + c.items;
    revenue.carriedOut += c.time + c.items;
  }
  for (const c of here2) {
    revenue.time += c.time;
    revenue.items += c.items;
    revenue.total += c.time + c.items;
    revenue.carriedIn += c.time + c.items;
  }
  const money = paymentsSummary(dayPayments);
  const stationMap = new Map(allStations.map((s) => [s.id, s]));
  const perStation = /* @__PURE__ */ new Map();
  for (const b of dayBills) {
    const time = b.breakdown.time;
    for (const l of time?.lines ?? []) {
      const cur = perStation.get(l.stationId) ?? { minutes: 0, amount: 0 };
      cur.minutes += l.ms / 6e4;
      cur.amount += l.amount;
      perStation.set(l.stationId, cur);
    }
  }
  const sessionStation = /* @__PURE__ */ new Map();
  const carrySessions = [.../* @__PURE__ */ new Set([...billedSessions, ...here2.map((c) => c.sessionId)])];
  if (carrySessions.length) {
    for (const s of await q.select({ id: sessions.id, stationId: sessions.stationId }).from(sessions).where(inArray6(sessions.id, carrySessions))) {
      sessionStation.set(s.id, s.stationId);
    }
  }
  const shiftStation = (sessionId, minutes, amount) => {
    const stationId = sessionStation.get(sessionId);
    if (!stationId) return;
    const cur = perStation.get(stationId) ?? { minutes: 0, amount: 0 };
    cur.minutes += minutes;
    cur.amount += amount;
    perStation.set(stationId, cur);
  };
  for (const [sessionId, c] of earlier) shiftStation(sessionId, -c.ms / 6e4, -c.time);
  for (const c of here2) shiftStation(c.sessionId, c.ms / 6e4, c.time);
  const stationRows = [...perStation.entries()].filter(([, v]) => Math.round(v.minutes) !== 0 || v.amount !== 0).map(([stationId, v]) => {
    const s = stationMap.get(stationId);
    return { stationId, name: s?.name ?? "?", type: s?.type ?? "", tier: s?.tier ?? "", minutes: Math.round(v.minutes), amount: v.amount };
  }).sort((a, b) => b.amount - a.amount);
  const billIds = dayBills.map((b) => b.id);
  const soldItems = billIds.length ? await q.select({ productId: orderItems.productId, name: orderItems.name, qty: orderItems.qty, unitPrice: orderItems.unitPrice }).from(orderItems).innerJoin(orders, eq7(orders.id, orderItems.orderId)).where(and7(inArray6(orders.billId, billIds), eq7(orderItems.voided, false))) : [];
  const perProduct = /* @__PURE__ */ new Map();
  for (const i of soldItems) {
    const cur = perProduct.get(i.productId) ?? { name: i.name, qty: 0, amount: 0 };
    cur.qty += i.qty;
    cur.amount += i.qty * i.unitPrice;
    perProduct.set(i.productId, cur);
  }
  const voidEvents = await q.select().from(events).where(
    and7(
      eq7(events.branchId, branch.id),
      eq7(events.type, "order.item_voided"),
      gte2(events.createdAt, row.openedAt),
      lt3(events.createdAt, until)
    )
  );
  const voids = {
    count: voidEvents.length,
    amount: voidEvents.reduce((s, e) => s + Number(e.payload.amount ?? 0), 0)
  };
  const range = businessDayRange(day, branch.timezone, branch.settings.day.cutoff);
  const dayRes = await q.select().from(reservations).where(and7(eq7(reservations.branchId, branch.id), gte2(reservations.startAt, new Date(range.start)), lt3(reservations.startAt, new Date(range.end))));
  const open = await q.select().from(sessions).where(and7(eq7(sessions.branchId, branch.id), inArray6(sessions.status, ["running", "ended"])));
  let runningValue = 0;
  if (open.length) {
    const bctx = await loadBillingContext(q, branch);
    const segs = await loadSegments(q, open.map((s) => s.id));
    const carried = await carriedSoFar(q, open.map((s) => s.id));
    const openItems = await q.select({ qty: orderItems.qty, unitPrice: orderItems.unitPrice }).from(orderItems).innerJoin(orders, eq7(orders.id, orderItems.orderId)).where(and7(inArray6(orders.sessionId, open.map((s) => s.id)), eq7(orders.status, "open"), eq7(orderItems.voided, false)));
    runningValue += openItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    for (const s of open) {
      const asOf = s.status === "running" ? now : s.endedAt?.getTime() ?? now;
      const c = carried.get(s.id);
      runningValue -= (c?.time ?? 0) + (c?.items ?? 0);
      try {
        runningValue += computeTimeBill(toTimeline(s, segs.get(s.id) ?? []), bctx, asOf).total;
      } catch {
      }
    }
  }
  const shiftRows = await shiftsOfDay(q, dayShifts);
  const productNames = counts.length ? await q.select({ id: products.id, name: products.name, qty: products.stockQty }).from(products).where(inArray6(products.id, counts.map((c) => c.productId))) : [];
  const productMap = new Map(productNames.map((p) => [p.id, p]));
  return {
    day,
    status: row.status,
    generatedAt: now,
    openedAt: row.openedAt.getTime(),
    closedAt: row.closedAt?.getTime() ?? null,
    auto: row.auto,
    currency: { code: branch.currency, decimals: branch.currencyDecimals },
    revenue,
    payments: money,
    stations: stationRows,
    products: [...perProduct.entries()].map(([productId, v]) => ({ productId, ...v })).sort((a, b) => b.amount - a.amount),
    voids,
    reservations: {
      total: dayRes.length,
      completed: dayRes.filter((r) => r.status === "completed" || r.status === "checked_in").length,
      cancelled: dayRes.filter((r) => r.status === "cancelled").length,
      noShows: dayRes.filter((r) => r.status === "no_show").length,
      fees: dayRes.reduce((s, r) => s + r.fee, 0)
    },
    openSessions: { count: open.length, runningValue },
    shifts: shiftRows,
    stock: counts.map((c) => {
      const p = productMap.get(c.productId);
      const counted = p?.qty ?? 0;
      return { productId: c.productId, name: p?.name ?? "?", expected: counted - c.delta, counted, variance: c.delta };
    })
  };
}
function paymentsSummary(rows) {
  const byMethod2 = { cash: 0, card: 0, wallet: 0 };
  let deposits = 0;
  let refunds = 0;
  let late = 0;
  for (const p of rows) {
    byMethod2[p.method] = (byMethod2[p.method] ?? 0) + p.amount;
    if (p.kind === "deposit") deposits += p.amount;
    if (p.amount < 0) refunds += -p.amount;
    if (p.note === AFTER_DAY_END) late += p.amount;
  }
  const net = Object.values(byMethod2).reduce((a, b) => a + b, 0);
  return { byMethod: byMethod2, deposits, refunds, net, late };
}
async function shiftsOfDay(q, dayShifts) {
  const userIds = [...new Set(dayShifts.map((s) => s.userId))];
  const names = userIds.length ? await q.select({ id: users.id, name: users.name }).from(users).where(inArray6(users.id, userIds)) : [];
  const nameOf = new Map(names.map((u) => [u.id, u.name]));
  return dayShifts.map((s) => ({
    id: s.id,
    userName: nameOf.get(s.userId) ?? "",
    openedAt: s.openedAt.getTime(),
    closedAt: s.closedAt?.getTime() ?? null,
    openingFloat: s.openingFloat,
    expectedCash: s.expectedCash,
    countedCash: s.countedCash,
    variance: s.variance,
    auto: !!s.closedAt && !s.closedBy
  }));
}
var nextDay = (day) => DateTime3.fromISO(day).plus({ days: 1 }).toISODate();
async function closeAndRoll(ctx2, actor, opts) {
  return mutate(ctx2, actor, (tx, record) => closeDayTx(tx, record, ctx2, actor, opts));
}
async function closeDayTx(tx, record, ctx2, actor, opts) {
  {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const day = await currentDay(tx, branch, now);
    if (opts.shift && actor.id) await closeOpenShift(tx, record, actor, opts.shift, now);
    for (const c of opts.counts) {
      const [p] = await tx.select().from(products).where(and7(eq7(products.id, c.productId), eq7(products.branchId, branch.id)));
      if (!p) throw notFound("product");
      const delta = c.countedQty - p.stockQty;
      await tx.update(products).set({ stockQty: c.countedQty, updatedAt: new Date(now) }).where(eq7(products.id, p.id));
      await tx.insert(stockMovements).values({
        id: newId(),
        branchId: branch.id,
        productId: p.id,
        delta,
        reason: "count",
        businessDay: day,
        createdBy: actor.id
      });
    }
    const asOf = opts.auto ? Math.min(now, businessDayRange(day, branch.timezone, branch.settings.day.cutoff).end) : now;
    if (branch.settings.day.autoCloseDay) await carryOpenSessions(tx, branch, day, asOf);
    const clockDay = businessDayOf(now, branch.timezone, branch.settings.day.cutoff);
    const next = clockDay > day ? clockDay : nextDay(day);
    const rolled = opts.auto ? await rollShiftAtDayEnd(tx, record, branch.id, next, now) : null;
    await tx.update(businessDays).set({ status: "closed", closedAt: new Date(now), closedBy: actor.id, auto: opts.auto }).where(and7(eq7(businessDays.branchId, branch.id), eq7(businessDays.day, day)));
    const report = await buildDayReport(tx, branch, day, now);
    await tx.update(businessDays).set({ report }).where(and7(eq7(businessDays.branchId, branch.id), eq7(businessDays.day, day)));
    await tx.insert(businessDays).values({ id: newId(), branchId: branch.id, day: next, status: "open", openedAt: new Date(now) }).onConflictDoUpdate({
      target: [businessDays.branchId, businessDays.day],
      set: { status: "open", closedAt: null, closedBy: null, report: null }
    });
    await record({
      type: "day.closed",
      entity: "day",
      payload: { day, next, auto: opts.auto, total: report.revenue.total, net: report.payments.net, shiftRolled: !!rolled }
    });
    return { day, next, report };
  }
}
async function endShiftAndDay(ctx2, actor, raw) {
  const input = closeShiftInput.parse(raw);
  const branch = await getBranch(ctx2.db, actor.branchId);
  if (branch.settings.day.autoCloseDay) return endShift(ctx2, actor, raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const shift = await closeOpenShift(tx, record, actor, input, ctx2.clock.now());
    const closed = await closeDayTx(tx, record, ctx2, actor, { auto: false, counts: [], shift: null });
    return { ...shift, day: closed.day, next: closed.next };
  });
}
async function resetLedger(ctx2, actor, raw) {
  z5.object({ confirm: z5.literal(true) }).parse(raw ?? {});
  if (actor.role !== "owner") throw new DomainError("owner_only", "Only the owner can start the ledger from zero");
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const day = await currentDay(tx, branch, now);
    const s = await openShift(tx, branch.id);
    if (s) {
      const summary = await shiftSummary(tx, s.id);
      await tx.update(shifts).set({ status: "closed", closedAt: new Date(now), closedBy: actor.id, expectedCash: summary.expectedCash, countedCash: null, variance: null }).where(and7(eq7(shifts.id, s.id), eq7(shifts.status, "open")));
    }
    await tx.update(businessDays).set({ status: "closed", closedAt: new Date(now), closedBy: actor.id, archived: true }).where(eq7(businessDays.branchId, branch.id));
    const clockDay = businessDayOf(now, branch.timezone, branch.settings.day.cutoff);
    const next = clockDay > day ? clockDay : nextDay(day);
    await tx.insert(businessDays).values({ id: newId(), branchId: branch.id, day: next, status: "open", openedAt: new Date(now) });
    await record({ type: "ledger.reset", entity: "day", payload: { throughDay: day, next, shiftClosed: !!s } });
    return { throughDay: day, next };
  });
}
async function closeDay(ctx2, actor, raw) {
  const input = closeDayInput.parse(raw ?? {});
  const shiftOpen = !!await openShift(ctx2.db, actor.branchId);
  if (shiftOpen && !input.shift) {
    throw new DomainError("shift_open", "Count the cash drawer (close the shift) before closing the day");
  }
  return closeAndRoll(ctx2, actor, { auto: false, counts: input.counts, shift: shiftOpen ? input.shift : null });
}
async function autoRollover(ctx2, branchId) {
  const branch = await getBranch(ctx2.db, branchId);
  if (!branch.settings.day.autoCloseDay) return false;
  const now = ctx2.clock.now();
  const open = await currentDay(ctx2.db, branch, now);
  const clockDay = businessDayOf(now, branch.timezone, branch.settings.day.cutoff);
  if (clockDay <= open) return false;
  await closeAndRoll(ctx2, { id: null, branchId }, { auto: true, counts: [] });
  return true;
}
async function dayReport(q, branchId, day, now) {
  const branch = await getBranch(q, branchId);
  const target = day ?? await currentDay(q, branch, now);
  const row = await getDayRow(q, branchId, target);
  if (!row || row.archived) throw notFound("business day");
  if (row.status === "closed" && row.report) {
    const saved = row.report;
    const [dayShifts, dayPayments] = await Promise.all([
      q.select().from(shifts).where(and7(eq7(shifts.branchId, branchId), eq7(shifts.businessDay, target))),
      q.select().from(payments).where(and7(eq7(payments.branchId, branchId), eq7(payments.businessDay, target)))
    ]);
    return { ...saved, payments: paymentsSummary(dayPayments), shifts: await shiftsOfDay(q, dayShifts) };
  }
  return buildDayReport(q, branch, target, now);
}
async function listDays(q, branchId) {
  return q.select({ day: businessDays.day, status: businessDays.status, openedAt: businessDays.openedAt, closedAt: businessDays.closedAt, auto: businessDays.auto }).from(businessDays).where(and7(eq7(businessDays.branchId, branchId), eq7(businessDays.archived, false))).orderBy(businessDays.day);
}

// src/services/orders.ts
import { and as and8, eq as eq8, inArray as inArray7, sql as sql2 } from "drizzle-orm";
import { z as z6 } from "zod";
var createOrderInput = z6.object({
  /** null/absent → walk-in (counter) order. */
  sessionId: z6.uuid().nullish(),
  label: z6.string().trim().max(80).nullish(),
  note: z6.string().trim().max(300).nullish(),
  items: z6.array(z6.object({ productId: z6.uuid(), qty: z6.number().int().min(1).max(99) })).min(1).max(50)
});
var voidItemInput = z6.object({
  reason: z6.string().trim().min(3).max(200),
  approvalPin: z6.string().nullish()
});
var orderItemsInput = createOrderInput.shape.items;
async function createOrder(ctx2, actor, raw) {
  const input = createOrderInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    if (input.sessionId) {
      const [s] = await tx.select({ status: sessions.status }).from(sessions).where(and8(eq8(sessions.id, input.sessionId), eq8(sessions.branchId, branch.id)));
      if (!s) throw notFound("session");
      if (s.status !== "running" && s.status !== "ended") throw new DomainError("session_closed", "Session is already closed");
    }
    return insertOrder(tx, record, branch, actor, input, now);
  });
}
async function insertOrder(tx, record, branch, actor, input, now) {
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const prods = await tx.select().from(products).where(and8(inArray7(products.id, ids), eq8(products.branchId, branch.id)));
  const byId = new Map(prods.map((p) => [p.id, p]));
  for (const it of input.items) {
    const p = byId.get(it.productId);
    if (!p) throw notFound("product");
    if (!p.active) throw new DomainError("product_inactive", `${p.name} is not available`, { productId: p.id });
  }
  const id = newId();
  const day = await currentDay(tx, branch, now);
  await tx.insert(orders).values({
    id,
    branchId: branch.id,
    sessionId: input.sessionId ?? null,
    status: "open",
    label: input.label ?? null,
    note: input.note ?? null,
    createdBy: actor.id
  });
  await tx.insert(orderItems).values(
    input.items.map((it) => {
      const p = byId.get(it.productId);
      return { id: newId(), orderId: id, productId: p.id, name: p.name, unitPrice: p.price, qty: it.qty };
    })
  );
  const stock = /* @__PURE__ */ new Map();
  for (const it of input.items) {
    const p = byId.get(it.productId);
    if (!p.trackStock) continue;
    const [left] = await tx.update(products).set({ stockQty: sql2`${products.stockQty} - ${it.qty}` }).where(eq8(products.id, p.id)).returning({ qty: products.stockQty });
    stock.set(p.id, { productId: p.id, name: p.name, left: left?.qty ?? 0, lowAt: p.lowStockAt });
    await tx.insert(stockMovements).values({
      id: newId(),
      branchId: branch.id,
      productId: p.id,
      delta: -it.qty,
      reason: "sale",
      refId: id,
      businessDay: day,
      createdBy: actor.id
    });
  }
  await record({
    type: "order.created",
    entity: "order",
    entityId: id,
    payload: { sessionId: input.sessionId ?? null, items: input.items, stock: [...stock.values()] }
  });
  return { id, stock: [...stock.values()] };
}
async function voidOrderItem(ctx2, actor, itemId, raw) {
  const input = voidItemInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const [row] = await tx.select({ item: orderItems, order: orders }).from(orderItems).innerJoin(orders, eq8(orders.id, orderItems.orderId)).where(and8(eq8(orderItems.id, itemId), eq8(orders.branchId, branch.id)));
    if (!row) throw notFound("order item");
    if (row.item.voided) throw new DomainError("already_voided", "Item is already voided");
    if (row.order.status !== "open") throw new DomainError("order_closed", "Order is already billed");
    const approvedBy = await resolveApproval(
      tx,
      actor,
      branch.settings.checkout.voidNeedsApproval,
      input.approvalPin,
      `void ${row.item.qty}\xD7 ${row.item.name}`
    );
    await tx.update(orderItems).set({ voided: true, voidReason: input.reason, voidedBy: actor.id, voidedAt: new Date(now) }).where(eq8(orderItems.id, itemId));
    const [p] = await tx.select().from(products).where(eq8(products.id, row.item.productId));
    if (p?.trackStock) {
      await tx.update(products).set({ stockQty: sql2`${products.stockQty} + ${row.item.qty}` }).where(eq8(products.id, p.id));
      await tx.insert(stockMovements).values({
        id: newId(),
        branchId: branch.id,
        productId: p.id,
        delta: row.item.qty,
        reason: "void",
        refId: row.order.id,
        businessDay: await currentDay(tx, branch, now),
        createdBy: actor.id
      });
    }
    const remaining = await tx.select({ id: orderItems.id }).from(orderItems).where(and8(eq8(orderItems.orderId, row.order.id), eq8(orderItems.voided, false)));
    if (remaining.length === 0) {
      await tx.update(orders).set({ status: "void", updatedAt: new Date(now) }).where(eq8(orders.id, row.order.id));
    }
    await record({
      type: "order.item_voided",
      entity: "order",
      entityId: row.order.id,
      payload: { itemId, name: row.item.name, qty: row.item.qty, amount: row.item.qty * row.item.unitPrice },
      approvedBy,
      reason: input.reason
    });
    return { id: itemId };
  });
}

// src/services/rewards.ts
import { and as and9, asc as asc4, desc as desc2, eq as eq9, sql as sql3 } from "drizzle-orm";
import { z as z7 } from "zod";
async function customerForPhone(tx, branch, input) {
  if (!input.phone?.trim()) return null;
  const phone = normalizePhone(input.phone, branch.settings.rewards.countryCode);
  if (!phone) {
    if (input.strict) throw new DomainError("invalid_phone", "This phone number is not valid");
    return null;
  }
  const name = input.name?.trim() || null;
  await tx.insert(customers).values({ id: newId(), orgId: branch.orgId, name: name ?? phone, phone }).onConflictDoNothing({ target: [customers.orgId, customers.phone] });
  const [c] = await tx.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(and9(eq9(customers.orgId, branch.orgId), eq9(customers.phone, phone)));
  if (!c) throw notFound("customer");
  if (name && c.name === phone) {
    await tx.update(customers).set({ name, updatedAt: /* @__PURE__ */ new Date() }).where(eq9(customers.id, c.id));
    return { id: c.id, name, phone };
  }
  return { id: c.id, name: c.name, phone };
}
var reasonText = (locale, minutes) => locale.startsWith("ar") ? `\u0645\u0643\u0627\u0641\u0623\u0629: ${minutes} \u062F\u0642\u064A\u0642\u0629 \u0645\u062C\u0627\u0646\u064A\u0629` : `Reward: ${minutes} free minutes`;
async function oldestAvailable(q, branchId, customerId) {
  const [r] = await q.select().from(rewards).where(and9(eq9(rewards.branchId, branchId), eq9(rewards.customerId, customerId), eq9(rewards.status, "available"))).orderBy(asc4(rewards.createdAt)).limit(1);
  return r;
}
async function billCustomer(q, branch, s, time) {
  if (!s.customerId) return { customer: null, reward: null };
  const [c] = await q.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(eq9(customers.id, s.customerId));
  if (!c?.phone) return { customer: null, reward: null };
  const r = await oldestAvailable(q, branch.id, c.id);
  const value = r ? freeTimeValue(time.total, time.billableMs, r.minutes) : 0;
  return {
    customer: { id: c.id, name: c.name, phone: c.phone },
    reward: r && value > 0 ? { id: r.id, minutes: r.minutes, value } : null
  };
}
async function rewardDiscount(tx, branch, s, time, rewardId) {
  if (!s.customerId) throw new DomainError("reward_no_customer", "Register the customer\u2019s phone number to use a reward");
  const [r] = await tx.select().from(rewards).where(and9(eq9(rewards.id, rewardId), eq9(rewards.branchId, branch.id), eq9(rewards.customerId, s.customerId), eq9(rewards.status, "available")));
  if (!r) throw new DomainError("reward_unavailable", "This reward is not available");
  const value = freeTimeValue(time.total, time.billableMs, r.minutes);
  if (value <= 0) throw new DomainError("reward_no_value", "There is no play time to take the free time off");
  return { id: r.id, minutes: r.minutes, value, reason: reasonText(branch.locale, r.minutes) };
}
async function useReward(tx, record, id, billId, sessionId, now) {
  const used = await tx.update(rewards).set({ status: "used", usedAt: new Date(now), usedSessionId: sessionId, usedBillId: billId, updatedAt: new Date(now) }).where(and9(eq9(rewards.id, id), eq9(rewards.status, "available"))).returning({ id: rewards.id });
  if (!used.length) throw new DomainError("reward_unavailable", "This reward was already used");
  await record({ type: "reward.used", entity: "reward", entityId: id, payload: { billId, sessionId } });
}
async function earnReward(tx, record, branch, s, playedMs, day, now) {
  const policy = branch.settings.rewards;
  if (!policy.enabled || !s.customerId || !earnsReward(playedMs, policy.afterMinutes)) return null;
  const id = newId();
  const playedMinutes = Math.floor(playedMs / 6e4);
  const added = await tx.insert(rewards).values({ id, branchId: branch.id, customerId: s.customerId, earnedSessionId: s.id, earnedDay: day, minutes: policy.freeMinutes, playedMinutes }).onConflictDoNothing({ target: rewards.earnedSessionId }).returning({ id: rewards.id });
  if (!added.length) return null;
  const [c] = await tx.select({ name: customers.name, phone: customers.phone }).from(customers).where(eq9(customers.id, s.customerId));
  await record({ type: "reward.earned", entity: "reward", entityId: id, payload: { customerId: s.customerId, sessionId: s.id, playedMinutes, minutes: policy.freeMinutes } });
  return { id, minutes: policy.freeMinutes, playedMinutes, name: c?.name ?? "", phone: c?.phone ?? "" };
}
var rewardsQuery = z7.object({
  status: z7.enum(["available", "used", "void", "all"]).default("all"),
  limit: z7.coerce.number().int().min(1).max(500).default(200)
});
async function listRewards(q, branchId, raw) {
  const input = rewardsQuery.parse(raw);
  const rows = await q.select({
    id: rewards.id,
    customerId: rewards.customerId,
    name: customers.name,
    phone: customers.phone,
    minutes: rewards.minutes,
    playedMinutes: rewards.playedMinutes,
    status: rewards.status,
    earnedDay: rewards.earnedDay,
    earnedAt: rewards.createdAt,
    usedAt: rewards.usedAt,
    notifiedAt: rewards.notifiedAt,
    voidReason: rewards.voidReason
  }).from(rewards).innerJoin(customers, eq9(customers.id, rewards.customerId)).where(and9(eq9(rewards.branchId, branchId), input.status === "all" ? void 0 : eq9(rewards.status, input.status))).orderBy(sql3`case when ${rewards.status} = 'available' then 0 else 1 end`, desc2(rewards.createdAt)).limit(input.limit);
  return rows.map((r) => ({ ...r, earnedAt: r.earnedAt.getTime(), usedAt: r.usedAt?.getTime() ?? null, notifiedAt: r.notifiedAt?.getTime() ?? null }));
}
async function lookupCustomer(q, branchId, rawPhone) {
  const branch = await getBranch(q, branchId);
  const phone = normalizePhone(typeof rawPhone === "string" ? rawPhone : "", branch.settings.rewards.countryCode);
  if (!phone) return null;
  const [c] = await q.select({ id: customers.id, name: customers.name }).from(customers).where(and9(eq9(customers.orgId, branch.orgId), eq9(customers.phone, phone)));
  if (!c) return { phone, name: null, available: 0 };
  const open = await q.select({ id: rewards.id }).from(rewards).where(and9(eq9(rewards.branchId, branchId), eq9(rewards.customerId, c.id), eq9(rewards.status, "available")));
  return { phone, name: c.name, available: open.length };
}
async function markRewardNotified(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const [r] = await tx.update(rewards).set({ notifiedAt: new Date(now), updatedAt: new Date(now) }).where(and9(eq9(rewards.id, id), eq9(rewards.branchId, actor.branchId))).returning({ id: rewards.id });
    if (!r) throw notFound("reward");
    await record({ type: "reward.notified", entity: "reward", entityId: id });
    return { id };
  });
}
var voidRewardInput = z7.object({ reason: z7.string().trim().min(3).max(200) });
async function voidReward(ctx2, actor, id, raw) {
  const input = voidRewardInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const [r] = await tx.update(rewards).set({ status: "void", voidReason: input.reason, updatedAt: new Date(now) }).where(and9(eq9(rewards.id, id), eq9(rewards.branchId, actor.branchId), eq9(rewards.status, "available"))).returning({ id: rewards.id });
    if (!r) throw new DomainError("reward_unavailable", "Only a reward that is still unused can be voided");
    await record({ type: "reward.voided", entity: "reward", entityId: id, reason: input.reason });
    return { id };
  });
}

// src/services/sessions.ts
import { and as and10, eq as eq10, isNull as isNull2 } from "drizzle-orm";
import { z as z8 } from "zod";
var startSessionInput = z8.object({
  stationId: z8.uuid(),
  mode: z8.string().min(1).max(40),
  kind: z8.enum(["open", "fixed"]),
  plannedMinutes: z8.number().int().min(1).max(24 * 60).nullish(),
  packageId: z8.uuid().nullish(),
  label: z8.string().trim().max(80).nullish(),
  /** The customer's phone number: it earns them a free hour after a long session (see rewards). */
  customerPhone: z8.string().trim().max(30).nullish(),
  reservationId: z8.uuid().nullish(),
  /** Start even though another customer's reservation is holding the station. */
  overrideReservation: z8.boolean().optional(),
  /** Paid up front (any session kind): how much and how (cash / visa). */
  prepaid: z8.object({ amount: z8.number().int().min(1), method: z8.enum(["cash", "card"]) }).nullish(),
  /** Numbered controllers handed to the customer. */
  controllerIds: z8.array(z8.uuid()).max(8).default([]),
  /** Drinks / food ordered together with the device. */
  items: z8.array(z8.object({ productId: z8.uuid(), qty: z8.number().int().min(1).max(99) })).max(50).default([]),
  /** If the cashier started the session late, how many minutes they have already played. */
  startedMinutesAgo: z8.number().int().min(0).max(24 * 60).nullish(),
  /** Or an explicit start timestamp (ms). */
  startedAt: z8.number().int().nullish()
});
var sessionPaymentInput = z8.object({
  amount: z8.number().int().min(1),
  method: z8.enum(["cash", "card"])
});
var sessionActionInput = z8.discriminatedUnion("type", [
  z8.object({ type: z8.literal("pause") }),
  z8.object({ type: z8.literal("resume") }),
  z8.object({ type: z8.literal("end") }),
  z8.object({ type: z8.literal("mode"), mode: z8.string().min(1).max(40) }),
  z8.object({ type: z8.literal("transfer"), stationId: z8.uuid() })
]);
var setPlanInput = z8.object({
  /** null → switch to open time. */
  plannedMinutes: z8.number().int().min(1).max(24 * 60).nullable()
});
var voidSessionInput = z8.object({
  reason: z8.string().trim().min(3).max(200),
  approvalPin: z8.string().nullish()
});
async function startSession(ctx2, actor, raw) {
  const input = startSessionInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const station2 = await getStation(tx, branch.id, input.stationId);
    assertUsable(station2, input.mode);
    await assertFree(tx, station2.id);
    const hold = await holdingReservation(tx, branch, station2.id, now);
    if (hold && hold.id !== input.reservationId && !input.overrideReservation) {
      throw new DomainError("station_reserved", "Station is held for a reservation", {
        reservationId: hold.id,
        customerName: hold.customerName,
        startAt: hold.startAt.getTime()
      });
    }
    let kind = input.kind;
    let plannedMinutes = input.kind === "fixed" ? input.plannedMinutes ?? null : null;
    if (input.packageId) {
      const [pkg] = await tx.select().from(packages).where(and10(eq10(packages.id, input.packageId), eq10(packages.branchId, branch.id)));
      if (!pkg || !pkg.active) throw notFound("package");
      kind = "fixed";
      plannedMinutes = pkg.minutes;
    }
    if (kind === "fixed" && !plannedMinutes) throw new DomainError("planned_minutes_required", "Fixed sessions need a duration");
    let reservation;
    if (input.reservationId) {
      [reservation] = await tx.select().from(reservations).where(and10(eq10(reservations.id, input.reservationId), eq10(reservations.branchId, branch.id)));
      if (!reservation) throw notFound("reservation");
      if (reservation.status !== "confirmed") throw new DomainError("reservation_not_confirmed", "Reservation is not active");
    }
    const customer = await customerForPhone(tx, branch, {
      phone: input.customerPhone || reservation?.customerPhone,
      name: input.label || reservation?.customerName,
      strict: !!input.customerPhone
    });
    const id = newId();
    const effectiveStart = input.startedMinutesAgo ? now - input.startedMinutesAgo * 6e4 : input.startedAt ?? now;
    await tx.insert(sessions).values({
      id,
      branchId: branch.id,
      kind,
      plannedMinutes,
      packageId: input.packageId ?? null,
      customerId: customer?.id ?? reservation?.customerId ?? null,
      label: input.label || reservation?.customerName || null,
      status: "running",
      stationId: station2.id,
      reservationId: reservation?.id ?? null,
      startedAt: new Date(effectiveStart),
      createdBy: actor.id
    });
    await tx.insert(segments).values({
      id: newId(),
      sessionId: id,
      stationId: station2.id,
      mode: input.mode,
      paused: false,
      startedAt: new Date(effectiveStart)
    });
    await handOverControllers(tx, record, branch.id, station2.id, input.controllerIds, now, id);
    const order = input.items.length ? await insertOrder(tx, record, branch, actor, { sessionId: id, items: input.items }, now) : null;
    if (reservation) {
      await tx.update(reservations).set({ status: "checked_in", sessionId: id, updatedAt: new Date(now) }).where(eq10(reservations.id, reservation.id));
      await record({ type: "reservation.checked_in", entity: "reservation", entityId: reservation.id, payload: { sessionId: id } });
    }
    if (input.prepaid) {
      const shift = await requireOpenShift(tx, branch.id);
      await tx.insert(payments).values({
        id: newId(),
        branchId: branch.id,
        businessDay: await currentDay(tx, branch, now),
        shiftId: shift.id,
        sessionId: id,
        method: input.prepaid.method,
        kind: "prepaid",
        amount: input.prepaid.amount,
        createdBy: actor.id
      });
    }
    await record({
      type: "session.started",
      entity: "session",
      entityId: id,
      payload: { stationId: station2.id, mode: input.mode, kind, plannedMinutes, packageId: input.packageId ?? null, prepaid: input.prepaid ?? null, customerId: customer?.id ?? null },
      reason: hold && input.overrideReservation ? "override_reservation" : null
    });
    return { id, stock: order?.stock ?? [] };
  });
}
var ACTION_EVENTS = {
  pause: "session.paused",
  resume: "session.resumed",
  end: "session.ended",
  mode: "session.mode_changed",
  transfer: "session.transferred"
};
async function sessionAction(ctx2, actor, id, raw) {
  const action = sessionActionInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const s = await getSession(tx, actor.branchId, id);
    if (s.status !== "running") throw new DomainError("session_not_running", "Session is not running");
    const segs = (await loadSegments(tx, [id])).get(id) ?? [];
    const cur = segs.find((g) => g.endedAt === null);
    if (!cur) throw new DomainError("session_not_running", "Session is not running");
    const plan = planAction(toTimeline(s, segs).segments, action, now);
    if (action.type === "transfer") {
      const target = await getStation(tx, actor.branchId, action.stationId);
      assertUsable(target, cur.mode);
      await assertFree(tx, target.id);
    }
    if (action.type === "mode") {
      assertUsable(await getStation(tx, actor.branchId, cur.stationId), action.mode);
    }
    await tx.update(segments).set({ endedAt: new Date(now) }).where(eq10(segments.id, cur.id));
    if (plan.open) {
      await tx.insert(segments).values({
        id: newId(),
        sessionId: id,
        stationId: plan.open.stationId,
        mode: plan.open.mode,
        paused: plan.open.paused,
        startedAt: new Date(now)
      });
    }
    await tx.update(sessions).set({
      updatedAt: new Date(now),
      ...action.type === "transfer" ? { stationId: action.stationId } : {},
      ...action.type === "end" ? { status: "ended", endedAt: new Date(now) } : {}
    }).where(eq10(sessions.id, id));
    if (action.type === "transfer") await moveStationControllers(tx, cur.stationId, action.stationId, now);
    if (action.type === "end") await returnStationControllers(tx, record, await getBranch(tx, actor.branchId), cur.stationId, now, id);
    await record({
      type: ACTION_EVENTS[action.type],
      entity: "session",
      entityId: id,
      payload: { ...action, fromStationId: cur.stationId, fromMode: cur.mode }
    });
    return { id };
  });
}
async function setPlan(ctx2, actor, id, raw) {
  const input = setPlanInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const s = await getSession(tx, actor.branchId, id);
    if (s.status !== "running") throw new DomainError("session_not_running", "Session is not running");
    if (input.plannedMinutes === null && s.packageId) throw new DomainError("package_session", "A package session cannot become open time");
    await tx.update(sessions).set({
      kind: input.plannedMinutes === null ? "open" : "fixed",
      plannedMinutes: input.plannedMinutes,
      updatedAt: new Date(ctx2.clock.now())
    }).where(eq10(sessions.id, id));
    await record({
      type: "session.plan_changed",
      entity: "session",
      entityId: id,
      payload: { from: s.plannedMinutes, to: input.plannedMinutes }
    });
    return { id };
  });
}
async function reopenSession(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const s = await getSession(tx, actor.branchId, id);
    if (s.status !== "ended") throw new DomainError("session_not_ended", "Only an ended, unpaid session can be reopened");
    const segs = (await loadSegments(tx, [id])).get(id) ?? [];
    const last = segs.at(-1);
    const station2 = await getStation(tx, actor.branchId, s.stationId);
    assertUsable(station2, last?.mode);
    await assertFree(tx, station2.id);
    await tx.insert(segments).values({
      id: newId(),
      sessionId: id,
      stationId: station2.id,
      mode: last?.mode ?? station2.modes[0] ?? "single",
      paused: false,
      startedAt: new Date(now)
    });
    await tx.update(sessions).set({ status: "running", endedAt: null, updatedAt: new Date(now) }).where(eq10(sessions.id, id));
    await record({ type: "session.reopened", entity: "session", entityId: id });
    return { id };
  });
}
async function voidSession(ctx2, actor, id, raw) {
  const input = voidSessionInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const s = await getSession(tx, actor.branchId, id);
    if (s.status !== "running" && s.status !== "ended") throw new DomainError("session_closed", "Session is already closed");
    const approvedBy = await resolveApproval(tx, actor, true, input.approvalPin, "void session");
    const items = await sessionItems(tx, id);
    if (items.some((i) => !i.voided) || await sessionPaid(tx, s) !== 0) {
      throw new DomainError("session_has_charges", "Session has orders or payments; check it out instead");
    }
    if (s.status === "running") {
      await tx.update(segments).set({ endedAt: new Date(now) }).where(and10(eq10(segments.sessionId, id), isNull2(segments.endedAt)));
    }
    await tx.update(sessions).set({ status: "void", endedAt: s.endedAt ?? new Date(now), updatedAt: new Date(now) }).where(eq10(sessions.id, id));
    const branch = await getBranch(tx, actor.branchId);
    await reverseCarries(tx, branch.id, id, await currentDay(tx, branch, now));
    if (s.status === "running") await returnStationControllers(tx, record, branch, s.stationId, now, id);
    await record({ type: "session.voided", entity: "session", entityId: id, approvedBy, reason: input.reason });
    return { id };
  });
}
async function addSessionPayment(ctx2, actor, id, raw) {
  const input = sessionPaymentInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const s = await getSession(tx, branch.id, id);
    if (s.status !== "running" && s.status !== "ended") throw new DomainError("session_closed", "Session is already closed");
    const shift = await requireOpenShift(tx, branch.id);
    await tx.insert(payments).values({
      id: newId(),
      branchId: branch.id,
      businessDay: await currentDay(tx, branch, now),
      shiftId: shift.id,
      sessionId: id,
      method: input.method,
      kind: "prepaid",
      amount: input.amount,
      createdBy: actor.id
    });
    await record({ type: "session.payment", entity: "session", entityId: id, payload: { ...input } });
    return { id };
  });
}
async function sessionItems(q, sessionId) {
  return q.select({
    id: orderItems.id,
    orderId: orderItems.orderId,
    productId: orderItems.productId,
    name: orderItems.name,
    unitPrice: orderItems.unitPrice,
    qty: orderItems.qty,
    voided: orderItems.voided,
    voidReason: orderItems.voidReason,
    createdAt: orderItems.createdAt
  }).from(orderItems).innerJoin(orders, eq10(orders.id, orderItems.orderId)).where(and10(eq10(orders.sessionId, sessionId), eq10(orders.status, "open"))).orderBy(orderItems.createdAt);
}
async function sessionBill(q, branch, s, now) {
  const bctx = await loadBillingContext(q, branch);
  const segs = (await loadSegments(q, [s.id])).get(s.id) ?? [];
  const timeline = toTimeline(s, segs);
  const asOf = s.status === "running" ? now : s.endedAt?.getTime() ?? now;
  const time = computeTimeBill(timeline, bctx, asOf);
  const items = await sessionItems(q, s.id);
  const { total: paid, byMethod: paidByMethod } = await sessionPaidByMethod(q, s);
  const totals = computeCheckout({
    timeCharge: time.total,
    items,
    discount: null,
    cashRounding: branch.settings.checkout.cashRounding,
    paid
  });
  return { session: s, timeline, time, items, paid, paidByMethod, totals };
}
var sessionCustomerInput = z8.object({
  phone: z8.string().trim().min(1).max(30),
  name: z8.string().trim().max(80).nullish()
});
async function setSessionCustomer(ctx2, actor, id, raw) {
  const input = sessionCustomerInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const s = await getSession(tx, actor.branchId, id);
    if (s.status !== "running" && s.status !== "ended") throw new DomainError("session_closed", "Session is already closed");
    const branch = await getBranch(tx, actor.branchId);
    const c = await customerForPhone(tx, branch, { phone: input.phone, name: input.name || s.label, strict: true });
    if (!c) throw new DomainError("invalid_phone", "This phone number is not valid");
    await tx.update(sessions).set({ customerId: c.id, label: s.label || input.name || null, updatedAt: new Date(ctx2.clock.now()) }).where(eq10(sessions.id, id));
    await record({ type: "session.customer_set", entity: "session", entityId: id, payload: { customerId: c.id } });
    return c;
  });
}
var adjustTimeInput = z8.object({
  startedMinutesAgo: z8.number().int().min(0).max(24 * 60).nullish(),
  startedAt: z8.number().int().nullish(),
  playedMinutes: z8.number().int().min(0).max(24 * 60).nullish()
});
async function adjustSessionTime(ctx2, actor, id, raw) {
  const input = adjustTimeInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const s = await getSession(tx, actor.branchId, id);
    if (s.status !== "running" && s.status !== "ended") throw new DomainError("session_closed", "Session is already closed");
    const segs = (await loadSegments(tx, [id])).get(id) ?? [];
    if (!segs.length) throw new DomainError("no_segments", "Session has no segments");
    const sorted = [...segs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const firstSeg = sorted[0];
    let newStart = now;
    if (input.playedMinutes != null) {
      newStart = now - input.playedMinutes * 6e4;
    } else if (input.startedMinutesAgo != null) {
      newStart = now - input.startedMinutesAgo * 6e4;
    } else if (input.startedAt != null) {
      newStart = input.startedAt;
    }
    await tx.update(sessions).set({ startedAt: new Date(newStart), updatedAt: new Date(now) }).where(eq10(sessions.id, id));
    await tx.update(segments).set({ startedAt: new Date(newStart) }).where(eq10(segments.id, firstSeg.id));
    await record({
      type: "session.time_adjusted",
      entity: "session",
      entityId: id,
      payload: { startedAt: newStart }
    });
    return { id, startedAt: newStart };
  });
}

// src/services/checkout.ts
var paymentInput = z9.object({
  method: z9.enum(["cash", "card"]),
  /** Minor units. Negative = refund to the customer. */
  amount: z9.number().int()
});
var baseCheckout = {
  discount: z9.object({ kind: z9.enum(["amount", "percent"]), value: z9.number().min(0) }).nullish(),
  discountReason: z9.string().trim().max(200).nullish(),
  payments: z9.array(paymentInput).max(4),
  approvalPin: z9.string().nullish(),
  /** The total the cashier saw. If the server computes something else, the checkout is refused so nobody is surprised. */
  expectedTotal: z9.number().int().optional()
};
var checkoutSessionInput = z9.object({
  ...baseCheckout,
  /** A device checked out without a number: register it now so a long session still earns its free hour. */
  customerPhone: z9.string().trim().max(30).nullish(),
  /** Take this customer's free hour off the bill (instead of a hand-made discount). */
  rewardId: z9.uuid().nullish()
});
function validatePayments(due, list) {
  const sum = list.reduce((s, p) => s + p.amount, 0);
  if (due >= 0) {
    if (list.some((p) => p.amount <= 0)) throw new DomainError("invalid_payment", "Payment amounts must be positive");
  } else if (list.length !== 1 || list[0].amount >= 0) {
    throw new DomainError("invalid_payment", "A refund is a single negative payment");
  }
  if (sum !== due) throw new DomainError("payment_mismatch", "Payments do not match the amount due", { due, paid: sum });
}
async function finalize(tx, record, ctx2, actor, branch, args) {
  const now = ctx2.clock.now();
  const policy = branch.settings.checkout;
  const totals = computeCheckout({
    timeCharge: args.time?.total ?? 0,
    items: args.items,
    discount: args.discount,
    cashRounding: policy.cashRounding,
    paid: args.paid
  });
  if (args.expectedTotal !== void 0 && args.expectedTotal !== totals.total) {
    throw new DomainError("bill_changed", "The bill changed since it was shown; please review it again", { totals });
  }
  const pct = discountPercentOf(args.discount, totals.subtotal);
  const refund = totals.due < 0 ? -totals.due : 0;
  const needsApproval = !args.rewardDiscount && pct > policy.maxCashierDiscountPercent + 1e-9 || refund > policy.refundApprovalAbove;
  if (totals.discountAmount > 0 && !args.discountReason) {
    throw new DomainError("discount_reason_required", "Give a reason for the discount");
  }
  const approvedBy = await resolveApproval(
    tx,
    actor,
    needsApproval,
    args.approvalPin,
    refund > 0 ? `refund ${refund}` : `discount ${pct.toFixed(1)}%`
  );
  validatePayments(totals.due, args.payments);
  const shift = args.payments.length > 0 ? await requireOpenShift(tx, branch.id) : await openShift(tx, branch.id);
  const day = await currentDay(tx, branch, now);
  const [seq] = await tx.update(branches).set({ billSeq: sql4`${branches.billSeq} + 1` }).where(eq11(branches.id, branch.id)).returning({ number: branches.billSeq });
  const billId = newId();
  await tx.insert(bills).values({
    id: billId,
    branchId: branch.id,
    number: seq.number,
    businessDay: day,
    sessionId: args.sessionId,
    shiftId: shift?.id ?? null,
    timeCharge: totals.timeCharge,
    itemsTotal: totals.itemsTotal,
    discountAmount: totals.discountAmount,
    discountReason: args.discountReason,
    rounding: totals.rounding,
    total: totals.total,
    paid: totals.total,
    status: "paid",
    breakdown: {
      time: args.time,
      items: args.items,
      totals,
      discount: args.discount,
      payments: args.payments,
      ...args.extra
    },
    createdBy: actor.id,
    approvedBy
  });
  let toOld = args.late && totals.due > 0 ? Math.min(args.late.amount, totals.due) : 0;
  const lateParts = [];
  const rows = [];
  for (const p of args.payments) {
    const base = { branchId: branch.id, billId, sessionId: args.sessionId, method: p.method, createdBy: actor.id };
    if (p.amount > 0 && toOld > 0 && args.late) {
      const part = Math.min(p.amount, toOld);
      toOld -= part;
      lateParts.push({ method: p.method, amount: part });
      rows.push({ ...base, id: newId(), businessDay: args.late.day, shiftId: args.late.shiftId, kind: "payment", amount: part, note: AFTER_DAY_END, approvedBy: null });
      if (p.amount > part) rows.push({ ...base, id: newId(), businessDay: day, shiftId: shift.id, kind: "payment", amount: p.amount - part, approvedBy: null });
      continue;
    }
    rows.push({ ...base, id: newId(), businessDay: day, shiftId: shift.id, kind: p.amount < 0 ? "refund" : "payment", amount: p.amount, approvedBy: p.amount < 0 ? approvedBy : null });
  }
  if (rows.length) await tx.insert(payments).values(rows);
  const lateCash = lateParts.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0);
  if (args.late && lateCash > 0) {
    await tx.update(shifts).set({ expectedCash: sql4`coalesce(${shifts.expectedCash}, 0) + ${lateCash}` }).where(eq11(shifts.id, args.late.shiftId));
  }
  if (args.sessionId) {
    const conds = [eq11(payments.sessionId, args.sessionId)];
    if (args.reservationId) conds.push(and11(eq11(payments.reservationId, args.reservationId), eq11(payments.kind, "deposit")));
    await tx.update(payments).set({ billId }).where(and11(isNull3(payments.billId), or2(...conds)));
  }
  if (args.orderIds.length) {
    await tx.update(orders).set({ status: "billed", billId, updatedAt: new Date(now) }).where(and11(inArray8(orders.id, args.orderIds), eq11(orders.status, "open")));
  }
  await record({
    type: "bill.paid",
    entity: "bill",
    entityId: billId,
    payload: { number: seq.number, total: totals.total, due: totals.due, sessionId: args.sessionId, payments: args.payments },
    approvedBy,
    reason: args.discountReason
  });
  const lateTotal = lateParts.reduce((a, p) => a + p.amount, 0);
  return {
    billId,
    number: seq.number,
    totals,
    late: args.late && lateTotal > 0 ? { amount: lateTotal, cash: lateCash, shiftId: args.late.shiftId, userName: args.late.userName, closedAt: args.late.closedAt } : null
  };
}
async function lateShareFor(tx, s, today) {
  const carried = (await carriedSoFar(tx, [s.id])).get(s.id);
  const earned = carried ? carried.time + carried.items : 0;
  if (earned <= 0) return null;
  const [last] = await tx.select({ day: dayCarries.businessDay }).from(dayCarries).where(eq11(dayCarries.sessionId, s.id)).orderBy(desc3(dayCarries.businessDay)).limit(1);
  if (!last) return null;
  const conds = [eq11(payments.sessionId, s.id)];
  if (s.reservationId) conds.push(and11(eq11(payments.reservationId, s.reservationId), eq11(payments.kind, "deposit")));
  const earlier = await tx.select({ amount: payments.amount }).from(payments).where(and11(or2(...conds), lt4(payments.businessDay, today)));
  const owed = earned - earlier.reduce((a, p) => a + p.amount, 0);
  if (owed <= 0) return null;
  const [drawer] = await tx.select({ id: shifts.id, closedAt: shifts.closedAt, userName: users.name }).from(shifts).leftJoin(users, eq11(users.id, shifts.userId)).where(and11(eq11(shifts.branchId, s.branchId), eq11(shifts.businessDay, last.day), eq11(shifts.status, "closed"), isNull3(shifts.closedBy), isNull3(shifts.countedCash))).orderBy(desc3(shifts.closedAt)).limit(1);
  if (!drawer) return null;
  return { amount: owed, shiftId: drawer.id, day: last.day, userName: drawer.userName ?? "", closedAt: drawer.closedAt?.getTime() ?? null };
}
async function checkoutSession(ctx2, actor, sessionId, raw) {
  const input = checkoutSessionInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    let s = await getSession(tx, branch.id, sessionId);
    if (s.status !== "running" && s.status !== "ended") throw new DomainError("session_closed", "Session is already closed");
    if (s.status === "running") {
      await tx.update(segments).set({ endedAt: new Date(now) }).where(and11(eq11(segments.sessionId, s.id), isNull3(segments.endedAt)));
      await tx.update(sessions).set({ status: "ended", endedAt: new Date(now), updatedAt: new Date(now) }).where(eq11(sessions.id, s.id));
      s = { ...s, status: "ended", endedAt: new Date(now) };
      await record({ type: "session.ended", entity: "session", entityId: s.id, payload: { viaCheckout: true } });
      await returnStationControllers(tx, record, branch, s.stationId, now, s.id);
    }
    if (!s.customerId && input.customerPhone) {
      const c = await customerForPhone(tx, branch, { phone: input.customerPhone, name: s.label, strict: true });
      if (c) {
        await tx.update(sessions).set({ customerId: c.id, updatedAt: new Date(now) }).where(eq11(sessions.id, s.id));
        s = { ...s, customerId: c.id };
        await record({ type: "session.customer_set", entity: "session", entityId: s.id, payload: { customerId: c.id } });
      }
    }
    const bctx = await loadBillingContext(tx, branch);
    const segs = (await loadSegments(tx, [s.id])).get(s.id) ?? [];
    const time = computeTimeBill(toTimeline(s, segs), bctx, s.endedAt.getTime());
    if (time.missingRate) throw new DomainError("missing_rate", "A station has no price configured for part of this session");
    let discount = input.discount ?? null;
    let discountReason = input.discountReason ?? null;
    let redeemed = null;
    if (input.rewardId) {
      if (discount) throw new DomainError("reward_and_discount", "A free hour cannot be combined with another discount");
      redeemed = await rewardDiscount(tx, branch, s, time, input.rewardId);
      discount = { kind: "amount", value: redeemed.value };
      discountReason = redeemed.reason;
    }
    const items = await sessionItems(tx, s.id);
    const orderIds = [...new Set(items.map((i) => i.orderId))];
    const [st] = await tx.select({ name: stations.name }).from(stations).where(eq11(stations.id, s.stationId));
    const paid = await sessionPaidByMethod(tx, s);
    const late = await lateShareFor(tx, s, await currentDay(tx, branch, now));
    const result = await finalize(tx, record, ctx2, actor, branch, {
      late,
      sessionId: s.id,
      reservationId: s.reservationId,
      time,
      items,
      orderIds,
      paid: paid.total,
      discount,
      discountReason,
      rewardDiscount: !!redeemed,
      payments: input.payments,
      approvalPin: input.approvalPin ?? null,
      expectedTotal: input.expectedTotal,
      extra: {
        label: s.label,
        stationName: st?.name ?? null,
        startedAt: s.startedAt.getTime(),
        endedAt: s.endedAt.getTime(),
        prepaidByMethod: paid.byMethod
      }
    });
    await tx.update(sessions).set({ status: "closed", closedAt: new Date(now), billId: result.billId, updatedAt: new Date(now) }).where(eq11(sessions.id, s.id));
    if (s.reservationId) {
      await tx.update(reservations).set({ status: "completed", updatedAt: new Date(now) }).where(eq11(reservations.id, s.reservationId));
    }
    if (redeemed) await useReward(tx, record, redeemed.id, result.billId, s.id, now);
    const earned = await earnReward(tx, record, branch, s, time.playedMs, await currentDay(tx, branch, now), now);
    return { ...result, reward: earned, redeemed: redeemed ? { id: redeemed.id, minutes: redeemed.minutes, value: redeemed.value } : null };
  });
}
var counterSaleInput = z9.object({
  items: orderItemsInput,
  /** Optional name on the receipt ("Ahmad", "table 2"). */
  label: z9.string().trim().max(80).nullish(),
  ...baseCheckout
});
async function counterSale(ctx2, actor, raw) {
  const input = counterSaleInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    if (input.payments.length > 0) await requireOpenShift(tx, branch.id);
    const order = await insertOrder(tx, record, branch, actor, { sessionId: null, label: input.label ?? null, items: input.items }, now);
    const items = await tx.select({ id: orderItems.id, orderId: orderItems.orderId, name: orderItems.name, unitPrice: orderItems.unitPrice, qty: orderItems.qty, voided: orderItems.voided }).from(orderItems).where(eq11(orderItems.orderId, order.id));
    const result = await finalize(tx, record, ctx2, actor, branch, {
      sessionId: null,
      reservationId: null,
      time: null,
      items,
      orderIds: [order.id],
      paid: 0,
      discount: input.discount ?? null,
      discountReason: input.discountReason ?? null,
      payments: input.payments,
      approvalPin: input.approvalPin ?? null,
      expectedTotal: input.expectedTotal,
      extra: { counter: true, label: input.label ?? null, startedAt: now, endedAt: now }
    });
    return { ...result, stock: order.stock };
  });
}
async function getBill(q, branchId, id) {
  const [b] = await q.select().from(bills).where(and11(eq11(bills.id, id), eq11(bills.branchId, branchId)));
  if (!b) throw notFound("bill");
  return b;
}
var voidBillInput = z9.object({
  reason: z9.string().trim().min(3).max(200),
  approvalPin: z9.string().nullish()
});
async function voidBill(ctx2, actor, id, raw) {
  const input = voidBillInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const [bill] = await tx.select().from(bills).where(and11(eq11(bills.id, id), eq11(bills.branchId, branch.id)));
    if (!bill) throw notFound("bill");
    if (bill.status === "void") throw new DomainError("bill_void", "This bill was already deleted");
    const approvedBy = await resolveApproval(tx, actor, true, input.approvalPin, "delete bill");
    const rows = await tx.select().from(payments).where(eq11(payments.billId, id));
    await tx.update(bills).set({ status: "void" }).where(eq11(bills.id, id));
    if (bill.sessionId) await reverseCarries(tx, branch.id, bill.sessionId, await currentDay(tx, branch, now));
    const back = rows.filter((p) => p.amount !== 0);
    if (back.length) {
      await tx.insert(payments).values(
        back.map((p) => ({
          id: newId(),
          branchId: p.branchId,
          businessDay: p.businessDay,
          shiftId: p.shiftId,
          billId: id,
          sessionId: p.sessionId,
          method: p.method,
          kind: "refund",
          amount: -p.amount,
          note: "bill deleted",
          createdBy: actor.id,
          approvedBy
        }))
      );
    }
    const byShift = /* @__PURE__ */ new Map();
    for (const p of back) if (p.shiftId && p.method === "cash") byShift.set(p.shiftId, (byShift.get(p.shiftId) ?? 0) + p.amount);
    for (const [shiftId, cash] of byShift) {
      await tx.update(shifts).set({ expectedCash: sql4`${shifts.expectedCash} - ${cash}` }).where(and11(eq11(shifts.id, shiftId), eq11(shifts.status, "closed"), sql4`${shifts.expectedCash} is not null`));
    }
    const [dayRow] = await tx.select().from(businessDays).where(and11(eq11(businessDays.branchId, branch.id), eq11(businessDays.day, bill.businessDay)));
    if (dayRow?.status === "closed" && dayRow.report) {
      const report = await buildDayReport(tx, branch, bill.businessDay, now);
      await tx.update(businessDays).set({ report }).where(eq11(businessDays.id, dayRow.id));
    }
    await record({
      type: "bill.voided",
      entity: "bill",
      entityId: id,
      payload: { number: bill.number, total: bill.total, sessionId: bill.sessionId },
      approvedBy,
      reason: input.reason
    });
    return { id, number: bill.number };
  });
}

// src/services/floor.ts
import { and as and13, eq as eq13, gte as gte3, inArray as inArray10, lt as lt5 } from "drizzle-orm";

// src/services/settings.ts
import { and as and12, asc as asc5, eq as eq12, inArray as inArray9, isNotNull, isNull as isNull4, or as or3, sql as sql5 } from "drizzle-orm";
import { z as z10 } from "zod";
var branchInput = z10.object({
  name: z10.string().trim().min(1).max(80).optional(),
  timezone: z10.string().min(3).max(60).optional(),
  currency: z10.string().length(3).optional(),
  currencyDecimals: z10.number().int().min(0).max(3).optional(),
  locale: z10.string().min(2).max(10).optional(),
  settings: z10.unknown().optional()
});
async function updateBranch(ctx2, actor, raw) {
  const input = branchInput.parse(raw);
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw new DomainError("invalid_timezone", "Unknown time zone");
    }
  }
  return mutate(ctx2, actor, async (tx, record) => {
    const [cur] = await tx.select().from(branches).where(eq12(branches.id, actor.branchId));
    if (!cur) throw notFound("branch");
    if (input.currencyDecimals !== void 0 && input.currencyDecimals !== cur.currencyDecimals) {
      const [paid] = await tx.select({ id: payments.id }).from(payments).where(eq12(payments.branchId, cur.id)).limit(1);
      if (paid) throw new DomainError("decimals_locked", "Currency decimals cannot change after payments exist");
    }
    const settings = input.settings !== void 0 ? branchSettingsSchema.parse(deepMerge(parseBranchSettings(cur.settings), input.settings)) : void 0;
    await tx.update(branches).set({
      ...input.name ? { name: input.name } : {},
      ...input.timezone ? { timezone: input.timezone } : {},
      ...input.currency ? { currency: input.currency.toUpperCase() } : {},
      ...input.currencyDecimals !== void 0 ? { currencyDecimals: input.currencyDecimals } : {},
      ...input.locale ? { locale: input.locale } : {},
      ...settings ? { settings } : {},
      updatedAt: new Date(ctx2.clock.now())
    }).where(eq12(branches.id, actor.branchId));
    await record({ type: "settings.updated", entity: "branch", entityId: actor.branchId, payload: { ...input } });
    return { id: actor.branchId };
  });
}
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    const b = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b, v) : v;
  }
  return out;
}
var stationInput = z10.object({
  name: z10.string().trim().min(1).max(40),
  type: z10.string().trim().min(1).max(20),
  tier: z10.string().trim().min(1).max(20),
  zone: z10.string().trim().max(40).default(""),
  modes: z10.array(z10.string().trim().min(1).max(40)).min(1).max(6),
  sort: z10.number().int().default(0),
  maintenance: z10.boolean().default(false),
  maintenanceNote: z10.string().trim().max(200).nullish(),
  active: z10.boolean().default(true)
});
async function listStations(q, branchId) {
  return q.select().from(stations).where(and12(eq12(stations.branchId, branchId), isNull4(stations.archivedAt))).orderBy(asc5(stations.sort), asc5(stations.name));
}
async function listArchivedStations(q, branchId) {
  return q.select({ id: stations.id, name: stations.name }).from(stations).where(and12(eq12(stations.branchId, branchId), isNotNull(stations.archivedAt)));
}
async function saveStation(ctx2, actor, id, raw) {
  const input = id ? stationInput.partial().parse(raw) : stationInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    if (input.name) {
      const same = await tx.select({ id: stations.id }).from(stations).where(and12(eq12(stations.branchId, actor.branchId), isNull4(stations.archivedAt), sql5`lower(${stations.name}) = lower(${input.name})`));
      if (same.some((s) => s.id !== id)) throw new DomainError("name_taken", "Another station already has this name");
    }
    if (id) {
      const [cur] = await tx.select().from(stations).where(and12(eq12(stations.id, id), eq12(stations.branchId, actor.branchId), isNull4(stations.archivedAt)));
      if (!cur) throw notFound("station");
      if (input.active === false || input.maintenance === true) {
        const [busy] = await tx.select({ id: sessions.id }).from(sessions).where(and12(eq12(sessions.stationId, id), eq12(sessions.status, "running")));
        if (busy) throw new DomainError("station_busy", "End the running session first");
      }
      await tx.update(stations).set({ ...input, updatedAt: now }).where(eq12(stations.id, id));
      await record({ type: "station.updated", entity: "station", entityId: id, payload: input });
      return { id };
    }
    const newStation = stationInput.parse(raw);
    const sid = newId();
    await tx.insert(stations).values({ ...newStation, id: sid, branchId: actor.branchId });
    await record({ type: "station.created", entity: "station", entityId: sid, payload: newStation });
    return { id: sid };
  });
}
async function deleteStation(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    const [cur] = await tx.select().from(stations).where(and12(eq12(stations.id, id), eq12(stations.branchId, actor.branchId), isNull4(stations.archivedAt)));
    if (!cur) throw notFound("station");
    const [busy] = await tx.select({ id: sessions.id }).from(sessions).where(and12(eq12(sessions.stationId, id), inArray9(sessions.status, ["running", "ended"]))).limit(1);
    if (busy) throw new DomainError("station_has_session", "End and settle the session on this station first");
    const [booked] = await tx.select({ id: reservations.id }).from(reservations).where(and12(eq12(reservations.stationId, id), eq12(reservations.status, "confirmed"), isNull4(reservations.archivedAt))).limit(1);
    if (booked) throw new DomainError("station_booked", "Cancel or move the bookings on this station first");
    await tx.update(controllers).set({ stationId: null, updatedAt: now }).where(and12(eq12(controllers.branchId, actor.branchId), eq12(controllers.stationId, id)));
    await tx.update(stations).set({ archivedAt: now, active: false, updatedAt: now }).where(eq12(stations.id, id));
    await record({ type: "station.deleted", entity: "station", entityId: id, payload: { name: cur.name } });
    return { id };
  });
}
var ruleInput = z10.object({
  name: z10.string().trim().min(1).max(80),
  priority: z10.number().int().min(-1e3).max(1e3).default(0),
  active: z10.boolean().default(true),
  match: ruleMatchSchema.prefault({}),
  effect: ruleEffectSchema
});
var windowOf = (r) => r.match;
var isCurrent = (r, now) => {
  const w = windowOf(r);
  return w.endsAt == null || w.endsAt > now;
};
async function listRules(q, branchId) {
  return q.select().from(pricingRules).where(eq12(pricingRules.branchId, branchId)).orderBy(asc5(pricingRules.createdAt));
}
async function listCurrentRules(q, branchId, now) {
  return (await listRules(q, branchId)).filter((r) => r.source === "manual" && isCurrent(r, now));
}
async function saveRule(ctx2, actor, id, raw) {
  const input = ruleInput.parse(raw);
  const { startsAt: _s, endsAt: _e, ...match } = input.match;
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    if (id) {
      const [cur] = await tx.select().from(pricingRules).where(and12(eq12(pricingRules.id, id), eq12(pricingRules.branchId, actor.branchId)));
      if (!cur) throw notFound("pricing rule");
      if (!isCurrent(cur, now)) throw new DomainError("rule_ended", "This price has already been replaced");
      const w = windowOf(cur);
      if (w.startsAt != null && w.startsAt > now) {
        await tx.update(pricingRules).set({ ...input, match: { ...match, startsAt: w.startsAt, endsAt: null }, updatedAt: new Date(now) }).where(eq12(pricingRules.id, id));
        await record({ type: "pricing_rule.updated", entity: "pricing_rule", entityId: id, payload: input });
        return { id };
      }
      await tx.update(pricingRules).set({ match: { ...cur.match, endsAt: now }, updatedAt: new Date(now) }).where(eq12(pricingRules.id, id));
      let nextId = null;
      if (input.active) {
        nextId = newId();
        await tx.insert(pricingRules).values({ ...input, id: nextId, branchId: actor.branchId, source: "manual", match: { ...match, startsAt: now } });
      }
      await record({ type: "pricing_rule.updated", entity: "pricing_rule", entityId: nextId ?? id, payload: { ...input, replaces: id } });
      return { id: nextId ?? id };
    }
    const rid = newId();
    await tx.insert(pricingRules).values({ ...input, id: rid, branchId: actor.branchId, source: "manual", match: { ...match, startsAt: now } });
    await record({ type: "pricing_rule.created", entity: "pricing_rule", entityId: rid, payload: input });
    return { id: rid };
  });
}
var quickDiscountInput = z10.object({
  percent: z10.number().int().min(1).max(100),
  /** Empty = every station. */
  stationTypes: z10.array(z10.string().min(1).max(20)).max(10).nullish(),
  tiers: z10.array(z10.string().min(1).max(20)).max(5).nullish(),
  until: z10.discriminatedUnion("kind", [
    z10.object({ kind: z10.literal("manual") }),
    z10.object({ kind: z10.literal("day_end") }),
    z10.object({ kind: z10.literal("minutes"), minutes: z10.number().int().min(15).max(24 * 60) })
  ])
});
async function endQuickDiscounts(tx, branchId, now) {
  const rows = (await tx.select().from(pricingRules).where(and12(eq12(pricingRules.branchId, branchId), eq12(pricingRules.source, "quick")))).filter(
    (r) => isCurrent(r, now)
  );
  for (const r of rows) {
    await tx.update(pricingRules).set({ match: { ...r.match, endsAt: now }, updatedAt: new Date(now) }).where(eq12(pricingRules.id, r.id));
  }
  return rows.length;
}
async function startQuickDiscount(ctx2, actor, raw) {
  const input = quickDiscountInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    await endQuickDiscounts(tx, branch.id, now);
    let endsAt = null;
    if (input.until.kind === "minutes") endsAt = now + input.until.minutes * MINUTE;
    if (input.until.kind === "day_end") {
      endsAt = businessDayRange(await currentDay(tx, branch, now), branch.timezone, branch.settings.day.cutoff).end;
    }
    const id = newId();
    await tx.insert(pricingRules).values({
      id,
      branchId: branch.id,
      source: "quick",
      name: `\u062E\u0635\u0645 ${input.percent}%`,
      priority: 100,
      active: true,
      match: {
        stationTypes: input.stationTypes?.length ? input.stationTypes : null,
        tiers: input.tiers?.length ? input.tiers : null,
        startsAt: now,
        endsAt
      },
      effect: { kind: "percent", percent: -input.percent }
    });
    await record({ type: "discount.started", entity: "pricing_rule", entityId: id, payload: { ...input, endsAt } });
    return { id, endsAt };
  });
}
async function stopQuickDiscount(ctx2, actor) {
  return mutate(ctx2, actor, async (tx, record) => {
    const ended = await endQuickDiscounts(tx, actor.branchId, ctx2.clock.now());
    if (ended) await record({ type: "discount.stopped", entity: "pricing_rule", payload: { ended } });
    return { ended };
  });
}
var packageInput = z10.object({
  name: z10.string().trim().min(1).max(80),
  minutes: z10.number().int().min(15).max(24 * 60),
  price: z10.number().int().min(0),
  active: z10.boolean().default(true),
  match: packageMatchSchema.prefault({})
});
async function listPackages(q, branchId) {
  return q.select().from(packages).where(eq12(packages.branchId, branchId)).orderBy(asc5(packages.minutes));
}
async function savePackage(ctx2, actor, id, raw) {
  const input = packageInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    if (id) {
      const res = await tx.update(packages).set({ ...input, updatedAt: new Date(ctx2.clock.now()) }).where(and12(eq12(packages.id, id), eq12(packages.branchId, actor.branchId))).returning({ id: packages.id });
      if (!res.length) throw notFound("package");
      await record({ type: "package.updated", entity: "package", entityId: id, payload: input });
      return { id };
    }
    const pid = newId();
    await tx.insert(packages).values({ ...input, id: pid, branchId: actor.branchId });
    await record({ type: "package.created", entity: "package", entityId: pid, payload: input });
    return { id: pid };
  });
}
var productInput = z10.object({
  name: z10.string().trim().min(1).max(60),
  category: z10.string().trim().min(1).max(40),
  price: z10.number().int().min(0),
  trackStock: z10.boolean().default(false),
  lowStockAt: z10.number().int().min(0).default(0),
  active: z10.boolean().default(true),
  sort: z10.number().int().default(0),
  /**
   * Pieces on the shelf: the opening count of a new product, or a recount when editing. Never a
   * default (a partial update must not reset the stock); every change is a stock movement.
   */
  stockQty: z10.number().int().min(0).max(1e6).optional()
});
async function listProducts(q, branchId) {
  return q.select().from(products).where(and12(eq12(products.branchId, branchId), isNull4(products.archivedAt))).orderBy(asc5(products.category), asc5(products.sort), asc5(products.name));
}
async function deleteProduct(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    const [cur] = await tx.select().from(products).where(and12(eq12(products.id, id), eq12(products.branchId, actor.branchId), isNull4(products.archivedAt)));
    if (!cur) throw notFound("product");
    await tx.update(products).set({ archivedAt: now, active: false, updatedAt: now }).where(eq12(products.id, id));
    await record({ type: "product.deleted", entity: "product", entityId: id, payload: { name: cur.name, stockQty: cur.stockQty } });
    return { id };
  });
}
async function saveProduct(ctx2, actor, id, raw) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    const name = raw?.name;
    if (typeof name === "string" && name.trim()) {
      const same = await tx.select({ id: products.id }).from(products).where(and12(eq12(products.branchId, actor.branchId), isNull4(products.archivedAt), sql5`lower(${products.name}) = lower(${name.trim()})`));
      if (same.some((p) => p.id !== id)) throw new DomainError("name_taken", "Another product already has this name");
    }
    const branch = await getBranch(tx, actor.branchId);
    const movement = async (productId, delta, reason, unitPrice) => tx.insert(stockMovements).values({
      id: newId(),
      branchId: branch.id,
      productId,
      delta,
      reason,
      unitPrice,
      businessDay: await currentDay(tx, branch, now.getTime()),
      createdBy: actor.id
    });
    if (id) {
      const { stockQty: stockQty2, ...input2 } = productInput.partial().parse(raw);
      const [cur] = await tx.select().from(products).where(and12(eq12(products.id, id), eq12(products.branchId, actor.branchId), isNull4(products.archivedAt)));
      if (!cur) throw notFound("product");
      const recount = stockQty2 !== void 0 && stockQty2 !== cur.stockQty;
      await tx.update(products).set({ ...input2, ...recount ? { stockQty: stockQty2, trackStock: true } : {}, updatedAt: now }).where(eq12(products.id, id));
      if (recount) await movement(id, stockQty2 - cur.stockQty, "adjust", null);
      await record({ type: "product.updated", entity: "product", entityId: id, payload: { ...input2, ...recount ? { stockQty: stockQty2, from: cur.stockQty } : {} } });
      return { id };
    }
    const { stockQty = 0, ...input } = productInput.parse(raw);
    const pid = newId();
    await tx.insert(products).values({ ...input, trackStock: input.trackStock || stockQty > 0, stockQty, id: pid, branchId: actor.branchId });
    if (stockQty > 0) await movement(pid, stockQty, "purchase", input.price);
    await record({ type: "product.created", entity: "product", entityId: pid, payload: { ...input, stockQty } });
    return { id: pid };
  });
}
var pin = z10.string().regex(/^\d{4,8}$/, "4\u20138 digits");
var staffInput = z10.object({
  name: z10.string().trim().min(1).max(60),
  role: z10.enum(["owner", "manager", "cashier", "waiter"]),
  pin: pin.optional(),
  active: z10.boolean().default(true)
});
async function listStaff(q, actor) {
  return q.select({ id: users.id, name: users.name, role: users.role, active: users.active, branchId: users.branchId }).from(users).where(and12(eq12(users.orgId, actor.orgId), or3(isNull4(users.branchId), eq12(users.branchId, actor.branchId)))).orderBy(asc5(users.name));
}
async function saveStaff(ctx2, actor, id, raw) {
  const input = id ? staffInput.partial().parse(raw) : staffInput.extend({ pin }).parse(raw);
  if (actor.role !== "owner" && (input.role === "owner" || input.role === "manager")) throw forbidden();
  const assertStrongPin = (role) => {
    if (ctx2.config.mode === "cloud" && input.pin && (role === "owner" || role === "manager") && input.pin.length < 6) {
      throw new DomainError("weak_pin", "Owner and manager PINs must be at least 6 digits online");
    }
  };
  if (!id) assertStrongPin(input.role);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    const pinHash = input.pin ? await hashPin(input.pin) : void 0;
    if (id) {
      const [cur] = await tx.select().from(users).where(and12(eq12(users.id, id), eq12(users.orgId, actor.orgId)));
      if (!cur) throw notFound("staff member");
      if (actor.role !== "owner" && (cur.role === "owner" || cur.role === "manager")) throw forbidden();
      assertStrongPin(input.role ?? cur.role);
      const losesOwner = cur.role === "owner" && cur.active && (input.role && input.role !== "owner" || input.active === false);
      if (losesOwner) {
        const owners = await tx.select({ id: users.id }).from(users).where(and12(eq12(users.orgId, actor.orgId), eq12(users.role, "owner"), eq12(users.active, true)));
        if (owners.filter((o) => o.id !== id).length === 0) throw new DomainError("last_owner", "The last active owner cannot be removed or demoted");
      }
      const { pin: _pin, ...rest } = input;
      await tx.update(users).set({ ...rest, ...pinHash ? { pinHash } : {}, updatedAt: now }).where(eq12(users.id, id));
      await record({ type: "staff.updated", entity: "user", entityId: id, payload: { ...rest, pinChanged: !!pinHash } });
      return { id };
    }
    const uid = newId();
    await tx.insert(users).values({
      id: uid,
      orgId: actor.orgId,
      branchId: input.role === "owner" ? null : actor.branchId,
      name: input.name,
      role: input.role,
      pinHash,
      active: input.active ?? true
    });
    await record({ type: "staff.created", entity: "user", entityId: uid, payload: { name: input.name, role: input.role } });
    return { id: uid };
  });
}

// src/services/floor.ts
async function floorSnapshot(q, branchId, now) {
  const branch = await getBranch(q, branchId);
  const [day, stationRows, archivedStations, rules, pkgs, shift, uncounted, controllerRows] = await Promise.all([
    currentDay(q, branch, now),
    listStations(q, branchId),
    listArchivedStations(q, branchId),
    listRules(q, branchId),
    listPackages(q, branchId),
    currentShift(q, branchId),
    uncountedShifts(q, branchId),
    listControllers(q, branchId)
  ]);
  const live = await q.select().from(sessions).where(and13(eq13(sessions.branchId, branchId), inArray10(sessions.status, ["running", "ended"])));
  const ids = live.map((s) => s.id);
  const segs = await loadSegments(q, ids);
  const carried = await carriedSoFar(q, ids);
  const items = ids.length ? await q.select({ sessionId: orders.sessionId, qty: orderItems.qty, unitPrice: orderItems.unitPrice, voided: orderItems.voided }).from(orderItems).innerJoin(orders, eq13(orders.id, orderItems.orderId)).where(and13(inArray10(orders.sessionId, ids), eq13(orders.status, "open"))) : [];
  const custIds = [...new Set(live.map((s) => s.customerId).filter((x) => !!x))];
  const custRows = custIds.length ? await q.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(inArray10(customers.id, custIds)) : [];
  const custOf = new Map(custRows.map((c) => [c.id, c]));
  const resIds = live.map((s) => s.reservationId).filter((x) => !!x);
  const paidRows = ids.length ? await q.select({ sessionId: payments.sessionId, method: payments.method, amount: payments.amount, billId: payments.billId }).from(payments).where(and13(eq13(payments.branchId, branchId), inArray10(payments.sessionId, ids))) : [];
  const depositRows = resIds.length ? await q.select({ reservationId: payments.reservationId, method: payments.method, amount: payments.amount, billId: payments.billId }).from(payments).where(and13(inArray10(payments.reservationId, resIds), eq13(payments.kind, "deposit"))) : [];
  const upcoming = await q.select().from(reservations).where(
    and13(
      eq13(reservations.branchId, branchId),
      inArray10(reservations.status, ["confirmed"]),
      gte3(reservations.startAt, new Date(now - 6 * 60 * MINUTE)),
      lt5(reservations.startAt, new Date(now + 24 * 60 * MINUTE))
    )
  );
  return {
    now,
    day,
    branch: {
      id: branch.id,
      name: branch.name,
      timezone: branch.timezone,
      currency: branch.currency,
      currencyDecimals: branch.currencyDecimals,
      locale: branch.locale,
      settings: branch.settings
    },
    shift,
    /** Drawers the day's end closed by itself and nobody counted yet. */
    uncountedShifts: uncounted,
    stations: stationRows,
    /** Deleted stations (id + name), so past sessions in the ledger still name their station. */
    archivedStations,
    rules,
    packages: pkgs,
    reservations: upcoming.map((r) => ({ ...r, startAt: r.startAt.getTime() })),
    controllers: controllerRows.map((c) => ({
      id: c.id,
      number: c.number,
      stationId: c.stationId,
      status: c.status,
      chargingSince: c.chargingSince?.getTime() ?? null,
      readyAt: c.readyAt?.getTime() ?? null,
      note: c.note
    })),
    sessions: live.map((s) => {
      const its = items.filter((i) => i.sessionId === s.id && !i.voided);
      const paidByMethod = {};
      for (const p of [
        ...paidRows.filter((p2) => p2.sessionId === s.id && !p2.billId),
        ...depositRows.filter((p2) => p2.reservationId === s.reservationId && !p2.billId)
      ]) {
        paidByMethod[p.method] = (paidByMethod[p.method] ?? 0) + p.amount;
      }
      const paid = Object.values(paidByMethod).reduce((a, b) => a + b, 0);
      return {
        id: s.id,
        kind: s.kind,
        status: s.status,
        stationId: s.stationId,
        plannedMinutes: s.plannedMinutes,
        packageId: s.packageId,
        label: s.label,
        /** The number registered for this session (it earns a free hour after a long session). */
        customer: s.customerId && custOf.get(s.customerId)?.phone ? { id: s.customerId, name: custOf.get(s.customerId).name, phone: custOf.get(s.customerId).phone } : null,
        reservationId: s.reservationId,
        startedAt: s.startedAt.getTime(),
        endedAt: s.endedAt?.getTime() ?? null,
        itemsCount: its.reduce((a, i) => a + i.qty, 0),
        itemsTotal: its.reduce((a, i) => a + i.qty * i.unitPrice, 0),
        paid,
        paidByMethod,
        /** Already counted in an earlier day's income (it ran past that day's end) — for the ledger only. */
        carried: { time: carried.get(s.id)?.time ?? 0, items: carried.get(s.id)?.items ?? 0 },
        segments: (segs.get(s.id) ?? []).map((g) => ({
          stationId: g.stationId,
          mode: g.mode,
          paused: g.paused,
          startedAt: g.startedAt.getTime(),
          endedAt: g.endedAt?.getTime() ?? null
        }))
      };
    })
  };
}

// src/services/manualEntry.ts
import { and as and14, eq as eq14, gte as gte4, sql as sql6 } from "drizzle-orm";
import { DateTime as DateTime4 } from "luxon";
import { z as z11 } from "zod";
var manualEntryInput = z11.object({
  /** Business day this entry belongs to, YYYY-MM-DD. */
  day: z11.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Station name as shown on the ledger (e.g. "جهاز 1", "VIP 1"). */
  stationName: z11.string().trim().min(1).max(80),
  /** Duration in minutes that was played. */
  durationMinutes: z11.number().int().min(1).max(24 * 60),
  /** Total amount in minor currency units (e.g. JOD: 8350 = 8.350 JD). */
  total: z11.number().int().min(1),
  /** Payment method. */
  method: z11.enum(["cash", "card"]).default("cash"),
  /** Optional note shown on the ledger row. */
  note: z11.string().trim().max(200).nullish()
});
async function matchStationId(tx, branchId, stationName) {
  const rows = await tx.select({ id: stations.id, name: stations.name }).from(stations).where(eq14(stations.branchId, branchId));
  const norm = (s) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const target = norm(stationName);
  for (const r of rows) {
    if (norm(r.name) === target) return r.id;
  }
  const numMatch = stationName.match(/(\d+)/);
  if (numMatch) {
    const num = Number(numMatch[1]);
    const isVip = /vip|في\s*اي\s*بي/i.test(stationName);
    for (const r of rows) {
      const rVip = /vip/i.test(r.name);
      const rNum = r.name.match(/(\d+)/);
      if (rNum && Number(rNum[1]) === num && rVip === isVip) return r.id;
    }
  }
  return null;
}
async function insertManualBill(tx, branch, now, actorId, entry) {
  const openDay = await currentDay(tx, branch, now);
  let [dayRow] = await tx.select().from(businessDays).where(and14(eq14(businessDays.branchId, branch.id), eq14(businessDays.day, entry.day)));
  if (!dayRow) {
    const range = businessDayRange(entry.day, branch.timezone, branch.settings.day.cutoff);
    const isPast = entry.day < openDay;
    const id = newId();
    await tx.insert(businessDays).values({
      id,
      branchId: branch.id,
      day: entry.day,
      status: isPast ? "closed" : "open",
      openedAt: new Date(range.start),
      closedAt: isPast ? new Date(range.end) : null,
      auto: isPast,
      archived: false
    });
    [dayRow] = await tx.select().from(businessDays).where(eq14(businessDays.id, id));
  } else if (dayRow.archived) {
    await tx.update(businessDays).set({ archived: false }).where(eq14(businessDays.id, dayRow.id));
  }
  const shift = entry.day === openDay ? await openShift(tx, branch.id) : null;
  const stationId = await matchStationId(tx, branch.id, entry.stationName);
  const [seq] = await tx.update(branches).set({ billSeq: sql6`${branches.billSeq} + 1` }).where(eq14(branches.id, branch.id)).returning({ number: branches.billSeq });
  const playedMs = entry.durationMinutes * 60 * 1e3;
  const billId = newId();
  await tx.insert(bills).values({
    id: billId,
    branchId: branch.id,
    number: seq.number,
    businessDay: entry.day,
    sessionId: null,
    shiftId: shift?.id ?? null,
    timeCharge: entry.total,
    itemsTotal: 0,
    discountAmount: 0,
    discountReason: null,
    rounding: 0,
    total: entry.total,
    paid: entry.total,
    status: "paid",
    breakdown: {
      stationName: entry.stationName,
      label: entry.note ?? null,
      startedAt: null,
      endedAt: null,
      time: {
        playedMs,
        billableMs: playedMs,
        total: entry.total,
        lines: stationId ? [
          {
            stationId,
            mode: "single",
            ms: playedMs,
            ratePerHour: Math.round(entry.total * 60 / entry.durationMinutes),
            amount: entry.total
          }
        ] : []
      },
      items: [],
      manual: true,
      ...entry.paperSeedKey ? { paperSeedKey: entry.paperSeedKey } : {}
    },
    createdBy: actorId,
    approvedBy: null
  });
  await tx.insert(payments).values({
    id: newId(),
    branchId: branch.id,
    businessDay: entry.day,
    shiftId: shift?.id ?? null,
    billId,
    sessionId: null,
    reservationId: null,
    method: entry.method,
    kind: "payment",
    amount: entry.total,
    note: entry.note ?? null,
    createdBy: actorId,
    approvedBy: null
  });
  const [updatedDayRow] = await tx.select().from(businessDays).where(and14(eq14(businessDays.branchId, branch.id), eq14(businessDays.day, entry.day)));
  if (updatedDayRow?.status === "closed") {
    const report = await buildDayReport(tx, branch, entry.day, now);
    await tx.update(businessDays).set({ report }).where(eq14(businessDays.id, updatedDayRow.id));
  }
  return { billId, number: seq.number };
}
async function addManualEntry(ctx2, actor, raw) {
  const input = manualEntryInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const res = await insertManualBill(tx, branch, now, actor.id, input);
    await record({
      type: "bill.manual_added",
      entity: "bill",
      entityId: res.billId,
      payload: {
        day: input.day,
        stationName: input.stationName,
        durationMinutes: input.durationMinutes,
        total: input.total,
        method: input.method
      }
    });
    return res;
  });
}
var DAY_11_PAPER_ENTRIES = [
  { key: "day11-ps1-4h20m-8350", stationName: "\u062C\u0647\u0627\u0632 1", durationMinutes: 4 * 60 + 20, total: 8350 },
  { key: "day11-ps2-1h00m-1500", stationName: "\u062C\u0647\u0627\u0632 2", durationMinutes: 1 * 60, total: 1500 },
  { key: "day11-ps5-1h20m-2500", stationName: "\u062C\u0647\u0627\u0632 5", durationMinutes: 1 * 60 + 20, total: 2500 },
  { key: "day11-vip1-5h10m-10250", stationName: "VIP 1", durationMinutes: 5 * 60 + 10, total: 10250 }
];
async function ensureDay11PaperSessions(ctx2) {
  const allBranches = await ctx2.db.select({ id: branches.id }).from(branches);
  const now = ctx2.clock.now();
  for (const b of allBranches) {
    await ctx2.db.transaction(async (tx) => {
      const branch = await getBranch(tx, b.id);
      const todayIso = businessDayOf(now, branch.timezone, branch.settings.day.cutoff);
      const yearMonth = todayIso.slice(0, 7);
      const targetDay = `${yearMonth}-11`;
      const existingBills = await tx.select({ breakdown: bills.breakdown, status: bills.status }).from(bills).where(and14(eq14(bills.branchId, branch.id), eq14(bills.businessDay, targetDay)));
      const existingKeys = new Set(
        existingBills.map((row) => row.breakdown?.paperSeedKey).filter((k) => !!k)
      );
      for (const item of DAY_11_PAPER_ENTRIES) {
        if (existingKeys.has(item.key)) continue;
        await insertManualBill(tx, branch, now, null, {
          day: targetDay,
          stationName: item.stationName,
          durationMinutes: item.durationMinutes,
          total: item.total,
          method: "cash",
          paperSeedKey: item.key
        });
      }
    });
  }
}
async function shiftLedgerDatesFromOct13(ctx2) {
  const allBranches = await ctx2.db.select({ id: branches.id }).from(branches);
  const now = ctx2.clock.now();
  for (const b of allBranches) {
    const [alreadyDone] = await ctx2.db.select({ id: events.id }).from(events).where(and14(eq14(events.branchId, b.id), eq14(events.type, "system.ledger_shifted_oct13_v1")));
    if (alreadyDone) continue;
    await ctx2.db.transaction(async (tx) => {
      const branch = await getBranch(tx, b.id);
      const [allBills, allPayments, allShifts, allDays] = await Promise.all([
        tx.select({ day: bills.businessDay }).from(bills).where(and14(eq14(bills.branchId, b.id), gte4(bills.businessDay, "2026-10-13"))),
        tx.select({ day: payments.businessDay }).from(payments).where(and14(eq14(payments.branchId, b.id), gte4(payments.businessDay, "2026-10-13"))),
        tx.select({ day: shifts.businessDay }).from(shifts).where(and14(eq14(shifts.branchId, b.id), gte4(shifts.businessDay, "2026-10-13"))),
        tx.select({ day: businessDays.day }).from(businessDays).where(and14(eq14(businessDays.branchId, b.id), gte4(businessDays.day, "2026-10-13")))
      ]);
      const daysSet = /* @__PURE__ */ new Set();
      for (const r of allBills) if (r.day) daysSet.add(r.day);
      for (const r of allPayments) if (r.day) daysSet.add(r.day);
      for (const r of allShifts) if (r.day) daysSet.add(r.day);
      for (const r of allDays) if (r.day) daysSet.add(r.day);
      const sortedDays = [...daysSet].sort();
      const touchedTargetDays = /* @__PURE__ */ new Set();
      for (const oldDay of sortedDays) {
        const prevDay = DateTime4.fromISO(oldDay).minus({ days: 1 }).toISODate();
        touchedTargetDays.add(prevDay);
        await tx.update(bills).set({ businessDay: prevDay }).where(and14(eq14(bills.branchId, b.id), eq14(bills.businessDay, oldDay)));
        await tx.update(payments).set({ businessDay: prevDay }).where(and14(eq14(payments.branchId, b.id), eq14(payments.businessDay, oldDay)));
        await tx.update(shifts).set({ businessDay: prevDay }).where(and14(eq14(shifts.branchId, b.id), eq14(shifts.businessDay, oldDay)));
        await tx.update(cashWithdrawals).set({ businessDay: prevDay }).where(and14(eq14(cashWithdrawals.branchId, b.id), eq14(cashWithdrawals.businessDay, oldDay)));
        await tx.update(stockMovements).set({ businessDay: prevDay }).where(and14(eq14(stockMovements.branchId, b.id), eq14(stockMovements.businessDay, oldDay)));
        await tx.update(dayCarries).set({ businessDay: prevDay }).where(and14(eq14(dayCarries.branchId, b.id), eq14(dayCarries.businessDay, oldDay)));
        await tx.update(rewards).set({ earnedDay: prevDay }).where(and14(eq14(rewards.branchId, b.id), eq14(rewards.earnedDay, oldDay)));
      }
      for (const targetDay of touchedTargetDays) {
        const [existing] = await tx.select().from(businessDays).where(and14(eq14(businessDays.branchId, b.id), eq14(businessDays.day, targetDay)));
        if (!existing) {
          const range = businessDayRange(targetDay, branch.timezone, branch.settings.day.cutoff);
          await tx.insert(businessDays).values({
            id: newId(),
            branchId: b.id,
            day: targetDay,
            status: "closed",
            openedAt: new Date(range.start),
            closedAt: new Date(range.end),
            auto: true,
            archived: false
          });
        }
      }
      const [currentOpen] = await tx.select().from(businessDays).where(and14(eq14(businessDays.branchId, b.id), eq14(businessDays.status, "open")));
      if (currentOpen && currentOpen.day >= "2026-10-13") {
        const shiftedOpenDay = DateTime4.fromISO(currentOpen.day).minus({ days: 1 }).toISODate();
        await tx.update(businessDays).set({ status: "open" }).where(and14(eq14(businessDays.branchId, b.id), eq14(businessDays.day, shiftedOpenDay)));
        await tx.delete(businessDays).where(and14(eq14(businessDays.branchId, b.id), eq14(businessDays.day, currentOpen.day)));
      }
      for (const targetDay of touchedTargetDays) {
        const [d] = await tx.select().from(businessDays).where(and14(eq14(businessDays.branchId, b.id), eq14(businessDays.day, targetDay)));
        if (d && d.status === "closed") {
          try {
            const report = await buildDayReport(tx, branch, targetDay, now);
            await tx.update(businessDays).set({ report }).where(eq14(businessDays.id, d.id));
          } catch {
          }
        }
      }
      await tx.insert(events).values({
        id: newId(),
        branchId: b.id,
        type: "system.ledger_shifted_oct13_v1",
        entity: "system",
        payload: {
          daysShifted: sortedDays,
          shiftedAt: new Date(now).toISOString()
        },
        createdAt: new Date(now)
      });
    });
  }
}

// src/services/setup.ts
import { and as and15, eq as eq15, inArray as inArray12, isNull as isNull5 } from "drizzle-orm";
import { z as z12 } from "zod";
var SETUP_FORMAT = "lounge-setup";
var stationRow = z12.object({
  name: z12.string().trim().min(1).max(40),
  type: z12.string().trim().min(1).max(20),
  tier: z12.string().trim().min(1).max(20),
  zone: z12.string().trim().max(40).default(""),
  modes: z12.array(z12.string().trim().min(1).max(40)).min(1).max(6),
  sort: z12.number().int().default(0),
  maintenance: z12.boolean().default(false),
  maintenanceNote: z12.string().trim().max(200).nullish(),
  active: z12.boolean().default(true)
});
var stationNames = z12.array(z12.string()).nullish();
var setupFileSchema = z12.object({
  format: z12.literal(SETUP_FORMAT),
  version: z12.literal(1),
  exportedAt: z12.number().int(),
  branch: z12.object({
    name: z12.string().trim().min(1).max(80),
    timezone: z12.string().min(3).max(60),
    currency: z12.string().length(3),
    currencyDecimals: z12.number().int().min(0).max(3),
    locale: z12.string().min(2).max(10),
    settings: z12.unknown()
  }),
  stations: z12.array(stationRow).max(500),
  rules: z12.array(
    z12.object({
      name: z12.string().trim().min(1).max(80),
      priority: z12.number().int().min(-1e3).max(1e3),
      active: z12.boolean(),
      effect: ruleEffectSchema,
      match: ruleMatchSchema.omit({ stationIds: true, startsAt: true, endsAt: true }),
      stationNames
    })
  ).max(500),
  packages: z12.array(
    z12.object({
      name: z12.string().trim().min(1).max(80),
      minutes: z12.number().int().min(1),
      price: z12.number().int().min(0),
      active: z12.boolean(),
      match: packageMatchSchema,
      stationNames
    })
  ).max(200),
  products: z12.array(
    z12.object({
      name: z12.string().trim().min(1).max(60),
      category: z12.string().trim().min(1).max(40),
      price: z12.number().int().min(0),
      trackStock: z12.boolean(),
      lowStockAt: z12.number().int().min(0),
      packSize: z12.number().int().min(1).nullish(),
      active: z12.boolean(),
      sort: z12.number().int()
    })
  ).max(1e3),
  controllers: z12.array(z12.object({ number: z12.number().int().min(1).max(9999), note: z12.string().max(200).nullish(), active: z12.boolean() })).max(500)
});
async function exportSetup(q, actor, now) {
  const branch = await getBranch(q, actor.branchId);
  const [st, rules, pkgs, prods, ctrls] = await Promise.all([
    q.select().from(stations).where(and15(eq15(stations.branchId, branch.id), isNull5(stations.archivedAt))),
    listCurrentRules(q, branch.id, now),
    q.select().from(packages).where(eq15(packages.branchId, branch.id)),
    q.select().from(products).where(and15(eq15(products.branchId, branch.id), isNull5(products.archivedAt))),
    q.select().from(controllers).where(eq15(controllers.branchId, branch.id))
  ]);
  const nameOf = new Map(st.map((s) => [s.id, s.name]));
  const split = (match) => {
    const { stationIds, startsAt: _s, endsAt: _e, ...rest } = match;
    return { match: rest, stationNames: stationIds?.length ? stationIds.map((id) => nameOf.get(id)).filter((n) => !!n) : null };
  };
  return {
    format: SETUP_FORMAT,
    version: 1,
    exportedAt: now,
    branch: {
      name: branch.name,
      timezone: branch.timezone,
      currency: branch.currency,
      currencyDecimals: branch.currencyDecimals,
      locale: branch.locale,
      settings: branch.settings
    },
    stations: st.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((s) => ({ name: s.name, type: s.type, tier: s.tier, zone: s.zone, modes: s.modes, sort: s.sort, maintenance: s.maintenance, maintenanceNote: s.maintenanceNote, active: s.active })),
    rules: rules.map((r) => ({ name: r.name, priority: r.priority, active: r.active, effect: r.effect, ...split(r.match) })),
    packages: pkgs.map((p) => ({ name: p.name, minutes: p.minutes, price: p.price, active: p.active, ...split(p.match) })),
    products: prods.map((p) => ({ name: p.name, category: p.category, price: p.price, trackStock: p.trackStock, lowStockAt: p.lowStockAt, packSize: p.packSize, active: p.active, sort: p.sort })),
    controllers: ctrls.sort((a, b) => a.number - b.number).map((c) => ({ number: c.number, note: c.note, active: c.active }))
  };
}
async function importSetup(ctx2, actor, raw) {
  if (actor.role !== "owner") throw forbidden();
  const file = setupFileSchema.parse(raw);
  const settings = branchSettingsSchema.parse(parseBranchSettings(file.branch.settings));
  try {
    new Intl.DateTimeFormat("en", { timeZone: file.branch.timezone });
  } catch {
    throw new DomainError("invalid_timezone", "Unknown time zone");
  }
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    const branchId = actor.branchId;
    const [hasStation] = await tx.select({ id: stations.id }).from(stations).where(and15(eq15(stations.branchId, branchId), isNull5(stations.archivedAt))).limit(1);
    const [hasProduct] = await tx.select({ id: products.id }).from(products).where(and15(eq15(products.branchId, branchId), isNull5(products.archivedAt))).limit(1);
    const [hasSession] = await tx.select({ id: sessions.id }).from(sessions).where(eq15(sessions.branchId, branchId)).limit(1);
    const [hasPayment] = await tx.select({ id: payments.id }).from(payments).where(eq15(payments.branchId, branchId)).limit(1);
    if (hasStation || hasProduct || hasSession || hasPayment) {
      throw new DomainError("import_not_empty", "Setup can only be imported into an empty shop");
    }
    await tx.update(branches).set({
      name: file.branch.name,
      timezone: file.branch.timezone,
      currency: file.branch.currency.toUpperCase(),
      currencyDecimals: file.branch.currencyDecimals,
      locale: file.branch.locale,
      settings,
      updatedAt: now
    }).where(eq15(branches.id, branchId));
    const idOf = /* @__PURE__ */ new Map();
    if (file.stations.length) {
      const rows = file.stations.map((s) => {
        const id = newId();
        idOf.set(s.name.toLowerCase(), id);
        return { ...s, maintenanceNote: s.maintenanceNote ?? null, id, branchId };
      });
      if (new Set(rows.map((r) => r.name.toLowerCase())).size !== rows.length) throw new DomainError("name_taken", "Two stations in the file have the same name");
      await tx.insert(stations).values(rows);
    }
    const ids = (names) => {
      if (!names?.length) return null;
      const out = names.map((n) => idOf.get(n.toLowerCase())).filter((x) => !!x);
      return out.length ? out : null;
    };
    if (file.rules.length) {
      await tx.insert(pricingRules).values(
        file.rules.map((r) => ({
          id: newId(),
          branchId,
          source: "manual",
          name: r.name,
          priority: r.priority,
          active: r.active,
          // Prices are valid from the moment of the import.
          match: { ...r.match, stationIds: ids(r.stationNames), startsAt: now.getTime(), endsAt: null },
          effect: r.effect
        }))
      );
    }
    if (file.packages.length) {
      await tx.insert(packages).values(
        file.packages.map((p) => ({ id: newId(), branchId, name: p.name, minutes: p.minutes, price: p.price, active: p.active, match: { ...p.match, stationIds: ids(p.stationNames) } }))
      );
    }
    if (file.products.length) {
      if (new Set(file.products.map((p) => p.name.toLowerCase())).size !== file.products.length) throw new DomainError("name_taken", "Two products in the file have the same name");
      await tx.insert(products).values(file.products.map((p) => ({ ...p, packSize: p.packSize ?? null, stockQty: 0, id: newId(), branchId })));
    }
    if (file.controllers.length) {
      const numbers = file.controllers.map((c) => c.number);
      const existing = await tx.select({ n: controllers.number }).from(controllers).where(and15(eq15(controllers.branchId, branchId), inArray12(controllers.number, numbers)));
      const taken = new Set(existing.map((e) => e.n));
      const fresh = file.controllers.filter((c) => !taken.has(c.number));
      if (fresh.length) {
        await tx.insert(controllers).values(fresh.map((c) => ({ id: newId(), branchId, number: c.number, note: c.note ?? null, active: c.active, status: "ready" })));
      }
    }
    const counts = { stations: file.stations.length, rules: file.rules.length, packages: file.packages.length, products: file.products.length, controllers: file.controllers.length };
    await record({ type: "setup.imported", entity: "branch", entityId: branchId, payload: counts });
    return counts;
  });
}

// src/services/customers.ts
import { and as and16, count, eq as eq16, isNotNull as isNotNull2, max as max2 } from "drizzle-orm";
import { z as z13 } from "zod";
async function listCustomers(q, orgId, branchId) {
  const rows = await q.select({ id: customers.id, name: customers.name, phone: customers.phone, notes: customers.notes, createdAt: customers.createdAt }).from(customers).where(and16(eq16(customers.orgId, orgId), isNotNull2(customers.phone)));
  const visits = await q.select({ customerId: sessions.customerId, visits: count(), last: max2(sessions.startedAt) }).from(sessions).where(and16(eq16(sessions.branchId, branchId), isNotNull2(sessions.customerId))).groupBy(sessions.customerId);
  const free = await q.select({ customerId: rewards.customerId, n: count() }).from(rewards).where(and16(eq16(rewards.branchId, branchId), eq16(rewards.status, "available"))).groupBy(rewards.customerId);
  const v = new Map(visits.map((x) => [x.customerId, x]));
  const f = new Map(free.map((x) => [x.customerId, x.n]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    createdAt: c.createdAt.getTime(),
    visits: v.get(c.id)?.visits ?? 0,
    lastVisitAt: v.get(c.id)?.last?.getTime() ?? null,
    freeAvailable: f.get(c.id) ?? 0
  })).sort((a, b) => (b.lastVisitAt ?? b.createdAt) - (a.lastVisitAt ?? a.createdAt));
}
var createCustomerInput = z13.object({
  phone: z13.string().trim().min(1).max(30),
  name: z13.string().trim().max(80).nullish(),
  notes: z13.string().trim().max(300).nullish()
});
async function createCustomer(ctx2, actor, raw) {
  const input = createCustomerInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const branch = await getBranch(tx, actor.branchId);
    const c = await customerForPhone(tx, branch, { phone: input.phone, name: input.name, strict: true });
    if (!c) throw new DomainError("invalid_phone", "This phone number is not valid");
    if (input.notes) await tx.update(customers).set({ notes: input.notes, updatedAt: new Date(ctx2.clock.now()) }).where(eq16(customers.id, c.id));
    await record({ type: "customer.saved", entity: "customer", entityId: c.id, payload: { phone: c.phone } });
    return c;
  });
}
var updateCustomerInput = z13.object({
  name: z13.string().trim().min(1).max(80).optional(),
  notes: z13.string().trim().max(300).nullish()
});
async function updateCustomer(ctx2, actor, id, raw) {
  const input = updateCustomerInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const set = { updatedAt: new Date(ctx2.clock.now()) };
    if (input.name !== void 0) set.name = input.name;
    if (input.notes !== void 0) set.notes = input.notes || null;
    const [row] = await tx.update(customers).set(set).where(and16(eq16(customers.id, id), eq16(customers.orgId, actor.orgId))).returning({ id: customers.id });
    if (!row) throw notFound("customer");
    await record({ type: "customer.updated", entity: "customer", entityId: id });
    return { id };
  });
}

// src/services/stock.ts
import { and as and17, asc as asc7, desc as desc4, eq as eq17, inArray as inArray13, isNull as isNull6, sql as sql7 } from "drizzle-orm";
import { z as z14 } from "zod";
var receiveLine = z14.object({
  /** An existing product… */
  productId: z14.uuid().nullish(),
  /** …or a new one created on the spot. */
  newProduct: z14.object({ name: z14.string().trim().min(1).max(60), category: z14.string().trim().min(1).max(40) }).nullish(),
  cartons: z14.number().int().min(1).max(500),
  /** Pieces in one carton. */
  packSize: z14.number().int().min(1).max(1e3),
  /** Selling price per piece (minor units). Absent = keep the current price. */
  price: z14.number().int().min(0).nullish()
}).refine((l) => !!l.productId !== !!l.newProduct, { message: "Choose a product or name a new one" });
var receiveStockInput = z14.object({
  lines: z14.array(receiveLine).min(1).max(50),
  note: z14.string().trim().max(200).nullish()
});
var adjustStockInput = z14.object({
  countedQty: z14.number().int().min(0).max(1e6),
  reason: z14.string().trim().max(200).nullish()
});
async function listStock(q, branchId) {
  return q.select().from(products).where(and17(eq17(products.branchId, branchId), eq17(products.active, true), isNull6(products.archivedAt))).orderBy(desc4(products.trackStock), asc7(products.category), asc7(products.sort), asc7(products.name));
}
async function receiveStock(ctx2, actor, raw) {
  const input = receiveStockInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const day = await currentDay(tx, branch, now);
    const received = [];
    for (const line of input.lines) {
      let productId = line.productId ?? null;
      if (!productId) {
        const [same] = await tx.select({ id: products.id }).from(products).where(and17(eq17(products.branchId, branch.id), isNull6(products.archivedAt), sql7`lower(${products.name}) = lower(${line.newProduct.name})`));
        if (same) throw new DomainError("name_taken", "A product with this name already exists \u2014 pick it from the list");
        productId = newId();
        await tx.insert(products).values({
          id: productId,
          branchId: branch.id,
          name: line.newProduct.name,
          category: line.newProduct.category,
          price: line.price ?? 0,
          trackStock: true,
          stockQty: 0,
          // Warn when about a quarter of a carton is left (editable in Settings → Products).
          lowStockAt: Math.max(3, Math.round(line.packSize / 4))
        });
        await record({ type: "product.created", entity: "product", entityId: productId, payload: { ...line.newProduct, price: line.price ?? 0 } });
      }
      const [p] = await tx.select().from(products).where(and17(eq17(products.id, productId), eq17(products.branchId, branch.id), isNull6(products.archivedAt)));
      if (!p) throw notFound("product");
      const added = line.cartons * line.packSize;
      const [{ stockQty } = { stockQty: 0 }] = await tx.update(products).set({
        stockQty: p.trackStock ? sql7`${products.stockQty} + ${added}` : added,
        trackStock: true,
        active: true,
        packSize: line.packSize,
        ...line.price != null ? { price: line.price } : {},
        updatedAt: new Date(now)
      }).where(eq17(products.id, p.id)).returning({ stockQty: products.stockQty });
      await tx.insert(stockMovements).values({
        id: newId(),
        branchId: branch.id,
        productId: p.id,
        delta: added,
        reason: "purchase",
        cartons: line.cartons,
        packSize: line.packSize,
        unitPrice: line.price ?? p.price,
        note: input.note ?? null,
        businessDay: day,
        createdBy: actor.id
      });
      received.push({ productId: p.id, name: p.name, added, stockQty });
    }
    await record({ type: "stock.received", entity: "product", payload: { lines: received, note: input.note ?? null } });
    return { received };
  });
}
async function adjustStock(ctx2, actor, productId, raw) {
  const input = adjustStockInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const [p] = await tx.select().from(products).where(and17(eq17(products.id, productId), eq17(products.branchId, branch.id)));
    if (!p) throw notFound("product");
    const delta = input.countedQty - p.stockQty;
    await tx.update(products).set({ stockQty: input.countedQty, trackStock: true, updatedAt: new Date(now) }).where(eq17(products.id, p.id));
    await tx.insert(stockMovements).values({
      id: newId(),
      branchId: branch.id,
      productId: p.id,
      delta,
      reason: "adjust",
      note: input.reason ?? null,
      businessDay: await currentDay(tx, branch, now),
      createdBy: actor.id
    });
    await record({
      type: "stock.adjusted",
      entity: "product",
      entityId: p.id,
      payload: { name: p.name, from: p.stockQty, to: input.countedQty, delta },
      reason: input.reason ?? null
    });
    return { id: p.id, delta };
  });
}
async function listMovements(q, branchId, opts) {
  const rows = await q.select({
    id: stockMovements.id,
    productId: stockMovements.productId,
    productName: products.name,
    delta: stockMovements.delta,
    reason: stockMovements.reason,
    cartons: stockMovements.cartons,
    packSize: stockMovements.packSize,
    unitPrice: stockMovements.unitPrice,
    note: stockMovements.note,
    businessDay: stockMovements.businessDay,
    createdBy: stockMovements.createdBy,
    createdAt: stockMovements.createdAt
  }).from(stockMovements).innerJoin(products, eq17(products.id, stockMovements.productId)).where(
    and17(
      eq17(stockMovements.branchId, branchId),
      ...opts.productId ? [eq17(stockMovements.productId, opts.productId)] : []
    )
  ).orderBy(desc4(stockMovements.createdAt)).limit(opts.limit);
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((x) => !!x))];
  const names = ids.length ? await q.select({ id: users.id, name: users.name }).from(users).where(inArray13(users.id, ids)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), createdByName: r.createdBy ? nameOf.get(r.createdBy) ?? null : null }));
}

// src/services/reservations.ts
import { and as and18, asc as asc8, eq as eq18, gte as gte5, inArray as inArray14, isNull as isNull7, lt as lt6 } from "drizzle-orm";
import { z as z15 } from "zod";
var createReservationInput = z15.object({
  stationId: z15.uuid(),
  startAt: z15.number().int(),
  minutes: z15.number().int().min(15).max(24 * 60),
  mode: z15.string().min(1).max(40),
  customerName: z15.string().trim().min(1).max(80),
  customerPhone: z15.string().trim().max(30).nullish(),
  deposit: z15.object({ amount: z15.number().int().min(1), method: z15.enum(["cash", "card"]) }).nullish(),
  note: z15.string().trim().max(300).nullish()
});
var cancelReservationInput = z15.object({
  refundMethod: z15.enum(["cash", "card"]).default("cash"),
  reason: z15.string().trim().max(200).nullish()
});
var refundReservationInput = z15.object({
  method: z15.enum(["cash", "card"]).default("cash")
});
var like2 = (r) => ({
  startAt: r.startAt.getTime(),
  minutes: r.minutes,
  deposit: r.deposit,
  status: r.status
});
async function getReservation(q, branchId, id) {
  const [r] = await q.select().from(reservations).where(and18(eq18(reservations.id, id), eq18(reservations.branchId, branchId)));
  if (!r) throw notFound("reservation");
  return r;
}
async function createReservation(ctx2, actor, raw) {
  const input = createReservationInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const station2 = await getStation(tx, branch.id, input.stationId);
    assertUsable(station2, input.mode);
    if (input.startAt < now - 5 * MINUTE) throw new DomainError("reservation_in_past", "Reservation time is in the past");
    const sameStation = await tx.select().from(reservations).where(
      and18(
        eq18(reservations.stationId, station2.id),
        inArray14(reservations.status, ["confirmed", "checked_in"]),
        gte5(reservations.startAt, new Date(input.startAt - 24 * 60 * MINUTE)),
        lt6(reservations.startAt, new Date(input.startAt + input.minutes * MINUTE))
      )
    );
    const clash = sameStation.find((r) => overlaps(r.startAt.getTime(), r.minutes, input.startAt, input.minutes));
    if (clash) {
      throw new DomainError("reservation_conflict", "Station is already booked at that time", {
        reservationId: clash.id,
        customerName: clash.customerName,
        startAt: clash.startAt.getTime()
      });
    }
    const id = newId();
    await tx.insert(reservations).values({
      id,
      branchId: branch.id,
      stationId: station2.id,
      customerName: input.customerName,
      customerPhone: input.customerPhone ?? null,
      startAt: new Date(input.startAt),
      minutes: input.minutes,
      mode: input.mode,
      deposit: input.deposit?.amount ?? 0,
      status: "confirmed",
      note: input.note ?? null,
      createdBy: actor.id
    });
    if (input.deposit) {
      const shift = await requireOpenShift(tx, branch.id);
      await tx.insert(payments).values({
        id: newId(),
        branchId: branch.id,
        businessDay: await currentDay(tx, branch, now),
        shiftId: shift.id,
        reservationId: id,
        method: input.deposit.method,
        kind: "deposit",
        amount: input.deposit.amount,
        createdBy: actor.id
      });
    }
    await record({
      type: "reservation.created",
      entity: "reservation",
      entityId: id,
      payload: { stationId: station2.id, startAt: input.startAt, minutes: input.minutes, deposit: input.deposit?.amount ?? 0 }
    });
    return { id };
  });
}
async function refundDeposit(tx, branch, actor, r, amount, method, now) {
  if (amount <= 0) return;
  const shift = await requireOpenShift(tx, branch.id);
  await tx.insert(payments).values({
    id: newId(),
    branchId: branch.id,
    businessDay: await currentDay(tx, branch, now),
    shiftId: shift.id,
    reservationId: r.id,
    method,
    kind: "refund",
    amount: -amount,
    createdBy: actor.id
  });
}
async function cancelReservation(ctx2, actor, id, raw) {
  const input = cancelReservationInput.parse(raw ?? {});
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const r = await getReservation(tx, branch.id, id);
    if (r.status !== "confirmed") throw new DomainError("reservation_not_confirmed", "Only a confirmed reservation can be cancelled");
    const outcome = evaluateCancellation(like2(r), now, branch.settings.reservations);
    await refundDeposit(tx, branch, actor, r, outcome.refund, input.refundMethod, now);
    await tx.update(reservations).set({ status: "cancelled", fee: outcome.fee, refunded: outcome.refund, cancelledAt: new Date(now), updatedAt: new Date(now) }).where(eq18(reservations.id, id));
    await record({
      type: "reservation.cancelled",
      entity: "reservation",
      entityId: id,
      payload: { ...outcome },
      reason: input.reason ?? null
    });
    return { id, ...outcome };
  });
}
async function refundReservation(ctx2, actor, id, raw) {
  const input = refundReservationInput.parse(raw ?? {});
  return mutate(ctx2, actor, async (tx, record) => {
    const now = ctx2.clock.now();
    const branch = await getBranch(tx, actor.branchId);
    const r = await getReservation(tx, branch.id, id);
    if (r.status !== "no_show" && r.status !== "cancelled") throw new DomainError("not_refundable", "Nothing to refund");
    const owed = r.deposit - r.fee - r.refunded;
    if (owed <= 0) throw new DomainError("not_refundable", "Nothing to refund");
    await refundDeposit(tx, branch, actor, r, owed, input.method, now);
    await tx.update(reservations).set({ refunded: r.refunded + owed, updatedAt: new Date(now) }).where(eq18(reservations.id, id));
    await record({ type: "reservation.refunded", entity: "reservation", entityId: id, payload: { amount: owed } });
    return { id, refunded: owed };
  });
}
async function deleteReservation(ctx2, actor, id) {
  return mutate(ctx2, actor, async (tx, record) => {
    const now = new Date(ctx2.clock.now());
    const r = await getReservation(tx, actor.branchId, id);
    if (r.archivedAt) throw notFound("reservation");
    if (r.status === "checked_in") throw new DomainError("reservation_in_use", "The customer is playing \u2014 end the session instead");
    if (r.status === "confirmed" && r.deposit > 0) throw new DomainError("reservation_has_deposit", "Cancel the booking first, to settle its deposit");
    if (r.deposit - r.fee - r.refunded > 0 && (r.status === "cancelled" || r.status === "no_show")) {
      throw new DomainError("reservation_refund_due", "Give the deposit back first");
    }
    await tx.update(reservations).set({
      // A booking deleted before its time frees the station like a cancellation.
      ...r.status === "confirmed" ? { status: "cancelled", cancelledAt: now } : {},
      archivedAt: now,
      updatedAt: now
    }).where(eq18(reservations.id, id));
    await record({ type: "reservation.deleted", entity: "reservation", entityId: id, payload: { customerName: r.customerName, status: r.status } });
    return { id };
  });
}
async function listReservations(q, branchId, from, to) {
  return q.select().from(reservations).where(
    and18(
      eq18(reservations.branchId, branchId),
      isNull7(reservations.archivedAt),
      gte5(reservations.startAt, new Date(from)),
      lt6(reservations.startAt, new Date(to))
    )
  ).orderBy(asc8(reservations.startAt));
}
async function sweepNoShows(ctx2, branchId) {
  const now = ctx2.clock.now();
  const branch = await getBranch(ctx2.db, branchId);
  const due = (await ctx2.db.select().from(reservations).where(and18(eq18(reservations.branchId, branchId), eq18(reservations.status, "confirmed"), lt6(reservations.startAt, new Date(now))))).filter((r) => isNoShow(like2(r), now, branch.settings.reservations));
  for (const r of due) {
    await mutate(ctx2, { id: null, branchId }, async (tx, record) => {
      const outcome = noShowOutcome(like2(r), branch.settings.reservations);
      await tx.update(reservations).set({ status: "no_show", fee: outcome.fee, updatedAt: new Date(now) }).where(and18(eq18(reservations.id, r.id), eq18(reservations.status, "confirmed")));
      await record({ type: "reservation.no_show", entity: "reservation", entityId: r.id, payload: { ...outcome } });
    });
  }
  return due.length;
}

// src/services/withdrawals.ts
import { and as and19, asc as asc9, eq as eq19 } from "drizzle-orm";
import { z as z16 } from "zod";
var withdrawalInput = z16.object({
  amount: z16.number().int().min(1),
  /** Who took it / what for ("the accountant"). */
  note: z16.string().trim().max(200).nullish()
});
async function createWithdrawal(ctx2, actor, raw) {
  const input = withdrawalInput.parse(raw);
  return mutate(ctx2, actor, async (tx, record) => {
    const shift = await requireOpenShift(tx, actor.branchId);
    const summary = await shiftSummary(tx, shift.id);
    if (input.amount > summary.expectedCash) {
      throw new DomainError("withdrawal_too_large", "The drawer does not hold that much", { expectedCash: summary.expectedCash });
    }
    const id = newId();
    await tx.insert(cashWithdrawals).values({
      id,
      branchId: actor.branchId,
      shiftId: shift.id,
      businessDay: shift.businessDay,
      amount: input.amount,
      note: input.note || null,
      createdBy: actor.id
    });
    await record({ type: "cash.withdrawn", entity: "cash_withdrawal", entityId: id, payload: { amount: input.amount, shiftId: shift.id }, reason: input.note ?? null });
    return { id, expectedCash: summary.expectedCash - input.amount };
  });
}
var voidWithdrawalInput = z16.object({ reason: z16.string().trim().max(200).nullish() });
async function voidWithdrawal(ctx2, actor, id, raw) {
  const input = voidWithdrawalInput.parse(raw ?? {});
  return mutate(ctx2, actor, async (tx, record) => {
    const open = await requireOpenShift(tx, actor.branchId);
    const [w] = await tx.select().from(cashWithdrawals).where(and19(eq19(cashWithdrawals.id, id), eq19(cashWithdrawals.branchId, actor.branchId)));
    if (!w) throw notFound("withdrawal");
    if (w.status === "void") throw new DomainError("withdrawal_void", "This withdrawal was already cancelled");
    if (w.shiftId !== open.id) throw new DomainError("withdrawal_shift_closed", "That shift is closed, its drawer was counted with this withdrawal");
    await tx.update(cashWithdrawals).set({ status: "void", voidReason: input.reason || null }).where(eq19(cashWithdrawals.id, id));
    await record({ type: "cash.withdrawal_voided", entity: "cash_withdrawal", entityId: id, payload: { amount: w.amount }, reason: input.reason ?? null });
    return { id };
  });
}
async function listWithdrawals(q, branchId, day) {
  if ((await archivedDays(q, branchId)).has(day)) return [];
  const rows = await q.select({
    id: cashWithdrawals.id,
    amount: cashWithdrawals.amount,
    note: cashWithdrawals.note,
    status: cashWithdrawals.status,
    createdAt: cashWithdrawals.createdAt,
    userName: users.name
  }).from(cashWithdrawals).leftJoin(users, eq19(users.id, cashWithdrawals.createdBy)).where(and19(eq19(cashWithdrawals.branchId, branchId), eq19(cashWithdrawals.businessDay, day), eq19(cashWithdrawals.status, "active"))).orderBy(asc9(cashWithdrawals.createdAt));
  return rows.map((r) => ({ ...r, userName: r.userName ?? "", createdAt: r.createdAt.getTime() }));
}

// src/app.ts
var idParam = z17.object({ id: z17.uuid() });
async function buildApp(ctx2) {
  const app2 = Fastify({
    logger: ctx2.config.mode === "cloud" ? true : { level: "warn" },
    bodyLimit: 1e6,
    // Behind Render's proxy the client IP is in X-Forwarded-For (needed for per-IP limits).
    trustProxy: ctx2.config.trustProxy
  });
  await app2.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    // HTTPS only exists online; on the shop LAN it is plain HTTP.
    hsts: ctx2.config.mode === "cloud" ? { maxAge: 15552e3 } : false
  });
  await app2.register(rateLimit, { max: 3e3, timeWindow: "1 minute" });
  const strict = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  app2.setErrorHandler((err, req, reply) => {
    const e = err;
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: "validation", message: "Invalid input", issues: err.issues });
    }
    if (err instanceof DomainError) {
      return reply.status(409).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    const pgCode = e.cause?.code ?? e.code;
    if (pgCode === "23505") {
      return reply.status(409).send({ code: "conflict", message: "This was changed by someone else at the same time. Try again." });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ code: "bad_request", message: e.message });
    }
    req.log.error(err);
    return reply.status(500).send({ code: "internal", message: "Unexpected server error" });
  });
  async function authenticate(req) {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw unauthorized();
    const actor = await verifyToken(h.slice(7), ctx2.config.jwtSecret);
    const [u] = await ctx2.db.select({ active: users.active, role: users.role }).from(users).where(eq20(users.id, actor.id));
    if (!u || !u.active) throw unauthorized("Account disabled");
    actor.role = u.role;
    req.actor = actor;
    return actor;
  }
  const route = (perm, handler) => async (req, reply) => {
    const actor = await authenticate(req);
    if (perm) requirePerm(actor, perm);
    const result = await handler(req, actor);
    return reply.send(result ?? { ok: true });
  };
  const id = (req) => idParam.parse(req.params).id;
  const now = () => ctx2.clock.now();
  const accessCode = ctx2.config.accessCode ? Buffer.from(ctx2.config.accessCode) : null;
  function requireAccess(req) {
    if (!accessCode) return;
    const given = req.headers["x-lounge-access"];
    if (typeof given !== "string" || !given) throw new HttpError(401, "access_code_required", "Shop code required");
    const g = Buffer.from(given);
    if (g.length !== accessCode.length || !timingSafeEqual2(g, accessCode)) {
      throw new HttpError(401, "access_code_invalid", "Wrong shop code");
    }
  }
  app2.get("/api/health", async () => ({ ok: true, mode: ctx2.config.mode, now: now() }));
  app2.get("/api/time", async () => ({ now: now() }));
  app2.get("/api/auth/branches", strict, async (req) => {
    requireAccess(req);
    return ctx2.db.select({ id: branches.id, name: branches.name }).from(branches).orderBy(branches.name);
  });
  app2.get("/api/auth/staff", strict, async (req) => {
    requireAccess(req);
    const { branchId } = z17.object({ branchId: z17.uuid() }).parse(req.query);
    const [b] = await ctx2.db.select({ orgId: branches.orgId }).from(branches).where(eq20(branches.id, branchId));
    if (!b) throw notFound("branch");
    return ctx2.db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and20(eq20(users.orgId, b.orgId), eq20(users.active, true), or4(isNull8(users.branchId), eq20(users.branchId, branchId)))).orderBy(users.name);
  });
  app2.post("/api/auth/login", strict, async (req) => {
    requireAccess(req);
    const input = z17.object({ userId: z17.uuid(), branchId: z17.uuid(), pin: z17.string().min(4).max(8) }).parse(req.body);
    const wait = checkLockout(input.userId, now());
    if (wait > 0) throw new HttpError(429, "locked", "Too many wrong PINs, try again later", { retryInMs: wait });
    const [u] = await ctx2.db.select().from(users).where(eq20(users.id, input.userId));
    const [b] = await ctx2.db.select().from(branches).where(eq20(branches.id, input.branchId));
    if (!u || !b || !u.active || u.orgId !== b.orgId || u.branchId && u.branchId !== b.id) throw unauthorized("Wrong PIN");
    if (!await verifyPin(input.pin, u.pinHash)) {
      recordFailure(u.id, now());
      throw unauthorized("Wrong PIN");
    }
    clearFailures(u.id);
    const actor = { id: u.id, orgId: u.orgId, branchId: b.id, role: u.role, name: u.name };
    return { token: await signToken(actor, ctx2.config.jwtSecret), user: actor };
  });
  app2.get("/api/me", route(null, async (_req, actor) => actor));
  app2.get("/api/floor", route("floor.view", async (_req, actor) => floorSnapshot(ctx2.db, actor.branchId, now())));
  app2.post("/api/sessions", route("session.manage", async (req, actor) => startSession(ctx2, actor, req.body)));
  app2.post("/api/sessions/:id/action", route("session.manage", async (req, actor) => sessionAction(ctx2, actor, id(req), req.body)));
  app2.post("/api/sessions/:id/customer", route("session.manage", async (req, actor) => setSessionCustomer(ctx2, actor, id(req), req.body)));
  app2.post("/api/sessions/:id/time", route("session.manage", async (req, actor) => adjustSessionTime(ctx2, actor, id(req), req.body)));
  app2.post("/api/sessions/:id/plan", route("session.manage", async (req, actor) => setPlan(ctx2, actor, id(req), req.body)));
  app2.post("/api/sessions/:id/reopen", route("session.manage", async (req, actor) => reopenSession(ctx2, actor, id(req))));
  app2.post("/api/sessions/:id/void", route("session.manage", async (req, actor) => voidSession(ctx2, actor, id(req), req.body)));
  app2.post("/api/sessions/:id/checkout", route("checkout", async (req, actor) => checkoutSession(ctx2, actor, id(req), req.body)));
  app2.post("/api/sessions/:id/payments", route("checkout", async (req, actor) => addSessionPayment(ctx2, actor, id(req), req.body)));
  app2.get("/api/controllers", route("floor.view", async (_req, actor) => listControllers(ctx2.db, actor.branchId)));
  app2.post("/api/controllers", route("settings.manage", async (req, actor) => addControllers(ctx2, actor, req.body)));
  app2.delete("/api/controllers/:id", route("settings.manage", async (req, actor) => deleteController(ctx2, actor, id(req))));
  app2.post("/api/controllers/:id/charge", route("controllers.manage", async (req, actor) => chargeController(ctx2, actor, id(req), req.body)));
  app2.post("/api/controllers/:id/ready", route("controllers.manage", async (req, actor) => readyController(ctx2, actor, id(req))));
  app2.post("/api/controllers/:id/assign", route("controllers.manage", async (req, actor) => assignController(ctx2, actor, id(req), req.body)));
  app2.post("/api/controllers/:id/broken", route("controllers.manage", async (req, actor) => setControllerBroken(ctx2, actor, id(req), req.body)));
  app2.get(
    "/api/sessions/:id/bill",
    route("floor.view", async (req, actor) => {
      const branch = await getBranch(ctx2.db, actor.branchId);
      const s = await getSession(ctx2.db, branch.id, id(req));
      const { session: _s, timeline, ...bill } = await sessionBill(ctx2.db, branch, s, now());
      const who = await billCustomer(ctx2.db, branch, s, bill.time);
      return { ...bill, ...who, timeline, session: { ...s, startedAt: s.startedAt.getTime(), endedAt: s.endedAt?.getTime() ?? null } };
    })
  );
  app2.get("/api/products", route("floor.view", async (_req, actor) => listProducts(ctx2.db, actor.branchId)));
  app2.post("/api/orders", route("order.create", async (req, actor) => createOrder(ctx2, actor, req.body)));
  app2.post("/api/counter/sale", route("checkout", async (req, actor) => counterSale(ctx2, actor, req.body)));
  app2.post("/api/order-items/:id/void", route("order.create", async (req, actor) => voidOrderItem(ctx2, actor, id(req), req.body)));
  app2.post("/api/bills/:id/void", route("day.close", async (req, actor) => voidBill(ctx2, actor, id(req), req.body)));
  app2.get("/api/bills/:id", route("floor.view", async (req, actor) => getBill(ctx2.db, actor.branchId, id(req))));
  app2.get(
    "/api/bills",
    route("reports.view", async (req, actor) => {
      const { day } = z17.object({ day: z17.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
      return ctx2.db.select().from(bills).where(and20(eq20(bills.branchId, actor.branchId), eq20(bills.businessDay, day))).orderBy(desc5(bills.number));
    })
  );
  app2.get(
    "/api/reservations",
    route("floor.view", async (req, actor) => {
      const q = z17.object({ from: z17.coerce.number().int().optional(), to: z17.coerce.number().int().optional() }).parse(req.query);
      const from = q.from ?? now() - 12 * 60 * MINUTE;
      const to = q.to ?? from + 7 * 24 * 60 * MINUTE;
      const rows = await listReservations(ctx2.db, actor.branchId, from, to);
      return rows.map((r) => ({ ...r, startAt: r.startAt.getTime() }));
    })
  );
  app2.post("/api/reservations", route("reservation.manage", async (req, actor) => createReservation(ctx2, actor, req.body)));
  app2.post("/api/reservations/:id/cancel", route("reservation.manage", async (req, actor) => cancelReservation(ctx2, actor, id(req), req.body)));
  app2.post("/api/reservations/:id/refund", route("reservation.manage", async (req, actor) => refundReservation(ctx2, actor, id(req), req.body)));
  app2.delete("/api/reservations/:id", route("reservation.manage", async (req, actor) => deleteReservation(ctx2, actor, id(req))));
  app2.get("/api/shifts/current", route("floor.view", async (_req, actor) => ({ shift: await currentShift(ctx2.db, actor.branchId) })));
  app2.post("/api/shifts/open", route("shift.manage", async (req, actor) => startShift(ctx2, actor, req.body)));
  app2.post("/api/withdrawals", route("shift.manage", async (req, actor) => createWithdrawal(ctx2, actor, req.body)));
  app2.post("/api/withdrawals/:id/void", route("shift.manage", async (req, actor) => voidWithdrawal(ctx2, actor, id(req), req.body)));
  app2.get(
    "/api/withdrawals",
    route("reports.view", async (req, actor) => {
      const { day } = z17.object({ day: z17.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
      return listWithdrawals(ctx2.db, actor.branchId, day);
    })
  );
  app2.post("/api/shifts/close", route("shift.manage", async (req, actor) => endShiftAndDay(ctx2, actor, req.body)));
  app2.post("/api/shifts/:id/count", route("shift.manage", async (req, actor) => countClosedShift(ctx2, actor, id(req), req.body)));
  app2.get("/api/days", route("reports.view", async (_req, actor) => listDays(ctx2.db, actor.branchId)));
  app2.get(
    "/api/reports/day",
    route("reports.view", async (req, actor) => {
      const { day } = z17.object({ day: z17.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
      return dayReport(ctx2.db, actor.branchId, day ?? null, now());
    })
  );
  app2.post("/api/ledger/reset", route("settings.manage", async (req, actor) => resetLedger(ctx2, actor, req.body)));
  app2.post("/api/ledger/manual-entry", route("reports.view", async (req, actor) => addManualEntry(ctx2, actor, req.body)));
  app2.post("/api/days/close", route("day.close", async (req, actor) => closeDay(ctx2, actor, req.body)));
  const dayQuery = z17.object({ day: z17.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
  app2.get(
    "/api/reports/sessions",
    route("reports.view", async (req, actor) => sessionsLog(ctx2.db, actor.branchId, dayQuery.parse(req.query).day))
  );
  app2.get(
    "/api/reports/month",
    route("reports.view", async (req, actor) => {
      const { month } = z17.object({ month: z17.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.query);
      return monthReport(ctx2.db, actor.branchId, month);
    })
  );
  app2.get(
    "/api/reports/range",
    route("reports.view", async (req, actor) => {
      const { from, to } = z17.object({ from: z17.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z17.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
      return rangeReport(ctx2.db, actor.branchId, from, to);
    })
  );
  app2.get("/api/rewards", route("checkout", async (req, actor) => listRewards(ctx2.db, actor.branchId, req.query)));
  app2.post("/api/rewards/:id/notified", route("checkout", async (req, actor) => markRewardNotified(ctx2, actor, id(req))));
  app2.post("/api/rewards/:id/void", route("settings.manage", async (req, actor) => voidReward(ctx2, actor, id(req), req.body)));
  app2.get(
    "/api/customers/lookup",
    route("session.manage", async (req, actor) => lookupCustomer(ctx2.db, actor.branchId, req.query.phone))
  );
  app2.get("/api/customers", route("checkout", async (_req, actor) => listCustomers(ctx2.db, actor.orgId, actor.branchId)));
  app2.post("/api/customers", route("checkout", async (req, actor) => createCustomer(ctx2, actor, req.body)));
  app2.patch("/api/customers/:id", route("checkout", async (req, actor) => updateCustomer(ctx2, actor, id(req), req.body)));
  app2.get("/api/stock", route("stock.view", async (_req, actor) => listStock(ctx2.db, actor.branchId)));
  app2.post("/api/stock/receive", route("stock.manage", async (req, actor) => receiveStock(ctx2, actor, req.body)));
  app2.post("/api/stock/:id/adjust", route("stock.manage", async (req, actor) => adjustStock(ctx2, actor, id(req), req.body)));
  app2.get(
    "/api/stock/movements",
    route("stock.view", async (req, actor) => {
      const q = z17.object({ productId: z17.uuid().optional(), limit: z17.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
      return listMovements(ctx2.db, actor.branchId, q);
    })
  );
  app2.get(
    "/api/settings",
    route("settings.manage", async (_req, actor) => {
      const [branch, stationRows, rules, pkgs, prods, staff] = await Promise.all([
        getBranch(ctx2.db, actor.branchId),
        listStations(ctx2.db, actor.branchId),
        listCurrentRules(ctx2.db, actor.branchId, now()),
        listPackages(ctx2.db, actor.branchId),
        listProducts(ctx2.db, actor.branchId),
        listStaff(ctx2.db, actor)
      ]);
      return { branch, stations: stationRows, rules, packages: pkgs, products: prods, staff };
    })
  );
  app2.patch("/api/settings/branch", route("settings.manage", async (req, actor) => updateBranch(ctx2, actor, req.body)));
  app2.get("/api/settings/export", route("settings.manage", async (_req, actor) => exportSetup(ctx2.db, actor, ctx2.clock.now())));
  app2.post("/api/settings/import", route("settings.manage", async (req, actor) => importSetup(ctx2, actor, req.body)));
  app2.post("/api/settings/stations", route("settings.manage", async (req, actor) => saveStation(ctx2, actor, null, req.body)));
  app2.patch("/api/settings/stations/:id", route("settings.manage", async (req, actor) => saveStation(ctx2, actor, id(req), req.body)));
  app2.delete("/api/settings/stations/:id", route("settings.manage", async (req, actor) => deleteStation(ctx2, actor, id(req))));
  app2.post("/api/settings/rules", route("settings.manage", async (req, actor) => saveRule(ctx2, actor, null, req.body)));
  app2.put("/api/settings/rules/:id", route("settings.manage", async (req, actor) => saveRule(ctx2, actor, id(req), req.body)));
  app2.post("/api/pricing/discount", route("settings.manage", async (req, actor) => startQuickDiscount(ctx2, actor, req.body)));
  app2.post("/api/pricing/discount/stop", route("settings.manage", async (_req, actor) => stopQuickDiscount(ctx2, actor)));
  app2.post("/api/settings/packages", route("settings.manage", async (req, actor) => savePackage(ctx2, actor, null, req.body)));
  app2.put("/api/settings/packages/:id", route("settings.manage", async (req, actor) => savePackage(ctx2, actor, id(req), req.body)));
  app2.post("/api/settings/products", route("stock.manage", async (req, actor) => saveProduct(ctx2, actor, null, req.body)));
  app2.patch("/api/settings/products/:id", route("stock.manage", async (req, actor) => saveProduct(ctx2, actor, id(req), req.body)));
  app2.delete("/api/settings/products/:id", route("stock.manage", async (req, actor) => deleteProduct(ctx2, actor, id(req))));
  app2.post("/api/settings/staff", route("staff.manage", async (req, actor) => saveStaff(ctx2, actor, null, req.body)));
  app2.patch("/api/settings/staff/:id", route("staff.manage", async (req, actor) => saveStaff(ctx2, actor, id(req), req.body)));
  app2.get(
    "/api/audit",
    route("audit.view", async (req, actor) => {
      const { limit, before } = z17.object({ limit: z17.coerce.number().int().min(1).max(500).default(100), before: z17.coerce.number().int().optional() }).parse(req.query);
      const rows = await ctx2.db.select().from(events).where(eq20(events.branchId, actor.branchId)).orderBy(desc5(events.createdAt)).limit(limit);
      const filtered = before ? rows.filter((r) => r.createdAt.getTime() < before) : rows;
      const ids = [...new Set(filtered.flatMap((r) => [r.actorId, r.approvedBy]).filter((x) => !!x))];
      const names = ids.length ? await ctx2.db.select({ id: users.id, name: users.name }).from(users).where(inArray15(users.id, ids)) : [];
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      return filtered.map((r) => ({
        ...r,
        createdAt: r.createdAt.getTime(),
        actorName: r.actorId ? nameOf.get(r.actorId) ?? null : null,
        approverName: r.approvedBy ? nameOf.get(r.approvedBy) ?? null : null
      }));
    })
  );
  const dist = ctx2.config.webDist;
  if (dist && existsSync(path.join(dist, "index.html"))) {
    const assetLinks = path.join(dist, ".well-known", "assetlinks.json");
    if (existsSync(assetLinks)) {
      const body = readFileSync(assetLinks, "utf8");
      app2.get("/.well-known/assetlinks.json", async (_req, reply) => reply.type("application/json").send(body));
    }
    await app2.register(fastifyStatic, { root: dist, wildcard: false });
    app2.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
        return reply.status(404).send({ code: "not_found", message: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }
  return app2;
}

// src/config.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
function loadOrCreateSecret(dataDir) {
  const file = path2.join(dataDir, "jwt-secret");
  if (existsSync2(file)) return readFileSync2(file, "utf8").trim();
  const secret = randomBytes2(48).toString("hex");
  writeFileSync(file, secret, { mode: 384 });
  return secret;
}
function loadConfig(env = process.env) {
  const dataDir = path2.resolve(env.LOUNGE_DATA_DIR ?? path2.join(process.cwd(), ".data"));
  mkdirSync(dataDir, { recursive: true });
  const mode = env.LOUNGE_MODE === "cloud" ? "cloud" : "local";
  const here2 = path2.dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    env.LOUNGE_WEB_DIST,
    path2.resolve(process.cwd(), "apps/web/dist"),
    path2.resolve(process.cwd(), "../web/dist"),
    path2.resolve(here2, "../../web/dist"),
    path2.resolve(here2, "../../../apps/web/dist"),
    path2.resolve(here2, "../web/dist")
  ];
  const webDist = candidateDirs.find((p) => p && existsSync2(path2.join(p, "index.html"))) ?? null;
  return {
    port: Number(env.PORT ?? 4e3),
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    databaseUrl: env.DATABASE_URL || null,
    jwtSecret: env.JWT_SECRET || loadOrCreateSecret(dataDir),
    mode,
    webDist,
    // Demo data only where it is safe: on by default locally, off by default online.
    seedDemo: env.LOUNGE_SEED_DEMO ? env.LOUNGE_SEED_DEMO !== "false" : mode === "local",
    schedulerIntervalMs: Number(env.LOUNGE_TICK_MS ?? 1e4),
    accessCode: env.LOUNGE_ACCESS_CODE?.trim() || null,
    owner: env.LOUNGE_OWNER_PIN ? { name: env.LOUNGE_OWNER_NAME?.trim() || "\u0627\u0644\u0645\u0627\u0644\u0643", pin: env.LOUNGE_OWNER_PIN.trim() } : null,
    trustProxy: env.LOUNGE_TRUST_PROXY ? env.LOUNGE_TRUST_PROXY === "true" : mode === "cloud"
  };
}
function assertSafeConfig(c) {
  if (c.mode !== "cloud") return;
  const problems = [];
  if (!c.databaseUrl) problems.push("DATABASE_URL is required online (the server disk is wiped on every deploy).");
  if (!c.accessCode || c.accessCode.length < 6) problems.push("LOUNGE_ACCESS_CODE (the shop code, at least 6 characters) is required online.");
  if (c.seedDemo) problems.push("LOUNGE_SEED_DEMO must be false online (demo staff have well-known PINs).");
  if (c.owner && !/^\d{6,8}$/.test(c.owner.pin)) problems.push("LOUNGE_OWNER_PIN must be 6\u20138 digits online.");
  if (problems.length) throw new Error(`Unsafe cloud configuration:
 - ${problems.join("\n - ")}`);
}

// src/db/index.ts
import { existsSync as existsSync3 } from "node:fs";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
var here = path3.dirname(fileURLToPath2(import.meta.url));
var possibleFolders = [
  path3.resolve(here, "../../drizzle"),
  path3.resolve(here, "../drizzle"),
  path3.resolve(process.cwd(), "apps/server/drizzle"),
  path3.resolve(process.cwd(), "drizzle")
];
var migrationsFolder = possibleFolders.find((f) => existsSync3(f)) || possibleFolders[0];
async function openDatabase(opts) {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db2 = drizzlePg({ client: pool, schema: schema_exports });
    await migratePg(db2, { migrationsFolder });
    return { db: db2, driver: "pg", close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate: migratePglite } = await import("drizzle-orm/pglite/migrator");
  const client = opts.dataDir ? new PGlite(path3.join(opts.dataDir, "pgdata")) : new PGlite();
  const db = drizzlePglite({ client, schema: schema_exports });
  await migratePglite(db, { migrationsFolder });
  return { db, driver: "pglite", close: () => client.close() };
}

// src/realtime.ts
import { Server } from "socket.io";
function attachRealtime(server, ctx2) {
  const io = new Server(server, {
    path: "/ws",
    // Same origin only: the web app is served by this server.
    // Gentle on phones: a weak signal that stalls for a few seconds must not drop the connection
    // (a dead one is still noticed within pingInterval + pingTimeout).
    pingInterval: 12e3,
    pingTimeout: 2e4
  });
  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? "");
      const actor = await verifyToken(token, ctx2.config.jwtSecret);
      socket.data.actor = actor;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const { branchId } = socket.data.actor;
    void socket.join(`branch:${branchId}`);
    socket.emit("hello", { now: ctx2.clock.now() });
    socket.on("time", (ack) => {
      if (typeof ack === "function") ack(ctx2.clock.now());
    });
  });
  const off = ctx2.bus.onEvent((e) => {
    io.to(`branch:${e.branchId}`).emit("evt", {
      id: e.id,
      type: e.type,
      entity: e.entity,
      entityId: e.entityId,
      actorId: e.actorId,
      at: e.createdAt.getTime(),
      // Small, branch-scoped details so screens can say *what* happened ("controller 3 is charged").
      payload: e.payload
    });
  });
  return {
    io,
    close: async () => {
      off();
      await io.close();
    }
  };
}

// src/scheduler.ts
import { and as and21, eq as eq21 } from "drizzle-orm";
async function tick(ctx2, log2 = () => {
}) {
  const all = await ctx2.db.select({ id: branches.id, orgId: branches.orgId }).from(branches);
  for (const b of all) {
    try {
      if (await autoRollover(ctx2, b.id)) log2(`day rolled over for branch ${b.id}`);
      const n = await sweepNoShows(ctx2, b.id);
      if (n) log2(`${n} reservation(s) marked no-show`);
      await sweepCharged(ctx2, b.id);
      await autoEndFixed(ctx2, b.id, b.orgId);
    } catch (err) {
      log2(`scheduler failed for branch ${b.id}`, err);
    }
  }
}
async function autoEndFixed(ctx2, branchId, orgId) {
  const branch = await getBranch(ctx2.db, branchId);
  if (!branch.settings.billing.autoEndFixed) return;
  const now = ctx2.clock.now();
  const running = await ctx2.db.select().from(sessions).where(and21(eq21(sessions.branchId, branchId), eq21(sessions.status, "running"), eq21(sessions.kind, "fixed")));
  const segs = await loadSegments(ctx2.db, running.map((s) => s.id));
  for (const s of running) {
    const state = liveState(toTimeline(s, segs.get(s.id) ?? []), now, branch.settings.billing.endingSoonMinutes);
    if (state.status === "overtime") {
      await sessionAction(ctx2, { id: SYSTEM_ID, orgId, branchId, role: "manager", name: "system" }, s.id, { type: "end" });
    }
  }
}
function startScheduler(ctx2, log2) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick(ctx2, log2);
    } finally {
      running = false;
    }
  }, ctx2.config.schedulerIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

// src/seed.ts
var DEMO_STAFF = [
  { name: "\u0627\u0644\u0645\u0627\u0644\u0643", role: "owner", pin: "1234" },
  { name: "\u0627\u0644\u0645\u062F\u064A\u0631", role: "manager", pin: "2222" },
  { name: "\u0627\u0644\u0643\u0627\u0634\u064A\u0631", role: "cashier", pin: "1111" },
  { name: "\u0627\u0644\u0648\u064A\u062A\u0631", role: "waiter", pin: "3333" }
];
async function seedIfEmpty(db, opts) {
  const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (existing.length > 0) return false;
  if (!opts.demo && !opts.owner) {
    throw new Error("First start without demo data: set LOUNGE_OWNER_PIN (and optionally LOUNGE_OWNER_NAME) for the owner account.");
  }
  const orgId = newId();
  const branchId = newId();
  const settings = defaultBranchSettings();
  settings.billing.graceMinutes = 3;
  settings.billing.roundingMinutes = 5;
  settings.checkout.cashRounding = 50;
  settings.checkout.refundApprovalAbove = 2e3;
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: orgId, name: "GOAT Gaming Center" });
    await tx.insert(branches).values({
      id: branchId,
      orgId,
      name: "GOAT Gaming Center",
      timezone: "Asia/Amman",
      currency: "JOD",
      currencyDecimals: 3,
      locale: "ar",
      settings
    });
    if (!opts.demo) {
      await tx.insert(users).values({ id: newId(), orgId, branchId: null, name: opts.owner.name, role: "owner", pinHash: await hashPin(opts.owner.pin) });
      return;
    }
    for (const s of DEMO_STAFF) {
      await tx.insert(users).values({
        id: newId(),
        orgId,
        branchId: s.role === "owner" ? null : branchId,
        name: s.name,
        role: s.role,
        pinHash: await hashPin(s.pin)
      });
    }
    const st = [];
    let sort = 0;
    for (let i = 1; i <= 10; i++) {
      st.push({ id: newId(), branchId, name: `PS-${String(i).padStart(2, "0")}`, type: "ps5", tier: "regular", zone: "\u0627\u0644\u0635\u0627\u0644\u0629", modes: ["single", "multi"], sort: sort++ });
    }
    for (let i = 1; i <= 4; i++) {
      st.push({ id: newId(), branchId, name: `VIP-${i}`, type: "ps5", tier: "vip", zone: "\u063A\u0631\u0641 VIP", modes: ["single", "multi"], sort: sort++ });
    }
    for (let i = 1; i <= 2; i++) {
      st.push({ id: newId(), branchId, name: `VR-${i}`, type: "vr", tier: "regular", zone: "VR", modes: ["standard"], sort: sort++ });
    }
    await tx.insert(stations).values(st);
    await tx.insert(controllers).values(Array.from({ length: 30 }, (_, i) => ({ id: newId(), branchId, number: i + 1 })));
    const rule = (name, priority, match, effect, active = true) => ({
      id: newId(),
      branchId,
      name,
      priority,
      active,
      match,
      effect
    });
    await tx.insert(pricingRules).values([
      rule("\u0633\u0627\u0639\u0629 GTA 6", 10, { modes: ["gta6"] }, { kind: "rate", perHour: 2500 }),
      rule("PS5 \u0641\u0631\u062F\u064A", 0, { stationTypes: ["ps5"], tiers: ["regular"], modes: ["single"] }, { kind: "rate", perHour: 2e3 }),
      rule("PS5 \u0632\u0648\u062C\u064A", 0, { stationTypes: ["ps5"], tiers: ["regular"], modes: ["multi"] }, { kind: "rate", perHour: 3e3 }),
      rule("VIP \u0641\u0631\u062F\u064A", 0, { stationTypes: ["ps5"], tiers: ["vip"], modes: ["single"] }, { kind: "rate", perHour: 4e3 }),
      rule("VIP \u0632\u0648\u062C\u064A", 0, { stationTypes: ["ps5"], tiers: ["vip"], modes: ["multi"] }, { kind: "rate", perHour: 5e3 }),
      rule("VR", 0, { stationTypes: ["vr"] }, { kind: "rate", perHour: 8e3 }),
      // Sunday–Thursday afternoons (ISO weekdays: 7 = Sunday … 4 = Thursday)
      rule("Happy Hour", 10, { daysOfWeek: [7, 1, 2, 3, 4], timeFrom: "12:00", timeTo: "16:00" }, { kind: "percent", percent: -20 }),
      rule("\u0644\u064A\u0644\u0629 \u0627\u0644\u0648\u064A\u0643\u0646\u062F", 5, { stationTypes: ["ps5"], daysOfWeek: [4, 5], timeFrom: "20:00", timeTo: "02:00" }, { kind: "percent", percent: 25 }, false)
    ]);
    await tx.insert(packages).values([
      { id: newId(), branchId, name: "3 \u0633\u0627\u0639\u0627\u062A \u0641\u0631\u062F\u064A", minutes: 180, price: 5e3, match: { stationTypes: ["ps5"], tiers: ["regular"], modes: ["single"] } },
      { id: newId(), branchId, name: "3 \u0633\u0627\u0639\u0627\u062A \u0632\u0648\u062C\u064A", minutes: 180, price: 7500, match: { stationTypes: ["ps5"], tiers: ["regular"], modes: ["multi"] } }
    ]);
    const p = (name, category, price, trackStock = false, stockQty = 0, sortN = 0) => ({
      id: newId(),
      branchId,
      name,
      category,
      price,
      trackStock,
      stockQty,
      lowStockAt: trackStock ? 10 : 0,
      sort: sortN
    });
    await tx.insert(products).values([
      p("\u0625\u0633\u0628\u0631\u064A\u0633\u0648", "\u0645\u0634\u0631\u0648\u0628\u0627\u062A \u0633\u0627\u062E\u0646\u0629", 1e3, false, 0, 1),
      p("\u0646\u0633\u0643\u0627\u0641\u064A\u0647", "\u0645\u0634\u0631\u0648\u0628\u0627\u062A \u0633\u0627\u062E\u0646\u0629", 1250, false, 0, 2),
      p("\u0634\u0627\u064A", "\u0645\u0634\u0631\u0648\u0628\u0627\u062A \u0633\u0627\u062E\u0646\u0629", 750, false, 0, 3),
      p("\u0628\u064A\u0628\u0633\u064A", "\u0645\u0634\u0631\u0648\u0628\u0627\u062A \u0628\u0627\u0631\u062F\u0629", 750, true, 48, 1),
      p("\u0631\u064A\u062F \u0628\u0648\u0644", "\u0645\u0634\u0631\u0648\u0628\u0627\u062A \u0628\u0627\u0631\u062F\u0629", 2e3, true, 24, 2),
      p("\u0645\u064A", "\u0645\u0634\u0631\u0648\u0628\u0627\u062A \u0628\u0627\u0631\u062F\u0629", 350, true, 60, 3),
      p("\u0646\u0627\u062A\u0634\u0648\u0632", "\u0623\u0643\u0644", 2500, false, 0, 1),
      p("\u0625\u0646\u062F\u0648\u0645\u064A", "\u0623\u0643\u0644", 1500, true, 30, 2),
      p("\u062A\u0648\u0633\u062A", "\u0623\u0643\u0644", 2e3, false, 0, 3),
      p("\u0634\u064A\u0628\u0633", "\u0633\u0646\u0627\u0643\u0633", 500, true, 40, 1),
      p("\u0634\u0648\u0643\u0648\u0644\u0627\u062A\u0629", "\u0633\u0646\u0627\u0643\u0633", 750, true, 36, 2)
    ]);
  });
  return true;
}

// src/index.ts
var config = loadConfig();
assertSafeConfig(config);
var database = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
var seeded = await seedIfEmpty(database.db, { demo: config.seedDemo, owner: config.owner });
var ctx = { db: database.db, clock: systemClock, bus: new Bus(), config };
await ensureDay11PaperSessions(ctx);
await shiftLedgerDatesFromOct13(ctx);
var app = await buildApp(ctx);
var realtime = attachRealtime(app.server, ctx);
await app.listen({ port: config.port, host: config.host });
var log = (msg, err) => err ? console.error(`[scheduler] ${msg}`, err) : console.log(`[scheduler] ${msg}`);
await tick(ctx, log);
var stopScheduler = startScheduler(ctx, log);
var lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i.address}:${config.port}`);
console.log(`
  Lounge OS server (${config.mode}) \u2014 database: ${database.driver}${seeded ? config.seedDemo ? " (demo data created)" : " (owner account created)" : ""}
  This PC:        http://localhost:${config.port}
  Other devices:  ${lan.join("  ") || "(no network)"}
  Web app:        ${config.webDist ? "served from " + config.webDist : "run the web dev server (npm run dev)"}
`);
async function shutdown() {
  stopScheduler();
  await realtime.close();
  await app.close();
  await database.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

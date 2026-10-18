// 시간 계산 엔진 — 화면·DB와 무관한 순수 함수만. 시각은 전부 UTC 밀리초(ms)로 다룬다.

export const MIN = 60_000;
export const DAY_MIN = 1440;

export type Entry = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  category: string;
  color: string;
  note: string;
  version: number;
};

export type Rule = {
  id: string;
  title: string;
  weekdays: number[]; // 0=일 … 6=토
  start_time: string; // "HH:MM"
  end_time: string; // start_time 이하이면 다음 날 끝남(23:00~07:00)
  timezone: string;
  category: string;
  color: string;
  note: string;
  active: boolean;
  effective_start_date: string; // "YYYY-MM-DD"
  effective_end_date: string | null;
  version: number;
};

export type Exception = {
  id: string;
  rule_id: string;
  occurrence_date: string;
  override_start_at: string | null;
  override_end_at: string | null;
  is_cancelled: boolean;
  version: number;
};

export type Occ = {
  key: string;
  kind: "entry" | "rule";
  id: string; // entry id 또는 rule id
  date?: string; // 반복이면 원래 날짜(occurrence_date)
  excId?: string;
  title: string;
  start: number;
  end: number;
  category: string;
  color: string;
  note: string;
};

export type Span = { start: number; end: number };

// ---------- 날짜·시간대 ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function wall(ms: number, tz: string) {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(ms)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ms → 그 시간대의 날짜 "YYYY-MM-DD"와 자정 이후 분 */
export function zoned(ms: number, tz: string) {
  const w = wall(ms, tz);
  return { date: `${w.y}-${pad(w.mo)}-${pad(w.d)}`, min: w.h * 60 + w.mi };
}

function offsetMin(ms: number, tz: string) {
  const w = wall(ms, tz);
  return (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / MIN) * MIN) / MIN;
}

/** 그 시간대의 날짜 + 자정 이후 분 → ms */
export function toUtc(date: string, min: number, tz: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d) + min * MIN;
  const o1 = offsetMin(guess, tz);
  let t = guess - o1 * MIN;
  const o2 = offsetMin(t, tz);
  if (o2 !== o1) t = guess - o2 * MIN;
  return t;
}

export function addDays(date: string, n: number) {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekday(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** 그 주 일요일 */
export const weekStart = (date: string) => addDays(date, -weekday(date));

export const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export const dayStart = (date: string, tz: string) => toUtc(date, 0, tz);
export const dayEnd = (date: string, tz: string) => toUtc(addDays(date, 1), 0, tz);

// ---------- 반복 ----------

export function ruleAppliesOn(r: Rule, date: string) {
  return (
    r.active &&
    r.weekdays.includes(weekday(date)) &&
    date >= r.effective_start_date &&
    (!r.effective_end_date || date <= r.effective_end_date)
  );
}

/** 반복 규칙이 그 날짜에 만드는 원래 구간(예외 적용 전) */
export function ruleSpan(r: Rule, date: string): Span {
  const s = hm(r.start_time);
  let e = hm(r.end_time);
  if (e <= s) e += DAY_MIN; // 자정 넘김(같으면 24시간)
  return { start: toUtc(date, s, r.timezone), end: toUtc(addDays(date, Math.floor(e / DAY_MIN)), e % DAY_MIN, r.timezone) };
}

function ruleOcc(r: Rule, date: string, span: Span, excId?: string): Occ {
  return {
    key: `r:${r.id}:${date}`,
    kind: "rule",
    id: r.id,
    date,
    excId,
    title: r.title,
    start: span.start,
    end: span.end,
    category: r.category,
    color: r.color,
    note: r.note,
  };
}

/** [from, to) 와 겹치는 반복 일정 생성. 과거 가상 일정은 저장하지 않고 그때그때 계산한다. */
export function expandRules(rules: Rule[], excs: Exception[], from: number, to: number): Occ[] {
  const out: Occ[] = [];
  const excMap = new Map(excs.map((x) => [`${x.rule_id}:${x.occurrence_date}`, x]));
  for (const r of rules) {
    // 시간대 차이·자정 넘김 여유로 앞뒤 하루씩 더 본다
    const last = addDays(zoned(to, r.timezone).date, 1);
    for (let d = addDays(zoned(from, r.timezone).date, -1); d <= last; d = addDays(d, 1)) {
      if (!ruleAppliesOn(r, d) || excMap.has(`${r.id}:${d}`)) continue;
      const sp = ruleSpan(r, d);
      if (sp.end > from && sp.start < to) out.push(ruleOcc(r, d, sp));
    }
  }
  // 예외로 옮긴 일정은 원래 날짜와 상관없이 옮긴 구간이 범위에 걸리면 보인다
  const byId = new Map(rules.map((r) => [r.id, r]));
  for (const x of excs) {
    const r = byId.get(x.rule_id);
    if (!r || x.is_cancelled || !ruleAppliesOn(r, x.occurrence_date)) continue;
    const base = ruleSpan(r, x.occurrence_date);
    const sp = {
      start: x.override_start_at ? Date.parse(x.override_start_at) : base.start,
      end: x.override_end_at ? Date.parse(x.override_end_at) : base.end,
    };
    if (sp.end > from && sp.start < to) out.push(ruleOcc(r, x.occurrence_date, sp, x.id));
  }
  return out;
}

export function entryOcc(e: Entry): Occ {
  return {
    key: `e:${e.id}`,
    kind: "entry",
    id: e.id,
    title: e.title,
    start: Date.parse(e.start_at),
    end: Date.parse(e.end_at),
    category: e.category,
    color: e.color,
    note: e.note,
  };
}

/** 화면에 보일 일정: 끝난 것은 정리 작업이 안 돌았어도 무조건 뺀다(진행 중은 남김) */
export function visible(entries: Entry[], rules: Rule[], excs: Exception[], from: number, to: number, now: number) {
  const lo = Math.max(from, now);
  if (lo >= to) return [];
  return [...entries.map(entryOcc), ...expandRules(rules, excs, lo, to)]
    .filter((o) => o.end > lo && o.start < to)
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

// ---------- 24시간 계산 ----------

export function merge(spans: Span[]): Span[] {
  const s = spans.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

export const clip = (s: Span, lo: number, hi: number): Span => ({ start: Math.max(s.start, lo), end: Math.min(s.end, hi) });
const len = (spans: Span[]) => spans.reduce((a, s) => a + s.end - s.start, 0);

/** [lo, hi) 안에서 busy가 차지하지 않은 빈 구간 */
export function gaps(busy: Span[], lo: number, hi: number): Span[] {
  const out: Span[] = [];
  let cur = lo;
  for (const b of merge(busy.map((s) => clip(s, lo, hi)))) {
    if (b.start > cur) out.push({ start: cur, end: b.start });
    cur = Math.max(cur, b.end);
  }
  if (cur < hi) out.push({ start: cur, end: hi });
  return out;
}

/** 서로 겹치는 일정 쌍 */
export function overlaps(occs: Occ[]): [Occ, Occ][] {
  const s = [...occs].sort((a, b) => a.start - b.start);
  const out: [Occ, Occ][] = [];
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length && s[j].start < s[i].end; j++) out.push([s[i], s[j]]);
  return out;
}

/**
 * 하루 통계(분). 실제 구간 기준이라 겹친 시간은 한 번만 센다.
 * avail은 지금 이후 남은 빈 시간(오늘이 아니면 free와 같음).
 */
export function dayStats(occs: Occ[], date: string, tz: string, now: number) {
  const lo = dayStart(date, tz);
  const hi = dayEnd(date, tz);
  const total = (hi - lo) / MIN; // 서머타임 날은 23/25시간
  const inDay = occs.filter((o) => o.end > lo && o.start < hi);
  const planned = len(merge(inDay.map((o) => clip(o, lo, hi)))) / MIN;
  const freeSpans = gaps(inDay, lo, hi);
  const avail = len(freeSpans.map((s) => clip(s, Math.max(lo, now), hi)).filter((s) => s.end > s.start)) / MIN;
  return { total, planned, free: total - planned, avail, freeSpans, overlaps: overlaps(inDay) };
}

// ---------- 역산 ----------

export type BackItem = { title: string; minutes: number };
export type Placed = BackItem & { start: number; end: number };

/**
 * 마감 시각에서 거꾸로 배치. 마지막 항목이 마감에 가장 가깝게 끝난다.
 * busy(고정 일정)와 겹치지 않게, 항목은 쪼개지 않는다. earliest(보통 지금) 이전으로는 못 간다.
 */
export function backward(items: BackItem[], deadline: number, busy: Span[], earliest: number) {
  const placed: Placed[] = [];
  const unplaced: BackItem[] = [];
  let free = gaps(busy, earliest, deadline);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const need = Math.round(it.minutes) * MIN;
    if (need <= 0) continue;
    const g = [...free].reverse().find((s) => s.end - s.start >= need);
    if (!g) {
      unplaced.unshift(it);
      continue;
    }
    const p = { start: g.end - need, end: g.end };
    placed.unshift({ ...it, ...p });
    // 순서를 지키려고 이 항목보다 뒤쪽 시간은 다음 항목이 못 쓰게 자른다
    free = free.map((s) => clip(s, earliest, p.start)).filter((s) => s.end > s.start);
  }
  const needMin = items.reduce((a, x) => a + Math.max(0, Math.round(x.minutes)), 0);
  const freeMin = len(gaps(busy, earliest, deadline)) / MIN;
  return {
    placed,
    unplaced,
    needMin,
    freeMin,
    shortMin: Math.max(0, needMin - freeMin), // 총량 기준 부족 시간
    start: placed.length && !unplaced.length ? placed[0].start : null,
  };
}

// ---------- 재배치 미리보기 ----------

/**
 * 고정(fixed) 구간과 겹치는 일정을 겹치지 않는 가장 가까운 뒤 시간으로 민다.
 * 결과는 제안일 뿐 — 적용은 사용자가 승인한 뒤에 한다.
 */
export function pushLater(moving: Occ[], fixed: Span[], limit: number) {
  const busy = [...fixed];
  const out: { occ: Occ; start: number; end: number }[] = [];
  for (const o of [...moving].sort((a, b) => a.start - b.start)) {
    const d = o.end - o.start;
    const g = gaps(busy, o.start, limit).find((s) => s.end - s.start >= d);
    if (!g) continue;
    out.push({ occ: o, start: g.start, end: g.start + d });
    busy.push({ start: g.start, end: g.start + d });
  }
  return out;
}

// ---------- 복사 ----------

/** 일정 구간을 다른 날짜로 같은 벽시계 시각 그대로 옮긴 구간 */
export function shiftToDate(span: Span, fromDate: string, toDate: string, tz: string): Span {
  const s = zoned(span.start, tz);
  const dayGap = (Date.parse(s.date) - Date.parse(fromDate)) / 86_400_000;
  const start = toUtc(addDays(toDate, dayGap), s.min, tz);
  return { start, end: start + (span.end - span.start) };
}

/**
 * 하루 일정을 여러 날짜로 복사할 새 일회성 일정 목록.
 * 시작이 그 날인 것만 복사하고, 대상 날짜에도 똑같이 생기는 반복 일정은 중복이라 뺀다.
 */
export function copyDay(occs: Occ[], fromDate: string, toDates: string[], tz: string, rules: Rule[]) {
  const lo = dayStart(fromDate, tz);
  const hi = dayEnd(fromDate, tz);
  const src = occs.filter((o) => o.start >= lo && o.start < hi);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: Omit<Entry, "id" | "version">[] = [];
  for (const to of toDates) {
    for (const o of src) {
      const r = o.kind === "rule" ? byId.get(o.id) : undefined;
      if (r && ruleAppliesOn(r, to)) continue;
      const sp = shiftToDate(o, fromDate, to, tz);
      out.push({
        title: o.title,
        start_at: new Date(sp.start).toISOString(),
        end_at: new Date(sp.end).toISOString(),
        category: o.category,
        color: o.color,
        note: o.note,
      });
    }
  }
  return out;
}

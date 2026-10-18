// 화면 동작 → DB 변경. 반복 일정을 "그 날만" 바꿀 땐 규칙을 건드리지 않고 예외로 저장한다.
import { Data, insert, remove, setException, update } from "./db";
import { addDays, DAY_MIN, hm, Occ, shiftToDate, toUtc, zoned } from "./time";

const iso = (ms: number) => new Date(ms).toISOString();

export type Form = {
  title: string;
  date: string;
  endDate: string;
  start: string;
  end: string;
  category: string;
  color: string;
  note: string;
  weekdays: number[]; // 비었으면 반복 안 함
  scope: "one" | "all"; // 반복 일정 편집 범위
};

export type Target = { mode: "new" } | { mode: "occ"; occ: Occ };

export const isRule = (t: Target) => t.mode === "occ" && t.occ.kind === "rule";

/** 폼의 날짜·시각 → 실제 구간. 종료가 시작 이하이고 같은 날이면 다음 날로 본다(23:00~07:00). */
export function formSpan(f: Form, tz: string, oneOff: boolean) {
  const s = hm(f.start);
  let e = hm(f.end);
  const start = toUtc(f.date, s, tz);
  if (!oneOff || f.endDate === f.date) {
    if (e <= s) e += DAY_MIN;
    return { start, end: toUtc(addDays(f.date, Math.floor(e / DAY_MIN)), e % DAY_MIN, tz) };
  }
  return { start, end: toUtc(f.endDate, e, tz) };
}

export async function moveOcc(d: Data, o: Occ, start: number, end: number) {
  if (o.kind === "entry") {
    const e = d.entries.find((x) => x.id === o.id);
    if (e) await update("tt_entries", e.id, e.version, { start_at: iso(start), end_at: iso(end) });
    return;
  }
  const exc = d.excs.find((x) => x.rule_id === o.id && x.occurrence_date === o.date);
  await setException(o.id, o.date!, exc, { override_start_at: iso(start), override_end_at: iso(end), is_cancelled: false });
}

export async function saveForm(d: Data, t: Target, f: Form, tz: string) {
  const base = { title: f.title.trim(), category: f.category, color: f.color, note: f.note.trim() };
  const rule = t.mode === "occ" && t.occ.kind === "rule" ? d.rules.find((r) => r.id === t.occ.id) : undefined;

  // 반복 일정의 그 날만: 시간만 바꾼다
  if (rule && f.scope === "one") {
    const sp = formSpan(f, tz, false);
    return moveOcc(d, (t as { occ: Occ }).occ, sp.start, sp.end);
  }
  const ruleFields = { ...base, weekdays: f.weekdays, start_time: f.start, end_time: f.end };
  if (rule) return update("tt_rules", rule.id, rule.version, ruleFields);

  if (f.weekdays.length) {
    // 새 반복 규칙(일회성 일정을 반복으로 바꾸면 원래 일정은 지운다)
    await insert("tt_rules", [{ ...ruleFields, timezone: tz, effective_start_date: f.date }]);
    if (t.mode === "occ") await remove("tt_entries", t.occ.id);
    return;
  }
  const sp = formSpan(f, tz, true);
  const row = { ...base, start_at: iso(sp.start), end_at: iso(sp.end) };
  if (t.mode === "new") return insert("tt_entries", [row]);
  const e = d.entries.find((x) => x.id === t.occ.id);
  if (e) return update("tt_entries", e.id, e.version, row);
}

export async function deleteOcc(d: Data, o: Occ, scope: "one" | "all") {
  if (o.kind === "entry") return remove("tt_entries", o.id);
  if (scope === "all") return remove("tt_rules", o.id);
  const exc = d.excs.find((x) => x.rule_id === o.id && x.occurrence_date === o.date);
  return setException(o.id, o.date!, exc, { is_cancelled: true });
}

/** 일정 하나를 여러 날짜에 같은 시각으로 복사(일회성으로) */
export async function copyOccTo(o: Occ, dates: string[], tz: string) {
  const from = zoned(o.start, tz).date;
  await insert(
    "tt_entries",
    dates.map((to) => {
      const sp = shiftToDate(o, from, to, tz);
      return { title: o.title, category: o.category, color: o.color, note: o.note, start_at: iso(sp.start), end_at: iso(sp.end) };
    }),
  );
}

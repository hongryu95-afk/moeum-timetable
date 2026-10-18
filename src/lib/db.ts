import { createClient } from "@supabase/supabase-js";
import { addDays, Entry, Exception, Rule } from "./time";

export const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
});

export type Profile = { timezone: string; default_view: 1 | 3 | 7; theme: "system" | "light" | "dark" };
export const DEFAULT_PROFILE: Profile = { timezone: "Asia/Seoul", default_view: 7, theme: "system" };

export type Data = { entries: Entry[]; rules: Rule[]; excs: Exception[]; profile: Profile };

const ENTRY_COLS = "id,title,start_at,end_at,category,color,note,version";
const RULE_COLS =
  "id,title,weekdays,start_time,end_time,timezone,category,color,note,active,effective_start_date,effective_end_date,version";
const EXC_COLS = "id,rule_id,occurrence_date,override_start_at,override_end_at,is_cancelled,version";

const must = <T>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

// DB의 time은 "HH:MM:SS"로 온다
const trimTime = (r: Rule): Rule => ({ ...r, start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5) });

export async function loadAll(now: number, today: string): Promise<Data> {
  const [e, r, x, p] = await Promise.all([
    sb.from("tt_entries").select(ENTRY_COLS).gt("end_at", new Date(now).toISOString()).order("start_at"),
    sb.from("tt_rules").select(RULE_COLS).order("start_time"),
    sb.from("tt_exceptions").select(EXC_COLS).gte("occurrence_date", addDays(today, -2)),
    sb.from("tt_profiles").select("timezone,default_view,theme").maybeSingle(),
  ]);
  return {
    entries: must(e),
    rules: must(r).map(trimTime),
    excs: must(x),
    profile: (must(p) as Profile | null) ?? DEFAULT_PROFILE,
  };
}

/** 지난 계획 실제 삭제 — 앱 열 때 한 번. 반복 규칙은 건드리지 않는다. */
export async function cleanup(now: number, today: string) {
  const nowIso = new Date(now).toISOString();
  await Promise.all([
    sb.from("tt_entries").delete().lt("end_at", nowIso),
    sb
      .from("tt_exceptions")
      .delete()
      .lt("occurrence_date", addDays(today, -2))
      .or(`override_end_at.is.null,override_end_at.lt.${nowIso}`),
  ]);
}

export type Table = "tt_entries" | "tt_rules" | "tt_exceptions";
export class Conflict extends Error {
  constructor(public gone: boolean) {
    super(gone ? "다른 기기에서 이미 삭제됨" : "다른 기기에서 먼저 고침");
  }
}

export async function insert(table: Table, rows: object[]) {
  if (rows.length) must(await sb.from(table).insert(rows));
}

/** 내가 본 version일 때만 고친다. 그새 다른 기기가 고쳤으면 Conflict. */
export async function update(table: Table, id: string, version: number, patch: object, force = false) {
  let q = sb.from(table).update(patch).eq("id", id);
  if (!force) q = q.eq("version", version);
  const rows = must(await q.select("id")) as { id: string }[];
  if (rows.length) return;
  const still = must(await sb.from(table).select("id").eq("id", id)) as unknown[];
  throw new Conflict(still.length === 0);
}

export async function remove(table: Table, id: string) {
  must(await sb.from(table).delete().eq("id", id));
}

/** 반복 일정의 그 날짜만 바꾸기(예외). 원래 규칙은 그대로. */
export async function setException(
  rule_id: string,
  occurrence_date: string,
  existing: Exception | undefined,
  patch: Partial<Pick<Exception, "override_start_at" | "override_end_at" | "is_cancelled">>,
) {
  if (existing) return update("tt_exceptions", existing.id, existing.version, patch);
  return insert("tt_exceptions", [{ rule_id, occurrence_date, override_start_at: null, override_end_at: null, is_cancelled: false, ...patch }]);
}

export async function saveProfile(p: Profile) {
  const { data } = await sb.auth.getUser();
  must(await sb.from("tt_profiles").upsert({ user_id: data.user!.id, ...p, updated_at: new Date().toISOString() }));
}

/** 다른 기기 변경 알림 → 다시 불러오기 */
export function subscribe(onChange: () => void) {
  const ch = sb.channel("tt-sync");
  for (const t of ["tt_entries", "tt_rules", "tt_exceptions", "tt_profiles"])
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, onChange);
  ch.subscribe();
  return () => {
    sb.removeChannel(ch);
  };
}

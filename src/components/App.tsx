"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, moveOcc, Target } from "@/lib/actions";
import { cleanup, Conflict, Data, insert, loadAll, sb, subscribe } from "@/lib/db";
import { addDays, copyDay, dayEnd, dayStart, dayStats, hhmm, Occ, Rule, ruleAppliesOn, ruleSpan, visible, weekStart, zoned } from "@/lib/time";
import { fmtDate, fmtDur } from "@/lib/ui";
import Backward from "./Backward";
import Editor, { DRAFT_KEY, formFor } from "./Editor";
import Grid from "./Grid";
import Settings from "./Settings";
import Sheet from "./Sheet";

type Status = "loading" | "ok" | "saving" | "offline" | "error";
type Panel = null | "backward" | "settings" | "stats";
type Editing = { target: Target; form: Form };

export default function App() {
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setUser(data.session ? { email: data.session.user.email ?? "" } : null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setUser(s ? { email: s.user.email ?? "" } : null));
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js");
    return () => data.subscription.unsubscribe();
  }, []);

  if (user === undefined) return <div className="p-6 text-muted">불러오는 중…</div>;
  if (!user) return <Login />;
  return <Planner email={user.email} />;
}

function Login() {
  const [err, setErr] = useState("");
  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">계획표</h1>
        <p className="mt-2 text-muted">하루 24시간을 미리 배치하고, 바뀌면 바로 고치는 시간 계획표. 폰과 PC에서 같은 계정으로 보면 계획이 맞춰져.</p>
      </div>
      <button
        className="btn btn-primary h-12 text-base"
        onClick={async () => {
          const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin } });
          if (error) setErr(error.message);
        }}
      >
        구글로 로그인
      </button>
      {err && <p className="text-sm text-now">{err}</p>}
    </main>
  );
}

function Planner({ email }: { email: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<1 | 3 | 7>(7);
  const [anchor, setAnchor] = useState("");
  const [statDate, setStatDate] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const first = useRef(true);

  const tz = data?.profile.timezone ?? "Asia/Seoul";
  const today = zoned(now, tz).date;

  // 지금 시각을 30초마다 갱신 → 끝난 계획이 화면에서 바로 빠진다
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const reload = useCallback(async () => {
    try {
      const t = Date.now();
      const d = await loadAll(t, zoned(t, tz).date);
      setData(d);
      setStatus(navigator.onLine ? "ok" : "offline");
      if (first.current) {
        // 처음 불러온 뒤(실패 후 재시도 포함) 한 번: 기본 보기·임시저장 입력 복구
        first.current = false;
        setView(d.profile.default_view);
        setAnchor(zoned(t, d.profile.timezone).date);
        try {
          const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
          if (draft?.target && draft?.form) setEditing(draft);
        } catch {}
      }
      return d;
    } catch {
      setStatus(navigator.onLine ? "error" : "offline");
      return null;
    }
  }, [tz]);

  // 첫 진입: 지난 계획 정리 → 불러오기
  useEffect(() => {
    const t = Date.now();
    cleanup(t, zoned(t, "Asia/Seoul").date)
      .catch(() => {})
      .then(reload);
  }, [reload]);

  // 다른 기기 변경: 실시간 알림 + 창으로 돌아올 때·다시 연결될 때 다시 불러오기
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 300);
    };
    const off = subscribe(again);
    const vis = () => document.visibilityState === "visible" && again();
    const offline = () => setStatus("offline");
    addEventListener("online", again);
    addEventListener("offline", offline);
    document.addEventListener("visibilitychange", vis);
    return () => {
      off();
      removeEventListener("online", again);
      removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [reload]);

  // 테마
  useEffect(() => {
    if (!data) return;
    const t = data.profile.theme;
    try {
      localStorage.setItem("tt-theme", t);
    } catch {}
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => (document.documentElement.dataset.theme = t === "system" ? (mq.matches ? "dark" : "light") : t);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [data]);

  /** 저장 공통: 실패해도 입력은 남기고(false 반환) 상태만 알린다 */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setStatus("saving");
      setNotice("");
      try {
        await fn();
        await reload();
        return true;
      } catch (e) {
        if (e instanceof Conflict) {
          await reload();
          setNotice(
            e.gone
              ? "다른 기기에서 이미 지운 계획이야. 필요하면 새로 추가해줘."
              : "다른 기기에서 먼저 고쳤어. 최신 내용을 불러왔으니, 내 입력으로 덮으려면 저장을 다시 눌러.",
          );
          setStatus("ok");
        } else {
          setStatus(navigator.onLine ? "error" : "offline");
          setNotice(navigator.onLine ? "저장하지 못했어. 입력은 그대로 있으니 다시 눌러줘." : "인터넷이 끊겨 저장 못 했어. 입력은 이 기기에 남아 있어.");
        }
        return false;
      }
    },
    [reload],
  );

  const occsBetween = useCallback(
    (from: number, to: number) => (data ? visible(data.entries, data.rules, data.excs, from, to, now) : []),
    [data, now],
  );

  // 보이는 날짜들 (7일=일~토, 3·1일=오늘 이전으로 못 감)
  const start = !anchor ? today : view === 7 ? weekStart(anchor) : anchor < today ? today : anchor;
  const dates = useMemo(() => Array.from({ length: view }, (_, i) => addDays(start, i)), [start, view]);
  const occs = useMemo(() => occsBetween(dayStart(dates[0], tz), dayEnd(dates[dates.length - 1], tz)), [occsBetween, dates, tz]);
  const canPrev = view === 7 ? start > weekStart(today) : start > today;
  const sd = dates.includes(statDate) && statDate >= today ? statDate : dates.find((d) => d >= today) ?? today;
  const stats = useMemo(() => dayStats(occsBetween(dayStart(sd, tz) - 86_400_000, dayEnd(sd, tz)), sd, tz, now), [occsBetween, sd, tz, now]);

  if (!data) {
    return (
      <div className="p-6 text-muted">
        {status === "loading" ? "불러오는 중…" : "불러오지 못했어. 인터넷 연결을 확인해줘."}
        {status !== "loading" && (
          <button className="btn ml-2" onClick={reload}>
            다시 시도
          </button>
        )}
      </div>
    );
  }

  const openNew = (date = sd, min = Math.ceil((date === today ? zoned(now, tz).min : 9 * 60) / 30) * 30) =>
    setEditing({ target: { mode: "new" }, form: formFor({ mode: "new" }, data, tz, date, Math.min(min, 23 * 60)) });
  const openOcc = (o: Occ) => setEditing({ target: { mode: "occ", occ: o }, form: formFor({ mode: "occ", occ: o }, data, tz, "", 0) });
  const editRule = (r: Rule) => {
    // 다음에 생기는 날짜의 일정을 "반복 전체"로 연다
    let d = today;
    for (let i = 0; i < 8 && !ruleAppliesOn(r, d); i++) d = addDays(d, 1);
    const sp = ruleSpan(r, d);
    const o: Occ = { key: `r:${r.id}:${d}`, kind: "rule", id: r.id, date: d, title: r.title, ...sp, category: r.category, color: r.color, note: r.note };
    setPanel(null);
    setEditing({ target: { mode: "occ", occ: o }, form: { ...formFor({ mode: "occ", occ: o }, data, tz, "", 0), scope: "all" } });
  };

  const go = (dir: number) => setAnchor(addDays(start, dir * view));
  const rangeLabel =
    view === 1 ? fmtDate(dates[0]) : `${fmtDate(dates[0]).replace(/ \(.\)/, "")} – ${Number(dates[dates.length - 1].slice(8))}일`;

  return (
    <main className="flex h-full flex-col">
      <header className="border-b border-line px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:px-4">
        <div className="flex items-center gap-1.5">
          <h1 className="mr-auto truncate font-semibold">{rangeLabel}</h1>
          <SyncDot status={status} />
          <button className="btn !px-2.5" disabled={!canPrev} onClick={() => go(-1)} aria-label="이전 기간">
            ◀
          </button>
          <button className="btn" onClick={() => setAnchor(today)}>
            오늘
          </button>
          <button className="btn !px-2.5" onClick={() => go(1)} aria-label="다음 기간">
            ▶
          </button>
          <label className="btn relative cursor-pointer !px-2.5" aria-label="날짜 선택">
            날짜
            <input
              type="date"
              min={today}
              className="absolute inset-0 opacity-0"
              onChange={(e) => {
                if (!e.target.value) return;
                setAnchor(e.target.value);
                setStatDate(e.target.value);
              }}
            />
          </label>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex rounded-lg bg-hour p-0.5 text-sm" role="tablist" aria-label="보기">
            {([7, 3, 1] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 ${view === v ? "bg-surface font-medium shadow-sm" : "text-muted"}`}
              >
                {v}일
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button className="btn text-sm" onClick={() => setPanel("backward")}>
            역산
          </button>
          <button className="btn text-sm" onClick={() => setPanel("settings")}>
            설정
          </button>
          <button className="btn btn-primary text-sm" onClick={() => openNew()}>
            + 추가
          </button>
        </div>
      </header>

      {notice && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-start gap-2 border-b border-line bg-hour px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm shadow-sm">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice("")} aria-label="알림 닫기">
            ✕
          </button>
        </div>
      )}

      <Grid
        dates={dates}
        occs={occs}
        now={now}
        tz={tz}
        today={today}
        view={view}
        onAdd={(d, m) => openNew(d, m)}
        onOpen={openOcc}
        onMove={(o, s, e) => run(() => moveOcc(data, o, s, e))}
        onDay={(d) => {
          setAnchor(d);
          setStatDate(d);
          setView(1);
        }}
      />

      <button
        className="flex items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-left text-sm flex-wrap"
        onClick={() => setPanel("stats")}
      >
        <b className="font-medium">{fmtDate(sd)}</b>
        <span>계획 {fmtDur(stats.planned)}</span>
        {sd === today ? <span className="text-accent">지금부터 빈 시간 {fmtDur(stats.avail)}</span> : <span>빈 시간 {fmtDur(stats.free)}</span>}
        {stats.overlaps.length > 0 && <span className="text-now">겹침 {stats.overlaps.length}</span>}
        <span className="ml-auto text-muted">자세히</span>
      </button>

      {panel === "stats" && (
        <StatsSheet
          date={sd}
          stats={stats}
          tz={tz}
          today={today}
          dayOccs={occsBetween(dayStart(sd, tz), dayEnd(sd, tz))}
          data={data}
          run={run}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "backward" && <Backward tz={tz} now={now} today={today} occsBetween={occsBetween} run={run} onClose={() => setPanel(null)} />}
      {panel === "settings" && (
        <Settings
          data={data}
          email={email}
          run={run}
          onClose={() => setPanel(null)}
          onEditRule={editRule}
          onNewRule={() => {
            setPanel(null);
            openNew(today, 23 * 60);
          }}
        />
      )}
      {editing && (
        <Editor
          key={JSON.stringify(editing.target) + editing.form.date + editing.form.start}
          target={editing.target}
          initial={editing.form}
          data={data}
          tz={tz}
          now={now}
          today={today}
          occsBetween={occsBetween}
          run={run}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

function SyncDot({ status }: { status: Status }) {
  const m = {
    loading: ["bg-muted", "불러오는 중"],
    ok: ["bg-[#5aa772]", "동기화됨"],
    saving: ["bg-accent", "저장 중"],
    offline: ["bg-[#d9a23b]", "오프라인"],
    error: ["bg-now", "동기화 실패"],
  }[status];
  return (
    <span className="mr-1 flex items-center gap-1 text-xs text-muted" role="status" title={m[1]}>
      <span className={`h-2.5 w-2.5 rounded-full ${m[0]}`} />
      <span className="sr-only md:not-sr-only">{m[1]}</span>
    </span>
  );
}

function StatsSheet({
  date, stats, tz, today, dayOccs, data, run, onClose,
}: {
  date: string; stats: ReturnType<typeof dayStats>; tz: string; today: string; dayOccs: Occ[]; data: Data;
  run: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const t = (ms: number) => hhmm(zoned(ms, tz).min);
  const preview = copyDay(dayOccs, date, targets, tz, data.rules);

  return (
    <Sheet title={`${fmtDate(date)} 24시간`} onClose={onClose}>
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">하루 전체</dt>
          <dd>{fmtDur(stats.total)}</dd>
          <dt className="text-muted">계획된 시간</dt>
          <dd>{fmtDur(stats.planned)}</dd>
          <dt className="text-muted">배정 안 한 시간</dt>
          <dd>{fmtDur(stats.free)}</dd>
          {date === today && (
            <>
              <dt className="text-muted">지금부터 쓸 수 있는 시간</dt>
              <dd className="text-accent">{fmtDur(stats.avail)}</dd>
            </>
          )}
        </dl>
        <p className="-mt-3 text-xs text-muted">겹친 시간은 한 번만 세. 지난 계획은 화면에 없지만 하루 합계엔 오늘 지나간 시간도 빈 시간으로 들어가.</p>

        <section>
          <h3 className="mb-1 text-sm text-muted">빈 구간</h3>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {stats.freeSpans.map((s) => (
              <span key={s.start} className="rounded-md border border-line px-2 py-0.5">
                {t(s.start)}–{t(s.end) === "00:00" ? "24:00" : t(s.end)} · {fmtDur((s.end - s.start) / 60000)}
              </span>
            ))}
          </div>
        </section>

        {stats.overlaps.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm text-now">겹치는 계획</h3>
            <ul className="space-y-0.5 text-sm">
              {stats.overlaps.map(([a, b]) => (
                <li key={a.key + b.key}>
                  {a.title} ({t(a.start)}–{t(a.end)}) ↔ {b.title} ({t(b.start)}–{t(b.end)})
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-line pt-4">
          <h3 className="mb-1 text-sm text-muted">이 날 전체를 다른 날짜에 복사</h3>
          <div className="flex gap-2">
            <input type="date" className="field" min={today} value={pick} onChange={(e) => setPick(e.target.value)} />
            <button
              className="btn"
              disabled={!pick || pick === date || targets.includes(pick)}
              onClick={() => {
                setTargets([...targets, pick].sort());
                setPick("");
              }}
            >
              추가
            </button>
          </div>
          {targets.length > 0 && (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {targets.map((d) => (
                  <button key={d} className="btn text-sm" onClick={() => setTargets(targets.filter((x) => x !== d))}>
                    {fmtDate(d)} ✕
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted">
                계획 {preview.length}개를 만들어. 대상 날짜에도 똑같이 생기는 반복 계획은 빼고 복사해.
              </p>
              <button
                className="btn btn-primary mt-2 w-full"
                disabled={!preview.length}
                onClick={async () => (await run(() => insert("tt_entries", preview))) && onClose()}
              >
                복사하기
              </button>
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
}

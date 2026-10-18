"use client";

import { useEffect, useMemo, useState } from "react";
import { copyOccTo, deleteOcc, Form, formSpan, isRule, moveOcc, saveForm, Target } from "@/lib/actions";
import { Data } from "@/lib/db";
import { hhmm, MIN, Occ, pushLater, zoned } from "@/lib/time";
import { CATEGORIES, colorOf, COLORS, fmtDate, REPEATS, Repeat, repeatOf, WD } from "@/lib/ui";
import Sheet from "./Sheet";

export const DRAFT_KEY = "tt-draft";

export function formFor(t: Target, d: Data, tz: string, date: string, min: number): Form {
  if (t.mode === "new") {
    const end = Math.min(min + 60, 24 * 60 - 1);
    return {
      title: "", date, endDate: date, start: hhmm(min), end: end === 24 * 60 - 1 ? "23:59" : hhmm(end),
      category: "작업", color: "rose", note: "", weekdays: [], scope: "one",
    };
  }
  const o = t.occ;
  const s = zoned(o.start, tz);
  const e = zoned(o.end, tz);
  const rule = o.kind === "rule" ? d.rules.find((r) => r.id === o.id) : undefined;
  return {
    title: o.title, date: s.date, endDate: e.date, start: hhmm(s.min), end: hhmm(e.min),
    category: o.category, color: o.color || "gray", note: o.note, weekdays: rule?.weekdays ?? [], scope: "one",
  };
}

type Props = {
  target: Target;
  initial: Form;
  data: Data;
  tz: string;
  now: number;
  today: string;
  occsBetween: (from: number, to: number) => Occ[];
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
};

export default function Editor({ target, initial, data, tz, now, today, occsBetween, run, onClose }: Props) {
  const [f, setF] = useState(initial);
  const [repeat, setRepeat] = useState<Repeat>(initial.weekdays.length ? repeatOf(initial.weekdays) : "none");
  const [copyDates, setCopyDates] = useState<string[]>([]);
  const [copyPick, setCopyPick] = useState("");
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);

  const rule = isRule(target);
  const occ = target.mode === "occ" ? target.occ : null;
  const oneDay = rule && f.scope === "one"; // 반복의 그 날만 → 시간만 바꿈
  const repeating = rule ? f.scope === "all" : repeat !== "none";

  // 끊겨도 입력값을 잃지 않게 — 고칠 때마다 저장
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ target, form: f }));
    } catch {}
  }, [target, f]);

  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  function pickRepeat(r: Repeat) {
    setRepeat(r);
    if (r !== "custom") set({ weekdays: REPEATS[r].days });
    else if (!f.weekdays.length) set({ weekdays: [new Date(f.date + "T00:00:00Z").getUTCDay()] });
  }

  const span = useMemo(() => {
    if (!/^\d\d:\d\d$/.test(f.start) || !/^\d\d:\d\d$/.test(f.end) || !f.date) return null;
    return formSpan(f, tz, !repeating && !oneDay);
  }, [f, tz, repeating, oneDay]);

  const error = !f.title.trim()
    ? "이름을 적어줘"
    : !span
      ? "날짜·시각을 확인해줘"
      : span.end <= span.start
        ? "끝나는 시각이 시작보다 늦어야 해"
        : repeating && !f.weekdays.length
          ? "반복할 요일을 골라줘"
          : !repeating && span.end <= now
            ? "이미 지난 시간이야"
            : "";

  // 겹치는 계획(첫 구간 기준)과 뒤로 밀기 미리보기
  const conflicts = useMemo(() => {
    if (!span || span.end <= span.start) return [];
    return occsBetween(span.start, span.end).filter((o) => o.key !== occ?.key && o.start < span.end && o.end > span.start);
  }, [span, occsBetween, occ]);
  const moves = useMemo(() => {
    if (!push || !span || !conflicts.length) return [];
    const others = occsBetween(span.start, span.end + 2 * 24 * 60 * MIN).filter(
      (o) => o.key !== occ?.key && !conflicts.some((c) => c.key === o.key),
    );
    return pushLater(conflicts, [span, ...others], span.end + 2 * 24 * 60 * MIN);
  }, [push, span, conflicts, occsBetween, occ]);
  const stuck = conflicts.filter((c) => !moves.some((m) => m.occ.key === c.key));

  async function done(fn: () => Promise<unknown>) {
    setBusy(true);
    const ok = await run(fn);
    setBusy(false);
    if (ok) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      onClose();
    }
  }

  const save = () =>
    done(async () => {
      await saveForm(data, target, f, tz);
      if (push) for (const m of moves) await moveOcc(data, m.occ, m.start, m.end);
    });

  function cancel() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    onClose();
  }

  const fmtSpan = (s: number, e: number) => {
    const a = zoned(s, tz);
    const b = zoned(e, tz);
    return `${a.date === today ? "" : fmtDate(a.date) + " "}${hhmm(a.min)}–${b.date !== a.date ? "다음 날 " : ""}${hhmm(b.min)}`;
  };

  const nextDay = span && zoned(span.end, tz).date !== f.date && f.endDate === f.date;

  return (
    <Sheet title={target.mode === "new" ? "새 계획" : "계획 고치기"} onClose={cancel}>
      <div className="space-y-4">
        {rule && (
          <div className="flex gap-1 rounded-lg bg-hour p-1 text-sm" role="radiogroup" aria-label="고칠 범위">
            {(["one", "all"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={f.scope === s}
                onClick={() => set({ scope: s })}
                className={`flex-1 rounded-md py-1.5 ${f.scope === s ? "bg-surface font-medium shadow-sm" : "text-muted"}`}
              >
                {s === "one" ? `${fmtDate(occ!.date!)}만` : "반복 전체"}
              </button>
            ))}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm text-muted">이름</span>
          <input
            className="field"
            value={f.title}
            disabled={oneDay}
            maxLength={100}
            autoFocus={target.mode === "new"}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="예: 개인 작업"
          />
        </label>

        {!(rule && f.scope === "all") && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm text-muted">날짜</span>
              <input
                type="date"
                className="field"
                min={today}
                value={f.date}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) set({ date: v, endDate: f.endDate === f.date ? v : f.endDate < v ? v : f.endDate });
                }}
              />
            </label>
            {!repeating && !oneDay && (
              <label className="block">
                <span className="mb-1 block text-sm text-muted">종료 날짜</span>
                <input
                  type="date"
                  className="field"
                  min={f.date}
                  value={f.endDate}
                  onChange={(e) => e.target.value && set({ endDate: e.target.value })}
                />
              </label>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">시작</span>
            <input type="time" step={300} className="field" value={f.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">끝 {nextDay && <em className="not-italic text-accent">(다음 날)</em>}</span>
            <input type="time" step={300} className="field" value={f.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
        {span && span.end > span.start && (
          <p className="-mt-2 text-sm text-muted">{Math.round((span.end - span.start) / MIN / 6) / 10}시간</p>
        )}

        {!oneDay && (
          <>
            <div>
              <span className="mb-1 block text-sm text-muted">카테고리</span>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => set({ category: c.name, color: c.color })}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      f.category === c.name ? "border-fg font-medium" : "border-transparent"
                    }`}
                    style={{ background: colorOf(c.color), color: "#23262b" }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-sm text-muted">색</span>
              <div className="flex gap-2">
                {Object.keys(COLORS).map((c) => (
                  <button
                    key={c}
                    onClick={() => set({ color: c })}
                    aria-label={`색 ${c}`}
                    aria-pressed={f.color === c}
                    className={`h-8 w-8 rounded-full ${f.color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""}`}
                    style={{ background: COLORS[c] }}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {!rule && (
          <div>
            <span className="mb-1 block text-sm text-muted">반복</span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(REPEATS) as Repeat[]).map((r) => (
                <button
                  key={r}
                  onClick={() => pickRepeat(r)}
                  className={`btn text-sm ${repeat === r ? "border-accent text-accent" : ""}`}
                >
                  {REPEATS[r].label}
                </button>
              ))}
            </div>
          </div>
        )}
        {repeating && (repeat === "custom" || rule) && (
          <div className="flex gap-1">
            {WD.map((w, i) => {
              const on = f.weekdays.includes(i);
              return (
                <button
                  key={w}
                  aria-pressed={on}
                  onClick={() => set({ weekdays: on ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i].sort() })}
                  className={`h-9 flex-1 rounded-md border text-sm ${on ? "border-accent bg-accent text-white dark:text-[#10141a]" : "border-line"}`}
                >
                  {w}
                </button>
              );
            })}
          </div>
        )}
        {repeating && !rule && <p className="-mt-2 text-sm text-muted">{fmtDate(f.date)}부터 반복해.</p>}

        {!oneDay && (
          <label className="block">
            <span className="mb-1 block text-sm text-muted">메모 (선택)</span>
            <textarea className="field" rows={2} maxLength={1000} value={f.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
        )}

        {conflicts.length > 0 && !repeating && (
          <div className="rounded-lg border border-now/40 p-3 text-sm">
            <p className="font-medium text-now">겹치는 계획 {conflicts.length}개</p>
            <ul className="mt-1 space-y-0.5">
              {conflicts.map((c) => (
                <li key={c.key}>
                  {c.title} · {fmtSpan(c.start, c.end)}
                </li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="h-4 w-4" />
              겹치는 계획을 뒤의 빈 시간으로 밀기
            </label>
            {push && (
              <ul className="mt-2 space-y-0.5 border-t border-line pt-2">
                {moves.map((m) => (
                  <li key={m.occ.key}>
                    {m.occ.title}: {fmtSpan(m.occ.start, m.occ.end)} → <b>{fmtSpan(m.start, m.end)}</b>
                    {m.occ.kind === "rule" && <span className="text-muted"> (그 날만)</span>}
                  </li>
                ))}
                {stuck.map((c) => (
                  <li key={c.key} className="text-now">
                    {c.title}: 이틀 안에 빈 시간이 없어 그대로 둬
                  </li>
                ))}
                <li className="text-muted">저장하면 위처럼 옮겨져.</li>
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-sm text-now">{error}</p>}

        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" disabled={!!error || busy} onClick={save}>
            저장
          </button>
          {occ && (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                const all = rule && f.scope === "all";
                if (all && !confirm(`'${occ.title}' 반복을 통째로 지울까? 앞으로의 모든 날에서 사라져.`)) return;
                done(() => deleteOcc(data, occ, rule ? f.scope : "one"));
              }}
            >
              {rule ? (f.scope === "all" ? "반복 삭제" : "이 날만 빼기") : "삭제"}
            </button>
          )}
        </div>

        {occ && (
          <div className="border-t border-line pt-4">
            <span className="mb-1 block text-sm text-muted">다른 날짜에 복사</span>
            <div className="flex gap-2">
              <input type="date" className="field" min={today} value={copyPick} onChange={(e) => setCopyPick(e.target.value)} />
              <button
                className="btn"
                disabled={!copyPick || copyDates.includes(copyPick)}
                onClick={() => {
                  setCopyDates([...copyDates, copyPick].sort());
                  setCopyPick("");
                }}
              >
                추가
              </button>
            </div>
            {copyDates.length > 0 && (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {copyDates.map((d) => (
                    <button key={d} className="btn text-sm" onClick={() => setCopyDates(copyDates.filter((x) => x !== d))}>
                      {fmtDate(d)} ✕
                    </button>
                  ))}
                </div>
                <button className="btn mt-2 w-full" disabled={busy} onClick={() => done(() => copyOccTo(occ, copyDates, tz))}>
                  {copyDates.length}개 날짜에 복사
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

"use client";

import { useMemo, useState } from "react";
import { insert } from "@/lib/db";
import { backward, hhmm, hm, Occ, toUtc, zoned } from "@/lib/time";
import { CATEGORIES, colorOf, fmtDate, fmtDur } from "@/lib/ui";
import Sheet from "./Sheet";

type Item = { title: string; minutes: number; category: string };

export default function Backward({
  tz, now, today, occsBetween, run, onClose,
}: {
  tz: string; now: number; today: string;
  occsBetween: (from: number, to: number) => Occ[];
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("18:00");
  const [from, setFrom] = useState(""); // 비우면 지금부터
  const [items, setItems] = useState<Item[]>([{ title: "", minutes: 60, category: "작업" }]);
  const [shown, setShown] = useState(false);

  const deadline = date && /^\d\d:\d\d$/.test(time) ? toUtc(date, hm(time), tz) : NaN;
  const earliest = Math.max(now, from ? toUtc(date, hm(from), tz) : now);
  const valid = items.filter((i) => i.title.trim() && i.minutes > 0);

  const res = useMemo(() => {
    if (!(deadline > earliest) || !valid.length) return null;
    const busy = occsBetween(earliest, deadline);
    return backward(valid, deadline, busy, earliest);
  }, [deadline, earliest, valid, occsBetween]);

  const setItem = (i: number, p: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const swap = (i: number, j: number) => {
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    setItems(n);
  };

  const at = (ms: number) => {
    const z = zoned(ms, tz);
    return `${z.date === date ? "" : fmtDate(z.date) + " "}${hhmm(z.min)}`;
  };

  async function apply() {
    if (!res) return;
    const ok = await run(() =>
      insert(
        "tt_entries",
        res.placed.map((p) => {
          const it = valid.find((v) => v.title === p.title)!;
          const color = CATEGORIES.find((c) => c.name === it.category)?.color ?? "gray";
          return {
            title: p.title.trim(), category: it.category, color, note: "",
            start_at: new Date(p.start).toISOString(), end_at: new Date(p.end).toISOString(),
          };
        }),
      ),
    );
    if (ok) onClose();
  }

  return (
    <Sheet title="역산 계산" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">언제까지 끝낼지 정하면, 필요한 시간을 거꾸로 세서 시작 시각을 알려줘. 기존 계획과 겹치지 않게 빈 시간에만 넣어.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">끝낼 날짜</span>
            <input type="date" className="field" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">끝낼 시각</span>
            <input type="time" step={300} className="field" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">이 시각 전엔 시작 안 함 (선택, 비우면 지금부터)</span>
          <input type="time" step={300} className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>

        <div>
          <span className="mb-1 block text-sm text-muted">할 일과 걸리는 시간 (위에서부터 순서대로)</span>
          <ol className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <input
                  className="field min-w-0 flex-1"
                  placeholder="예: 집안일"
                  value={it.title}
                  maxLength={100}
                  onChange={(e) => setItem(i, { title: e.target.value })}
                />
                <select className="field !w-auto" value={it.category} onChange={(e) => setItem(i, { category: e.target.value })} aria-label="카테고리">
                  {CATEGORIES.map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={5}
                  step={5}
                  className="field !w-[68px]"
                  value={it.minutes}
                  onChange={(e) => setItem(i, { minutes: Math.max(0, Math.round(+e.target.value)) })}
                  aria-label="분"
                />
                <span className="text-sm text-muted">분</span>
                <div className="flex flex-col">
                  <button className="px-1 text-xs text-muted disabled:opacity-30" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="위로">▲</button>
                  <button className="px-1 text-xs text-muted disabled:opacity-30" disabled={i === items.length - 1} onClick={() => swap(i, i + 1)} aria-label="아래로">▼</button>
                </div>
                <button className="px-1 text-muted" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="빼기">✕</button>
              </li>
            ))}
          </ol>
          <button className="btn mt-2 text-sm" onClick={() => setItems([...items, { title: "", minutes: 30, category: "작업" }])}>
            + 항목
          </button>
        </div>

        {res && (
          <div className="space-y-2 border-t border-line pt-4">
            <p>
              필요한 시간 <b>{fmtDur(res.needMin)}</b> · 쓸 수 있는 빈 시간 {fmtDur(res.freeMin)}
            </p>
            {res.start !== null ? (
              <p className="text-lg">
                <b>{at(res.start)}</b>에 시작하면 돼.
              </p>
            ) : res.shortMin > 0 ? (
              <p className="text-now">시간이 {fmtDur(res.shortMin)} 모자라.</p>
            ) : (
              <p className="text-now">빈 시간은 충분하지만 잘게 쪼개져 있어서 한 번에 못 들어가는 항목이 있어.</p>
            )}
            <ul className="space-y-1">
              {res.placed.map((p, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-sm" style={{ background: colorOf(CATEGORIES.find((c) => c.name === valid.find((v) => v.title === p.title)?.category)?.color ?? "gray") }} />
                  {at(p.start)}–{hhmm(zoned(p.end, tz).min)} {p.title}
                </li>
              ))}
              {res.unplaced.map((u, i) => (
                <li key={"u" + i} className="text-sm text-now">
                  못 넣음: {u.title} ({fmtDur(u.minutes)})
                </li>
              ))}
            </ul>
            {!shown ? (
              <button className="btn btn-primary w-full" disabled={!res.placed.length} onClick={() => setShown(true)}>
                시간표에 넣기…
              </button>
            ) : (
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1" onClick={apply}>
                  {res.placed.length}개 넣기 확인
                </button>
                <button className="btn" onClick={() => setShown(false)}>
                  취소
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

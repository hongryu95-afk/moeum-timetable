"use client";

import { useEffect, useRef, useState } from "react";
import { clip, dayEnd, dayStart, hhmm, MIN, Occ, zoned } from "@/lib/time";
import { colorOf, WD } from "@/lib/ui";

type Props = {
  dates: string[];
  occs: Occ[];
  now: number;
  tz: string;
  today: string;
  view: 1 | 3 | 7;
  onAdd: (date: string, min: number) => void;
  onOpen: (o: Occ) => void;
  onMove: (o: Occ, start: number, end: number) => void;
  onDay: (date: string) => void;
};

const PPH = { 7: 34, 3: 46, 1: 60 }; // 시간당 픽셀
const SNAP = 5; // 끌기 단위(분)

/** 같은 칸에서 겹치는 블록을 옆으로 나란히 놓을 자리 계산 */
function lanes(items: { start: number; end: number }[]) {
  const laneEnd: number[] = [];
  const lane = items.map((it) => {
    let i = laneEnd.findIndex((e) => e <= it.start);
    if (i < 0) i = laneEnd.push(0) - 1;
    laneEnd[i] = it.end;
    return i;
  });
  // 서로 이어진 겹침 묶음마다 칸 수를 따로 센다
  const cols = new Array(items.length).fill(1);
  let gStart = 0;
  let gEnd = -Infinity;
  for (let i = 0; i <= items.length; i++) {
    if (i === items.length || items[i].start >= gEnd) {
      const n = Math.max(1, ...lane.slice(gStart, i).map((l) => l + 1));
      for (let j = gStart; j < i; j++) cols[j] = n;
      gStart = i;
    }
    if (i < items.length) gEnd = Math.max(gEnd, items[i].end);
  }
  return { lane, cols };
}

export default function Grid({ dates, occs, now, tz, today, view, onAdd, onOpen, onMove, onDay }: Props) {
  const pph = PPH[view];
  const ppm = pph / 60;
  const body = useRef<HTMLDivElement>(null);
  const nowMin = zoned(now, tz).min;

  // 처음엔 지금(또는 아침 7시) 근처로 스크롤
  const scrolled = useRef("");
  useEffect(() => {
    const key = dates[0] + view;
    if (!body.current || scrolled.current === key) return;
    scrolled.current = key;
    const h = dates.includes(today) ? Math.max(0, nowMin / 60 - 1.5) : 7;
    body.current.scrollTop = h * pph;
  }, [dates, view, today, nowMin, pph]);

  const gutter = view === 7 ? 26 : 44;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 날짜 머리줄 */}
      <div className="flex border-b border-line" style={{ paddingLeft: gutter }}>
        {dates.map((d) => {
          const past = d < today;
          const wd = new Date(d + "T00:00:00Z").getUTCDay();
          return (
            <button
              key={d}
              onClick={() => !past && onDay(d)}
              disabled={past}
              className={`min-w-0 flex-1 py-1.5 text-center leading-tight ${past ? "text-muted/60" : ""}`}
              aria-label={`${d} 하루 보기`}
            >
              <span className={`block text-[11px] ${wd === 0 ? "text-now" : wd === 6 ? "text-accent" : "text-muted"}`}>
                {WD[wd]}
              </span>
              <span
                className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                  d === today ? "bg-accent font-semibold text-white dark:text-[#10141a]" : ""
                }`}
              >
                {Number(d.slice(8))}
              </span>
            </button>
          );
        })}
      </div>

      {/* 시간 몸통 */}
      <div ref={body} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative flex" style={{ height: 24 * pph }}>
          <div className="shrink-0" style={{ width: gutter }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="relative text-right text-[10px] text-muted" style={{ height: pph }}>
                {h > 0 && <span className="absolute -top-[7px] right-1">{view === 7 ? h : hhmm(h * 60)}</span>}
              </div>
            ))}
          </div>
          {dates.map((d) => (
            <Column
              key={d}
              date={d}
              occs={occs}
              now={now}
              tz={tz}
              today={today}
              view={view}
              ppm={ppm}
              pph={pph}
              onAdd={onAdd}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Column({
  date, occs, now, tz, today, view, ppm, pph, onAdd, onOpen, onMove,
}: Omit<Props, "dates" | "onDay"> & { date: string; ppm: number; pph: number }) {
  const lo = dayStart(date, tz);
  const hi = dayEnd(date, tz);
  const past = date < today;
  const items = occs.filter((o) => o.end > lo && o.start < hi).map((o) => ({ o, ...clip(o, Math.max(lo, now), hi) }));
  const { lane, cols } = lanes(items);
  const pastH = past ? 24 * pph : date === today ? ((now - lo) / MIN) * ppm : 0;

  function add(e: React.MouseEvent<HTMLDivElement>) {
    if (past || e.target !== e.currentTarget) return;
    const y = e.nativeEvent.offsetY;
    const min = Math.floor(y / ppm / 30) * 30;
    if (lo + (min + 30) * MIN <= now) return;
    onAdd(date, min);
  }

  return (
    <div
      className="relative min-w-0 flex-1 border-l border-line"
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${pph - 1}px, var(--hour) ${pph - 1}px, var(--hour) ${pph}px)`,
      }}
      onClick={add}
    >
      {pastH > 0 && <div className="pointer-events-none absolute inset-x-0 top-0 bg-past/80" style={{ height: pastH }} />}
      {items.map((it, i) => (
        <Block
          key={it.o.key}
          o={it.o}
          top={((it.start - lo) / MIN) * ppm}
          height={((it.end - it.start) / MIN) * ppm}
          left={(lane[i] / cols[i]) * 100}
          width={100 / cols[i]}
          ppm={ppm}
          view={view}
          tz={tz}
          clippedTop={it.start > it.o.start}
          onOpen={onOpen}
          onMove={onMove}
          now={now}
        />
      ))}
      {date === today && (
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-now" style={{ top: pastH }}>
          <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-now" />
        </div>
      )}
    </div>
  );
}

function Block({
  o, top, height, left, width, ppm, view, tz, clippedTop, onOpen, onMove, now,
}: {
  o: Occ; top: number; height: number; left: number; width: number; ppm: number; view: 1 | 3 | 7; tz: string;
  clippedTop: boolean; onOpen: (o: Occ) => void; onMove: (o: Occ, s: number, e: number) => void; now: number;
}) {
  // 끌기 중 미리보기: 위치(dTop)·길이(dLen) 변화량(분)
  const [drag, setDrag] = useState<{ dTop: number; dLen: number } | null>(null);
  const canDrag = view !== 7;
  const mouseHandled = useRef(false); // 마우스로 누른 건 끌기 코드가 열기까지 처리한다

  function startDrag(e: React.PointerEvent, mode: "move" | "resize") {
    if (!canDrag || (mode === "move" && (e.pointerType !== "mouse" || clippedTop))) return;
    e.stopPropagation();
    if (mode === "move") mouseHandled.current = true;
    const y0 = e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let d = { dTop: 0, dLen: 0 };
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const m = Math.round((ev.clientY - y0) / ppm / SNAP) * SNAP;
      if (Math.abs(ev.clientY - y0) > 4) moved = true;
      d = mode === "move" ? { dTop: m, dLen: 0 } : { dTop: 0, dLen: Math.max(SNAP - (o.end - o.start) / MIN, m) };
      setDrag(d);
    };
    const up = () => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) {
        if (mode === "move") onOpen(o);
        return;
      }
      const s = o.start + d.dTop * MIN;
      const en = o.end + (d.dTop + d.dLen) * MIN;
      if (en > now && (d.dTop || d.dLen)) onMove(o, s, en);
    };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  const t = top + (drag?.dTop ?? 0) * ppm;
  const h = Math.max(view === 7 ? 12 : 18, height + (drag?.dLen ?? 0) * ppm - 1);
  const s = zoned(o.start + (drag?.dTop ?? 0) * MIN, tz).min;
  const e = zoned(o.end + ((drag?.dTop ?? 0) + (drag?.dLen ?? 0)) * MIN, tz).min;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(ev) => {
        ev.stopPropagation();
        if (mouseHandled.current) mouseHandled.current = false;
        else onOpen(o);
      }}
      onKeyDown={(ev) => ev.key === "Enter" && onOpen(o)}
      onPointerDown={(ev) => startDrag(ev, "move")}
      className={`absolute overflow-hidden rounded-[5px] text-[var(--block-fg)] ${drag ? "z-20 opacity-90 shadow-md" : ""} ${
        view === 7 ? "px-[3px] py-[1px]" : "px-1.5 py-1"
      }`}
      style={{
        top: t,
        height: h,
        left: `calc(${left}% + 1px)`,
        width: `calc(${width}% - 2px)`,
        background: colorOf(o.color),
        cursor: canDrag ? "grab" : "pointer",
      }}
      aria-label={`${o.title} ${hhmm(s)}–${hhmm(e)}`}
    >
      <div className={`font-medium leading-tight ${view === 7 ? "line-clamp-3 break-all text-[10px]" : "text-[13px]"}`}>
        {o.title}
      </div>
      {view !== 7 && h > 34 && (
        <div className="text-[11px] leading-tight opacity-70">
          {hhmm(s)}–{hhmm(e)}
          {o.kind === "rule" && " · 반복"}
        </div>
      )}
      {view === 1 && o.note && h > 60 && <div className="mt-0.5 line-clamp-2 text-[11px] opacity-70">{o.note}</div>}
      {canDrag && (
        <div
          className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize touch-none"
          onPointerDown={(ev) => startDrag(ev, "resize")}
          onClick={(ev) => ev.stopPropagation()}
          aria-label="길이 조절"
        />
      )}
    </div>
  );
}

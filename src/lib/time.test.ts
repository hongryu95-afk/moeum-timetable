import { describe, expect, it } from "vitest";
import {
  addDays, backward, copyDay, dayStats, Entry, Exception, expandRules, MIN, pushLater, Rule,
  toUtc, visible, weekStart, zoned,
} from "./time";

const TZ = "Asia/Seoul";
const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return toUtc(date, h * 60 + m, TZ);
};
const iso = (date: string, time: string) => new Date(at(date, time)).toISOString();

const entry = (id: string, date: string, s: string, e: string, endDate = date): Entry => ({
  id, title: id, start_at: iso(date, s), end_at: iso(endDate, e), category: "", color: "", note: "", version: 1,
});
const rule = (p: Partial<Rule>): Rule => ({
  id: "r1", title: "수면", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "23:00", end_time: "07:00",
  timezone: TZ, category: "생활", color: "", note: "", active: true,
  effective_start_date: "2026-01-01", effective_end_date: null, version: 1, ...p,
});

// 기준: 2026-10-18(일) 12:00 서울
const NOW = at("2026-10-18", "12:00");

describe("시간대·날짜", () => {
  it("서울 날짜↔UTC 왕복", () => {
    expect(zoned(at("2026-10-29", "14:00"), TZ)).toEqual({ date: "2026-10-29", min: 840 });
    expect(new Date(at("2026-10-29", "00:00")).toISOString()).toBe("2026-10-28T15:00:00.000Z");
  });
  it("주는 일요일에 시작", () => {
    expect(weekStart("2026-10-22")).toBe("2026-10-18");
    expect(weekStart("2026-10-18")).toBe("2026-10-18");
  });
  it("서머타임 시간대도 하루 길이를 실제로 계산", () => {
    const s = dayStats([], "2026-03-08", "America/New_York", 0);
    expect(s.total).toBe(23 * 60);
  });
});

describe("미래 일정", () => {
  it("다음 주 목요일 일정이 그 날에 보인다", () => {
    const thu = addDays(weekStart("2026-10-18"), 7 + 4); // 10-29 목
    expect(thu).toBe("2026-10-29");
    const e = entry("작업", thu, "14:00", "16:00");
    const v = visible([e], [], [], at(thu, "00:00"), at(addDays(thu, 1), "00:00"), NOW);
    expect(v.map((o) => o.title)).toEqual(["작업"]);
  });
});

describe("자정 넘김", () => {
  it("23:00~07:00 수면이 두 날에 나눠 잡힌다", () => {
    const occ = expandRules([rule({})], [], at("2026-10-20", "00:00"), at("2026-10-21", "00:00"));
    // 19일 밤 수면(00~07)과 20일 밤 수면(23~24)
    expect(occ.map((o) => o.date).sort()).toEqual(["2026-10-19", "2026-10-20"]);
    const s = dayStats(occ, "2026-10-20", TZ, 0);
    expect(s.planned).toBe(8 * 60);
    expect(s.free).toBe(16 * 60);
  });
});

describe("겹침·가용 시간", () => {
  it("겹친 시간은 한 번만 센다", () => {
    const d = "2026-10-25";
    const occ = visible([entry("a", d, "09:00", "12:00"), entry("b", d, "11:00", "13:00")], [], [],
      at(d, "00:00"), at(addDays(d, 1), "00:00"), NOW);
    const s = dayStats(occ, d, TZ, 0);
    expect(s.planned).toBe(4 * 60);
    expect(s.free).toBe(20 * 60);
    expect(s.overlaps).toHaveLength(1);
    expect(s.freeSpans.map((x) => (x.end - x.start) / MIN)).toEqual([540, 660]);
  });
  it("수면 8 + 생활 5 → 나머지 11시간", () => {
    const d = "2026-10-25";
    const occ = [
      ...expandRules([rule({})], [], at(d, "00:00"), at(addDays(d, 1), "00:00")), // 00~07 + 23~24 = 8h
      ...visible([entry("식사", d, "12:00", "13:00"), entry("집안일", d, "18:00", "22:00")], [], [], 0, Infinity, 0),
    ];
    expect(dayStats(occ, d, TZ, 0).free).toBe(11 * 60);
  });
  it("오늘 남은 가용 시간은 지금 이후만", () => {
    const s = dayStats([], "2026-10-18", TZ, NOW);
    expect(s.avail).toBe(12 * 60);
  });
});

describe("역산", () => {
  const items = [{ title: "작업", minutes: 120 }, { title: "집안일", minutes: 60 }, { title: "휴식", minutes: 30 }];
  it("고정 일정이 없으면 18:00 마감 → 14:30 시작", () => {
    const r = backward(items, at("2026-10-25", "18:00"), [], at("2026-10-25", "00:00"));
    expect(zoned(r.start!, TZ).min).toBe(14 * 60 + 30);
    expect(r.placed.map((p) => p.title)).toEqual(["작업", "집안일", "휴식"]);
    expect(r.needMin).toBe(210);
  });
  it("고정 일정은 피해서, 쪼개지 않고 배치", () => {
    const busy = [{ start: at("2026-10-25", "16:00"), end: at("2026-10-25", "17:00") }];
    const r = backward(items, at("2026-10-25", "18:00"), busy, at("2026-10-25", "00:00"));
    // 휴식 17:30~18:00, 집안일 16:00 앞이 아니라 17:00~... 1시간 칸 없음 → 15:00~16:00, 작업 13:00~15:00
    const t = r.placed.map((p) => [zoned(p.start, TZ).min / 60, zoned(p.end, TZ).min / 60]);
    expect(t).toEqual([[13, 15], [15, 16], [17.5, 18]]);
    expect(r.start).toBe(at("2026-10-25", "13:00"));
  });
  it("시간이 모자라면 부족 시간 표시", () => {
    const r = backward(items, at("2026-10-25", "18:00"), [], at("2026-10-25", "16:00"));
    expect(r.shortMin).toBe(90);
    expect(r.start).toBeNull();
    expect(r.unplaced.map((x) => x.title)).toEqual(["작업"]);
  });
});

describe("반복 예외", () => {
  const work = rule({ id: "w", title: "작업", weekdays: [1], start_time: "09:00", end_time: "11:00" });
  const exc: Exception = {
    id: "x", rule_id: "w", occurrence_date: "2026-10-26", override_start_at: iso("2026-10-26", "10:00"),
    override_end_at: iso("2026-10-26", "12:00"), is_cancelled: false, version: 1,
  };
  it("그 날만 10:00~12:00, 다른 월요일은 원래대로", () => {
    const occ = expandRules([work], [exc], at("2026-10-19", "00:00"), at("2026-11-03", "00:00"));
    const t = occ.map((o) => `${zoned(o.start, TZ).date} ${zoned(o.start, TZ).min / 60}`).sort();
    expect(t).toEqual(["2026-10-19 9", "2026-10-26 10", "2026-11-02 9"]);
  });
  it("그 날만 취소", () => {
    const occ = expandRules([work], [{ ...exc, is_cancelled: true }], at("2026-10-26", "00:00"), at("2026-10-27", "00:00"));
    expect(occ).toHaveLength(0);
  });
  it("토요일 수면만 01:00~09:00", () => {
    const sat = "2026-10-24";
    const x: Exception = { ...exc, rule_id: "r1", occurrence_date: sat, override_start_at: iso(addDays(sat, 1), "01:00"), override_end_at: iso(addDays(sat, 1), "09:00") };
    const occ = expandRules([rule({})], [x], at(addDays(sat, 1), "00:00"), at(addDays(sat, 2), "00:00"));
    const satNight = occ.find((o) => o.date === sat)!;
    expect(zoned(satNight.start, TZ).min).toBe(60);
    expect(occ.find((o) => o.date === addDays(sat, 1))).toBeTruthy(); // 일요일 밤 수면은 그대로
  });
});

describe("지난 계획 제외", () => {
  it("끝난 일회성은 정리 작업이 안 돌았어도 안 보이고, 진행 중은 보인다", () => {
    const d = "2026-10-18";
    const v = visible([entry("끝남", d, "09:00", "11:00"), entry("진행중", d, "11:00", "13:00"), entry("나중", d, "15:00", "16:00")],
      [], [], at(d, "00:00"), at(addDays(d, 1), "00:00"), NOW);
    expect(v.map((o) => o.title)).toEqual(["진행중", "나중"]);
  });
  it("반복 규칙은 지나간 날짜가 있어도 앞으로 계속 생긴다", () => {
    const r = rule({ effective_start_date: "2020-01-01" });
    const v = visible([], [r], [], at("2026-10-30", "00:00"), at("2026-10-31", "00:00"), NOW);
    expect(v).toHaveLength(2);
  });
  it("지난 날짜 범위는 통째로 비어 있다", () => {
    expect(visible([entry("x", "2026-10-17", "09:00", "10:00")], [rule({})], [], at("2026-10-17", "00:00"), at("2026-10-18", "00:00"), NOW)).toEqual([]);
  });
});

describe("복사·재배치", () => {
  it("하루 전체 복사 — 대상 날에도 생기는 반복은 빼고 같은 시각으로", () => {
    const d = "2026-10-25";
    const sleep = rule({});
    const gym = rule({ id: "g", title: "운동", weekdays: [0], start_time: "07:00", end_time: "08:00" });
    const occ = visible([entry("작업", d, "14:00", "16:00")], [sleep, gym], [], at(d, "00:00"), at(addDays(d, 1), "00:00"), NOW);
    const out = copyDay(occ, d, ["2026-10-27", "2026-10-28"], TZ, [sleep, gym]);
    // 날마다 작업 + 운동(일요일 반복이라 화·수엔 없음), 수면은 매일 반복이라 제외
    expect(out.map((e) => `${zoned(Date.parse(e.start_at), TZ).date} ${e.title}`).sort()).toEqual([
      "2026-10-27 운동", "2026-10-27 작업", "2026-10-28 운동", "2026-10-28 작업",
    ]);
    expect(out.find((e) => e.title === "작업")!.start_at).toBe(iso("2026-10-27", "14:00"));
  });
  it("겹치는 일정은 다음 빈 시간으로 밀기 제안", () => {
    const d = "2026-10-25";
    const [a] = visible([entry("a", d, "14:00", "15:00")], [], [], 0, Infinity, 0);
    const res = pushLater([a], [{ start: at(d, "13:00"), end: at(d, "16:00") }], at(addDays(d, 1), "00:00"));
    expect(res[0].start).toBe(at(d, "16:00"));
  });
});

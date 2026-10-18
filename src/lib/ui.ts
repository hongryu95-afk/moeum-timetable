// 화면 공용 값 — 색·카테고리·글자 포맷

export const COLORS: Record<string, string> = {
  rose: "#f6d3d1",
  peach: "#fae0c4",
  butter: "#f3eab3",
  mint: "#cde9d6",
  sky: "#cbe2f4",
  lavender: "#ded7f2",
  sand: "#e7ded1",
  gray: "#e1e4e8",
};

export const CATEGORIES: { name: string; color: string }[] = [
  { name: "수면", color: "lavender" },
  { name: "식사", color: "peach" },
  { name: "집안일", color: "sand" },
  { name: "외출", color: "sky" },
  { name: "휴식", color: "mint" },
  { name: "개인시간", color: "butter" },
  { name: "작업", color: "rose" },
  { name: "기타", color: "gray" },
];

export const colorOf = (c: string) => COLORS[c] ?? COLORS.gray;

export const WD = ["일", "월", "화", "수", "목", "금", "토"];

export const REPEATS = {
  none: { label: "안 함", days: [] as number[] },
  daily: { label: "매일", days: [0, 1, 2, 3, 4, 5, 6] },
  weekdays: { label: "평일", days: [1, 2, 3, 4, 5] },
  weekend: { label: "주말", days: [0, 6] },
  custom: { label: "요일 선택", days: [] as number[] },
};
export type Repeat = keyof typeof REPEATS;

export function repeatOf(days: number[]): Repeat {
  const k = [...days].sort().join();
  for (const r of ["daily", "weekdays", "weekend"] as Repeat[]) if (REPEATS[r].days.join() === k) return r;
  return "custom";
}

export function fmtDur(min: number) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}분`;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

/** "10월 29일 (목)" */
export function fmtDate(date: string) {
  const [, mo, d] = date.split("-").map(Number);
  const wd = new Date(date + "T00:00:00Z").getUTCDay();
  return `${mo}월 ${d}일 (${WD[wd]})`;
}

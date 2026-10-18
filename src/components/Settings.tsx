"use client";

import { useRef, useState } from "react";
import { Data, insert, Profile, saveProfile, sb } from "@/lib/db";
import { Rule } from "@/lib/time";
import { colorOf, WD } from "@/lib/ui";
import Sheet from "./Sheet";

export default function Settings({
  data, email, run, onClose, onEditRule, onNewRule,
}: {
  data: Data; email: string;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
  onEditRule: (r: Rule) => void;
  onNewRule: () => void;
}) {
  const [p, setP] = useState<Profile>(data.profile);
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [p.timezone];

  async function change(patch: Partial<Profile>) {
    const n = { ...p, ...patch };
    setP(n);
    if (patch.theme) {
      try {
        localStorage.setItem("tt-theme", patch.theme);
      } catch {}
    }
    await run(() => saveProfile(n));
  }

  function backup() {
    const blob = new Blob([JSON.stringify({ app: "tt", version: 1, ...data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `계획표-백업-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function restore(f: File) {
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== "tt" || !Array.isArray(j.entries) || !Array.isArray(j.rules)) throw new Error();
      const strip = <T extends object>(x: T) => {
        const { id, version, ...rest } = x as T & { id?: string; version?: number };
        void id; void version;
        return rest;
      };
      const entries = j.entries.filter((e: { end_at: string }) => Date.parse(e.end_at) > Date.now()).map(strip);
      if (!confirm(`일회성 계획 ${entries.length}개와 반복 ${j.rules.length}개를 더할까? (지금 있는 건 그대로 두고 추가만 해)`)) return;
      const ok = await run(async () => {
        await insert("tt_entries", entries);
        await insert("tt_rules", j.rules.map(strip));
      });
      setMsg(ok ? "복원했어. (반복의 날짜별 예외는 복원하지 않아)" : "");
    } catch {
      setMsg("이 앱의 백업 파일이 아니야.");
    }
  }

  return (
    <Sheet title="설정" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm text-muted">계정</h3>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{email}</span>
            <button className="btn" onClick={() => sb.auth.signOut()}>
              로그아웃
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">기본 시간대</span>
            <select className="field" value={p.timezone} onChange={(e) => change({ timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-sm text-muted">기본 보기</span>
            <div className="flex gap-1.5">
              {([7, 3, 1] as const).map((v) => (
                <button key={v} className={`btn flex-1 ${p.default_view === v ? "border-accent text-accent" : ""}`} onClick={() => change({ default_view: v })}>
                  {v}일
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-sm text-muted">테마</span>
            <div className="flex gap-1.5">
              {(["system", "light", "dark"] as const).map((t) => (
                <button key={t} className={`btn flex-1 ${p.theme === t ? "border-accent text-accent" : ""}`} onClick={() => change({ theme: t })}>
                  {{ system: "기기 설정", light: "밝게", dark: "어둡게" }[t]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm text-muted">반복 생활시간</h3>
          {data.rules.length === 0 && <p className="text-sm text-muted">아직 없어. 수면·식사처럼 매번 같은 시간은 반복으로 넣어둬.</p>}
          <ul className="divide-y divide-line">
            {data.rules.map((r) => (
              <li key={r.id}>
                <button className="flex w-full items-center gap-2 py-2 text-left" onClick={() => onEditRule(r)}>
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colorOf(r.color) }} />
                  <span className="flex-1 truncate">{r.title}</span>
                  <span className="text-sm text-muted">
                    {r.weekdays.length === 7 ? "매일" : r.weekdays.map((d) => WD[d]).join("")} {r.start_time}–{r.end_time}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button className="btn mt-2 text-sm" onClick={onNewRule}>
            + 생활시간 추가
          </button>
        </section>

        <section>
          <h3 className="mb-2 text-sm text-muted">데이터 백업</h3>
          <div className="flex gap-2">
            <button className="btn flex-1" onClick={backup}>
              백업 파일 받기
            </button>
            <button className="btn flex-1" onClick={() => file.current?.click()}>
              백업에서 복원
            </button>
          </div>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
          {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
        </section>
      </div>
    </Sheet>
  );
}

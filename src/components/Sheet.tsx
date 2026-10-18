"use client";

import { useEffect } from "react";

/** 모바일=아래에서 올라오는 시트, PC=오른쪽 편집 패널 */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/25 md:bg-transparent md:pointer-events-none" onClick={onClose} />
      <section
        role="dialog"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col rounded-t-2xl bg-surface shadow-[0_-4px_24px_rgba(0,0,0,0.12)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:border-l md:border-line md:shadow-[-4px_0_24px_rgba(0,0,0,0.06)]"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    </>
  );
}

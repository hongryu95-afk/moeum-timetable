# 유동 계획표 — 스펙 문서

원 지시문(24시간 유동형 시간 계획표)을 기준으로 하되, 2026-10-18 사용자와 합의한 변경을 반영한다.

## 목표
폰·PC에서 같은 계정으로 쓰는, 앞으로의 24시간을 배치하고 자주 고치는 개인 시간 계획표.

## 합의된 변경 (원 지시문 대비)
- 7일 보기 = **일~토**. 이번 주 지난 요일은 회색 빈칸(칸 위치 고정).
- **서버 예약 정리 작업 없음.** 조회 시 지난 계획 제외 + 앱 열 때 내 지난 일회성 계획·지난 반복 예외를 DB에서 삭제.
- 로그인 = 구글(Supabase Auth). 공용 Supabase 프로젝트에 `tt_` 접두 테이블만 추가.
- 역산의 작업 분할은 1차 제외(쪼개지 않는 배치만).
- 시간대 기본 Asia/Seoul, 설정에서 변경 가능.
- 오늘 루틴 앱과의 통합은 미정 — 미리 만드는 연결 없음.

## 데이터
- `tt_profiles`(user_id, timezone, default_view, theme)
- `tt_entries` 일회성(start_at/end_at timestamptz, version)
- `tt_rules` 반복(weekdays int[], start_time/end_time, 자정 넘김 허용, 유효기간)
- `tt_exceptions` 반복 예외(rule_id, occurrence_date, override 또는 취소)
- 생활시간 = 반복 규칙(카테고리)로 표현. 과거 가상 일정은 저장하지 않음.
- RLS: 모든 테이블 `user_id = auth.uid()`.

## UI
- 상단: 기간 이동(이전/다음/오늘/날짜 선택) · 7일/3일/1일 전환 · 추가 · 역산 · 설정
- 시간표: 세로=시간, 가로=날짜, 블록 높이=소요 시간, 현재 시각선, 빈 시간은 배경 그대로
- 하단/옆: 그날 계획 합계 · 빈 시간 · 겹침
- 편집: PC=오른쪽 패널, 모바일=하단 시트. 반복 일정은 "이 날만 / 전체 규칙" 선택
- 파스텔 카테고리 색, AI 슬롭 금지(tool-ui-principles.md)

## 기술 스택
Next.js(App Router) · TypeScript · Tailwind · Supabase(Postgres/Auth/Realtime) · Vercel · PWA(manifest+sw) · Vitest

## 완료 기준
1. Vitest: 자정 넘김·겹침 차감·가용시간·역산·반복 예외·지난 계획 제외 테스트 전부 통과.
2. `next build` 성공, 360px 폭에서 7일(일~토) 7열이 가로 스크롤 없이 보임.
3. 로그인한 두 브라우저에서 한쪽 수정이 다른 쪽에 5초 안에 반영, 같은 계획 동시 수정 시 충돌 알림.

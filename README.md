# 계획표 — 24시간 유동형 시간 계획표

앞으로의 24시간을 미리 배치하고, 바뀌면 바로 고치는 개인용 시간 계획표. 할 일 체크리스트가 아니라 **시간 배분** 도구다. 폰·PC에서 같은 구글 계정으로 쓰면 계획이 맞춰진다.

스펙(합의된 변경 포함): [SPEC.md](SPEC.md)

## 기능

- **7일(일~토) / 3일 / 1일 보기**: 블록 높이 = 실제 시간. 현재 시각선. 이번 주 지난 요일·오늘 지난 시간은 회색. 모바일에서도 7일이 한 화면에 다 보임.
- **일정**: 이름·날짜·시작/종료(자정 넘김 자동)·카테고리·색·메모. 3일·1일 보기에서 아래 가장자리를 끌면 길이 조절, PC는 블록을 끌어서 옮기기.
- **반복**: 매일·평일·주말·요일 선택. 반복 일정은 "이 날만 / 반복 전체"를 골라서 고친다. 이 날만 고치면 원래 규칙은 그대로 두고 예외로 저장.
- **24시간 계산**: 계획된 시간·배정 안 한 시간·지금부터 쓸 수 있는 시간·빈 구간·겹침. 겹친 시간은 한 번만 센다.
- **역산**: 끝낼 시각과 할 일별 소요 시간을 넣으면 기존 계획을 피해 거꾸로 배치하고 시작 시각을 알려준다. 모자라면 부족 시간을 보여주고, 확인을 눌러야 시간표에 들어간다. (할 일 쪼개기는 안 함)
- **겹침 → 뒤로 밀기**: 저장하려는 계획이 다른 계획과 겹치면 알려주고, 원하면 겹치는 계획을 뒤의 빈 시간으로 옮기는 안을 미리 보여준다. 저장해야 적용된다.
- **복사**: 일정 하나를 여러 날짜에, 하루 전체를 여러 날짜에(대상 날에도 생기는 반복은 빼고).
- **지난 계획**: 끝나면 화면에서 바로 빠진다(30초마다 갱신). 앱을 열 때 DB에서도 지운다. 반복 규칙은 지우지 않는다.
- **동기화**: Supabase 실시간 알림 + 창으로 돌아올 때 다시 불러오기. 다른 기기가 먼저 고쳤으면 덮어쓰지 않고 알려준다(version 비교). 저장 실패 시 입력은 이 기기에 남는다.
- **설정**: 시간대·기본 보기·테마·반복 생활시간 목록·백업 파일 받기/복원.
- **PWA**: 홈 화면에 설치 가능.

## 구조

```
src/lib/time.ts       시간 계산 엔진(순수 함수) — 시간대, 반복 전개, 겹침·빈 구간, 역산, 밀기, 복사
src/lib/time.test.ts  Vitest
src/lib/db.ts         Supabase 연결·불러오기·정리·version 충돌 감지·실시간 구독
src/lib/actions.ts    화면 동작 → DB 변경(반복의 "이 날만"은 예외로)
src/components/       App(로그인·메인), Grid(시간표), Editor, Backward(역산), Settings, Sheet
supabase/migrations/  테이블·RLS·트리거 SQL
```

데이터: `tt_profiles`(설정), `tt_entries`(일회성), `tt_rules`(반복 규칙), `tt_exceptions`(반복의 날짜별 예외). 반복 일정은 규칙만 저장하고 화면에 그릴 때 계산한다. 모든 테이블은 RLS로 본인 것만 보인다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # Supabase 주소와 publishable 키 입력
npm run dev -- --port 3017
npm test
```

## Supabase 설정 (처음 한 번)

1. `supabase/migrations/*.sql`을 SQL Editor에서 실행(또는 `supabase db push`).
2. Authentication → Providers → Google 켜기.
3. Authentication → URL Configuration → Redirect URLs에 앱 주소를 추가: `http://localhost:3017/**`, 배포 주소 `https://<도메인>/**`.

## 배포 (Vercel)

1. GitHub 저장소에 올리고 Vercel에서 가져오기(Framework: Next.js).
2. 환경변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 등록.
3. 배포된 주소를 Supabase Redirect URLs에 추가.

서버 예약 작업(Cron)은 쓰지 않는다 — 지난 계획은 조회에서 빠지고 앱을 열 때 정리되므로 Vercel 무료 플랜으로 충분하다.

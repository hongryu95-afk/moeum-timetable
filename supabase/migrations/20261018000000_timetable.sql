-- 유동 계획표 (공용 프로젝트 — tt_ 접두사로 다른 앱과 분리)

create table public.tt_profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  timezone text not null default 'Asia/Seoul' check (length(timezone) between 1 and 64),
  default_view smallint not null default 7 check (default_view in (1, 3, 7)),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  updated_at timestamptz not null default now()
);

create table public.tt_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 100),
  start_at timestamptz not null,
  end_at timestamptz not null,
  category text not null default '' check (length(category) <= 30),
  color text not null default '' check (length(color) <= 20),
  note text not null default '' check (length(note) <= 1000),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index tt_entries_user_end on public.tt_entries (user_id, end_at);

create table public.tt_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 100),
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{0,1,2,3,4,5,6}'),
  start_time time not null,
  end_time time not null, -- start_time 이하이면 다음 날 끝남
  timezone text not null default 'Asia/Seoul' check (length(timezone) between 1 and 64),
  category text not null default '' check (length(category) <= 30),
  color text not null default '' check (length(color) <= 20),
  note text not null default '' check (length(note) <= 1000),
  active boolean not null default true,
  effective_start_date date not null default current_date,
  effective_end_date date,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tt_rules_user on public.tt_rules (user_id);

create table public.tt_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  rule_id uuid not null references public.tt_rules on delete cascade,
  occurrence_date date not null,
  override_start_at timestamptz,
  override_end_at timestamptz,
  is_cancelled boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, occurrence_date),
  check (override_end_at is null or override_start_at is null or override_end_at > override_start_at)
);
create index tt_exceptions_user_date on public.tt_exceptions (user_id, occurrence_date);

-- 수정할 때마다 version +1 — 클라이언트는 "where version = 내가 본 값"으로 고쳐서 충돌을 잡는다
create function public.tt_bump() returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger tt_entries_bump before update on public.tt_entries for each row execute function public.tt_bump();
create trigger tt_rules_bump before update on public.tt_rules for each row execute function public.tt_bump();
create trigger tt_exceptions_bump before update on public.tt_exceptions for each row execute function public.tt_bump();

-- RLS: 내 것만
alter table public.tt_profiles enable row level security;
alter table public.tt_entries enable row level security;
alter table public.tt_rules enable row level security;
alter table public.tt_exceptions enable row level security;

create policy own on public.tt_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own on public.tt_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own on public.tt_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own on public.tt_exceptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tt_rules r where r.id = rule_id and r.user_id = (select auth.uid()))
  );

revoke all on public.tt_profiles, public.tt_entries, public.tt_rules, public.tt_exceptions from anon;
grant select, insert, update, delete on public.tt_profiles, public.tt_entries, public.tt_rules, public.tt_exceptions to authenticated;

-- 실시간 동기화(변경 알림은 RLS를 따른다)
alter publication supabase_realtime add table public.tt_entries, public.tt_rules, public.tt_exceptions, public.tt_profiles;

-- ==============================================================================
-- Telemetry: daily heartbeat storage + dashboard views
-- ==============================================================================
-- Applied via Supabase MCP migrations:
--   1. add_telemetry_tables
--   2. add_telemetry_dashboard_views
-- ==============================================================================

-- 1. Daily heartbeat aggregates (one row per install_id per day)
create table if not exists client_daily_stats (
  id                       bigserial   primary key,
  install_id               text        not null,
  day                      date        not null,
  app_version              text,
  enabled                  boolean,
  is_pro                   boolean,
  is_trial                 boolean,
  active_ai_count          int         not null default 0,
  active_search_count      int         not null default 0,
  custom_ai_count          int         not null default 0,
  custom_search_count      int         not null default 0,
  active_ai_ids            jsonb       not null default '[]'::jsonb,
  active_search_ids        jsonb       not null default '[]'::jsonb,
  bang_histogram           jsonb       not null default '{}'::jsonb,
  telemetry_schema_version int         not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint client_daily_unique unique (install_id, day)
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_client_daily_updated_at on client_daily_stats;
create trigger trg_client_daily_updated_at
before update on client_daily_stats
for each row execute function set_updated_at();

create index if not exists idx_cds_day     on client_daily_stats(day);
create index if not exists idx_cds_install on client_daily_stats(install_id);
create index if not exists idx_cds_version on client_daily_stats(app_version);

alter table client_daily_stats enable row level security;

-- 2. Delivery log
create table if not exists telemetry_ingest_log (
  id          bigserial   primary key,
  install_id  text,
  day         date,
  status      text        not null,
  message     text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_til_created on telemetry_ingest_log(created_at desc);
alter table telemetry_ingest_log enable row level security;

-- ==============================================================================
-- 3. Dashboard views
-- ==============================================================================

-- DAU
create or replace view v_dau as
select day, count(distinct install_id)::int as dau
from client_daily_stats
group by day order by day desc;

-- WAU (rolling 7-day)
create or replace view v_wau as
select d.day,
  (select count(distinct s.install_id)::int
   from client_daily_stats s
   where s.day between d.day - interval '6 days' and d.day) as wau
from (select distinct day from client_daily_stats) d
order by d.day desc;

-- MAU (rolling 30-day)
create or replace view v_mau as
select d.day,
  (select count(distinct s.install_id)::int
   from client_daily_stats s
   where s.day between d.day - interval '29 days' and d.day) as mau
from (select distinct day from client_daily_stats) d
order by d.day desc;

-- Custom site count distribution
create or replace view v_custom_distribution as
select day, custom_ai_count, custom_search_count, count(*)::int as users
from client_daily_stats
group by day, custom_ai_count, custom_search_count
order by day desc, users desc;

-- Top active AI sites
create or replace view v_top_ai_sites as
select day, site_id, count(*)::int as users
from client_daily_stats, jsonb_array_elements_text(active_ai_ids) as site_id
group by day, site_id order by day desc, users desc;

-- Top active search engines
create or replace view v_top_search_sites as
select day, site_id, count(*)::int as users
from client_daily_stats, jsonb_array_elements_text(active_search_ids) as site_id
group by day, site_id order by day desc, users desc;

-- Version adoption
create or replace view v_version_adoption as
select day, app_version, count(distinct install_id)::int as users
from client_daily_stats where app_version is not null
group by day, app_version order by day desc, users desc;

-- Pro vs trial vs free
create or replace view v_plan_distribution as
select day,
  count(*) filter (where is_pro)::int   as pro_users,
  count(*) filter (where is_trial)::int as trial_users,
  count(*) filter (where not is_pro and not is_trial)::int as free_users
from client_daily_stats
group by day order by day desc;

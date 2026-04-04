-- ==============================================================================
-- 1. site_requests (Users can suggest AI/Search/Feature requests and vote)
-- ==============================================================================
create table if not exists site_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,             -- Title of the request
  url text,                       -- URL for AI/Search requests; optional for feature
  description text,               -- Extra details (used for feature requests)
  type text not null check (type in ('ai', 'se', 'feature')),
  votes int default 1,            -- Tracks upvotes
  voter_ids text[] default '{}',  -- Prevents double-voting
  creator_id text,                -- Anonymous install ID (rate limit)
  status text default 'pending',  -- pending | added
  created_at timestamptz default now()
);

-- Bring older installs forward to the current schema
alter table site_requests add column if not exists description text;
alter table site_requests drop constraint if exists site_requests_type_check;
alter table site_requests
  add constraint site_requests_type_check check (type in ('ai', 'se', 'feature'));
alter table site_requests enable row level security;
drop policy if exists "public read site_requests" on site_requests;
create policy "public read site_requests" on site_requests for select using (true);

-- RPC for secure upvoting
create or replace function vote_request(req_id uuid, voter text)
returns boolean as $$
begin
  if exists (select 1 from site_requests where id = req_id and voter = any(voter_ids)) then
    return false; -- Already voted
  end if;

  update site_requests
  set votes = votes + 1,
      voter_ids = array_append(voter_ids, voter)
  where id = req_id;

  return true;
end;
$$ language plpgsql security definer;

-- RPC for secure submission with 1-hour rate limit
create or replace function submit_request(
  r_name text,
  r_url text,
  r_type text,
  r_description text,
  r_creator text
)
returns json as $$
declare
  last_req timestamptz;
begin
  -- Check for a request from this same creator in the last hour
  select created_at into last_req
  from site_requests
  where creator_id = r_creator
  order by created_at desc
  limit 1;

  if last_req is not null and (now() - last_req) < interval '1 hour' then
    return json_build_object(
      'success', false,
      'message', 'You can only make one request per hour.'
    );
  end if;

  -- Insert the new request
  insert into site_requests (name, url, type, description, creator_id)
  values (r_name, r_url, r_type, r_description, r_creator);

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

grant execute on function vote_request(uuid, text) to anon, authenticated;
grant execute on function submit_request(text, text, text, text, text) to anon, authenticated;

-- ==============================================================================
-- 2. announcements (For "News & Updates")
-- ==============================================================================
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,       -- Headline
  description text,          -- Body text/details
  version text,              -- Optional version tag e.g. "v1.4.0"
  link text,                 -- Optional URL
  created_at timestamptz default now()
);

alter table announcements add column if not exists version text;
alter table announcements enable row level security;
drop policy if exists "public read announcements" on announcements;
create policy "public read announcements" on announcements for select using (true);


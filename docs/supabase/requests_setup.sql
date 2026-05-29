-- ==============================================================================
-- 1. site_requests (Users can suggest AI/Search/Feature/Bug requests and vote)
-- ==============================================================================
create table if not exists site_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,             -- Title of the request
  url text,                       -- URL for AI/Search requests; optional for feature/bug
  description text,               -- Extra details (used for feature and bug reports)
  type text not null check (type in ('ai', 'se', 'feature', 'bug')),
  votes int default 1,            -- Tracks upvotes
  voter_ids text[] default '{}',  -- Prevents double-voting
  creator_id text,                -- Anonymous install ID (who submitted)
  status text default 'pending',  -- pending | added
  created_at timestamptz default now()
);

-- Bring older installs forward to the current schema
alter table site_requests add column if not exists description text;
alter table site_requests add column if not exists creator_id text;
alter table site_requests drop constraint if exists site_requests_type_check;
alter table site_requests
  add constraint site_requests_type_check check (type in ('ai', 'se', 'feature', 'bug'));
alter table site_requests enable row level security;
drop policy if exists "public read site_requests" on site_requests;
create policy "public read site_requests" on site_requests for select using (true);

-- RPC for secure upvoting
create or replace function toggle_vote(req_id uuid, voter text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  next_voted boolean;
  next_votes int;
begin
  if voter is null or length(btrim(voter)) < 8 or length(voter) > 128 then
    return json_build_object('success', false, 'message', 'Invalid voter');
  end if;

  if not exists (select 1 from site_requests where id = req_id and status = 'pending') then
    return json_build_object('success', false, 'message', 'Request not found');
  end if;

  if exists (select 1 from site_requests where id = req_id and voter = any(voter_ids)) then
    update site_requests
    set voter_ids = array_remove(voter_ids, voter),
        votes = greatest(array_length(array_remove(voter_ids, voter), 1), 0)
    where id = req_id
    returning votes into next_votes;

    next_voted := false;
  else
    update site_requests
    set voter_ids = array_append(voter_ids, voter),
        votes = greatest(coalesce(array_length(voter_ids, 1), 0) + 1, 1)
    where id = req_id
    returning votes into next_votes;

    next_voted := true;
  end if;

  return json_build_object('success', true, 'voted', next_voted, 'votes', next_votes);
end;
$$;

-- Backwards-compatible one-way upvote wrapper for older clients.
create or replace function vote_request(req_id uuid, voter text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if exists (select 1 from site_requests where id = req_id and voter = any(voter_ids)) then
    return false;
  end if;

  result := toggle_vote(req_id, voter);
  return coalesce((result->>'success')::boolean, false);
end;
$$;

-- RPC for secure submission. Client-side validation is only UX; this function
-- enforces type, length, URL shape, creator shape, and a one-hour rate limit.
create or replace function submit_request(
  r_name text,
  r_url text,
  r_type text,
  r_description text,
  r_creator text
)
returns json as $$
declare
  clean_name text := btrim(coalesce(r_name, ''));
  clean_url text := btrim(coalesce(r_url, ''));
  clean_type text := btrim(coalesce(r_type, ''));
  clean_description text := btrim(coalesce(r_description, ''));
  clean_creator text := btrim(coalesce(r_creator, ''));
begin
  if clean_type not in ('ai', 'se', 'feature', 'bug') then
    return json_build_object('success', false, 'message', 'Invalid request type');
  end if;

  if length(clean_name) < 3 or length(clean_name) > 120 then
    return json_build_object('success', false, 'message', 'Title must be 3-120 characters');
  end if;

  if clean_type in ('feature', 'bug') then
    if length(clean_name) < 8 or length(clean_description) < 15 then
      return json_build_object('success', false, 'message', 'Please include a clear title and description');
    end if;
    clean_url := null;
  else
    if clean_url !~* '^https?://[^[:space:]/]+\\.[^[:space:]]+' or length(clean_url) > 500 then
      return json_build_object('success', false, 'message', 'Enter a valid http(s) URL');
    end if;
  end if;

  if length(clean_description) > 1000 then
    return json_build_object('success', false, 'message', 'Description is too long');
  end if;

  if length(clean_creator) < 8 or length(clean_creator) > 128 then
    return json_build_object('success', false, 'message', 'Invalid creator');
  end if;

  if exists (
    select 1
    from site_requests
    where creator_id = clean_creator
      and created_at > now() - interval '1 hour'
  ) then
    return json_build_object('success', false, 'message', 'Please wait before submitting another request');
  end if;

  insert into site_requests (name, url, type, description, creator_id, voter_ids, votes)
  values (clean_name, clean_url, clean_type, nullif(clean_description, ''), clean_creator, array[clean_creator], 1);

  return json_build_object('success', true);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function toggle_vote(uuid, text) to anon, authenticated;
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

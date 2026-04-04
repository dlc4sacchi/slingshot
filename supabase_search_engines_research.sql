-- Add/normalize search categories and seed research engines.
-- Run this in your Supabase SQL editor.

-- 1) Ensure category column exists and normalize legacy values.
alter table if exists search_engines
  add column if not exists category text;

update search_engines
set category = 'general'
where category is null
   or btrim(category) = ''
   or lower(category) not in ('general', 'dev', 'design', 'research');

-- 2) Move known research sources into the research bucket.
update search_engines set category = 'research' where id in ('wikipedia', 'scholar', 'google_scholar', 'semanticscholar', 'arxiv', 'pubmed');
update search_engines set category = 'research' where lower(name) in ('wikipedia', 'google scholar', 'semantic scholar', 'arxiv', 'pubmed');

-- 3) Upsert core research engines (keeps existing rows if ids already exist).
insert into search_engines (id, name, bang, url, active, custom, category)
values
  ('google_scholar', 'Google Scholar', 'gs', 'https://scholar.google.com/scholar?q=%s', false, false, 'research'),
  ('semanticscholar', 'Semantic Scholar', 'ss', 'https://www.semanticscholar.org/search?q=%s', false, false, 'research'),
  ('arxiv', 'arXiv', 'ax', 'https://arxiv.org/search/?query=%s&searchtype=all', false, false, 'research')
on conflict (id) do update
set
  name = excluded.name,
  url = excluded.url,
  category = excluded.category;

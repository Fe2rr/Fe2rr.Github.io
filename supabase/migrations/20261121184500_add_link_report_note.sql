alter table public.link_reports
  add column if not exists note text not null default '';

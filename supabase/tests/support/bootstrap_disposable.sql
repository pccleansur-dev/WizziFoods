create schema auth;
create schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end;
$$;

create table auth.users (
  id uuid primary key
);

create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

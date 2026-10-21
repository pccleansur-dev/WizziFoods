begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select has_function(
  'private',
  'is_auth_session_active',
  array['uuid', 'uuid'],
  'active administrative session function exists'
);

insert into auth.users (id)
values
  ('70000000-0000-4000-8000-000000000007'),
  ('80000000-0000-4000-8000-000000000008');

insert into auth.sessions (id, user_id, not_after)
values
  (
    '90000000-0000-4000-8000-000000000009',
    '70000000-0000-4000-8000-000000000007',
    now() + interval '1 hour'
  ),
  (
    'a0000000-0000-4000-8000-00000000000a',
    '70000000-0000-4000-8000-000000000007',
    now() - interval '1 minute'
  );

select ok(
  private.is_auth_session_active(
    '90000000-0000-4000-8000-000000000009',
    '70000000-0000-4000-8000-000000000007'
  ),
  'an active session is accepted for its owner'
);

select isnt(
  private.is_auth_session_active(
    '90000000-0000-4000-8000-000000000009',
    '80000000-0000-4000-8000-000000000008'
  ),
  true,
  'a session cannot be used by another identity'
);

select isnt(
  private.is_auth_session_active(
    'a0000000-0000-4000-8000-00000000000a',
    '70000000-0000-4000-8000-000000000007'
  ),
  true,
  'an expired session is rejected'
);

delete from auth.sessions
where id = '90000000-0000-4000-8000-000000000009';

select isnt(
  private.is_auth_session_active(
    '90000000-0000-4000-8000-000000000009',
    '70000000-0000-4000-8000-000000000007'
  ),
  true,
  'a revoked session is rejected immediately'
);

select * from finish();
rollback;

begin;

do $migration$
declare
  definition text := pg_get_functiondef(
    'private.diner_account_split_view(uuid,uuid,text,bytea)'::regprocedure
  );
  split_filter text := $old$    and candidate.session_id = account_id
    and candidate.status = 'open';$old$;
  current_split text := $new$    and candidate.session_id = account_id
  order by (candidate.status = 'open') desc, candidate.created_at desc, candidate.id desc
  limit 1;
  if split.status = 'superseded' or (
    split.status = 'done' and not exists (
      select 1 from private.account_split_shares own_share
      where own_share.split_id = split.id
        and own_share.status = 'paid'
        and own_share.claimed_hash = target_secret_hash
    )
  ) then
    split := null;
  end if;$new$;
  claim_owner text := $old$'mine', share.status = 'claimed'
              and share.claimed_hash is not distinct from target_secret_hash,$old$;
  paid_owner text := $new$'mine', coalesce(
              share.status in ('claimed', 'paid')
              and share.claimed_hash = target_secret_hash, false),$new$;
begin
  if strpos(definition, split_filter) = 0 or strpos(definition, claim_owner) = 0 then
    raise exception 'diner_account_split_view changed: expected anchors not found';
  end if;
  execute replace(replace(definition, split_filter, current_split), claim_owner, paid_owner);
end;
$migration$;

commit;

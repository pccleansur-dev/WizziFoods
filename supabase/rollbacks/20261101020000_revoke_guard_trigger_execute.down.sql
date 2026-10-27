begin;

grant execute on function
  private.guard_loyalty_visit_change(),
  private.guard_split_change(),
  private.guard_online_payment_change(),
  private.guard_split_share_change()
to public;

commit;

begin;

-- T33: the trigger functions that guard loyalty visits, splits, shares and online payments
-- kept the default EXECUTE for PUBLIC. They are only ever fired by their triggers (the
-- privilege is checked when the trigger is created, not when it fires), so nobody needs to
-- be able to name them. Every other function in `private` was already closed; this brings
-- these four in line, and supabase/tests/database/security_posture.test.sql keeps it so.
revoke all on function
  private.guard_loyalty_visit_change(),
  private.guard_split_change(),
  private.guard_online_payment_change(),
  private.guard_split_share_change()
from public, anon, authenticated;

commit;

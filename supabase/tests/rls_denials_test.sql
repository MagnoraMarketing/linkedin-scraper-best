-- ============================================================================
--  Checks that must raise. Run individually by scripts/test-db.sh, which
--  asserts each one fails; a success here would be the bug.
-- ============================================================================

-- CHECK: inserting a lead owned by another user
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
insert into leads (user_id, full_name) values ('11111111-1111-1111-1111-111111111111', 'Injected');

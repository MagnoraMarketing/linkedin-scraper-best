-- CHECK: a browser session must not be able to claim jobs
set role authenticated;
select * from claim_next_job('evil');

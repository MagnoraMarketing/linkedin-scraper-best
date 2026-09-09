-- CHECK: the anon role must not be able to read leads at all
set role anon;
select count(*) from leads;

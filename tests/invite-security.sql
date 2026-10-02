-- Transaction-only fixtures: no real accounts or invitations are changed.
begin;
create function pg_temp.access_denied(command text) returns void language plpgsql as $$
begin
 begin execute command; exception when insufficient_privilege or raise_exception then return; end;
 raise exception 'Unexpected access allowed: %',command;
end $$;
do $$
declare f uuid:=gen_random_uuid(); f2 uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); invited uuid:=gen_random_uuid(); second_invited uuid:=gen_random_uuid(); ticket jsonb; result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,aud,role) values(o,o||'@test.invalid',now(),'authenticated','authenticated'),(a,a||'@test.invalid',now(),'authenticated','authenticated'),(m,m||'@test.invalid',now(),'authenticated','authenticated'),(x,x||'@test.invalid',now(),'authenticated','authenticated');
 insert into public.families(id,name) values(f,'Temporary invite tests'),(f2,'Temporary other family');
 insert into public.family_members(family_id,user_id,display_name,role,color) values(f,o,'Owner','owner','#355c50'),(f,a,'Admin','admin','#355c50'),(f,m,'Member','member','#355c50'),(f2,x,'Other','owner','#355c50');
 perform pg_temp.access_denied(format('select public.prepare_family_access_link(%L,%L,%L,null)',o,invited||'@test.invalid','invite'));
 update private.family_access_config set enabled=true;
 perform pg_temp.access_denied(format('select public.prepare_family_access_link(%L,%L,%L,null)',m,invited||'@test.invalid','invite'));
 perform pg_temp.access_denied(format('select public.prepare_family_access_link(%L,null,%L,%L)',a,'recovery',o));
 perform pg_temp.access_denied(format('select public.prepare_family_access_link(%L,null,%L,%L)',o,'recovery',x));
 ticket=public.prepare_family_access_link(o,invited||'@test.invalid','invite',null);
 insert into auth.users(id,email,invited_at,aud,role) values(invited,invited||'@test.invalid',now(),'authenticated','authenticated');
 result=public.finish_family_access_link((ticket->>'request_id')::uuid,invited);
 assert length(result->>'family_code')=32,'Family code entropy';
 perform pg_temp.access_denied(format('select public.finish_family_access_link(%L,%L)',ticket->>'request_id',invited));
 perform pg_temp.access_denied(format('select public.prepare_family_access_link(%L,null,%L,%L)',o,'recovery',m));
 update private.family_access_requests set created_at=now()-interval '2 minutes' where family_id=f;
 ticket=public.prepare_family_access_link(a,null,'recovery',m);
 result=public.finish_family_access_link((ticket->>'request_id')::uuid,m);
 assert result->>'family_code' is null,'Recovery must not join a family';
 update private.family_access_requests set created_at=now()-interval '2 minutes' where family_id=f;
 ticket=public.prepare_family_access_link(a,second_invited||'@test.invalid','invite',null);
 insert into auth.users(id,email,invited_at,aud,role) values(second_invited,second_invited||'@test.invalid',now(),'authenticated','authenticated');
 update public.family_members set role='member' where user_id=a;
 -- Revoked admin rights, wrong target and expired reservations never complete.
 perform pg_temp.access_denied(format('select public.finish_family_access_link(%L,%L)',ticket->>'request_id',second_invited));
 update public.family_members set role='admin' where user_id=a;
 perform pg_temp.access_denied(format('select public.finish_family_access_link(%L,%L)',ticket->>'request_id',invited));
 update private.family_access_requests set created_at=now()-interval '6 minutes' where id=(ticket->>'request_id')::uuid;
 perform pg_temp.access_denied(format('select public.finish_family_access_link(%L,%L)',ticket->>'request_id',second_invited));
 execute 'set local role authenticated';
 perform pg_temp.access_denied(format('select public.prepare_family_access_link(%L,%L,%L,null)',o,'bad@test.invalid','invite'));
 perform pg_temp.access_denied('select * from private.family_access_requests');
 execute 'reset role';
 execute 'set local role anon';
 perform pg_temp.access_denied(format('select public.finish_family_access_link(%L,%L)',ticket->>'request_id',invited));
 execute 'reset role';
end $$;
select 'Invite/Reset authorization, family isolation, rate limit, replay and API grants passed' result;
rollback;

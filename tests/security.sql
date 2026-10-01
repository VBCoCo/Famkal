-- Run with the project's SQL tool as postgres. ALL fixture data rolls back.
begin;
create function pg_temp.expect_denied(command text, expected_state text) returns void language plpgsql as $$
declare failed boolean:=false; begin
  begin execute command;
  exception when others then
    if sqlstate<>expected_state then raise exception 'Unexpected failure %, expected %: %',sqlstate,expected_state,sqlerrm; end if;
    failed:=true;
  end;
  if not failed then raise exception 'Security test unexpectedly allowed: %',command; end if;
end $$;
do $$
declare
  o uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  f uuid:=gen_random_uuid(); f2 uuid:=gen_random_uuid(); s uuid; occurrence uuid; exception_id uuid; invite text; new_id uuid;
  patch jsonb; n int; original_date date; changed_date date;
begin
  insert into auth.users(id,email,email_confirmed_at,aud,role)
  values (o,o||'@test.invalid',now(),'authenticated','authenticated'),(a,a||'@test.invalid',now(),'authenticated','authenticated'),
    (m,m||'@test.invalid',now(),'authenticated','authenticated'),(other_owner,other_owner||'@test.invalid',now(),'authenticated','authenticated'),
    (outsider,outsider||'@test.invalid',now(),'authenticated','authenticated');
  insert into public.families(id,name) values(f,'Temporary security family'),(f2,'Temporary other family');
  insert into public.family_members(family_id,user_id,display_name,role,color)
  values(f,o,'Owner','owner','#355c50'),(f,a,'Admin','admin','#355c50'),(f,m,'Member','member','#355c50'),(f2,other_owner,'Other','owner','#355c50');

  -- Owner creates a bounded weekly series using the real API wrapper.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',o,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  patch:=jsonb_build_object('family_id',f,'title','Security series','event_type','appointment','event_date','2026-10-01','all_day',false,'start_time','15:00','end_time','16:00','reminders',jsonb_build_array(0,15));
  s:=public.create_event_series(patch,'weekly','2026-10-22');
  select id,event_date into occurrence,original_date from public.events where series_id=s order by event_date limit 1;
  select id into exception_id from public.events where series_id=s order by event_date offset 1 limit 1;
  select count(*) into n from public.events where series_id=s; assert n=4,'Series creation failed';
  perform public.update_series_scope(exception_id,'single',patch||jsonb_build_object('title','Individual exception','event_date','2026-10-09'));
  perform public.update_series_scope(occurrence,'series',patch||jsonb_build_object('event_date','2026-10-02','all_day',true));
  select event_date into changed_date from public.events where id=occurrence;
  assert changed_date=original_date+1,'Series date shift failed';
  assert (select all_day and start_time is null and end_time is null from public.events where id=occurrence),'All-day normalization failed';
  assert (select title='Individual exception' and event_date='2026-10-09' from public.events where id=exception_id),'Individual exception overwritten';
  perform pg_temp.expect_denied(format('update public.family_members set role=%L where user_id=%L','member',o),'42501');
  perform pg_temp.expect_denied(format('select public.admin_update_member(%L,%L,%L,%L)',o,'member','#355c50','Owner'),'P0001');
  perform pg_temp.expect_denied(format('update public.events set series_id=null where id=%L',occurrence),'42501');
  perform pg_temp.expect_denied(format('update public.events set created_by=%L where id=%L',m,occurrence),'42501');
  perform pg_temp.expect_denied(format('update public.events set assignee_id=%L where id=%L',other_owner,occurrence),'23503');
  perform pg_temp.expect_denied(format('update public.events set title=%L where id=%L',' ',occurrence),'23514');
  perform pg_temp.expect_denied(format('update public.events set reminders=array[-1] where id=%L',occurrence),'23514');
  perform pg_temp.expect_denied(format('update public.family_members set color=%L where user_id=%L','"><img onerror=x>',o),'23514');
  invite:=public.create_family_invitation(outsider||'@test.invalid');

  -- Admin cannot promote self, others, or downgrade owner.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  perform pg_temp.expect_denied(format('update public.family_members set role=%L where user_id=%L','owner',a),'42501');
  perform pg_temp.expect_denied(format('select public.admin_update_member(%L,%L,%L,%L)',a,'owner','#355c50','Admin'),'P0001');
  perform pg_temp.expect_denied(format('select public.admin_update_member(%L,%L,%L,%L)',m,'admin','#355c50','Member'),'P0001');
  perform public.admin_update_member(m,'member','#f39a3f','Renamed member');

  -- A normal member with no assignment cannot exploit NULL comparisons.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);
  perform pg_temp.expect_denied(format('select public.update_series_scope(%L,%L,%L::jsonb)',occurrence,'single',patch::text),'P0001');
  perform pg_temp.expect_denied(format('select public.delete_series_scope(%L,%L)',occurrence,'following'),'P0001');
  select count(*) into n from public.families where id=f2; assert n=0,'Other family visible';
  select count(*) into n from public.family_invitations where family_id=f; assert n=0,'Invitations visible to member';
  update public.family_members set display_name='Member updated',default_reminder_minutes=0 where user_id=m;
  assert (select default_reminder_minutes=0 from public.family_members where user_id=m),'Profile update failed';
  -- A member may create a series but may change only an authorized occurrence.
  new_id:=public.create_event_series(patch,'weekly','2026-10-15');
  select id into occurrence from public.events where series_id=new_id order by event_date limit 1;
  perform public.update_series_scope(occurrence,'single',patch||jsonb_build_object('title','Own exception'));
  perform pg_temp.expect_denied(format('select public.update_series_scope(%L,%L,%L::jsonb)',occurrence,'following',patch::text),'P0001');
  perform pg_temp.expect_denied(format('select public.delete_series_scope(%L,%L)',occurrence,'series'),'P0001');

  -- Joining validates confirmed account email and invitation.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  perform public.join_family(invite);
  assert public.my_family_id()=f,'Invitation join failed';

  -- Owner cancellation is restricted to selected family and scope.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',o,'role','authenticated')::text,true);
  select id into occurrence from public.events where series_id=s order by event_date limit 1;
  perform public.delete_series_scope(occurrence,'following');
  assert not exists(select 1 from public.events where series_id=s and not is_cancelled),'Series cancellation failed';

  execute 'reset role';
  -- Cross-family series IDs are rejected even for privileged raw fixture SQL.
  perform pg_temp.expect_denied(format('insert into public.events(family_id,series_id,title,event_date,created_by) values(%L,%L,%L,%L,%L)',f2,s,'Invalid linkage','2026-10-01',other_owner),'23503');
  execute 'set local role anon';
  perform pg_temp.expect_denied('select * from public.events','42501');
  perform pg_temp.expect_denied('select public.my_family_id()','42501');
  perform pg_temp.expect_denied('select public.create_family(''Unauthorized'')','42501');
  execute 'reset role';
end $$;
select 'PASS: roles, tenant isolation, NULL authorization, invitation, profile, series shift/exceptions/all-day, constraints, anonymous access; fixtures rolled back' as result;
rollback;

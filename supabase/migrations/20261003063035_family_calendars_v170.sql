-- Famkal 1.7.0. Additive identities; existing event rows and device subscriptions survive.
create table public.family_people (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 display_name text not null check(length(trim(display_name)) between 1 and 80),
 color text not null default '#888888' check(color ~ '^#[0-9a-fA-F]{6}$'),
 linked_user_id uuid unique, legacy_test_member_id uuid unique,
 is_active boolean not null default true, is_test boolean not null default false,
 include_in_all_tasks boolean not null default false, created_at timestamptz not null default now(),
 unique(family_id,id), foreign key(family_id,linked_user_id) references public.family_members(family_id,user_id),
 foreign key(family_id,legacy_test_member_id) references public.test_members(family_id,id)
);
create index family_people_family on public.family_people(family_id);
create table public.calendars (
 id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),
 person_id uuid not null unique,display_name text not null check(length(trim(display_name)) between 1 and 80),
 sort_order int not null default 0,is_active boolean not null default true,
 allow_family_create boolean not null default false,created_at timestamptz not null default now(),
 unique(family_id,id),foreign key(family_id,person_id) references public.family_people(family_id,id)
);
create index calendars_family on public.calendars(family_id);
create table public.event_calendars (
 family_id uuid not null,event_id uuid not null,calendar_id uuid not null,primary key(event_id,calendar_id),
 foreign key(family_id,event_id) references public.events(family_id,id) on delete cascade,
 foreign key(family_id,calendar_id) references public.calendars(family_id,id)
);
create index event_calendars_family on public.event_calendars(family_id,calendar_id);
create table public.series_calendars (
 family_id uuid not null,series_id uuid not null,calendar_id uuid not null,primary key(series_id,calendar_id),
 foreign key(family_id,series_id) references public.event_series(family_id,id) on delete cascade,
 foreign key(family_id,calendar_id) references public.calendars(family_id,id)
);
create index series_calendars_family on public.series_calendars(family_id,calendar_id);
alter table public.events add column blocks_time boolean not null default true;
alter table public.family_invitations add column calendar_id uuid;
alter table public.family_invitations add constraint invitation_calendar_family foreign key(family_id,calendar_id) references public.calendars(family_id,id);
create index invitation_calendar_idx on public.family_invitations(calendar_id);
alter table public.event_assignments add column person_id uuid;
alter table public.event_assignments add constraint assignment_person_family foreign key(family_id,person_id) references public.family_people(family_id,id);
-- Stable person identity; legacy columns remain readable for audit and older clients.
alter table public.event_assignments drop constraint event_assignments_check;
insert into public.family_people(family_id,display_name,color,linked_user_id,include_in_all_tasks)
 select family_id,display_name,color,user_id,true from public.family_members;
insert into public.family_people(family_id,display_name,color,legacy_test_member_id,is_test,is_active,include_in_all_tasks)
 select family_id,display_name,color,id,true,is_active,is_active from public.test_members;
update public.event_assignments a set person_id=p.id from public.family_people p
 where p.family_id=a.family_id and (p.linked_user_id=a.member_user_id or p.legacy_test_member_id=a.test_member_id);
alter table public.event_assignments alter column person_id set not null;
create unique index assignment_person_unique on public.event_assignments(event_id,role,person_id);
create index assignments_person on public.event_assignments(family_id,person_id);
-- Existing synchronization is superseded by the controlled 1.7 writer.
drop trigger sync_legacy_assignment on public.events;
insert into public.calendars(family_id,person_id,display_name,sort_order)
 select family_id,id,display_name,1 from public.family_people where linked_user_id is not null;
do $$ declare f record; name text; pid uuid; cid uuid; pos int; begin
 for f in select id from public.families loop
  pos:=0;
  foreach name in array array['Leo','Anna','Oma Lena'] loop
   insert into public.family_people(family_id,display_name,color) values(f.id,name,case name when 'Leo' then '#667c94' when 'Anna' then '#e29a36' else '#819b61' end) returning id into pid;
   insert into public.calendars(family_id,person_id,display_name,sort_order,allow_family_create)
    values(f.id,pid,name,case name when 'Leo' then 0 when 'Anna' then 2 else 3 end,name='Leo') returning id into cid;
   if name='Leo' then
    insert into public.event_calendars select family_id,id,cid from public.events where family_id=f.id;
    insert into public.series_calendars select family_id,id,cid from public.event_series where family_id=f.id;
   end if;
  end loop;
 end loop;
end $$;
alter table public.events drop constraint events_times_valid;
alter table public.events add constraint events_times_valid check(all_day or
 (start_time is not null and end_time is not null and coalesce(end_date,event_date)+end_time >= event_date+start_time+interval '1 minute'));
-- No table write grants for browser roles. All mutation paths validate identities.
do $$ declare t text; begin
 foreach t in array array['family_people','calendars','event_calendars','series_calendars'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy family_read on public.%I for select to authenticated using(family_id=(select private.my_family_id()))',t);
 end loop;
end $$;
revoke delete on public.events from authenticated;
create function private.calendar_owner() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.family_members where user_id=auth.uid() and role='owner')
$$;
create or replace function private.calendar_can_edit(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.events e where e.id=p_id and e.family_id=private.my_family_id() and auth.uid() is not null
 and (private.calendar_owner() or (exists(select 1 from public.event_calendars ec where ec.event_id=e.id) and not exists(
  select 1 from public.event_calendars ec join public.calendars c on c.id=ec.calendar_id join public.family_people p on p.id=c.person_id
  where ec.event_id=e.id and not (coalesce(p.linked_user_id=auth.uid(),false) or (c.allow_family_create and e.created_by=auth.uid()))
 ))))
$$;
create function private.check_calendars(p_ids uuid[],p_create boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare f uuid:=private.my_family_id(); cid uuid; begin
 if auth.uid() is null or f is null or coalesce(cardinality(p_ids),0)=0 or cardinality(p_ids)>50 then raise exception 'Bitte mindestens einen Kalender wählen';end if;
 foreach cid in array p_ids loop
  if cid is null or not exists(select 1 from public.calendars c join public.family_people p on p.id=c.person_id where c.id=cid and c.family_id=f and c.is_active and p.is_active
   and (private.calendar_owner() or p.linked_user_id=auth.uid() or (p_create and c.allow_family_create))) then raise exception 'Kalender ist nicht verfügbar oder nicht freigegeben';end if;
 end loop;
end $$;
create or replace function private.calendar_assign(p_id uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb; p public.family_people%rowtype; f uuid; begin
 select family_id into f from public.events where id=p_id;
 if f is distinct from private.my_family_id() or auth.uid() is null then raise exception 'Falsche Familie';end if;
 if jsonb_typeof(coalesce(p_data->'assignments','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_data->'assignments','[]'::jsonb))>100 then raise exception 'Ungültige Zuordnungen';end if;
 if coalesce((p_data->>'assignee_all')::boolean,false) and exists(select 1 from jsonb_array_elements(p_data->'assignments') x where x->>'role'='assignee') then raise exception 'Alle und einzelne Zuständige sind alternative Auswahlen';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x where x->>'role' in ('to','from') group by x->>'role' having count(distinct x->>'person_id')>1) then raise exception 'Bringt und Holt jeweils nur eine Person';end if;
 for a in select * from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) loop
  if a->>'role' is null or a->>'role' not in ('assignee','to','from') then raise exception 'Ungültige Rolle';end if;
  select * into p from public.family_people where id=(a->>'person_id')::uuid and family_id=f and is_active;
  if not found then raise exception 'Person gehört nicht zur aktiven Familie';end if;
 end loop;
 update public.events set assignee_id=null,transport_to_id=null,transport_from_id=null where id=p_id;
 delete from public.event_assignments where event_id=p_id;
 for a in select distinct x from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x loop
  select * into p from public.family_people where id=(a->>'person_id')::uuid;
  insert into public.event_assignments(family_id,event_id,role,person_id,member_user_id,test_member_id)
   values(f,p_id,a->>'role',p.id,p.linked_user_id,p.legacy_test_member_id);
 end loop;
 update public.events e set assignee_id=(select member_user_id from public.event_assignments where event_id=e.id and role='assignee' and member_user_id is not null order by member_user_id limit 1),
 transport_to_id=(select member_user_id from public.event_assignments where event_id=e.id and role='to' limit 1),
 transport_from_id=(select member_user_id from public.event_assignments where event_id=e.id and role='from' limit 1) where e.id=p_id;
end $$;
alter function private.save_calendar_event(jsonb,uuid,text,text,date,smallint[],jsonb) rename to save_calendar_event_engine;
create function private.save_calendar_event_v170(p_event jsonb,p_id uuid,p_scope text,p_recurrence text,p_until date,p_weekdays smallint[],p_cancel jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare f uuid:=private.my_family_id(); cids uuid[]; ids uuid[]; e public.events%rowtype; target uuid; result_id uuid; sid uuid; existing jsonb; submitted jsonb; begin
 if auth.uid() is null or f is null then raise exception 'Keine Familienmitgliedschaft';end if;
 perform 1 from public.families where id=f for update;
 cids:=array(select distinct value::uuid from jsonb_array_elements_text(p_event->'calendar_ids'));
 perform private.check_calendars(cids);
 if p_id is not null then
  select * into e from public.events where id=p_id and family_id=f;
  if not found or not private.calendar_can_edit(p_id) then raise exception 'Keine Bearbeitungsrechte';end if;
  if p_scope<>'single' and not private.calendar_owner() then raise exception 'Nur Owner dürfen ganze Serien ändern';end if;
  ids:=array(select id from public.events where family_id=f and not is_cancelled and ((p_scope='single' and id=p_id) or (p_scope in ('following','series') and series_id=e.series_id and (not is_exception or id=p_id) and (p_scope='series' or event_date>=e.event_date))));
  foreach target in array ids loop
   if not private.calendar_can_edit(target) then raise exception 'Keine Rechte für einen Serientermin';end if;
  end loop;
  if not private.calendar_owner() and e.created_by<>auth.uid() then
   select coalesce(jsonb_agg(jsonb_build_object('role',role,'person_id',person_id) order by role,person_id),'[]') into existing from public.event_assignments where event_id=e.id;
   select coalesce(jsonb_agg(jsonb_build_object('role',x->>'role','person_id',x->>'person_id') order by x->>'role',x->>'person_id'),'[]') into submitted from jsonb_array_elements(coalesce(p_event->'assignments','[]')) x;
   if existing<>submitted or coalesce((p_event->>'assignee_all')::boolean,false)<>e.assignee_all then raise exception 'Andere Zuständige darf nur Ersteller oder Owner ändern';end if;
  end if;
 end if;
 result_id:=private.save_calendar_event_engine(p_event,p_id,p_scope,p_recurrence,p_until,p_weekdays,p_cancel);
 select series_id into sid from public.events where id=result_id;
 if p_id is null then ids:=array(select id from public.events where (sid is not null and series_id=sid) or id=result_id);end if;
 foreach target in array ids loop
  delete from public.event_calendars where event_id=target;
  insert into public.event_calendars select f,target,unnest(cids);
  update public.events set blocks_time=coalesce((p_event->>'blocks_time')::boolean,true) where id=target;
 end loop;
 if sid is not null and (p_id is null or p_scope='series') then
  delete from public.series_calendars where series_id=sid;
  insert into public.series_calendars select f,sid,unnest(cids);
 end if;
 return result_id;
end $$;
create function public.save_calendar_event_v170(p_event jsonb,p_id uuid default null,p_scope text default 'single',p_recurrence text default 'none',p_until date default null,p_weekdays smallint[] default null,p_cancel jsonb default '[]') returns uuid language sql security invoker set search_path='' as $$ select private.save_calendar_event_v170(p_event,p_id,p_scope,p_recurrence,p_until,p_weekdays,p_cancel) $$;
-- Legacy public writer is intentionally closed; stale apps must reload.
create or replace function public.save_calendar_event(p_event jsonb,p_id uuid default null,p_scope text default 'single',p_recurrence text default 'none',p_until date default null,p_weekdays smallint[] default null,p_cancel jsonb default '[]') returns uuid language plpgsql security invoker set search_path='' as $$begin raise exception 'Bitte Famkal aktualisieren (Version 1.7.0)';end$$;
create function private.calendar_cancel_v170(p_id uuid,p_cancel boolean,p_scope text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; f uuid:=private.my_family_id(); ids uuid[]; target uuid; begin
 if auth.uid() is null or f is null then raise exception 'Keine Familienmitgliedschaft';end if;
 perform 1 from public.families where id=f for update;
 select * into e from public.events where id=p_id and family_id=f;
 if not found or not private.calendar_can_edit(p_id) then raise exception 'Keine Bearbeitungsrechte';end if;
 if p_scope is null or p_scope not in ('single','following','series','vacation') then raise exception 'Ungültiger Umfang';end if;
 if p_scope<>'single' and not private.calendar_owner() then raise exception 'Nur Owner dürfen Serien oder Urlaubsabsagen ändern';end if;
 if p_scope='vacation' then
  if e.event_type<>'vacation' or p_cancel then raise exception 'Ungültige Wiederherstellung';end if;
  ids:=array(select id from public.events where family_id=f and vacation_cancel_id=e.id);
 else
  if p_scope<>'single' and e.series_id is null then raise exception 'Keine Serie';end if;
  ids:=array(select id from public.events where family_id=f and ((p_scope='single' and id=e.id) or (p_scope<>'single' and series_id=e.series_id and (p_scope='series' or event_date>=e.event_date))));
 end if;
 foreach target in array ids loop
  if not private.calendar_can_edit(target) then raise exception 'Keine Rechte für einen betroffenen Termin';end if;
  update public.events set is_cancelled=p_cancel,vacation_cancel_id=null,is_exception=case when series_id is not null then true else is_exception end where id=target;
 end loop;
end $$;
create function public.calendar_cancel_v170(p_id uuid,p_cancel boolean,p_scope text default 'single') returns void language sql security invoker set search_path='' as $$select private.calendar_cancel_v170(p_id,p_cancel,p_scope)$$;
create or replace function public.calendar_cancel(p_id uuid,p_cancel boolean,p_scope text default 'single') returns void language plpgsql security invoker set search_path='' as $$begin raise exception 'Bitte Famkal aktualisieren (Version 1.7.0)';end$$;
create function private.manage_calendar(p_id uuid,p_name text,p_color text,p_order int,p_active boolean,p_all boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare f uuid:=private.my_family_id(); pid uuid; cid uuid; begin
 if not private.calendar_owner() then raise exception 'Nur Owner dürfen Kalender verwalten';end if;
 perform 1 from public.families where id=f for update;
 if p_id is null then
  insert into public.family_people(family_id,display_name,color,include_in_all_tasks) values(f,trim(p_name),p_color,p_all) returning id into pid;
  insert into public.calendars(family_id,person_id,display_name,sort_order,is_active) values(f,pid,trim(p_name),coalesce(p_order,0),p_active) returning id into cid;
 else
  select person_id into pid from public.calendars where id=p_id and family_id=f;
  if not found then raise exception 'Kalender nicht gefunden';end if;
  update public.calendars set display_name=trim(p_name),sort_order=coalesce(p_order,0),is_active=p_active where id=p_id;
  update public.family_people set display_name=trim(p_name),color=p_color,include_in_all_tasks=p_all where id=pid;
  update public.family_members m set display_name=trim(p_name),color=p_color from public.family_people p where p.id=pid and m.user_id=p.linked_user_id;
  cid:=p_id;
 end if;
 return cid;
end $$;
create function public.manage_calendar(p_id uuid default null,p_name text default '',p_color text default '#888888',p_order int default 0,p_active boolean default true,p_all boolean default false) returns uuid language sql security invoker set search_path='' as $$select private.manage_calendar(p_id,p_name,p_color,p_order,p_active,p_all)$$;
create function private.calendar_self_assign(p_event uuid,p_role text,p_take boolean) returns void language plpgsql security definer set search_path='' as $$
declare f uuid:=private.my_family_id(); p public.family_people%rowtype; e public.events%rowtype; begin
 if auth.uid() is null or f is null or p_role is null or p_role not in ('assignee','to','from') or p_take is null then raise exception 'Ungültige Aufgabe';end if;
 perform 1 from public.families where id=f for update;
 select * into e from public.events where id=p_event and family_id=f and not is_cancelled;
 if not found then raise exception 'Termin nicht verfügbar';end if;
 select * into p from public.family_people where family_id=f and linked_user_id=auth.uid() and is_active;
 if not found then raise exception 'Kein Personenprofil';end if;
 if p_role='assignee' and e.assignee_all then raise exception 'Bei Alle verwaltet der Owner die Teilnehmergruppe';end if;
 if p_take then
  if p_role in ('to','from') and exists(select 1 from public.event_assignments where event_id=p_event and role=p_role and person_id<>p.id) then raise exception 'Diese Fahrt ist bereits übernommen';end if;
  insert into public.event_assignments(family_id,event_id,role,person_id,member_user_id) values(f,p_event,p_role,p.id,auth.uid()) on conflict do nothing;
 else delete from public.event_assignments where event_id=p_event and role=p_role and person_id=p.id;
 end if;
 update public.events set updated_at=clock_timestamp() where id=p_event;
end $$;
create function public.calendar_self_assign(p_event uuid,p_role text,p_take boolean) returns void language sql security invoker set search_path='' as $$select private.calendar_self_assign(p_event,p_role,p_take)$$;
-- Invariant checks also protect privileged callers and future code changes.
create function private.require_event_calendar() returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid; begin
 eid:=case when TG_TABLE_NAME='events' then new.id else old.event_id end;
 if exists(select 1 from public.events where id=eid) and not exists(select 1 from public.event_calendars where event_id=eid) then raise exception 'Termin benötigt einen Kalender';end if;
 return null;
end $$;
create constraint trigger event_calendar_required after insert on public.events deferrable initially deferred for each row execute function private.require_event_calendar();
create constraint trigger event_calendar_retained after delete on public.event_calendars deferrable initially deferred for each row execute function private.require_event_calendar();

create function private.prepare_family_access_link_v170(p_actor uuid,p_email text,p_action text,p_target_user uuid,p_calendar uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.family_members%rowtype; c public.calendars%rowtype; ticket jsonb; begin
 select * into a from public.family_members where user_id=p_actor;
 if p_action='invite' then
  if a.role is distinct from 'owner' then raise exception 'Nur Owner dürfen Kalender einladen';end if;
  perform 1 from public.families where id=a.family_id for update;
  select c1.* into c from public.calendars c1 join public.family_people p on p.id=c1.person_id where c1.id=p_calendar and c1.family_id=a.family_id and c1.is_active and p.is_active and p.linked_user_id is null;
  if not found then raise exception 'Kalender bereits verknüpft oder nicht verfügbar';end if;
  update public.family_invitations set expires_at=now() where calendar_id=c.id and used_at is null;
 end if;
 ticket:=private.prepare_family_access_link(p_actor,p_email,p_action,p_target_user);
 if p_action='invite' then
  update public.family_invitations set calendar_id=c.id where id=(select invitation_id from private.family_access_requests where id=(ticket->>'request_id')::uuid);
 end if;
 return ticket;
end $$;
create function public.prepare_family_access_link_v170(p_actor uuid,p_email text,p_action text,p_target_user uuid default null,p_calendar uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_family_access_link_v170(p_actor,p_email,p_action,p_target_user,p_calendar)$$;

CREATE OR REPLACE FUNCTION private.finish_family_access_link(p_request uuid, p_target uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.family_access_requests%rowtype; a public.family_members%rowtype; t public.family_members%rowtype; target auth.users%rowtype; code text;
begin
 if not exists(select 1 from private.family_access_config where enabled) then raise exception 'Einladungslinks sind noch nicht freigeschaltet'; end if;
 select * into r from private.family_access_requests where id=p_request for update;
 if not found or r.completed_at is not null or r.created_at<now()-interval '5 minutes' then raise exception 'Anfrage ist abgelaufen'; end if;
 select * into a from public.family_members where user_id=r.actor;
 if not found or a.family_id<>r.family_id or a.role not in ('owner','admin') or (r.action='invite' and a.role<>'owner') then raise exception 'Berechtigung wurde geändert'; end if;
 perform 1 from public.families where id=r.family_id for update;
 select * into target from auth.users where id=p_target;
 if not found or lower(target.email)<>r.email or (r.target_id is not null and r.target_id<>p_target) then raise exception 'Falsches Zielkonto'; end if;
 select * into t from public.family_members where user_id=p_target;
 if r.action='recovery' then
  if t.user_id is null or t.family_id<>r.family_id or (a.role='admin' and t.role<>'member' and a.user_id<>t.user_id) or (t.role='owner' and a.user_id<>t.user_id) then raise exception 'Keine Reset-Berechtigung'; end if;
 else
  if t.user_id is not null or target.invited_at is null or target.email_confirmed_at is not null then raise exception 'Zielkonto kann nicht eingeladen werden'; end if;
  select i.code into code from public.family_invitations i join public.calendars c on c.id=i.calendar_id join public.family_people p on p.id=c.person_id where c.is_active and p.is_active and p.linked_user_id is null and id=r.invitation_id and family_id=r.family_id and expires_at>now() and used_at is null;
  if code is null then raise exception 'Einladung ist abgelaufen oder wurde ersetzt'; end if;
 end if;
 update private.family_access_requests set completed_at=clock_timestamp(),target_id=p_target where id=r.id;
 return jsonb_build_object('family_code',code);
end $function$
;
create or replace function public.prepare_family_access_link(p_actor uuid,p_email text,p_action text,p_target_user uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if p_action='invite' then raise exception 'Bitte Famkal aktualisieren und einen Kalender wählen';end if;
 return private.prepare_family_access_link(p_actor,p_email,p_action,p_target_user);
end $$;
create or replace function private.join_family(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare i public.family_invitations%rowtype; c public.calendars%rowtype; p public.family_people%rowtype; mail text; f uuid; begin
 if auth.uid() is null then raise exception 'Nicht angemeldet';end if;
 if private.my_family_id() is not null then raise exception 'Du gehörst bereits zu einer Familie';end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null then raise exception 'Bitte E-Mail bestätigen';end if;
 select family_id into f from public.family_invitations where code=upper(trim(p_code));
 perform 1 from public.families where id=f for update;
 select * into i from public.family_invitations where code=upper(trim(p_code)) and used_at is null and expires_at>now() for update;
 if not found or lower(i.email) is distinct from mail then raise exception 'Einladung ungültig, abgelaufen oder für eine andere Adresse';end if;
 select * into c from public.calendars where id=i.calendar_id and family_id=i.family_id and is_active for update;
 if not found then raise exception 'Kalender nicht verfügbar';end if;
 select * into p from public.family_people where id=c.person_id and is_active and linked_user_id is null for update;
 if not found then raise exception 'Person bereits mit einem Konto verknüpft';end if;
 insert into public.family_members(family_id,user_id,display_name,color,role) values(i.family_id,auth.uid(),p.display_name,p.color,'member');
 update public.family_people set linked_user_id=auth.uid() where id=p.id;
 update public.event_assignments set member_user_id=auth.uid() where person_id=p.id;
 update public.family_invitations set used_at=now(),used_by=auth.uid() where id=i.id;
end $$;
-- Close older alternate invitation path.
create or replace function public.create_family_invitation(p_email text) returns text language plpgsql security invoker set search_path='' as $$begin raise exception 'Bitte über die Kalenderverwaltung einladen';end$$;
create function private.sync_person_profile() returns trigger language plpgsql security definer set search_path='' as $$begin
 if TG_TABLE_NAME='test_members' then
  insert into public.family_people(family_id,display_name,color,legacy_test_member_id,is_test,is_active,include_in_all_tasks)
   values(new.family_id,new.display_name,new.color,new.id,true,new.is_active,new.is_active)
   on conflict(legacy_test_member_id) do update set display_name=excluded.display_name,color=excluded.color,is_active=excluded.is_active;
 else
  update public.family_people set color=new.color where linked_user_id=new.user_id;
 end if;return new;
end $$;
create trigger sync_test_profile after insert or update on public.test_members for each row execute function private.sync_person_profile();
create trigger sync_member_profile after update of color on public.family_members for each row execute function private.sync_person_profile();
CREATE OR REPLACE FUNCTION private.push_eligible(p_now timestamp with time zone)
 RETURNS TABLE(event_id uuid, subscription_id uuid, user_id uuid, reminder_minutes integer, start_at timestamp with time zone, due_at timestamp with time zone, title text, roles text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select e.id,s.id,m.user_id,r.minutes,t.start_at,t.start_at-make_interval(mins=>r.minutes),e.title,
 concat_ws(' · ',case when (e.assignee_all and p.include_in_all_tasks) or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='assignee') then 'Zuständig' end,
 case when exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='to') then 'Bringen' end,
 case when exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='from') then 'Abholen' end,
 case when exists(select 1 from public.event_calendars ec join public.calendars c on c.id=ec.calendar_id where ec.event_id=e.id and c.person_id=p.id) then 'Eigener Termin' end)
 from public.events e join public.family_members m on m.family_id=e.family_id
 join public.family_people p on p.linked_user_id=m.user_id and p.family_id=e.family_id and p.is_active
 join public.push_subscriptions s on s.user_id=m.user_id and s.is_active
 cross join lateral(select distinct unnest(e.reminders) minutes) r
 cross join lateral(select (e.event_date+case when e.all_day then time '09:00' else e.start_time end) at time zone 'Europe/Berlin' start_at) t
 where not e.is_cancelled and (e.all_day or e.start_time is not null)
 and e.event_date between (p_now at time zone 'Europe/Berlin')::date-1 and (p_now at time zone 'Europe/Berlin')::date+8
 and r.minutes between 0 and 10080 and t.start_at-make_interval(mins=>r.minutes)<=p_now
 and t.start_at-make_interval(mins=>r.minutes)>p_now-interval '10 minutes' and t.start_at+interval '5 minutes'>p_now
 and ((e.assignee_all and p.include_in_all_tasks) or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id)
 or exists(select 1 from public.event_calendars ec join public.calendars c on c.id=ec.calendar_id where ec.event_id=e.id and c.person_id=p.id))
$function$;
-- Revoke all new definer entrypoints by default; grant only checked RPC paths.
revoke all on function private.save_calendar_event_engine(jsonb,uuid,text,text,date,smallint[],jsonb) from public,anon,authenticated;
revoke all on function private.calendar_cancel(uuid,boolean,text) from public,anon,authenticated;
revoke all on function private.calendar_assign(uuid,jsonb),private.check_calendars(uuid[],boolean),private.require_event_calendar(),private.sync_person_profile() from public,anon,authenticated;
revoke all on function private.calendar_owner(),private.save_calendar_event_v170(jsonb,uuid,text,text,date,smallint[],jsonb),private.calendar_cancel_v170(uuid,boolean,text),private.manage_calendar(uuid,text,text,int,boolean,boolean),private.calendar_self_assign(uuid,text,boolean),private.prepare_family_access_link_v170(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function private.calendar_owner(),private.save_calendar_event_v170(jsonb,uuid,text,text,date,smallint[],jsonb),private.calendar_cancel_v170(uuid,boolean,text),private.manage_calendar(uuid,text,text,int,boolean,boolean),private.calendar_self_assign(uuid,text,boolean) to authenticated;
grant execute on function private.prepare_family_access_link_v170(uuid,text,text,uuid,uuid) to service_role;
revoke all on function public.save_calendar_event_v170(jsonb,uuid,text,text,date,smallint[],jsonb),public.calendar_cancel_v170(uuid,boolean,text),public.manage_calendar(uuid,text,text,int,boolean,boolean),public.calendar_self_assign(uuid,text,boolean),public.prepare_family_access_link_v170(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_calendar_event_v170(jsonb,uuid,text,text,date,smallint[],jsonb),public.calendar_cancel_v170(uuid,boolean,text),public.manage_calendar(uuid,text,text,int,boolean,boolean),public.calendar_self_assign(uuid,text,boolean) to authenticated;
grant execute on function public.prepare_family_access_link_v170(uuid,text,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
-- Close pre-1.5 mutation RPCs and column-level grants as well as table grants.
revoke all on function public.create_event_series(jsonb,text,date),public.update_series_scope(uuid,text,jsonb),public.delete_series_scope(uuid,text),
 private.create_event_series(jsonb,text,date),private.update_series_scope(uuid,text,jsonb),private.delete_series_scope(uuid,text) from public,anon,authenticated;
do $$ declare cols text;begin
 select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name='events';
 execute 'revoke insert('||cols||'),update('||cols||') on public.events from authenticated,anon';
end $$;

CREATE OR REPLACE FUNCTION private.validate_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
  if tg_op='UPDATE' and current_user not in ('postgres','service_role') and
    (new.family_id is distinct from old.family_id or new.created_by is distinct from old.created_by or new.series_id is distinct from old.series_id or new.id is distinct from old.id) then
    raise exception 'Familie, Ersteller und Serie dürfen nicht direkt verändert werden';
  end if;
  if new.all_day then new.start_time:=null; new.end_time:=null; end if;
  new.title:=trim(new.title); new.updated_at:=clock_timestamp(); return new;
end $function$
;

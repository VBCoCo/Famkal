-- Approved additive extension. Existing dates, users and legacy assignments retained.
alter table public.events add column end_date date, add column assignee_all boolean not null default false,
 add column vacation_cancel_id uuid, add constraint events_family_id_unique unique(family_id,id);
alter table public.events add constraint events_vacation_same_family foreign key(family_id,vacation_cancel_id) references public.events(family_id,id);
alter table public.events drop constraint events_times_valid, drop constraint events_type_valid;
alter table public.events add constraint events_type_valid check(event_type in ('school','transport','appointment','care','bedtime','vacation')),
 add constraint events_dates_valid check(coalesce(end_date,event_date) between event_date and event_date+730),
 add constraint events_times_valid check(all_day or end_time is null or (start_time is not null and (coalesce(end_date,event_date)>event_date or end_time>=start_time)));
alter table public.event_series add column selected_weekdays smallint[];
alter table public.event_series drop constraint event_series_recurrence_check;
alter table public.event_series add constraint event_series_recurrence_check check(recurrence in ('daily','weekdays','weekly','biweekly','custom')),
 add constraint series_weekdays_valid check(recurrence<>'custom' or (selected_weekdays is not null and cardinality(selected_weekdays) between 1 and 7 and selected_weekdays <@ array[1,2,3,4,5,6,7]::smallint[] and array_position(selected_weekdays,null) is null));
create table public.test_members (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id),
 display_name text not null check(length(trim(display_name)) between 1 and 80),
 color text not null default '#ff69b4' check(color ~ '^#[0-9a-fA-F]{6}$'),
 is_active boolean not null default true, created_at timestamptz not null default now(), unique(family_id,id)
);
create table public.event_assignments (
 id uuid primary key default gen_random_uuid(), family_id uuid not null, event_id uuid not null,
 role text not null check(role in ('assignee','to','from')), member_user_id uuid, test_member_id uuid,
 check((member_user_id is null)<>(test_member_id is null)),
 foreign key(family_id,event_id) references public.events(family_id,id) on delete cascade,
 foreign key(family_id,member_user_id) references public.family_members(family_id,user_id),
 foreign key(family_id,test_member_id) references public.test_members(family_id,id)
);
create unique index event_assignment_user_unique on public.event_assignments(event_id,role,member_user_id) where member_user_id is not null;
create unique index event_assignment_test_unique on public.event_assignments(event_id,role,test_member_id) where test_member_id is not null;
create index assignments_family_member on public.event_assignments(family_id,member_user_id);
create index assignments_test_member on public.event_assignments(family_id,test_member_id);
create index test_members_family on public.test_members(family_id);
create index events_overlap_end on public.events(family_id,(coalesce(end_date,event_date)));
create index events_vacation_cancel on public.events(vacation_cancel_id) where vacation_cancel_id is not null;
alter table public.test_members enable row level security;
alter table public.event_assignments enable row level security;
create policy test_members_read on public.test_members for select to authenticated using(family_id=(select private.my_family_id()));
create policy assignments_read on public.event_assignments for select to authenticated using(family_id=(select private.my_family_id()));
revoke all on public.test_members,public.event_assignments from public,anon,authenticated;
grant select on public.test_members,public.event_assignments to authenticated;
grant select,insert,update,delete on public.test_members,public.event_assignments to service_role;

-- Preserve old clients: changing a legacy assignment replaces only that role.
create function private.sync_legacy_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare r text; k text; old_id uuid; new_id uuid; begin
 for r,k in select * from (values('assignee','assignee_id'),('to','transport_to_id'),('from','transport_from_id')) v loop
  new_id:=(to_jsonb(new)->>k)::uuid;
  old_id:=case when TG_OP='UPDATE' then (to_jsonb(old)->>k)::uuid else null end;
  if TG_OP='INSERT' or new_id is distinct from old_id then
   delete from public.event_assignments where event_id=new.id and role=r;
   if new_id is not null then insert into public.event_assignments(family_id,event_id,role,member_user_id) values(new.family_id,new.id,r,new_id); end if;
  end if;
 end loop; return new;
end $$;
create trigger sync_legacy_assignment after insert or update of assignee_id,transport_to_id,transport_from_id on public.events for each row execute function private.sync_legacy_assignment();
insert into public.event_assignments(family_id,event_id,role,member_user_id)
 select e.family_id,e.id,v.role,v.person from public.events e cross join lateral
 (values('assignee',e.assignee_id),('to',e.transport_to_id),('from',e.transport_from_id)) v(role,person) where v.person is not null;

create function private.calendar_can_edit(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.events e where e.id=p_id and e.family_id=private.my_family_id() and auth.uid() is not null and
 (private.is_admin() or e.created_by=auth.uid() or e.assignee_id=auth.uid() or e.transport_to_id=auth.uid() or e.transport_from_id=auth.uid() or e.assignee_all or
 exists(select 1 from public.event_assignments a where a.event_id=e.id and a.member_user_id=auth.uid())))
$$;
-- Existing direct legacy writes still have the same field grants; new fields via RPC only.
drop policy events_update on public.events;
create policy events_update on public.events for update to authenticated using(family_id=(select private.my_family_id()) and private.calendar_can_edit(id)) with check(family_id=(select private.my_family_id()));
create function private.calendar_span(p public.events) returns tsrange language sql immutable set search_path='' as $$
 select tsrange(p.event_date+coalesce(p.start_time,'00:00'::time),
  case when p.all_day or p.end_time is null then (coalesce(p.end_date,p.event_date)+1)::timestamp else coalesce(p.end_date,p.event_date)+p.end_time end,'[)')
$$;
create function private.calendar_assign(p_id uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb; pid uuid; family uuid; kind text; legacy_assignee uuid; legacy_to uuid; legacy_from uuid; begin
 select family_id into family from public.events where id=p_id;
 if family is distinct from private.my_family_id() or auth.uid() is null then raise exception 'Falsche Familie'; end if;
 if jsonb_typeof(coalesce(p_data->'assignments','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_data->'assignments','[]'::jsonb))>100 then raise exception 'Ungültige Zuordnungen'; end if;
 if coalesce((p_data->>'assignee_all')::boolean,false) and exists(select 1 from jsonb_array_elements(p_data->'assignments') x where x->>'role'='assignee') then raise exception 'Alle und einzelne Zuständige sind alternative Auswahlen'; end if;
 -- Validate first; transaction ensures no partial changes on error.
 for a in select * from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) loop
  kind:=a->>'role'; pid:=(a->>'person_id')::uuid;
  if kind not in ('assignee','to','from') or kind is null or pid is null then raise exception 'Ungültige Zuordnung'; end if;
  if not exists(select 1 from public.family_members where family_id=family and user_id=pid) and
     not exists(select 1 from public.test_members where family_id=family and id=pid and is_active) then raise exception 'Person gehört nicht zur aktiven Familie'; end if;
 end loop;
 select min((x->>'person_id')::text)::uuid into legacy_assignee from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x join public.family_members m on m.user_id=(x->>'person_id')::uuid and m.family_id=family where x->>'role'='assignee';
 select min((x->>'person_id')::text)::uuid into legacy_to from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x join public.family_members m on m.user_id=(x->>'person_id')::uuid and m.family_id=family where x->>'role'='to';
 select min((x->>'person_id')::text)::uuid into legacy_from from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x join public.family_members m on m.user_id=(x->>'person_id')::uuid and m.family_id=family where x->>'role'='from';
 update public.events set assignee_id=legacy_assignee,transport_to_id=legacy_to,transport_from_id=legacy_from where id=p_id;
 delete from public.event_assignments where event_id=p_id;
 for a in select distinct x from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x loop
  pid:=(a->>'person_id')::uuid;
  insert into public.event_assignments(family_id,event_id,role,member_user_id,test_member_id)
   values(family,p_id,a->>'role',case when exists(select 1 from public.family_members where family_id=family and user_id=pid) then pid end,
    case when exists(select 1 from public.test_members where family_id=family and id=pid and is_active) then pid end);
 end loop;
end $$;
create function private.save_calendar_event(p_event jsonb,p_id uuid,p_scope text,p_recurrence text,p_until date,p_weekdays smallint[],p_cancel jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare family uuid:=private.my_family_id(); old public.events%rowtype; v public.events%rowtype; first_day date; last_day date; day date; duration int; delta int; sid uuid; eid uuid; result_id uuid; ids uuid[]; target uuid; chosen jsonb; begin
 if auth.uid() is null or family is null then raise exception 'Keine Familienmitgliedschaft'; end if;
 perform 1 from public.families where id=family for update;
 if (p_event->>'family_id')::uuid is distinct from family then raise exception 'Falsche Familie'; end if;
 v:=jsonb_populate_record(null::public.events,p_event);
 if v.event_date is null then raise exception 'Startdatum fehlt'; end if;
 v.end_date:=coalesce(v.end_date,v.event_date);duration:=v.end_date-v.event_date;
 v.all_day:=coalesce(v.all_day,false);v.assignee_all:=coalesce(v.assignee_all,false);
 if duration<0 or duration>730 then raise exception 'Ungültiges Enddatum (maximal zwei Jahre)'; end if;
 if v.all_day then v.start_time:=null;v.end_time:=null; end if;
 if p_scope not in ('single','following','series') or p_scope is null then raise exception 'Ungültiger Umfang'; end if;
 if v.event_type='vacation' and (not private.is_admin() or p_recurrence<>'none') then raise exception 'Urlaub über die Administrator-Vorschau anlegen'; end if;
 if p_id is not null then
  select * into old from public.events where id=p_id and family_id=family for update;
  if not found or not private.calendar_can_edit(p_id) then raise exception 'Keine Berechtigung'; end if;
  if old.is_cancelled then raise exception 'Abgesagten Termin zuerst wiederherstellen'; end if;
  if p_event->>'expected_updated_at' is null or (p_event->>'expected_updated_at')::timestamptz is distinct from old.updated_at then raise exception 'Termin wurde inzwischen geändert. Bitte neu laden.'; end if;
  if p_scope<>'single' and (not private.is_admin() or old.series_id is null) then raise exception 'Nur Administratoren dürfen ganze Serien ändern'; end if;
  delta:=v.event_date-old.event_date;
  ids:=array(select id from public.events where family_id=family and not is_cancelled and
   ((p_scope='single' and id=p_id) or (p_scope<>'single' and series_id=old.series_id and (not is_exception or id=p_id) and (p_scope='series' or event_date>=old.event_date))) order by id);
  foreach target in array ids loop
   update public.events set event_date=event_date+delta,end_date=event_date+delta+duration,title=v.title,event_type=v.event_type,
    start_time=v.start_time,end_time=v.end_time,all_day=v.all_day,location=v.location,notes=v.notes,reminders=coalesce(v.reminders,'{}'),assignee_all=v.assignee_all,
    is_exception=case when p_scope='single' and series_id is not null then true else is_exception end where id=target;
   perform private.calendar_assign(target,p_event);
  end loop;result_id:=p_id;
 else
  first_day:=v.event_date;last_day:=first_day;
  if p_recurrence<>'none' then
   if p_recurrence not in ('daily','weekdays','weekly','biweekly','custom') then raise exception 'Ungültige Wiederholung'; end if;
   last_day:=coalesce(p_until,first_day+365);
   if last_day<first_day or last_day>first_day+730 then raise exception 'Ungültiges Serienende (maximal zwei Jahre)'; end if;
   insert into public.event_series(family_id,recurrence,starts_on,ends_on,created_by,selected_weekdays) values(family,p_recurrence,first_day,last_day,auth.uid(),p_weekdays) returning id into sid;
  end if;
  day:=first_day;
  while day<=last_day loop
   if p_recurrence in ('none','daily') or (p_recurrence='weekdays' and extract(isodow from day)<6) or (p_recurrence='weekly' and mod(day-first_day,7)=0) or
    (p_recurrence='biweekly' and mod(day-first_day,14)=0) or (p_recurrence='custom' and extract(isodow from day)::smallint=any(p_weekdays)) then
    insert into public.events(family_id,series_id,event_type,title,event_date,end_date,start_time,end_time,all_day,location,notes,reminders,created_by,assignee_all)
     values(family,sid,v.event_type,v.title,day,day+duration,v.start_time,v.end_time,v.all_day,v.location,v.notes,coalesce(v.reminders,'{}'),auth.uid(),v.assignee_all) returning id into eid;
    perform private.calendar_assign(eid,p_event);result_id:=coalesce(result_id,eid);
   end if; day:=day+1;
  end loop;
  if result_id is null then raise exception 'Kein passender Wochentag im gewählten Zeitraum'; end if;
 end if;
 if jsonb_typeof(coalesce(p_cancel,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_cancel,'[]'::jsonb))>1000 then raise exception 'Ungültige Urlaubsauswahl'; end if;
 if jsonb_array_length(coalesce(p_cancel,'[]'::jsonb))>0 then
  if v.event_type<>'vacation' or p_id is not null or not private.is_admin() then raise exception 'Urlaubsabsagen erfordern Administratorrechte'; end if;
  select * into v from public.events where id=result_id;
  for chosen in select * from jsonb_array_elements(p_cancel) loop
   select * into old from public.events where id=(chosen->>'id')::uuid and family_id=family for update;
   if not found or old.id=result_id or old.is_cancelled or chosen->>'updated_at' is null or old.updated_at is distinct from (chosen->>'updated_at')::timestamptz or
     not (private.calendar_span(old) && private.calendar_span(v)) then raise exception 'Urlaubsauswahl ist veraltet oder liegt außerhalb des Zeitraums. Bitte Vorschau neu laden.'; end if;
   update public.events set is_cancelled=true,is_exception=true,vacation_cancel_id=result_id where id=old.id;
  end loop;
 end if;return result_id;
end $$;
create function public.save_calendar_event(p_event jsonb,p_id uuid default null,p_scope text default 'single',p_recurrence text default 'none',p_until date default null,p_weekdays smallint[] default null,p_cancel jsonb default '[]') returns uuid language sql security invoker set search_path='' as $$ select private.save_calendar_event(p_event,p_id,p_scope,p_recurrence,p_until,p_weekdays,p_cancel) $$;

create function private.manage_test_member(p_id uuid,p_name text,p_color text,p_remove boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare family uuid:=private.my_family_id(); result_id uuid; begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Keine Administratorrechte'; end if;
 perform 1 from public.families where id=family for update;
 if p_remove then
  if not exists(select 1 from public.test_members where id=p_id and family_id=family and is_active) then raise exception 'Testmitglied nicht gefunden'; end if;
  update public.events set updated_at=clock_timestamp() where family_id=family and id in (select event_id from public.event_assignments where test_member_id=p_id);
  delete from public.event_assignments where family_id=family and test_member_id=p_id;
  update public.test_members set is_active=false where id=p_id and family_id=family;return p_id;
 elsif p_id is null then
  insert into public.test_members(family_id,display_name,color) values(family,trim(p_name),p_color) returning id into result_id;
 else
  update public.test_members set display_name=trim(p_name),color=p_color where id=p_id and family_id=family and is_active returning id into result_id;
  if result_id is null then raise exception 'Testmitglied nicht gefunden'; end if;
 end if;return result_id;
end $$;
create function public.manage_test_member(p_id uuid default null,p_name text default 'Test',p_color text default '#ff69b4',p_remove boolean default false) returns uuid language sql security invoker set search_path='' as $$ select private.manage_test_member(p_id,p_name,p_color,p_remove) $$;
create function private.calendar_cancel(p_id uuid,p_cancel boolean,p_scope text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; family uuid:=private.my_family_id(); begin
 if auth.uid() is null or family is null then raise exception 'Keine Familienmitgliedschaft'; end if;
 perform 1 from public.families where id=family for update;
 select * into e from public.events where id=p_id and family_id=family for update;
 if not found or not (private.is_admin() or e.created_by=auth.uid()) then raise exception 'Keine Berechtigung'; end if;
 if p_scope not in ('single','following','series','vacation') or p_scope is null then raise exception 'Ungültiger Umfang'; end if;
 if p_scope<>'single' and not private.is_admin() then raise exception 'Keine Administratorrechte'; end if;
 if p_scope='vacation' then
  if e.event_type<>'vacation' or p_cancel then raise exception 'Ungültige Wiederherstellung'; end if;
  update public.events set is_cancelled=false,vacation_cancel_id=null where family_id=family and vacation_cancel_id=e.id;return;
 end if;
 if p_scope<>'single' and e.series_id is null then raise exception 'Keine Serie'; end if;
 update public.events set is_cancelled=p_cancel,vacation_cancel_id=null,is_exception=case when series_id is not null then true else is_exception end where family_id=family and
 ((p_scope='single' and id=e.id) or (p_scope<>'single' and series_id=e.series_id and (p_scope='series' or event_date>=e.event_date)));
end $$;
create function public.calendar_cancel(p_id uuid,p_cancel boolean,p_scope text default 'single') returns void language sql security invoker set search_path='' as $$ select private.calendar_cancel(p_id,p_cancel,p_scope) $$;

revoke all on function private.sync_legacy_assignment(),private.calendar_can_edit(uuid),private.calendar_span(public.events),private.calendar_assign(uuid,jsonb),
 private.save_calendar_event(jsonb,uuid,text,text,date,smallint[],jsonb),private.manage_test_member(uuid,text,text,boolean),private.calendar_cancel(uuid,boolean,text) from public,anon,authenticated;
grant execute on function private.calendar_can_edit(uuid),private.save_calendar_event(jsonb,uuid,text,text,date,smallint[],jsonb),private.manage_test_member(uuid,text,text,boolean),private.calendar_cancel(uuid,boolean,text) to authenticated;
revoke all on function public.save_calendar_event(jsonb,uuid,text,text,date,smallint[],jsonb),public.manage_test_member(uuid,text,text,boolean),public.calendar_cancel(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.save_calendar_event(jsonb,uuid,text,text,date,smallint[],jsonb),public.manage_test_member(uuid,text,text,boolean),public.calendar_cancel(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';

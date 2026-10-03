-- Remove obsolete transport responsibilities; standalone transport events remain.
create or replace function private.calendar_assign(p_id uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb; p public.family_people%rowtype; f uuid; begin
 select family_id into f from public.events where id=p_id;
 if f is distinct from private.my_family_id() or auth.uid() is null then raise exception 'Falsche Familie';end if;
 if jsonb_typeof(coalesce(p_data->'assignments','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_data->'assignments','[]'::jsonb))>100 then raise exception 'Ungültige Zuordnungen';end if;
 if coalesce((p_data->>'assignee_all')::boolean,false) and exists(select 1 from jsonb_array_elements(p_data->'assignments') x where x->>'role'='assignee') then raise exception 'Alle und einzelne Zuständige sind alternative Auswahlen';end if;
 for a in select * from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) loop
  if a->>'role' is null or a->>'role' <> 'assignee' then raise exception 'Ungültige Rolle';end if;
  select * into p from public.family_people where id=(a->>'person_id')::uuid and family_id=f and is_active;
  if not found then raise exception 'Person gehört nicht zur aktiven Familie';end if;
 end loop;
 update public.events set assignee_id=null where id=p_id;
 delete from public.event_assignments where event_id=p_id;
 for a in select distinct x from jsonb_array_elements(coalesce(p_data->'assignments','[]'::jsonb)) x loop
  select * into p from public.family_people where id=(a->>'person_id')::uuid;
  insert into public.event_assignments(family_id,event_id,role,person_id,member_user_id,test_member_id)
   values(f,p_id,a->>'role',p.id,p.linked_user_id,p.legacy_test_member_id);
 end loop;
 update public.events e set assignee_id=(select member_user_id from public.event_assignments where event_id=e.id and role='assignee' and member_user_id is not null order by member_user_id limit 1) where e.id=p_id;
end $$;
create or replace function private.calendar_self_assign(p_event uuid,p_role text,p_take boolean) returns void language plpgsql security definer set search_path='' as $$
declare f uuid:=private.my_family_id(); p public.family_people%rowtype; e public.events%rowtype; begin
 if auth.uid() is null or f is null or p_role is null or p_role <> 'assignee' or p_take is null then raise exception 'Ungültige Aufgabe';end if;
 perform 1 from public.families where id=f for update;
 select * into e from public.events where id=p_event and family_id=f and not is_cancelled;
 if not found then raise exception 'Termin nicht verfügbar';end if;
 select * into p from public.family_people where family_id=f and linked_user_id=auth.uid() and is_active;
 if not found then raise exception 'Kein Personenprofil';end if;
 if p_role='assignee' and e.assignee_all then raise exception 'Bei Alle verwaltet der Owner die Teilnehmergruppe';end if;
 if p_take then
  insert into public.event_assignments(family_id,event_id,role,person_id,member_user_id) values(f,p_event,p_role,p.id,auth.uid()) on conflict do nothing;
 else delete from public.event_assignments where event_id=p_event and role=p_role and person_id=p.id;
 end if;
 update public.events set updated_at=clock_timestamp() where id=p_event;
end $$;
-- Bedtime reminders follow responsibilities, not explicit calendar ownership.
-- Existing roles, checks and grants are retained.
CREATE OR REPLACE FUNCTION private.push_eligible(p_now timestamp with time zone)
 RETURNS TABLE(event_id uuid, subscription_id uuid, user_id uuid, reminder_minutes integer, start_at timestamp with time zone, due_at timestamp with time zone, title text, roles text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select e.id,s.id,m.user_id,r.minutes,t.start_at,t.start_at-make_interval(mins=>r.minutes),e.title,
 concat_ws(' · ',case when (e.assignee_all and p.include_in_all_tasks) or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='assignee') then 'Zuständig' end,
 case when e.event_type<>'bedtime' and exists(select 1 from public.event_calendars ec join public.calendars c on c.id=ec.calendar_id where ec.event_id=e.id and c.person_id=p.id) then 'Eigener Termin' end)
 from public.events e join public.family_members m on m.family_id=e.family_id
 join public.family_people p on p.linked_user_id=m.user_id and p.family_id=e.family_id and p.is_active
 join public.push_subscriptions s on s.user_id=m.user_id and s.is_active
 cross join lateral(select distinct unnest(e.reminders) minutes) r
 cross join lateral(select (e.event_date+case when e.all_day then time '09:00' else e.start_time end) at time zone 'Europe/Berlin' start_at) t
 where not e.is_cancelled and (e.all_day or e.start_time is not null)
 and e.event_date between (p_now at time zone 'Europe/Berlin')::date-1 and (p_now at time zone 'Europe/Berlin')::date+8
 and r.minutes between 0 and 10080 and t.start_at-make_interval(mins=>r.minutes)<=p_now
 and t.start_at-make_interval(mins=>r.minutes)>p_now-interval '10 minutes' and t.start_at+interval '5 minutes'>p_now
 and ((e.assignee_all and p.include_in_all_tasks) or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='assignee')
 or (e.event_type<>'bedtime' and exists(select 1 from public.event_calendars ec join public.calendars c on c.id=ec.calendar_id where ec.event_id=e.id and c.person_id=p.id)))
$function$;
-- Remove retired, already revoked pre-1.7 mutation paths, without CASCADE.
drop function public.create_event_series(jsonb,text,date);
drop function public.update_series_scope(uuid,text,jsonb);
drop function private.create_event_series(jsonb,text,date);
drop function private.update_series_scope(uuid,text,jsonb);
drop function private.sync_legacy_assignment();
-- Explicitly authorized removal of the old Bringt/Holt assignments.
delete from public.event_assignments where role in ('to','from');
alter table public.event_assignments drop constraint event_assignments_role_check;
alter table public.event_assignments add constraint event_assignments_role_check check(role='assignee');
alter table public.events drop column transport_to_id, drop column transport_from_id;

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
 case when exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='to') then 'Bringen' end,
 case when exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id and a.role='from') then 'Abholen' end,
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
 and ((e.assignee_all and p.include_in_all_tasks) or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.person_id=p.id)
 or (e.event_type<>'bedtime' and exists(select 1 from public.event_calendars ec join public.calendars c on c.id=ec.calendar_id where ec.event_id=e.id and c.person_id=p.id)))
$function$;

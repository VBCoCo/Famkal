-- Additive optional text per existing reminder offset; no event rewrites.
alter table public.events add column reminder_messages jsonb not null default '{}';
create function private.valid_reminder_messages(messages jsonb,minutes int[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry record; n int:=0;
begin
 if messages is null or jsonb_typeof(messages)<>'object' then return false;end if;
 for entry in select * from jsonb_each(messages) loop
  n:=n+1;
  if n>10 or entry.key !~ '^(0|[1-9][0-9]{0,4})$' or jsonb_typeof(entry.value)<>'string' then return false;end if;
  if not (entry.key::int=any(coalesce(minutes,'{}'))) or char_length(entry.value#>>'{}')>240 then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function private.valid_reminder_messages(jsonb,int[]) from public,anon,authenticated;
grant execute on function private.valid_reminder_messages(jsonb,int[]) to authenticated,service_role;
alter table public.events add constraint events_reminder_messages_valid check(private.valid_reminder_messages(reminder_messages,reminders));
-- Old clients do not send the field: retain notes for unchanged offsets only.
create function private.prune_reminder_messages() returns trigger language plpgsql set search_path='' as $$
begin
 if new.reminder_messages=old.reminder_messages and new.reminders is distinct from old.reminders then
  new.reminder_messages:=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(new.reminder_messages) where key::int=any(new.reminders));
 end if;
 return new;
end $$;
revoke all on function private.prune_reminder_messages() from public,anon,authenticated;
create trigger prune_reminder_messages before update of reminders,reminder_messages on public.events for each row execute function private.prune_reminder_messages();

CREATE OR REPLACE FUNCTION private.save_calendar_event_engine(p_event jsonb, p_id uuid, p_scope text, p_recurrence text, p_until date, p_weekdays smallint[], p_cancel jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    start_time=v.start_time,end_time=v.end_time,all_day=v.all_day,location=v.location,notes=v.notes,reminders=coalesce(v.reminders,'{}'),reminder_messages=coalesce(v.reminder_messages,reminder_messages),assignee_all=v.assignee_all,
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
    insert into public.events(family_id,series_id,event_type,title,event_date,end_date,start_time,end_time,all_day,location,notes,reminders,reminder_messages,created_by,assignee_all)
     values(family,sid,v.event_type,v.title,day,day+duration,v.start_time,v.end_time,v.all_day,v.location,v.notes,coalesce(v.reminders,'{}'),coalesce(v.reminder_messages,'{}'),auth.uid(),v.assignee_all) returning id into eid;
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
end $function$;

create or replace function private.prepare_push(p_id uuid,p_token uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('subscription',s.subscription,'event_id',d.event_id,'title',e.title,'roles',e.roles,'start_at',d.start_at,'reminder_minutes',d.reminder_minutes,'reminder_message',ev.reminder_messages->>d.reminder_minutes::text,'tag',d.id)
 from private.push_deliveries d join private.push_eligible(now()) e on (e.event_id,e.subscription_id,e.user_id,e.reminder_minutes,e.start_at)=(d.event_id,d.subscription_id,d.user_id,d.reminder_minutes,d.start_at)
 join public.events ev on ev.id=d.event_id
 join public.push_subscriptions s on s.id=d.subscription_id
 where d.id=p_id and d.claim_token=p_token and d.state='processing'
$$;

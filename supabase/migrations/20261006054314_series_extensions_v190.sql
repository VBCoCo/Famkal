-- Additive API: existing writers/permissions and all stored rows remain unchanged.
create function private.save_calendar_event_v190(p_event jsonb,p_id uuid,p_scope text,p_recurrence text,p_until date,p_weekdays smallint[],p_days smallint[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare f uuid:=private.my_family_id(); original public.events%rowtype; target public.events%rowtype; sid uuid; eid uuid; first_day date; last_day date; day date; duration int; delta int; data jsonb; changed int:=0;
begin
 if auth.uid() is null or f is null then raise exception 'Keine Familienmitgliedschaft';end if;
 perform 1 from public.families where id=f for update;
 select * into original from public.events where id=p_id and family_id=f for update;
 if not found or not private.calendar_can_edit(p_id) then raise exception 'Keine Bearbeitungsrechte';end if;
 if original.is_cancelled then raise exception 'Abgesagten Termin zuerst wiederherstellen';end if;
 if (p_event->>'family_id')::uuid is distinct from f then raise exception 'Falsche Familie';end if;
 if p_event->>'expected_updated_at' is null or (p_event->>'expected_updated_at')::timestamptz is distinct from original.updated_at then raise exception 'Termin wurde inzwischen geändert. Bitte neu laden.';end if;
 if p_scope='weekdays' then
  if not private.calendar_owner() or original.series_id is null then raise exception 'Nur Owner dürfen Wochentage einer Serie ändern';end if;
  if coalesce(cardinality(p_days),0)=0 or cardinality(p_days)>7 or exists(select 1 from unnest(p_days)d where d is null or d not between 1 and 7) then raise exception 'Bitte gültige Wochentage wählen';end if;
  delta:=(p_event->>'event_date')::date-original.event_date;
  duration:=coalesce((p_event->>'end_date')::date,(p_event->>'event_date')::date)-(p_event->>'event_date')::date;
  for target in select * from public.events where family_id=f and series_id=original.series_id and event_date>=original.event_date and extract(isodow from event_date)::smallint=any(p_days) and not is_cancelled and (not is_exception or id=p_id) order by event_date,id for update loop
   data:=p_event||jsonb_build_object('event_date',target.event_date+delta,'end_date',target.event_date+delta+duration,'expected_updated_at',target.updated_at);
   perform private.save_calendar_event_v170(data,target.id,'single','none',null,null,'[]');
   update public.events set is_exception=target.is_exception where id=target.id;
   changed:=changed+1;
  end loop;
  if changed=0 then raise exception 'Keine passenden unveränderten Serientermine für diese Wochentage';end if;
  return p_id;
 end if;
 if p_scope is distinct from 'single' or original.series_id is not null or p_recurrence is null or p_recurrence not in ('daily','weekdays','weekly','biweekly','custom') then raise exception 'Ungültige Umwandlung';end if;
 if original.event_type='vacation' or p_event->>'event_type'='vacation' then raise exception 'Urlaub bleibt ein Einzeltermin';end if;
 first_day:=(p_event->>'event_date')::date;last_day:=coalesce(p_until,first_day+365);
 if first_day is null or last_day<first_day or last_day>first_day+730 then raise exception 'Ungültiges Serienende (maximal zwei Jahre)';end if;
 if p_recurrence='custom' and (coalesce(cardinality(p_weekdays),0)=0 or exists(select 1 from unnest(p_weekdays)d where d is null or d not between 1 and 7)) then raise exception 'Bitte gültige Wochentage wählen';end if;
 if (p_recurrence='weekdays' and extract(isodow from first_day)>5) or (p_recurrence='custom' and not extract(isodow from first_day)::smallint=any(p_weekdays)) then raise exception 'Der bestehende Termin muss auf einen gewählten Serien-Wochentag fallen';end if;
 -- Existing ID, creator and all dependent records survive the conversion.
 perform private.save_calendar_event_v170(p_event,p_id,'single','none',null,null,'[]');
 insert into public.event_series(family_id,recurrence,starts_on,ends_on,created_by,selected_weekdays) values(f,p_recurrence,first_day,last_day,auth.uid(),p_weekdays) returning id into sid;
 update public.events set series_id=sid,is_exception=false where id=p_id;
 insert into public.series_calendars select f,sid,calendar_id from public.event_calendars where event_id=p_id;
 duration:=coalesce((p_event->>'end_date')::date,first_day)-first_day;
 day:=first_day+1;
 while day<=last_day loop
  if p_recurrence='daily' or (p_recurrence='weekdays' and extract(isodow from day)<6) or (p_recurrence='weekly' and mod(day-first_day,7)=0) or (p_recurrence='biweekly' and mod(day-first_day,14)=0) or (p_recurrence='custom' and extract(isodow from day)::smallint=any(p_weekdays)) then
   data:=p_event||jsonb_build_object('event_date',day,'end_date',day+duration);
   eid:=private.save_calendar_event_v170(data,null,'single','none',null,null,'[]');
   update public.events set series_id=sid where id=eid;
  end if;
  day:=day+1;
 end loop;
 return p_id;
end $$;
revoke all on function private.save_calendar_event_v190(jsonb,uuid,text,text,date,smallint[],smallint[]) from public,anon,authenticated;
grant execute on function private.save_calendar_event_v190(jsonb,uuid,text,text,date,smallint[],smallint[]) to authenticated;
create function public.save_calendar_event_v190(p_event jsonb,p_id uuid,p_scope text default 'single',p_recurrence text default 'none',p_until date default null,p_weekdays smallint[] default null,p_days smallint[] default null) returns uuid
language sql security invoker set search_path='' as $$select private.save_calendar_event_v190(p_event,p_id,p_scope,p_recurrence,p_until,p_weekdays,p_days)$$;
revoke all on function public.save_calendar_event_v190(jsonb,uuid,text,text,date,smallint[],smallint[]) from public,anon,authenticated;
grant execute on function public.save_calendar_event_v190(jsonb,uuid,text,text,date,smallint[],smallint[]) to authenticated;

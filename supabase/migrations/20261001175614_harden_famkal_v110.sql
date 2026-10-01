-- Upgrade the existing Famkal database. No existing rows are deleted.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Preserve dependencies (policies/triggers) while moving privileged code out
-- of the exposed public schema. Public API wrappers run as their caller.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
    ('my_family_id','my_role','is_admin','protect_member_security_fields',
     'create_family','create_family_invitation','join_family','admin_update_member',
     'create_event_series','update_series_scope','delete_series_scope')
  loop execute format('alter function %s set schema private',f.signature); end loop;
end $$;

create function public.my_family_id() returns uuid language sql stable security invoker set search_path='' as $$ select private.my_family_id() $$;
create function public.my_role() returns text language sql stable security invoker set search_path='' as $$ select private.my_role() $$;
create function public.is_admin() returns boolean language sql stable security invoker set search_path='' as $$ select private.is_admin() $$;
create function public.create_family(p_name text) returns uuid language sql security invoker set search_path='' as $$ select private.create_family(p_name) $$;
create function public.create_family_invitation(p_email text) returns text language sql security invoker set search_path='' as $$ select private.create_family_invitation(p_email) $$;
create function public.join_family(p_code text) returns void language sql security invoker set search_path='' as $$ select private.join_family(p_code) $$;
create function public.admin_update_member(p_user_id uuid,p_role text,p_color text,p_display_name text) returns void language sql security invoker set search_path='' as $$ select private.admin_update_member(p_user_id,p_role,p_color,p_display_name) $$;
create function public.create_event_series(p_event jsonb,p_recurrence text,p_until date) returns uuid language sql security invoker set search_path='' as $$ select private.create_event_series(p_event,p_recurrence,p_until) $$;
create function public.update_series_scope(p_occurrence_id uuid,p_scope text,p_patch jsonb) returns void language sql security invoker set search_path='' as $$ select private.update_series_scope(p_occurrence_id,p_scope,p_patch) $$;
create function public.delete_series_scope(p_occurrence_id uuid,p_scope text) returns void language sql security invoker set search_path='' as $$ select private.delete_series_scope(p_occurrence_id,p_scope) $$;

create or replace function private.my_family_id() returns uuid language sql stable security definer set search_path='' as $$ select family_id from public.family_members where user_id=auth.uid() $$;
create or replace function private.my_role() returns text language sql stable security definer set search_path='' as $$ select role from public.family_members where user_id=auth.uid() $$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(private.my_role() in ('owner','admin'),false) $$;

create or replace function private.protect_member_security_fields() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('postgres','service_role') and
     (new.role is distinct from old.role or new.family_id is distinct from old.family_id or new.user_id is distinct from old.user_id) then
    raise exception 'Rolle und Familienzuordnung dürfen nur über die Verwaltung geändert werden';
  end if;
  return new;
end $$;

create or replace function private.create_family(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare f uuid; n text:=trim(p_name); begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if n is null or length(n) not between 1 and 100 then raise exception 'Familienname: 1 bis 100 Zeichen'; end if;
  if private.my_family_id() is not null then raise exception 'Du gehörst bereits zu einer Familie'; end if;
  insert into public.families(name) values(n) returning id into f;
  insert into public.family_members(family_id,user_id,display_name,color,role)
    select f,id,left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'),''),split_part(email,'@',1)),80),'#355c50','owner' from auth.users where id=auth.uid();
  return f;
end $$;

create or replace function private.create_family_invitation(p_email text) returns text language plpgsql security definer set search_path='' as $$
declare c text; mail text:=lower(trim(p_email)); begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Keine Administratorrechte'; end if;
  if mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Bitte eine gültige E-Mail-Adresse eingeben'; end if;
  -- Revoke previous unused invitations without deleting invitation history.
  update public.family_invitations set expires_at=now() where family_id=private.my_family_id() and email=mail and used_at is null;
  insert into public.family_invitations(family_id,email,created_by) values(private.my_family_id(),mail,auth.uid()) returning code into c;
  return c;
end $$;

create or replace function private.join_family(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare i public.family_invitations%rowtype; account_email text; account_name text; begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if private.my_family_id() is not null then raise exception 'Du gehörst bereits zu einer Familie'; end if;
  select lower(email),left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'),''),split_part(email,'@',1)),80) into account_email,account_name
    from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if account_email is null then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen'; end if;
  select * into i from public.family_invitations where code=upper(trim(p_code)) and used_at is null and expires_at>now() for update;
  if not found then raise exception 'Ungültiger oder abgelaufener Einladungscode'; end if;
  if lower(i.email) is distinct from account_email then raise exception 'Der Code wurde für eine andere E-Mail-Adresse erstellt'; end if;
  insert into public.family_members(family_id,user_id,display_name,color,role) values(i.family_id,auth.uid(),account_name,'#f39a3f','member');
  update public.family_invitations set used_at=now(),used_by=auth.uid() where id=i.id;
end $$;

create or replace function private.admin_update_member(p_user_id uuid,p_role text,p_color text,p_display_name text) returns void language plpgsql security definer set search_path='' as $$
declare target_role text; owners int; family uuid:=private.my_family_id(); begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Keine Administratorrechte'; end if;
  if p_role is null or p_role not in ('owner','admin','member') then raise exception 'Ungültige Rolle'; end if;
  perform 1 from public.families where id=family for update;
  select role into target_role from public.family_members where family_id=family and user_id=p_user_id;
  if target_role is null then raise exception 'Mitglied nicht gefunden'; end if;
  if private.my_role()<>'owner' and (target_role<>'member' or p_role<>'member') then raise exception 'Nur Eigentümer dürfen Administrator- und Eigentümerrollen verwalten'; end if;
  select count(*) into owners from public.family_members where family_id=family and role='owner';
  if target_role='owner' and p_role<>'owner' and owners=1 then raise exception 'Der letzte Eigentümer kann nicht herabgestuft werden'; end if;
  update public.family_members set role=p_role,color=p_color,display_name=trim(p_display_name) where family_id=family and user_id=p_user_id;
end $$;

create or replace function private.create_event_series(p_event jsonb,p_recurrence text,p_until date) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid; d date; stop date; first_day date; family uuid:=private.my_family_id(); begin
  if auth.uid() is null or family is null then raise exception 'Keine Familienmitgliedschaft'; end if;
  if (p_event->>'family_id')::uuid is distinct from family then raise exception 'Falsche Familie'; end if;
  if p_recurrence is null or p_recurrence not in ('daily','weekdays','weekly','biweekly') then raise exception 'Ungültige Wiederholung'; end if;
  first_day:=(p_event->>'event_date')::date; stop:=coalesce(p_until,first_day+365);
  if first_day is null or stop<first_day or stop>first_day+730 then raise exception 'Ungültiges Serienende (maximal zwei Jahre)'; end if;
  insert into public.event_series(family_id,recurrence,starts_on,ends_on,created_by) values(family,p_recurrence,first_day,stop,auth.uid()) returning id into s;
  d:=first_day;
  while d<=stop loop
    if p_recurrence='daily' or (p_recurrence='weekdays' and extract(isodow from d)<6) or (p_recurrence='weekly' and mod(d-first_day,7)=0) or (p_recurrence='biweekly' and mod(d-first_day,14)=0) then
      insert into public.events(family_id,series_id,event_type,title,event_date,start_time,end_time,all_day,location,notes,assignee_id,transport_to_id,transport_from_id,reminders,created_by)
      values(family,s,p_event->>'event_type',trim(p_event->>'title'),d,nullif(p_event->>'start_time','')::time,nullif(p_event->>'end_time','')::time,coalesce((p_event->>'all_day')::boolean,false),nullif(p_event->>'location',''),nullif(p_event->>'notes',''),nullif(p_event->>'assignee_id','')::uuid,nullif(p_event->>'transport_to_id','')::uuid,nullif(p_event->>'transport_from_id','')::uuid,array(select jsonb_array_elements_text(p_event->'reminders')::int),auth.uid());
    end if;
    d:=d+1;
  end loop;
  if not exists(select 1 from public.events where series_id=s) then raise exception 'Im gewählten Zeitraum liegt kein passender Serientermin'; end if;
  return s;
end $$;

create or replace function private.update_series_scope(p_occurrence_id uuid,p_scope text,p_patch jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; family uuid:=private.my_family_id(); delta int; begin
  if auth.uid() is null or family is null then raise exception 'Keine Familienmitgliedschaft'; end if;
  if p_scope is null or p_scope not in ('single','following','series') then raise exception 'Ungültiger Umfang'; end if;
  select * into e from public.events where id=p_occurrence_id and family_id=family for update;
  if not found or e.series_id is null then raise exception 'Serientermin nicht gefunden'; end if;
  if (private.is_admin() or e.created_by=auth.uid() or e.assignee_id=auth.uid() or e.transport_to_id=auth.uid() or e.transport_from_id=auth.uid()) is not true then raise exception 'Keine Berechtigung'; end if;
  if p_scope<>'single' and not private.is_admin() then raise exception 'Nur Administratoren dürfen mehrere Serientermine ändern'; end if;
  perform 1 from public.event_series where id=e.series_id and family_id=family for update;
  if not found then raise exception 'Falsche Serienzuordnung'; end if;
  delta:=(p_patch->>'event_date')::date-e.event_date;
  if delta is null then raise exception 'Datum fehlt'; end if;
  update public.events set title=trim(p_patch->>'title'),event_type=p_patch->>'event_type',event_date=event_date+delta,
    all_day=coalesce((p_patch->>'all_day')::boolean,false),start_time=nullif(p_patch->>'start_time','')::time,end_time=nullif(p_patch->>'end_time','')::time,
    location=nullif(p_patch->>'location',''),notes=nullif(p_patch->>'notes',''),assignee_id=nullif(p_patch->>'assignee_id','')::uuid,
    transport_to_id=nullif(p_patch->>'transport_to_id','')::uuid,transport_from_id=nullif(p_patch->>'transport_from_id','')::uuid,
    reminders=array(select jsonb_array_elements_text(p_patch->'reminders')::int),is_exception=case when p_scope='single' then true else is_exception end,updated_at=now()
    where family_id=family and series_id=e.series_id and
      ((p_scope='single' and id=e.id) or (p_scope='following' and event_date>=e.event_date and (not is_exception or id=e.id)) or (p_scope='series' and (not is_exception or id=e.id)))
      and not is_cancelled;
  if p_scope<>'single' then
    update public.event_series set starts_on=(select min(event_date) from public.events where family_id=family and series_id=e.series_id and not is_cancelled),
      ends_on=(select max(event_date) from public.events where family_id=family and series_id=e.series_id and not is_cancelled) where id=e.series_id and family_id=family;
  end if;
end $$;

create or replace function private.delete_series_scope(p_occurrence_id uuid,p_scope text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; family uuid:=private.my_family_id(); begin
  if auth.uid() is null or family is null then raise exception 'Keine Familienmitgliedschaft'; end if;
  if p_scope is null or p_scope not in ('single','following','series') then raise exception 'Ungültiger Umfang'; end if;
  select * into e from public.events where id=p_occurrence_id and family_id=family for update;
  if not found or e.series_id is null then raise exception 'Serientermin nicht gefunden'; end if;
  if (private.is_admin() or e.created_by=auth.uid()) is not true then raise exception 'Keine Berechtigung'; end if;
  if p_scope<>'single' and not private.is_admin() then raise exception 'Nur Administratoren dürfen mehrere Serientermine löschen'; end if;
  perform 1 from public.event_series where id=e.series_id and family_id=family for update;
  if not found then raise exception 'Falsche Serienzuordnung'; end if;
  -- Cancellation retains exceptions and history and does not cascade-delete rows.
  update public.events set is_cancelled=true,is_exception=true,updated_at=now() where family_id=family and series_id=e.series_id
    and ((p_scope='single' and id=e.id) or (p_scope='following' and event_date>=e.event_date) or p_scope='series');
end $$;

create function private.valid_reminders(v int[]) returns boolean language sql immutable set search_path='' as $$
  select v is not null and cardinality(v)<=10 and not exists(select 1 from unnest(v) n where n is null or n<0 or n>10080)
$$;
alter table public.families add constraint families_name_valid check(length(trim(name)) between 1 and 100);
alter table public.family_members add constraint members_color_valid check(color ~ '^#[0-9A-Fa-f]{6}$'), add constraint members_name_valid check(length(trim(display_name)) between 1 and 80);
alter table public.event_series add constraint series_family_id_unique unique(family_id,id);
alter table public.events add constraint events_series_same_family foreign key(family_id,series_id) references public.event_series(family_id,id),
  add constraint events_assignee_same_family foreign key(family_id,assignee_id) references public.family_members(family_id,user_id),
  add constraint events_transport_to_same_family foreign key(family_id,transport_to_id) references public.family_members(family_id,user_id),
  add constraint events_transport_from_same_family foreign key(family_id,transport_from_id) references public.family_members(family_id,user_id),
  add constraint events_title_valid check(length(trim(title)) between 1 and 200),
  add constraint events_type_valid check(event_type in ('school','transport','appointment','care','bedtime')),
  add constraint events_notes_valid check(length(coalesce(notes,''))<=4000 and length(coalesce(location,''))<=300),
  add constraint events_reminders_valid check(private.valid_reminders(reminders)),
  add constraint events_times_valid check(all_day or end_time is null or (start_time is not null and end_time>=start_time));

create function private.validate_event() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='UPDATE' and current_user not in ('postgres','service_role') and
    (new.family_id is distinct from old.family_id or new.created_by is distinct from old.created_by or new.series_id is distinct from old.series_id or new.id is distinct from old.id) then
    raise exception 'Familie, Ersteller und Serie dürfen nicht direkt verändert werden';
  end if;
  if new.all_day then new.start_time:=null; new.end_time:=null; end if;
  new.title:=trim(new.title); new.updated_at:=now(); return new;
end $$;
create trigger validate_event_fields before insert or update on public.events for each row execute function private.validate_event();

create index events_family_date_idx on public.events(family_id,event_date,start_time) where not is_cancelled;
create index events_series_date_idx on public.events(series_id,event_date);
create index events_assignee_idx on public.events(family_id,assignee_id);
create index events_transport_to_idx on public.events(family_id,transport_to_id);
create index events_transport_from_idx on public.events(family_id,transport_from_id);
create index invitations_family_idx on public.family_invitations(family_id);
create index series_family_idx on public.event_series(family_id);
create index push_user_idx on public.push_subscriptions(user_id);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.families,public.family_members,public.family_invitations,public.event_series,public.events,public.sent_notifications to authenticated;
grant update(display_name,color,default_reminder_minutes,notify_assignments,notify_changes) on public.family_members to authenticated;
grant insert(family_id,event_type,title,event_date,start_time,end_time,all_day,location,notes,assignee_id,transport_to_id,transport_from_id,reminders,created_by) on public.events to authenticated;
grant update(event_type,title,event_date,start_time,end_time,all_day,location,notes,assignee_id,transport_to_id,transport_from_id,reminders,updated_at) on public.events to authenticated;
grant delete on public.events to authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_family_id(),private.my_role(),private.is_admin(),private.valid_reminders(int[]),
  private.create_family(text),private.create_family_invitation(text),private.join_family(text),private.admin_update_member(uuid,text,text,text),
  private.create_event_series(jsonb,text,date),private.update_series_scope(uuid,text,jsonb),private.delete_series_scope(uuid,text) to authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_family_id(),public.my_role(),public.is_admin(),public.create_family(text),public.create_family_invitation(text),public.join_family(text),
  public.admin_update_member(uuid,text,text,text),public.create_event_series(jsonb,text,date),public.update_series_scope(uuid,text,jsonb),public.delete_series_scope(uuid,text) to authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public,anon,authenticated;
notify pgrst,'reload schema';

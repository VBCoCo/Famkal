-- A shared trigger record has a different shape for each attached table.
-- Use separate PL/pgSQL branches so DELETE never resolves NEW.id.
-- Existing triggers, privileges, search_path and calendar guarantees are retained.
create or replace function private.require_event_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
  if TG_TABLE_NAME='events' then
    eid:=NEW.id;
  elsif TG_TABLE_NAME='event_calendars' then
    eid:=OLD.event_id;
  else
    raise exception 'Unerwartete Tabelle für Kalenderprüfung';
  end if;
  if exists(select 1 from public.events where id=eid)
     and not exists(select 1 from public.event_calendars where event_id=eid) then
    raise exception 'Termin benötigt einen Kalender';
  end if;
  return null;
end $$;

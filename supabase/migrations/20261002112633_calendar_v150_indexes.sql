-- Cover the new composite foreign keys; no change to data or permissions.
create index assignments_family_event on public.event_assignments(family_id,event_id);
create index events_family_vacation on public.events(family_id,vacation_cancel_id);

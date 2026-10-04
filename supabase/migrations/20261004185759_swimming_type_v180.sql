-- Extend the existing type validation without changing any stored events.
alter table public.events drop constraint events_type_valid;
alter table public.events add constraint events_type_valid check
 (event_type in ('school','transport','appointment','swimming','care','bedtime','vacation'));

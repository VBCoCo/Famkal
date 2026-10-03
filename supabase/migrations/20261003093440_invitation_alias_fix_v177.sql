-- Qualify invitation columns in the joined calendar/person check.
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
  select i.code into code from public.family_invitations i join public.calendars c on c.id=i.calendar_id join public.family_people p on p.id=c.person_id where c.is_active and p.is_active and p.linked_user_id is null and i.id=r.invitation_id and i.family_id=r.family_id and i.expires_at>now() and i.used_at is null;
  if code is null then raise exception 'Einladung ist abgelaufen oder wurde ersetzt'; end if;
 end if;
 update private.family_access_requests set completed_at=clock_timestamp(),target_id=p_target where id=r.id;
 return jsonb_build_object('family_code',code);
end $function$
;

-- Additive staging migration. Link generation stays disabled until Auth settings
-- have been verified (signup disabled, passwords >=12, OTP expiry <=3600s).
create table private.family_access_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.family_access_config values(true,false);
create table private.family_access_requests(
 id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),
 actor uuid not null references auth.users(id),email text not null,action text not null check(action in ('invite','recovery')),
 target_id uuid references auth.users(id),invitation_id uuid references public.family_invitations(id),created_at timestamptz not null default now(),completed_at timestamptz
);
create index family_access_requests_limits on private.family_access_requests(family_id,created_at desc);
create index family_access_requests_actor on private.family_access_requests(actor);
create index family_access_requests_target on private.family_access_requests(target_id);
create index family_access_requests_invitation on private.family_access_requests(invitation_id);
alter table private.family_access_config enable row level security;
alter table private.family_access_requests enable row level security;
revoke all on private.family_access_config,private.family_access_requests from public,anon,authenticated,service_role;

create function private.prepare_family_access_link(p_actor uuid,p_email text,p_action text,p_target_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.family_members%rowtype; t public.family_members%rowtype; target auth.users%rowtype; mail text:=lower(trim(p_email)); r uuid; invitation uuid;
begin
 if not exists(select 1 from private.family_access_config where enabled) then raise exception 'Einladungslinks sind noch nicht freigeschaltet'; end if;
 select * into a from public.family_members where user_id=p_actor;
 if not found or a.role not in ('owner','admin') then raise exception 'Nur Owner/Admin dürfen Links erstellen'; end if;
 if p_action='recovery' then select lower(email) into mail from auth.users where id=p_target_user; end if;
 if p_action is null or p_action not in ('invite','recovery') or mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Ungültige Anfrage'; end if;
 perform 1 from public.families where id=a.family_id for update;
 if exists(select 1 from private.family_access_requests where family_id=a.family_id and created_at>now()-interval '1 minute') or (select count(*) from private.family_access_requests where family_id=a.family_id and created_at>now()-interval '1 hour')>=10 then raise exception 'Bitte mindestens eine Minute warten (maximal zehn Links pro Stunde)'; end if;
 select * into target from auth.users where lower(email)=mail;
 select * into t from public.family_members where user_id=target.id;
 if p_action='recovery' then
  if t.user_id is null or t.family_id<>a.family_id then raise exception 'Reset nur für Mitglieder der eigenen Familie'; end if;
  if (a.role='admin' and t.role<>'member' and a.user_id<>t.user_id) or (t.role='owner' and a.user_id<>t.user_id) then raise exception 'Für dieses Konto darfst du keinen Reset-Link erstellen'; end if;
 else
  if t.user_id is not null then raise exception 'Konto gehört bereits zu einer Familie; für eigene Mitglieder bitte Reset verwenden'; end if;
  if target.id is not null and (target.email_confirmed_at is not null or target.invited_at is null) then raise exception 'Konto existiert bereits; bitte Administrator kontaktieren'; end if;
  if target.id is not null and not exists(select 1 from public.family_invitations where family_id=a.family_id and lower(email)=mail and used_at is null) then raise exception 'Konto wurde nicht von dieser Familie eingeladen'; end if;
 end if;
 if p_action='invite' then
  update public.family_invitations set expires_at=now() where family_id=a.family_id and lower(email)=mail and used_at is null;
  insert into public.family_invitations(family_id,email,code,created_by,expires_at) values(a.family_id,mail,upper(replace(gen_random_uuid()::text,'-','')),p_actor,now()+interval '1 hour') returning id into invitation;
 end if;
 insert into private.family_access_requests(family_id,actor,email,action,target_id,invitation_id) values(a.family_id,p_actor,mail,p_action,target.id,invitation) returning id into r;
 return jsonb_build_object('request_id',r,'link_type',p_action,'target_id',target.id,'email',mail);
end $$;

create function private.finish_family_access_link(p_request uuid,p_target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.family_access_requests%rowtype; a public.family_members%rowtype; t public.family_members%rowtype; target auth.users%rowtype; code text;
begin
 if not exists(select 1 from private.family_access_config where enabled) then raise exception 'Einladungslinks sind noch nicht freigeschaltet'; end if;
 select * into r from private.family_access_requests where id=p_request for update;
 if not found or r.completed_at is not null or r.created_at<now()-interval '5 minutes' then raise exception 'Anfrage ist abgelaufen'; end if;
 select * into a from public.family_members where user_id=r.actor;
 if not found or a.family_id<>r.family_id or a.role not in ('owner','admin') then raise exception 'Berechtigung wurde geändert'; end if;
 perform 1 from public.families where id=r.family_id for update;
 select * into target from auth.users where id=p_target;
 if not found or lower(target.email)<>r.email or (r.target_id is not null and r.target_id<>p_target) then raise exception 'Falsches Zielkonto'; end if;
 select * into t from public.family_members where user_id=p_target;
 if r.action='recovery' then
  if t.user_id is null or t.family_id<>r.family_id or (a.role='admin' and t.role<>'member' and a.user_id<>t.user_id) or (t.role='owner' and a.user_id<>t.user_id) then raise exception 'Keine Reset-Berechtigung'; end if;
 else
  if t.user_id is not null or target.invited_at is null or target.email_confirmed_at is not null then raise exception 'Zielkonto kann nicht eingeladen werden'; end if;
  select i.code into code from public.family_invitations i where id=r.invitation_id and family_id=r.family_id and expires_at>now() and used_at is null;
  if code is null then raise exception 'Einladung ist abgelaufen oder wurde ersetzt'; end if;
 end if;
 update private.family_access_requests set completed_at=clock_timestamp(),target_id=p_target where id=r.id;
 return jsonb_build_object('family_code',code);
end $$;
create function public.prepare_family_access_link(p_actor uuid,p_email text,p_action text,p_target_user uuid) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_family_access_link(p_actor,p_email,p_action,p_target_user)$$;
create function public.finish_family_access_link(p_request uuid,p_target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.finish_family_access_link(p_request,p_target)$$;
revoke all on function private.prepare_family_access_link(uuid,text,text,uuid),private.finish_family_access_link(uuid,uuid),public.prepare_family_access_link(uuid,text,text,uuid),public.finish_family_access_link(uuid,uuid) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.prepare_family_access_link(uuid,text,text,uuid),private.finish_family_access_link(uuid,uuid),public.prepare_family_access_link(uuid,text,text,uuid),public.finish_family_access_link(uuid,uuid) to service_role;
-- Revoke the legacy setup/invite RPCs only in the release activation migration,
-- so the existing live 1.2.0 interface keeps working during preparation.

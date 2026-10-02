-- Additive push delivery infrastructure. Existing calendar/Auth data is preserved.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.push_subscriptions add column is_active boolean not null default true,
  add column updated_at timestamptz not null default now(),
  add column last_test_at timestamptz,
  add column last_error text;
drop policy if exists push_own on public.push_subscriptions;
create policy push_read_own on public.push_subscriptions for select to authenticated using (user_id=(select auth.uid()));
revoke insert,update,delete on public.push_subscriptions from authenticated;
grant select on public.push_subscriptions to authenticated;

create function private.push_endpoint_valid(p_endpoint text) returns boolean language sql immutable set search_path='' as $$
select length(p_endpoint) between 20 and 2048 and p_endpoint ~ '^https://(web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)/[^[:space:]]+$'
$$;

create function private.register_push(p_subscription jsonb,p_agent text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); saved uuid;
begin
 if u is null or not exists(select 1 from public.family_members where user_id=u) then raise exception 'Keine Familienmitgliedschaft'; end if;
 if not coalesce(private.push_endpoint_valid(p_subscription->>'endpoint'),false)
 or not coalesce((p_subscription->'keys'->>'p256dh') ~ '^[A-Za-z0-9_-]{87}=?$',false)
 or not coalesce((p_subscription->'keys'->>'auth') ~ '^[A-Za-z0-9_-]{22}(==)?$',false) then raise exception 'Ungültige Geräteanmeldung'; end if;
 perform 1 from public.family_members where user_id=u for update;
 if (select count(*) from public.push_subscriptions where user_id=u and is_active and endpoint<>p_subscription->>'endpoint')>=10 then raise exception 'Maximal zehn Geräte'; end if;
 insert into public.push_subscriptions(user_id,endpoint,subscription,user_agent) values(u,p_subscription->>'endpoint',jsonb_build_object('endpoint',p_subscription->>'endpoint','keys',p_subscription->'keys'),left(p_agent,512))
 on conflict(endpoint) do update set user_id=u,subscription=excluded.subscription,user_agent=excluded.user_agent,is_active=true,updated_at=now(),last_error=null
 where public.push_subscriptions.user_id=u or public.push_subscriptions.subscription->'keys'=excluded.subscription->'keys'
 returning id into saved;
 if saved is null then raise exception 'Gerät ist bereits anderweitig angemeldet'; end if;
 return saved;
end $$;
create function public.register_push(p_subscription jsonb,p_agent text default '') returns uuid language sql set search_path='' as $$ select private.register_push(p_subscription,p_agent) $$;
create function private.disable_push(p_endpoint text) returns void language sql security definer set search_path='' as $$
 update public.push_subscriptions set is_active=false,updated_at=now() where user_id=auth.uid() and endpoint=p_endpoint
$$;
create function public.disable_push(p_endpoint text) returns void language sql set search_path='' as $$select private.disable_push(p_endpoint)$$;

create table private.push_deliveries (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.events(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reminder_minutes integer not null,
 start_at timestamptz not null,
 due_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','processing','sent','failed','obsolete')),
 attempts integer not null default 0,
 claim_token uuid,
 retry_at timestamptz not null default now(),
 sent_at timestamptz,
 last_status integer,
 unique(event_id,subscription_id,user_id,reminder_minutes,start_at)
);
create index push_deliveries_due on private.push_deliveries(state,retry_at);
create index push_deliveries_event on private.push_deliveries(event_id);
create index push_deliveries_subscription on private.push_deliveries(subscription_id);
create index push_deliveries_user on private.push_deliveries(user_id);
alter table private.push_deliveries enable row level security;
create policy push_deliveries_backend on private.push_deliveries to service_role using(true) with check(true);
grant usage on schema private to service_role;
grant all on private.push_deliveries to service_role;
grant all on public.push_subscriptions to service_role;

create function private.push_eligible(p_now timestamptz) returns table(event_id uuid,subscription_id uuid,user_id uuid,reminder_minutes integer,start_at timestamptz,due_at timestamptz,title text,roles text) language sql stable security definer set search_path='' as $$
 select e.id,s.id,m.user_id,r.minutes,t.start_at,t.start_at-make_interval(mins=>r.minutes),e.title,
 concat_ws(' · ',case when e.assignee_all or e.assignee_id=m.user_id or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.member_user_id=m.user_id and a.role='assignee') then 'Zuständig' end,
 case when e.transport_to_id=m.user_id or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.member_user_id=m.user_id and a.role='to') then 'Bringen' end,
 case when e.transport_from_id=m.user_id or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.member_user_id=m.user_id and a.role='from') then 'Abholen' end)
 from public.events e join public.family_members m on m.family_id=e.family_id
 join public.push_subscriptions s on s.user_id=m.user_id and s.is_active
 cross join lateral (select distinct unnest(e.reminders) minutes) r
 cross join lateral (select (e.event_date+case when e.all_day then time '09:00' else e.start_time end) at time zone 'Europe/Berlin' start_at) t
 where not e.is_cancelled and (e.all_day or e.start_time is not null)
 and e.event_date between (p_now at time zone 'Europe/Berlin')::date-1 and (p_now at time zone 'Europe/Berlin')::date+8
 and r.minutes between 0 and 10080
 and t.start_at-make_interval(mins=>r.minutes)<=p_now
 and t.start_at-make_interval(mins=>r.minutes)>p_now-interval '10 minutes'
 and t.start_at+interval '5 minutes'>p_now
 and (e.assignee_all or m.user_id in(e.assignee_id,e.transport_to_id,e.transport_from_id) or exists(select 1 from public.event_assignments a where a.event_id=e.id and a.member_user_id=m.user_id))
$$;

create function private.claim_push(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not pg_try_advisory_xact_lock(1602026) then return '[]'::jsonb; end if;
 insert into private.push_deliveries(event_id,subscription_id,user_id,reminder_minutes,start_at,due_at)
 select event_id,subscription_id,user_id,reminder_minutes,start_at,due_at from private.push_eligible(p_now) on conflict do nothing;
 update private.push_deliveries d set state='obsolete' where d.state in('pending','processing') and not exists(select 1 from private.push_eligible(p_now) e where (e.event_id,e.subscription_id,e.user_id,e.reminder_minutes,e.start_at)=(d.event_id,d.subscription_id,d.user_id,d.reminder_minutes,d.start_at));
 with selected as(select id from private.push_deliveries where state in('pending','processing') and retry_at<=p_now and attempts<3 order by due_at limit 50 for update skip locked),
 claimed as(update private.push_deliveries d set state='processing',attempts=attempts+1,claim_token=gen_random_uuid(),retry_at=p_now+interval '2 minutes' from selected s where d.id=s.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'token',c.claim_token)), '[]'::jsonb) into result from claimed c;
 update private.push_deliveries set state='failed' where state='processing' and attempts>=3 and retry_at<=p_now;
 -- Limit history size without touching sent rows inside the deduplication window.
 delete from private.push_deliveries where due_at<p_now-interval '30 days';
 return result;
end $$;
create function public.claim_push() returns jsonb language sql set search_path='' as $$select private.claim_push()$$;

create function private.prepare_push(p_id uuid,p_token uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('subscription',s.subscription,'event_id',d.event_id,'title',e.title,'roles',e.roles,'start_at',d.start_at,'reminder_minutes',d.reminder_minutes,'tag',d.id)
 from private.push_deliveries d join private.push_eligible(now()) e on (e.event_id,e.subscription_id,e.user_id,e.reminder_minutes,e.start_at)=(d.event_id,d.subscription_id,d.user_id,d.reminder_minutes,d.start_at)
 join public.push_subscriptions s on s.id=d.subscription_id
 where d.id=p_id and d.claim_token=p_token and d.state='processing'
$$;
create function public.prepare_push(p_id uuid,p_token uuid) returns jsonb language sql set search_path='' as $$select private.prepare_push(p_id,p_token)$$;

create function private.finish_push(p_id uuid,p_token uuid,p_status integer) returns void language plpgsql security definer set search_path='' as $$
declare sub uuid;
begin
 update private.push_deliveries set state=case when p_status between 200 and 299 then 'sent' when p_status in(404,410) or attempts>=3 then 'failed' else 'pending' end,
 sent_at=case when p_status between 200 and 299 then now() end,last_status=p_status,retry_at=now()+interval '1 minute'
 where id=p_id and claim_token=p_token and state='processing' returning subscription_id into sub;
 if sub is not null and p_status in(404,410) then update public.push_subscriptions set is_active=false,last_error='Geräteanmeldung abgelaufen',updated_at=now() where id=sub; end if;
end $$;
create function public.finish_push(p_id uuid,p_token uuid,p_status integer) returns void language sql set search_path='' as $$select private.finish_push(p_id,p_token,p_status)$$;

create function private.push_config() returns jsonb language sql security definer set search_path='' as $$select decrypted_secret::jsonb from vault.decrypted_secrets where name='famkal_push_config'$$;
create function public.push_config() returns jsonb language sql set search_path='' as $$select private.push_config()$$;
create function private.claim_push_test(p_id uuid,p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.push_subscriptions s set last_test_at=now() where id=p_id and user_id=p_user and is_active
 and exists(select 1 from public.family_members where user_id=p_user)
 and (last_test_at is null or last_test_at<now()-interval '1 minute') returning subscription into result;
 return result;
end $$;
create function public.claim_push_test(p_id uuid,p_user uuid) returns jsonb language sql set search_path='' as $$select private.claim_push_test(p_id,p_user)$$;
create function public.expire_push(p_id uuid) returns void language sql set search_path='' as $$update public.push_subscriptions set is_active=false,last_error='Geräteanmeldung abgelaufen',updated_at=now() where id=p_id$$;

-- Private definer routines stay outside the Data API. Public wrappers are invokers.
revoke all on function private.register_push(jsonb,text),private.disable_push(text),private.push_endpoint_valid(text) from public,anon;
grant execute on function private.register_push(jsonb,text),private.disable_push(text) to authenticated;
revoke all on function public.register_push(jsonb,text),public.disable_push(text) from public,anon;
grant execute on function public.register_push(jsonb,text),public.disable_push(text) to authenticated;
revoke all on function private.push_eligible(timestamptz),private.claim_push(timestamptz),private.prepare_push(uuid,uuid),private.finish_push(uuid,uuid,integer),private.push_config(),private.claim_push_test(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_push(),public.prepare_push(uuid,uuid),public.finish_push(uuid,uuid,integer),public.push_config(),public.claim_push_test(uuid,uuid),public.expire_push(uuid) from public,anon,authenticated;
grant execute on function private.push_eligible(timestamptz),private.claim_push(timestamptz),private.prepare_push(uuid,uuid),private.finish_push(uuid,uuid,integer),private.push_config(),private.claim_push_test(uuid,uuid),private.push_endpoint_valid(text) to service_role;
grant execute on function public.claim_push(),public.prepare_push(uuid,uuid),public.finish_push(uuid,uuid,integer),public.push_config(),public.claim_push_test(uuid,uuid),public.expire_push(uuid) to service_role;

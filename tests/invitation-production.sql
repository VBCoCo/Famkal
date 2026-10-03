-- Full invitation database lifecycle, isolated fake identities, no email or Auth API calls.
begin;
do $$
declare f uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); invitee_id uuid:=gen_random_uuid(); wrong_id uuid:=gen_random_uuid(); pid uuid; cid uuid; ticket jsonb; result jsonb; code text; mail text:='invite-regression-'||invitee_id||'@example.invalid'; bad boolean; n int:=0;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,'invite-owner-'||owner_id||'@example.invalid',now()),(wrong_id,'invite-wrong-'||wrong_id||'@example.invalid',now());
 insert into public.families(id,name) values(f,'Isolated invitation regression');
 insert into public.family_members(family_id,user_id,display_name,role) values(f,owner_id,'Owner','owner');
 insert into public.family_people(family_id,display_name) values(f,'Invitee') returning id into pid;
 insert into public.calendars(family_id,person_id,display_name) values(f,pid,'Invitee') returning id into cid;
 set local role service_role;
 ticket:=public.prepare_family_access_link_v170(owner_id,mail,'invite',null,cid);
 reset role;
 if (select calendar_id from public.family_invitations where id=(select invitation_id from private.family_access_requests where id=(ticket->>'request_id')::uuid)) is distinct from cid then raise exception 'Calendar binding lost';end if;n:=n+1;
 -- Stand-in for the account returned by Auth generateLink; no network request.
 insert into auth.users(id,email,invited_at) values(invitee_id,mail,now());
 set local role service_role;
 bad:=false;begin perform public.finish_family_access_link((ticket->>'request_id')::uuid,wrong_id);exception when others then bad:=true;end;if not bad then raise exception 'Wrong target accepted';end if;n:=n+1;
 reset role;update public.family_invitations set expires_at=now()-interval '1 minute' where calendar_id=cid;
 set local role service_role;
 bad:=false;begin perform public.finish_family_access_link((ticket->>'request_id')::uuid,invitee_id);exception when others then bad:=true;end;if not bad then raise exception 'Expired invitation accepted';end if;n:=n+1;
 reset role;update public.family_invitations set expires_at=now()+interval '1 hour' where calendar_id=cid;update public.calendars set is_active=false where id=cid;
 set local role service_role;
 bad:=false;begin perform public.finish_family_access_link((ticket->>'request_id')::uuid,invitee_id);exception when others then bad:=true;end;if not bad then raise exception 'Archived calendar accepted';end if;n:=n+1;
 reset role;update public.calendars set is_active=true where id=cid;
 set local role service_role;
 result:=public.finish_family_access_link((ticket->>'request_id')::uuid,invitee_id);code:=result->>'family_code';
 if code is null or length(code)<>32 then raise exception 'Invitation finish failed';end if;n:=n+1;
 bad:=false;begin perform public.finish_family_access_link((ticket->>'request_id')::uuid,invitee_id);exception when others then bad:=true;end;if not bad then raise exception 'Completed ticket reused';end if;n:=n+1;
 reset role;
 if not exists(select 1 from private.family_access_requests where id=(ticket->>'request_id')::uuid and completed_at is not null and private.family_access_requests.target_id=invitee_id) then raise exception 'Completion not recorded';end if;n:=n+1;
 if has_function_privilege('anon','public.finish_family_access_link(uuid,uuid)','execute') or has_function_privilege('authenticated','public.finish_family_access_link(uuid,uuid)','execute') then raise exception 'Finish exposed';end if;n:=n+1;
 update auth.users set email_confirmed_at=now() where id=invitee_id;
 perform set_config('request.jwt.claim.sub',invitee_id::text,true);set local role authenticated;
 perform public.join_family(code);
 if (select linked_user_id from public.family_people where id=pid) is distinct from invitee_id then raise exception 'Join calendar identity lost';end if;n:=n+1;
 reset role;
 -- Recovery still works; adjust only the fake request to respect the one-minute rate limit.
 update private.family_access_requests set created_at=now()-interval '2 minutes' where family_id=f;
 set local role service_role;
 ticket:=public.prepare_family_access_link_v170(owner_id,null,'recovery',owner_id,null);
 result:=public.finish_family_access_link((ticket->>'request_id')::uuid,owner_id);
 if result->>'family_code' is not null then raise exception 'Recovery returned invitation code';end if;n:=n+1;
 reset role;raise notice '% isolated invitation lifecycle checks passed',n;
end $$;
set constraints all immediate;
rollback;

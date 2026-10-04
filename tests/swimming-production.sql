-- Isolated swimming checks; no real family or notification is touched.
begin;
do $$
declare f uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid; c uuid; e uuid; data jsonb; bad boolean;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'swimming-'||u||'@example.invalid',now());
 insert into public.families(id,name) values(f,'Isolated swimming check');
 insert into public.family_members(family_id,user_id,display_name,role) values(f,u,'Owner','owner');
 insert into public.family_people(family_id,display_name,linked_user_id,include_in_all_tasks) values(f,'Owner',u,true) returning id into p;
 insert into public.calendars(family_id,person_id,display_name) values(f,p,'Owner') returning id into c;
 perform set_config('request.jwt.claim.sub',u::text,true);set local role authenticated;
 data:=jsonb_build_object('family_id',f,'calendar_ids',jsonb_build_array(c),'title','Swimming','event_type','swimming','event_date','2030-01-01','end_date','2030-01-01','start_time','10:00','end_time','11:00','reminders',jsonb_build_array(15),'assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',p)));
 e:=public.save_calendar_event_v170(data);
 if not exists(select 1 from public.events where id=e and event_type='swimming') then raise exception 'Swimming save failed';end if;
 if not exists(select 1 from public.event_assignments where event_id=e and person_id=p) then raise exception 'Swimming responsibility missing';end if;
 if not exists(select 1 from public.events where id=e and reminders @> array[15]) then raise exception 'Swimming reminder missing';end if;
 reset role;
 insert into public.push_subscriptions(user_id,endpoint,subscription) values(u,'https://web.push.apple.com/isolated-swimming-'||u,'{}');
 if not exists(select 1 from private.push_eligible('2030-01-01T08:45:00Z') where event_id=e and user_id=u and roles like '%Zuständig%') then raise exception 'Swimming push eligibility missing';end if;
 set local role authenticated;
 data:=data||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e),'title','Swimming edited');
 perform public.save_calendar_event_v170(data,e);
 if not exists(select 1 from public.events where id=e and title='Swimming edited') then raise exception 'Swimming edit failed';end if;
 perform public.calendar_cancel_v170(e,true);
 if not exists(select 1 from public.events where id=e and is_cancelled) then raise exception 'Swimming cancellation failed';end if;
 bad:=false;begin perform public.save_calendar_event_v170(data||jsonb_build_object('event_type','unknown'));exception when check_violation then bad:=true;end;if not bad then raise exception 'Invalid type accepted';end if;
 e:=public.save_calendar_event_v170(data||jsonb_build_object('title','Swimming series'),null,'single','weekly','2030-01-15');
 if (select count(*) from public.events where series_id=(select series_id from public.events where id=e) and event_type='swimming')<>3 then raise exception 'Swimming series failed';end if;
 reset role;
end $$;
set constraints all immediate;
rollback;

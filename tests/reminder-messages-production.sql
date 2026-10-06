-- Isolated data, rollback, no push dispatch.
begin;
do $$
declare f uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid; c uuid; e uuid; sid uuid; data jsonb; bad boolean; stamp timestamptz; sub uuid; delivery uuid; token uuid:=gen_random_uuid(); startstamp timestamptz:=date_trunc('minute',now())+interval '15 minutes';
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'reminders-'||u||'@example.invalid',now());
 insert into public.families(id,name) values(f,'Isolated reminders');
 insert into public.family_members(family_id,user_id,display_name,role) values(f,u,'Owner','owner');
 insert into public.family_people(family_id,display_name,linked_user_id) values(f,'Owner',u) returning id into p;
 insert into public.calendars(family_id,person_id,display_name) values(f,p,'Owner') returning id into c;
 perform set_config('request.jwt.claim.sub',u::text,true);set local role authenticated;
 data:=jsonb_build_object('family_id',f,'calendar_ids',jsonb_build_array(c),'title','Text test','event_type','appointment','event_date','2030-01-01','end_date','2030-01-01','start_time','07:00','end_time','07:30','reminders',jsonb_build_array(15,5),'reminder_messages',jsonb_build_object('15','In 15 Minuten losfahren','5','In fünf Minuten losfahren'),'assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',p)));
 e:=public.save_calendar_event_v170(data);
 if (select reminder_messages->>'5' from public.events where id=e)<>'In fünf Minuten losfahren' then raise exception 'Text missing';end if;
 select updated_at into stamp from public.events where id=e;
 bad:=false;begin perform public.save_calendar_event_v170(data||jsonb_build_object('expected_updated_at',stamp,'reminder_messages',jsonb_build_object('5',repeat('x',241))),e);exception when check_violation then bad:=true;end;if not bad then raise exception 'Oversized note accepted';end if;
 bad:=false;begin perform public.save_calendar_event_v170(data||jsonb_build_object('expected_updated_at',stamp,'reminder_messages',jsonb_build_object('30','Wrong offset')),e);exception when check_violation then bad:=true;end;if not bad then raise exception 'Unknown offset accepted';end if;
 bad:=false;begin perform public.save_calendar_event_v170(data||jsonb_build_object('expected_updated_at',stamp,'reminder_messages',jsonb_build_object('5',42)),e);exception when check_violation then bad:=true;end;if not bad then raise exception 'Non-text note accepted';end if;
 -- Conversion retains the original and clones the notes.
 perform public.save_calendar_event_v190(data||jsonb_build_object('expected_updated_at',stamp),e,'single','daily','2030-01-07');
 select series_id into sid from public.events where id=e;
 if (select count(*) from public.events where series_id=sid and reminder_messages=data->'reminder_messages')<>7 then raise exception 'Conversion lost notes';end if;
 perform public.save_calendar_event_v190(data||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e),'reminder_messages',jsonb_build_object('15','Wednesday')),e,'weekdays','none',null,null,array[3]::smallint[]);
 if (select count(*) from public.events where series_id=sid and reminder_messages->>'15'='Wednesday')<>1 then raise exception 'Weekday notes wrong';end if;
 perform public.save_calendar_event_v170(data||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e),'reminder_messages',jsonb_build_object('5','All days')),e,'series');
 if (select count(*) from public.events where series_id=sid and reminder_messages->>'5'='All days')<>7 then raise exception 'Series notes wrong';end if;
 -- Older clients retain notes, but removing an offset prunes its text.
 perform public.save_calendar_event_v170((data-'reminder_messages')||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e),'reminders',jsonb_build_array(5)),e);
 if (select reminder_messages from public.events where id=e)<>jsonb_build_object('5','All days') then raise exception 'Legacy note lost';end if;
 perform public.save_calendar_event_v170((data-'reminder_messages')||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e),'reminders','[]'::jsonb),e);
 if (select reminder_messages from public.events where id=e)<>'{}'::jsonb then raise exception 'Removed note retained';end if;
 reset role;
 -- Prepare a notification using an isolated delivery, without invoking the scheduler.
 insert into public.push_subscriptions(user_id,endpoint,subscription) values(u,'https://web.push.apple.com/reminder-test-'||u,jsonb_build_object('endpoint','https://web.push.apple.com/reminder-test-'||u,'keys',jsonb_build_object('p256dh','B'||repeat('a',86),'auth',repeat('b',22)))) returning id into sub;
 update public.events set event_date=(startstamp at time zone 'Europe/Berlin')::date,end_date=(startstamp at time zone 'Europe/Berlin')::date,start_time=(startstamp at time zone 'Europe/Berlin')::time,end_time=((startstamp+interval '30 minutes') at time zone 'Europe/Berlin')::time,reminders=array[15],reminder_messages=jsonb_build_object('15','Shared text') where id=e;
 insert into private.push_deliveries(event_id,subscription_id,user_id,reminder_minutes,start_at,due_at,state,claim_token) values(e,sub,u,15,startstamp,startstamp-interval '15 minutes','processing',token) returning id into delivery;
 if private.prepare_push(delivery,token)->>'reminder_message'<>'Shared text' then raise exception 'Prepared notification missing text';end if;
 if private.prepare_push(delivery,gen_random_uuid()) is not null then raise exception 'Invalid delivery token accepted';end if;
 if has_column_privilege('anon','public.events','reminder_messages','select') or has_column_privilege('authenticated','public.events','reminder_messages','update') then raise exception 'Unsafe direct grants';end if;
 if has_function_privilege('authenticated','public.prepare_push(uuid,uuid)','execute') then raise exception 'Push privilege widened';end if;
end $$;
rollback;

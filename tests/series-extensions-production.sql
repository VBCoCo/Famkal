-- All records and changes are isolated and rolled back; no mail/push dispatch.
begin;
do $$
declare f uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); p uuid; ap uuid; c uuid; ac uuid; e uuid; sid uuid; exception_id uuid; cancelled_id uuid; data jsonb; n int; bad boolean; member_event uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'series-owner-'||u||'@example.invalid',now()),(a,'series-member-'||a||'@example.invalid',now());
 insert into public.families(id,name) values(f,'Isolated series 1.9');
 insert into public.family_members(family_id,user_id,display_name,role) values(f,u,'Owner','owner'),(f,a,'Member','member');
 insert into public.family_people(family_id,display_name,linked_user_id) values(f,'Owner',u) returning id into p;
 insert into public.family_people(family_id,display_name,linked_user_id) values(f,'Member',a) returning id into ap;
 insert into public.calendars(family_id,person_id,display_name) values(f,p,'Owner') returning id into c;
 insert into public.calendars(family_id,person_id,display_name) values(f,ap,'Member') returning id into ac;
 perform set_config('request.jwt.claim.sub',u::text,true);set local role authenticated;
 data:=jsonb_build_object('family_id',f,'calendar_ids',jsonb_build_array(c),'title','Original','event_type','care','event_date','2030-01-01','end_date','2030-01-01','start_time','07:00','end_time','07:30','reminders',jsonb_build_array(15),'assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',p)));
 e:=public.save_calendar_event_v170(data);
 data:=data||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e));
 if public.save_calendar_event_v190(data,e,'single','daily','2030-01-21')<>e then raise exception 'Original ID lost';end if;
 select series_id into sid from public.events where id=e;
 if sid is null or (select count(*) from public.events where series_id=sid)<>21 then raise exception 'Conversion count wrong';end if;
 if (select count(*) from public.events where series_id=sid and event_date='2030-01-01')<>1 then raise exception 'Duplicate anchor';end if;
 if not exists(select 1 from public.events where id=e and created_by=u) then raise exception 'Creator lost';end if;
 if (select count(*) from public.event_calendars ec join public.events ev on ev.id=ec.event_id where ev.series_id=sid)<>21 then raise exception 'Calendars lost';end if;
 if (select count(*) from public.event_assignments x join public.events ev on ev.id=x.event_id where ev.series_id=sid and x.person_id=p)<>21 then raise exception 'Assignments lost';end if;
 reset role;
 select id into exception_id from public.events where series_id=sid and event_date='2030-01-09';
 select id into cancelled_id from public.events where series_id=sid and event_date='2030-01-16';
 update public.events set is_exception=true,title='Individual exception' where id=exception_id;
 update public.events set is_cancelled=true where id=cancelled_id;
 set local role authenticated;
 data:=data||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=e),'assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',ap)));
 perform public.save_calendar_event_v190(data,e,'weekdays','none',null,null,array[3]::smallint[]);
 if (select count(*) from public.event_assignments x join public.events ev on ev.id=x.event_id where ev.series_id=sid and x.person_id=ap)<>1 then raise exception 'Wrong weekday set';end if;
 if not exists(select 1 from public.events where id=exception_id and title='Individual exception' and is_exception) then raise exception 'Exception changed';end if;
 if not exists(select 1 from public.events where id=cancelled_id and is_cancelled) then raise exception 'Cancellation changed';end if;
 if exists(select 1 from public.event_assignments where event_id in (exception_id,cancelled_id) and person_id=ap) then raise exception 'Exception assignment changed';end if;
 -- Repeat weekday operation; earlier weekday edits must remain editable as a group.
 perform public.save_calendar_event_v190(data||jsonb_build_object('title','Wednesday'),e,'weekdays','none',null,null,array[3]::smallint[]);
 if (select count(*) from public.events where series_id=sid and title='Wednesday')<>1 then raise exception 'Repeat weekday change lost';end if;
 bad:=false;begin perform public.save_calendar_event_v190(data,e,'weekdays','none',null,null,array[8]::smallint[]);exception when others then bad:=true;end;if not bad then raise exception 'Bad weekday accepted';end if;
 bad:=false;begin perform public.save_calendar_event_v190(data||jsonb_build_object('expected_updated_at','2000-01-01'),e,'weekdays','none',null,null,array[3]::smallint[]);exception when others then bad:=true;end;if not bad then raise exception 'Stale write accepted';end if;
 bad:=false;begin perform public.save_calendar_event_v190(data,e,'single','daily','2030-02-01');exception when others then bad:=true;end;if not bad then raise exception 'Second conversion accepted';end if;
 -- Member may convert their own event, but cannot change an owner series.
 reset role;perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 bad:=false;begin perform public.save_calendar_event_v190(data,e,'weekdays','none',null,null,array[3]::smallint[]);exception when others then bad:=true;end;if not bad then raise exception 'Member changed owner series';end if;
 data:=data||jsonb_build_object('calendar_ids',jsonb_build_array(ac),'assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',ap)),'title','Own member event');
 member_event:=public.save_calendar_event_v170(data);
 data:=data||jsonb_build_object('expected_updated_at',(select updated_at from public.events where id=member_event));
 perform public.save_calendar_event_v190(data,member_event,'single','custom','2030-01-15',array[2]::smallint[]);
 if (select count(*) from public.events where series_id=(select series_id from public.events where id=member_event))<>3 then raise exception 'Member custom conversion failed';end if;
 bad:=false;begin perform public.save_calendar_event_v190(data,member_event,'weekdays','none',null,null,array[2]::smallint[]);exception when others then bad:=true;end;if not bad then raise exception 'Member changed weekday group';end if;
 reset role;
end $$;
set constraints all immediate;
rollback;

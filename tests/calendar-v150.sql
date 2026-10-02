-- Synthetic fixtures and every mutation roll back. Run inside a transaction.
create temp table v150_ids as select gen_random_uuid() owner_id,gen_random_uuid() member_id,gen_random_uuid() outsider_id,gen_random_uuid() family_id,gen_random_uuid() other_family;
insert into auth.users(id,email) select owner_id,'v150-owner-'||owner_id||'@example.invalid' from v150_ids union all select member_id,'v150-member-'||member_id||'@example.invalid' from v150_ids union all select outsider_id,'v150-outside-'||outsider_id||'@example.invalid' from v150_ids;
insert into public.families(id,name) select family_id,'V150 transactional test' from v150_ids union all select other_family,'V150 other family' from v150_ids;
insert into public.family_members(family_id,user_id,display_name,color,role)
 select family_id,owner_id,'Owner','#0066ff','owner' from v150_ids union all select family_id,member_id,'Member','#339933','member' from v150_ids union all select other_family,outsider_id,'Outsider','#777777','owner' from v150_ids;
grant select on v150_ids to authenticated;
set local role authenticated;
do $$
declare f record; t uuid; solo uuid; multi uuid; night uuid; vac uuid; data jsonb; assigned jsonb; snap timestamptz; bad bool; begin
 select * into f from v150_ids;
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 if (select count(*) from public.family_members)<>2 then raise exception 'RLS leaks family members'; end if;
 t:=public.manage_test_member(null,'Test Pink','#ff69b4',false);
 data:=jsonb_build_object('family_id',f.family_id,'event_date','2026-10-04','end_date','2026-10-05','start_time','20:00','end_time','06:00','event_type','bedtime','title','Night','assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',t)));
 night:=public.save_calendar_event(data,null,'single','custom','2026-10-08',array[7,1,2,3,4]::smallint[]);
 if (select count(*) from public.events where series_id=(select series_id from public.events where id=night))<>5 then raise exception 'Custom days incorrect'; end if;
 if exists(select 1 from public.events where series_id=(select series_id from public.events where id=night) and end_date<>event_date+1) then raise exception 'Overnight duration lost'; end if;
 solo:=public.save_calendar_event(data||jsonb_build_object('title','Solo'),null);
 assigned:=jsonb_build_array(jsonb_build_object('role','assignee','person_id',f.owner_id),jsonb_build_object('role','assignee','person_id',f.member_id),jsonb_build_object('role','assignee','person_id',t));
 multi:=public.save_calendar_event(data||jsonb_build_object('title','Multi','assignments',assigned),null);
 if (select count(*) from public.event_assignments where event_id=multi)<>3 then raise exception 'Multiple assignment lost'; end if;
 bad:=false;begin perform public.save_calendar_event(data||jsonb_build_object('assignments',jsonb_build_array(jsonb_build_object('role','assignee','person_id',f.outsider_id))),null);exception when others then bad:=true;end;if not bad then raise exception 'Foreign family assigned';end if;
 bad:=false;begin perform public.save_calendar_event(data||jsonb_build_object('assignee_all',true),null);exception when others then bad:=true;end;if not bad then raise exception 'All plus individuals accepted';end if;
 perform public.save_calendar_event(data||jsonb_build_object('assignee_all',true,'assignments','[]'::jsonb,'title','Everyone'),null);
 bad:=false;begin perform public.save_calendar_event(data||jsonb_build_object('end_date','2026-10-04'),null);exception when others then bad:=true;end;if not bad then raise exception 'Invalid same-day end accepted';end if;
 select updated_at into snap from public.events where id=multi;
 vac:=public.save_calendar_event(jsonb_build_object('family_id',f.family_id,'event_type','vacation','title','Holiday','event_date','2026-10-04','end_date','2026-10-09','all_day',true,'assignments','[]'::jsonb),null,'single','none',null,null,jsonb_build_array(jsonb_build_object('id',multi,'updated_at',snap)));
 if not exists(select 1 from public.events where id=multi and is_cancelled and vacation_cancel_id=vac) then raise exception 'Holiday selection not cancelled'; end if;
 if (select is_cancelled from public.events where id=solo) then raise exception 'Unselected occurrence cancelled';end if;
 perform public.calendar_cancel(vac,false,'vacation');
 if (select is_cancelled from public.events where id=multi) then raise exception 'Holiday restore failed';end if;
 bad:=false;begin perform public.save_calendar_event(jsonb_build_object('family_id',f.family_id,'event_type','vacation','title','Stale holiday','event_date','2026-10-04','end_date','2026-10-09','all_day',true,'assignments','[]'::jsonb),null,'single','none',null,null,jsonb_build_array(jsonb_build_object('id',multi,'updated_at','2000-01-01')));exception when others then bad:=true;end;
 if not bad or exists(select 1 from public.events where title='Stale holiday') then raise exception 'Vacation transaction was not atomic';end if;
 perform public.manage_test_member(t,'Test Pink','#ff69b4',true);
 if exists(select 1 from public.event_assignments where test_member_id=t) or not exists(select 1 from public.events where id=solo) then raise exception 'Removing test person deleted events or kept assignment';end if;
 if (select count(*) from public.event_assignments where event_id=multi)<>2 then raise exception 'Other assignees lost';end if;
 bad:=false;begin perform public.save_calendar_event(data,null);exception when others then bad:=true;end;if not bad then raise exception 'Archived test person assigned';end if;
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 if not private.calendar_can_edit(multi) then raise exception 'Additional real assignee cannot edit';end if;
 bad:=false;begin perform public.manage_test_member(null,'Forbidden','#ff69b4',false);exception when others then bad:=true;end;if not bad then raise exception 'Member created test member';end if;
 bad:=false;begin perform public.save_calendar_event(data||jsonb_build_object('event_type','vacation','all_day',true,'assignments','[]'::jsonb),null);exception when others then bad:=true;end;if not bad then raise exception 'Member created vacation';end if;
 perform set_config('request.jwt.claim.sub',f.outsider_id::text,true);
 if exists(select 1 from public.events where id=multi) or exists(select 1 from public.test_members where id=t) or exists(select 1 from public.event_assignments where event_id=multi) then raise exception 'New table RLS leaks foreign family';end if;
 if private.calendar_can_edit(multi) then raise exception 'Foreign event permission';end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.event_assignments','INSERT') or has_table_privilege('authenticated','public.test_members','DELETE') or
 has_function_privilege('anon','public.save_calendar_event(jsonb,uuid,text,text,date,smallint[],jsonb)','EXECUTE') or
 has_function_privilege('authenticated','private.calendar_assign(uuid,jsonb)','EXECUTE') then raise exception 'Unsafe grants';end if;
end $$;

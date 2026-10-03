import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url);
const owner='11111111-1111-4111-8111-111111111111',anna='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333',family='44444444-4444-4444-8444-444444444444',foreign='55555555-5555-4555-8555-555555555555';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
test('PostgreSQL migration, calendar rights, invitations, tasks and own reminders',async()=>{
 const db=new PGlite();let checks=0;
 const query=async(sql,args)=>{checks++;return (await db.query(sql,args)).rows;};
 const denied=async(sql,args)=>{await db.exec('savepoint deny');try{await assert.rejects(db.query(sql,args));checks++;}finally{await db.exec('rollback to deny');}};
 const as=async id=>{await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,invited_at timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select current_user::text$$;
  grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;
  create function gen_random_bytes(n int) returns bytea language sql volatile as $$select decode(left(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),n*2),'hex')$$;`);
  await db.exec(fs.readFileSync(new URL('supabase.txt',root),'utf8').replace('create extension if not exists pgcrypto;',''));
  for(const p of fs.readdirSync(new URL('supabase/migrations/',root)).filter(x=>x.endsWith('.sql')&&!/v170|v173|schedule_v160/.test(x)).sort()){
   let sql=fs.readFileSync(new URL('supabase/migrations/'+p,root),'utf8').replace(/create extension if not exists pg_cron;/g,'').replace(/create extension if not exists pg_net with schema extensions;/g,'');
   if(p.includes('activate_invite'))sql="select set_config('famkal.auth_config_verified','yes',true);\n"+sql;
   await db.exec(sql);
  }
  await db.exec(`insert into auth.users(id,email,email_confirmed_at,invited_at) values('${owner}','owner@example.invalid',now(),null),('${anna}','anna@example.invalid',now(),now()),('${outsider}','outside@example.invalid',now(),null);
   insert into public.families(id,name) values('${family}','Family'),('${foreign}','Outside');
   insert into public.family_members(family_id,user_id,display_name,role) values('${family}','${owner}','Robert','owner'),('${foreign}','${outsider}','Outside','owner');
   insert into public.test_members(family_id,display_name,color) values('${family}','Test','#ff69b4');
   insert into public.event_series(family_id,recurrence,starts_on,ends_on,created_by) values('${family}','weekly','2026-10-04','2026-10-11','${owner}');
   insert into public.events(family_id,title,event_type,event_date,start_time,end_time,created_by,assignee_id) values('${family}','Existing','appointment','2026-10-04','10:00','11:00','${owner}','${owner}');`);
  const original=(await query('select to_jsonb(e) value from public.events e'))[0].value;
  await db.exec(fs.readFileSync(new URL('supabase/migrations/20261003063035_family_calendars_v170.sql',root),'utf8'));
  await db.exec(fs.readFileSync(new URL('supabase/migrations/20261003080822_calendar_trigger_fix_v173.sql',root),'utf8'));
  const after=(await query('select to_jsonb(e) value from public.events e'))[0].value;delete after.blocks_time;assert.deepEqual(after,original);
  assert.equal((await query('select count(*)::int n from public.event_calendars'))[0].n,1);
  assert.equal((await query('select count(*)::int n from public.event_assignments where person_id is not null'))[0].n,1);
  assert.equal((await query('select count(*)::int n from public.series_calendars'))[0].n,1);
  const cals=await query(`select c.*,p.linked_user_id,p.include_in_all_tasks from public.calendars c join public.family_people p on p.id=c.person_id where c.family_id='${family}'`);
  const leo=cals.find(c=>c.display_name==='Leo'),robert=cals.find(c=>c.display_name==='Robert'),ac=cals.find(c=>c.display_name==='Anna');
  assert.equal(leo.include_in_all_tasks,false);assert.equal(robert.linked_user_id,owner);
  await db.exec('begin');await as(owner);
  const base={family_id:family,title:'New',event_type:'appointment',event_date:'2027-01-01',end_date:'2027-01-01',start_time:'10:00',end_time:'11:00',all_day:false,assignments:[],calendar_ids:[robert.id],reminders:[15]};
  const save=async(data,id=null)=> (await query('select public.save_calendar_event_v170($1::jsonb,$2::uuid) id',[JSON.stringify(data),id]))[0].id;
  const own=await save(base);assert.ok(own);
  await denied('select public.save_calendar_event($1::jsonb)',[JSON.stringify(base)]);
  await denied('select private.save_calendar_event_engine($1::jsonb,null,\'single\',\'none\',null,null,\'[]\')',[JSON.stringify(base)]);
  await denied('update public.events set title=\'Bypass\' where id=$1::uuid',[own]);
  await denied('delete from public.events where id=$1::uuid',[own]);
  for(const bad of [{end_time:null},{start_time:null},{end_time:'10:00'},{end_time:'09:00'},{calendar_ids:[]},{calendar_ids:['99999999-9999-4999-8999-999999999999']}]) await denied('select public.save_calendar_event_v170($1::jsonb)',[JSON.stringify({...base,...bad})]);
  const minute=await save({...base,end_time:'10:01'});assert.ok(minute);
  const overnight=await save({...base,start_time:'22:00',end_time:'06:00',end_date:'2027-01-02',calendar_ids:[leo.id]});assert.ok(overnight);
  const group=await save({...base,assignee_all:true,calendar_ids:[leo.id]});
  assert.equal((await query('select count(*)::int n from public.family_people where family_id=$1 and include_in_all_tasks',[family]))[0].n,2);
  // Invitation joins the existing Anna profile and does not create a second calendar.
  await db.exec('reset role');
  await db.exec(`insert into public.family_invitations(family_id,email,code,created_by,calendar_id) values('${family}','anna@example.invalid','TESTCODE','${owner}','${ac.id}')`);
  await as(anna);await query("select public.join_family('TESTCODE')");
  assert.equal((await query('select linked_user_id from public.family_people where id=$1',[ac.person_id]))[0].linked_user_id,anna);
  assert.equal((await query('select count(*)::int n from public.calendars'))[0].n,4);
  assert.equal((await query('select include_in_all_tasks from public.family_people where id=$1',[ac.person_id]))[0].include_in_all_tasks,false);
  await denied("select public.join_family('TESTCODE')");
  const aOwn=await save({...base,calendar_ids:[ac.id]});
  const aLeo=await save({...base,calendar_ids:[leo.id]});
  await denied('select public.save_calendar_event_v170($1::jsonb)',[JSON.stringify(base)]);
  await denied('select public.manage_calendar(p_name:=\'Bypass\')');
  const stamp=(await query('select updated_at from public.events where id=$1',[aLeo]))[0].updated_at;
  await save({...base,calendar_ids:[leo.id],expected_updated_at:stamp,title:'Updated by creator'},aLeo);
  await denied('select public.save_calendar_event_v170($1::jsonb,$2)',[JSON.stringify({...base,calendar_ids:[leo.id],expected_updated_at:stamp}),aLeo]);
  await denied('select public.calendar_cancel_v170($1,true)',[overnight]);
  await query('select public.calendar_self_assign($1,\'to\',true)',[overnight]);
  assert.equal((await query('select person_id from public.event_assignments where event_id=$1',[overnight]))[0].person_id,ac.person_id);
  await query('select public.calendar_self_assign($1,\'to\',false)',[overnight]);
  await denied('select public.calendar_self_assign($1,\'assignee\',true)',[group]);
  await query('select public.calendar_cancel_v170($1,true)',[aOwn]);
  await query('select public.calendar_cancel_v170($1,false)',[aOwn]);
  // Profile linking alone cannot turn unrelated responsibilities into edit rights.
  assert.equal((await query('select private.calendar_can_edit($1) allowed',[overnight]))[0].allowed,false);
  await as(outsider);assert.equal((await query('select count(*)::int n from public.events'))[0].n,0);
  await denied('select public.save_calendar_event_v170($1::jsonb)',[JSON.stringify({...base,family_id:foreign,calendar_ids:[leo.id]})]);
  await as(owner);
  await denied('select public.save_calendar_event_v170($1::jsonb)',[JSON.stringify({...base,assignments:[{role:'assignee',person_id:cals.find(c=>c.display_name==='Oma Lena').person_id},{role:'to',person_id:'99999999-9999-4999-8999-999999999999'}]})]);
  // Own calendar reminder, no explicit responsibility, no real provider call.
  await db.exec('reset role');
  await query('insert into public.push_subscriptions(user_id,endpoint,subscription) values($1,\'https://web.push.apple.com/local-test\',\'{}\')',[anna]);
  const due='2027-01-01T08:45:00Z';
  const recipients=await query('select event_id,user_id,roles from private.push_eligible($1::timestamptz)',[due]);
  assert.ok(recipients.some(r=>r.event_id===aOwn&&r.user_id===anna&&r.roles==='Eigener Termin'));
  assert.ok(!recipients.some(r=>r.event_id===group&&r.user_id===anna));
  assert.equal((await query("select has_function_privilege('anon','public.manage_calendar(uuid,text,text,integer,boolean,boolean)','execute') allowed"))[0].allowed,false);
  assert.equal((await query("select has_function_privilege('authenticated','public.prepare_family_access_link_v170(uuid,text,text,uuid,uuid)','execute') allowed"))[0].allowed,false);
  // Finish the transaction: deferred checks MUST run, not disappear on rollback.
  await db.exec('commit');
  for(const scope of ['single','following','series']){
    await db.exec('begin');await as(owner);
    const created=(await query("select public.save_calendar_event_v170($1::jsonb,null,'single','daily','2027-01-03') id",[JSON.stringify({...base,calendar_ids:[leo.id],title:'Series commit '+scope})]))[0].id;
    await db.exec('commit');await db.exec('begin');await as(owner);
    const current=(await query('select updated_at::text stamp from public.events where id=$1',[created]))[0].stamp;
    await query("select public.save_calendar_event_v170($1::jsonb,$2::uuid,$3) id",[JSON.stringify({...base,calendar_ids:[leo.id],expected_updated_at:current,title:'Committed '+scope}),created,scope]);
    await db.exec('commit');await db.exec('reset role');
    const saved=await query('select title from public.events where id=$1',[created]);assert.equal(saved[0].title,'Committed '+scope);
  }
  // Removing the last calendar remains forbidden at COMMIT and rolls back.
  await db.exec('reset role;begin');await db.query('delete from public.event_calendars where event_id=$1',[own]);
  await assert.rejects(db.exec('commit'),/Termin benötigt einen Kalender/);await db.exec('rollback');
  assert.equal((await query('select count(*)::int n from public.event_calendars where event_id=$1',[own]))[0].n,1);
  await db.exec('begin');
  await db.query("insert into public.events(family_id,title,event_type,event_date,start_time,end_time,created_by) values($1,'Missing initial calendar','appointment','2030-01-01','10:00','11:00',$2)",[family,owner]);
  await assert.rejects(db.exec('commit'),/Termin benötigt einen Kalender/);await db.exec('rollback');
  assert.equal((await query("select count(*)::int n from public.events where title='Missing initial calendar'"))[0].n,0);
  await db.exec(fs.readFileSync(new URL('tests/family-calendars-production.sql',root),'utf8'));console.log(checks+' PostgreSQL checks plus 22 isolated production checks passed');
 }finally{await db.close();}
});

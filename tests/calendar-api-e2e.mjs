// Only runs against a disposable, separately created family; never writes real calendar rows.
import {readFile} from 'node:fs/promises';import vm from 'node:vm';import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
const f=JSON.parse(await readFile(process.argv[2],'utf8')),context={window:{}};
vm.runInNewContext(await readFile(new URL('../config.js',import.meta.url),'utf8'),context);
const cfg=context.window.APP_CONFIG;
const sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
let checks=0;const ok=r=>{if(r.error)throw r.error;checks++;return r.data;};
try{
 const session=ok(await sb.auth.signInWithPassword({email:f.email,password:f.password}));assert.equal(session.user.id,f.uid);
 const pink=ok(await sb.rpc('manage_test_member',{p_name:'API Pink',p_color:'#ff69b4'}));
 const data={family_id:f.fid,event_date:'2026-10-04',end_date:'2026-10-05',event_type:'bedtime',title:'API overnight',start_time:'20:00',end_time:'06:00',assignments:[{role:'assignee',person_id:pink}]};
 const first=ok(await sb.rpc('save_calendar_event',{p_event:data,p_recurrence:'custom',p_until:'2026-10-08',p_weekdays:[7,1,2,3,4]}));
 const rows=ok(await sb.from('events').select('*,assignments:event_assignments(role,member_user_id,test_member_id)').eq('family_id',f.fid).lte('event_date','2026-10-10').or('end_date.gte.2026-10-05,and(end_date.is.null,event_date.gte.2026-10-05)'));
 assert.equal(rows.length,5);assert.equal(rows[0].assignments[0].test_member_id,pink);assert.ok(rows.every(e=>e.end_date>e.event_date));
 const target=rows.find(e=>e.id===first);
 const vacation=ok(await sb.rpc('save_calendar_event',{p_event:{family_id:f.fid,event_type:'vacation',title:'API Holiday',event_date:'2026-10-04',end_date:'2026-10-09',all_day:true,assignments:[]},p_cancel:[{id:target.id,updated_at:target.updated_at}]}));
 const cancelled=ok(await sb.from('events').select('id,is_cancelled,vacation_cancel_id').eq('id',first).single());assert.equal(cancelled.is_cancelled,true);assert.equal(cancelled.vacation_cancel_id,vacation);
 ok(await sb.rpc('calendar_cancel',{p_id:vacation,p_cancel:false,p_scope:'vacation'}));
 const restored=ok(await sb.from('events').select('id,is_cancelled').eq('id',first).single());assert.equal(restored.is_cancelled,false);
 ok(await sb.rpc('manage_test_member',{p_id:pink,p_remove:true}));
 const remaining=ok(await sb.from('events').select('*,assignments:event_assignments(role,member_user_id,test_member_id)').eq('id',first).single());assert.equal(remaining.assignments.length,0);assert.equal(remaining.id,first);
 console.log(`${checks} real API checks passed`);
}finally{await sb.auth.signOut();}

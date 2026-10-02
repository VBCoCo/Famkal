import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*$/gm,'');
import * as utils from '../calendar-utils.js';
import {mountProjectList} from '../project-list.js';
import {mountPushSettings,disablePushDevice} from '../push-settings.js';
import * as links from '../access-links.js';
function fixture({rows=[],rpcResult=null,rpcError=null}={}) {
  const dom=new JSDOM(html,{url:'https://vbcoco.github.io/Famkal/',runScripts:'outside-only'});
  const w=dom.window,calls=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  const sb={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({data:{}}),verifyOtp:async()=>({data:{session:{},user:{id:'u1'}}}),setSession:async data=>{calls.push({action:'reset-session'});return {data:{session:{},user:{id:'u1'}}};},resetPasswordForEmail:async(email,options)=>{calls.push({action:'recovery-mail',email,options});return {data:{}};},updateUser:async data=>{calls.push({action:'password',length:data.password.length});return {data:{}};}},from(table){
    const q={action:'read',filters:[],select(){return this;},eq(...args){this.filters.push(args);return this;},gte(){return this;},lte(){return this;},or(){return this;},order(){return this;},range(){return this;},update(){this.action='update';return this;},insert(){this.action='insert';return this;},delete(){this.action='delete';return this;},maybeSingle(){return this;},single(){return this;},then(resolve){calls.push({table,action:this.action});return Promise.resolve({data:table==='family_members'&&this.action==='read'?[member]:rows,error:null}).then(resolve);}};
    return q;
  },rpc:async(name,args)=>{calls.push({action:'rpc',name,args});return {data:rpcResult,error:rpcError};}};
  const member={user_id:'u1',family_id:'f1',display_name:'Robert',color:'#355c50',role:'owner',default_reminder_minutes:0};
  Object.assign(w,{...utils,...links,mountPushSettings,disablePushDevice,esc:utils.escapeHtml,mountProjectList,createClient:()=>sb});
  w.eval(app.replace(/start\(\);\s*$/,'sb=createClient(); bindUI();')+'\nwindow.testApp={start,openSettings,openNotificationEvent,openEvent,payload,card,askScope,navigate,renderToday,renderWeek,renderTasks,clearSession,vacationPreview,setTestPeople(value){testMembers=value;},setEvents(value){events=value;renderToday();renderWeek();renderTasks();},setPeople(value){members=value;},setAccessLink(value){accessLink=value;},setState(){user={id:"u1"};member='+JSON.stringify(member)+';members=[member];events=[];series=[];},setRole(role){member.role=role;},setSeries(value){series=value;},refreshAll};');
  w.testApp.setState();
  return {dom,w,calls,close:()=>dom.window.close()};
}
test('event editor preserves zero-minute default and all-day clears payload times',()=>{
  const f=fixture();try {
    f.w.testApp.openEvent();
    assert.equal(f.w.document.querySelector('#reminders input').value,'0');
    f.w.document.querySelector('#startTime').value='14:00';f.w.document.querySelector('#allDay').value='true';
    assert.equal(f.w.testApp.payload().start_time,null);
  }finally{f.close();}
});
test('overnight custom series sends end date, weekday selection and multiple assignments',async()=>{
 const f=fixture({rpcResult:'saved'});try{
  f.w.testApp.setPeople([{user_id:'u1',display_name:'Robert',color:'#0066ff'},{user_id:'u2',display_name:'Anna',color:'#ff0000'}]);f.w.testApp.openEvent();
  const d=f.w.document;d.querySelector('#eventTitle').value='Schlafen';d.querySelector('#eventDate').value='2026-10-04';d.querySelector('#eventEndDate').value='2026-10-05';d.querySelector('#startTime').value='20:00';d.querySelector('#endTime').value='06:00';d.querySelector('#recurrence').value='custom';d.querySelector('#recurrenceEnd').value='2026-10-08';
  d.querySelectorAll('#assigneePeople input').forEach(x=>x.checked=true);d.querySelectorAll('#weekdayChoices input').forEach(x=>x.checked=['7','1','2','3','4'].includes(x.value));
  d.querySelector('#eventForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));
  const call=f.calls.find(x=>x.name==='save_calendar_event');assert.ok(call);assert.equal(call.args.p_event.end_date,'2026-10-05');assert.equal(call.args.p_event.assignments.length,2);assert.equal(call.args.p_weekdays.length,5);assert.ok(call.args.p_weekdays.includes(7));
 }finally{f.close();}
});
test('All clears individuals, fake people can be selected and stale edit timestamp is preserved',()=>{
 const f=fixture();try{
  f.w.testApp.setTestPeople([{id:'pink',user_id:'pink',display_name:'Test',color:'#ff69b4',is_test:true}]);
  f.w.testApp.openEvent(makeEvent('edit',{updated_at:'2026-10-02T10:00:00Z',assignments:[{role:'assignee',test_member_id:'pink'}]}));
  const d=f.w.document;assert.equal(d.querySelector('#assigneePeople input[value=pink]').checked,true);
  assert.equal(f.w.testApp.payload().expected_updated_at,'2026-10-02T10:00:00Z');
  d.querySelector('#assigneeAll').click();const data=f.w.testApp.payload();assert.equal(data.assignee_all,true);assert.equal(data.assignments.length,0);assert.equal(d.querySelector('#assigneePeople input[value=pink]').disabled,true);
 }finally{f.close();}
});
test('cancelled filter persists in every view and includes plain appointments in tasks',()=>{
 const f=fixture();try{
  f.w.testApp.setEvents([makeEvent('active',{assignee_all:true}),makeEvent('cancelled',{is_cancelled:true})]);
  assert.equal(f.w.document.querySelectorAll('#upcomingList .event-card').length,1);
  f.w.document.querySelector('[data-filter=cancelled]').click();
  for(const view of ['today','week','tasks']){f.w.testApp.navigate(view);assert.equal(f.w.document.querySelector('[data-filter=cancelled]').getAttribute('aria-pressed'),'true');}
  assert.equal(f.w.document.querySelectorAll('#tasksList .event-card').length,1);assert.ok(f.w.document.querySelector('#tasksList .cancelled'));assert.match(f.w.document.querySelector('#tasksList').textContent,/Wiederherstellen/);
 }finally{f.close();}
});
test('holiday preview starts unselected, groups occurrences and only saves reviewed IDs',async()=>{
 const rows=[makeEvent('a',{event_date:'2026-10-04',series_id:'s',updated_at:'2026-10-02'}),makeEvent('b',{event_date:'2026-10-05',series_id:'s',updated_at:'2026-10-02'}),makeEvent('outside',{event_date:'2026-10-10'}),makeEvent('cancelled',{event_date:'2026-10-05',is_cancelled:true})];
 const f=fixture({rows,rpcResult:'holiday'});try{
  await f.w.testApp.vacationPreview({family_id:'f1',event_type:'vacation',title:'Urlaub',event_date:'2026-10-04',end_date:'2026-10-06',all_day:true});
  const d=f.w.document;assert.equal(d.querySelectorAll('[data-vacation-id]').length,2);assert.equal(d.querySelectorAll('[data-vacation-id]:checked').length,0);assert.ok(!f.calls.some(x=>x.name==='save_calendar_event'));
  d.querySelector('[data-vacation-group]').click();d.querySelector('#vacationNext').click();assert.match(d.querySelector('#vacationSave').textContent,/2 Termine absagen/);
  d.querySelector('#vacationSave').click();await new Promise(r=>setTimeout(r,20));const call=f.calls.find(x=>x.name==='save_calendar_event');assert.equal(call.args.p_cancel.length,2);assert.ok(call.args.p_cancel.every(x=>['a','b'].includes(x.id)&&x.updated_at));
 }finally{f.close();}
});
test('holiday failure remains in foreground, cancel or preview alone never writes',async()=>{
 const f=fixture({rpcError:{message:'Auswahl veraltet'}});try{
  const data={family_id:'f1',event_type:'vacation',title:'Urlaub',event_date:'2026-10-04',end_date:'2026-10-06',all_day:true};
  await f.w.testApp.vacationPreview(data);f.w.document.querySelector('[data-close=vacationDialog]').click();assert.ok(!f.calls.some(x=>x.name==='save_calendar_event'));
  await f.w.testApp.vacationPreview(data);f.w.document.querySelector('#vacationNext').click();f.w.document.querySelector('#vacationSave').click();await new Promise(r=>setTimeout(r,10));
  assert.equal(f.w.document.querySelector('#vacationDialog').open,true);assert.match(f.w.document.querySelector('#vacationDialog [role=alert]').textContent,/veraltet/);
 }finally{f.close();}
});
test('invited user sets a password before joining and no public signup control exists',async()=>{
 const f=fixture();try{
  assert.equal(f.w.document.querySelector('#toggleSignup'),null);
  f.w.testApp.setAccessLink({kind:'invite',token:'a'.repeat(56),familyCode:'b'.repeat(32)});
  f.w.document.querySelector('#redeemLink').click();await new Promise(r=>setTimeout(r,10));
  assert.equal(f.w.document.querySelector('#passwordDialog').open,true);
  assert.ok(!f.calls.some(c=>c.name==='join_family'));
  f.w.document.querySelector('#newPassword').value='long-test-password';f.w.document.querySelector('#confirmPassword').value='long-test-password';
  f.w.document.querySelector('#passwordForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));
  assert.ok(f.calls.some(c=>c.action==='password'));
  assert.equal(f.calls.find(c=>c.name==='join_family').args.p_code,'b'.repeat(32));
 }finally{f.close();}
});
test('recovery mail uses only valid email, fixed redirect and neutral message with admin fallback',async()=>{
 const f=fixture();try{
  f.w.document.querySelector('#forgotPassword').click();await new Promise(r=>setTimeout(r,10));
  assert.ok(!f.calls.some(c=>c.action==='recovery-mail'));
  f.w.document.querySelector('#email').value='owner@example.com';
  f.w.document.querySelector('#forgotPassword').click();await new Promise(r=>setTimeout(r,10));
  const call=f.calls.find(c=>c.action==='recovery-mail');assert.equal(call.email,'owner@example.com');assert.equal(call.options.redirectTo,'https://vbcoco.github.io/Famkal/');
  assert.match(f.w.document.querySelector('#authInfo').textContent,/Falls für diese Adresse/);
  assert.match(f.w.document.querySelector('#authInfo').textContent,/Spam-Ordner.*Familien-Administrator/);
  f.w.document.querySelector('#forgotPassword').click();await new Promise(r=>setTimeout(r,10));
  assert.equal(f.calls.filter(c=>c.action==='recovery-mail').length,1);
 }finally{f.close();}
});
test('mail recovery shows password dialog and never joins a family',async()=>{
 const f=fixture();try{
  f.w.testApp.setAccessLink({kind:'recovery',accessToken:'header.payload.signature',refreshToken:'refresh-token',familyCode:null});
  f.w.document.querySelector('#redeemLink').click();await new Promise(r=>setTimeout(r,10));
  assert.equal(f.w.document.querySelector('#passwordDialog').open,true);
  assert.ok(f.calls.some(c=>c.action==='reset-session'));
  f.w.document.querySelector('#newPassword').value='long-test-password9';f.w.document.querySelector('#confirmPassword').value='long-test-password9';
  f.w.document.querySelector('#passwordForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));
  assert.ok(f.calls.some(c=>c.action==='password'));assert.ok(!f.calls.some(c=>c.name==='join_family'));
 }finally{f.close();}
});
test('opening a mail callback immediately removes tokens and requires explicit activation',async()=>{
 const f=fixture();try{
  f.w.location.hash='type=recovery&access_token=header.payload.signature&refresh_token=refresh-token';
  await f.w.testApp.start();
  assert.equal(f.w.location.hash,'');
  assert.equal(f.w.document.querySelector('#passwordDialog').open,false);
  assert.ok(!f.calls.some(c=>c.action==='reset-session'));
  assert.match(f.w.document.querySelector('#authInfo').textContent,/Reset-Link/);
  f.w.document.querySelector('#redeemLink').click();await new Promise(r=>setTimeout(r,10));
  assert.equal(f.w.document.querySelector('#passwordDialog').open,true);
 }finally{f.close();}
});
test('profile opens the read-only project list',async()=>{
  const f=fixture();try{
    f.w.document.querySelector('#avatar').click();
    assert.ok(f.w.document.querySelector('#showProject'));
    f.w.document.querySelector('#showProject').click();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.w.document.querySelector('#settingsHeading').textContent,'Projekt & offene Punkte');
    assert.ok(f.calls.some(c=>c.table==='project_items'));
    assert.equal(f.w.document.querySelector('#settingsContent input'),null);
  }finally{f.close();}
});
test('cancel closes series scope without submitting an action',async()=>{
  const f=fixture();try {
    let calls=0;f.w.testApp.askScope(()=>{calls++;});
    f.w.document.querySelector('[data-scope=cancel]').click();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.w.document.querySelector('#scopeDialog').open,false);assert.equal(calls,0);
  }finally{f.close();}
});
test('member cannot choose following or whole-series scope',()=>{
  const f=fixture();try {f.w.testApp.setRole('member');f.w.testApp.askScope(()=>{});
    assert.equal(f.w.document.querySelector('[data-scope=following]').disabled,true);
    assert.equal(f.w.document.querySelector('[data-scope=series]').disabled,true);
    assert.equal(f.w.document.querySelector('[data-scope=single]').disabled,false);
  }finally{f.close();}
});
test('zero-row update is not reported as saved',async()=>{
  const f=fixture();try {
    f.w.testApp.openEvent({id:'e1',created_by:'u1',event_date:'2026-10-01',title:'Test',event_type:'appointment',all_day:true,reminders:[]});
    f.w.document.querySelector('#eventForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(f.w.document.querySelector('#eventDialog [role=alert]').textContent,/Nicht gespeichert/);
    assert.equal(f.w.document.querySelector('#eventDialog').open,true);
  }finally{f.close();}
});
test('overnight validation error is visible inside the modal and preserves inputs',async()=>{
 const f=fixture();try{
  f.w.testApp.openEvent();f.w.document.querySelector('#eventTitle').value='Bettgehzeit';
  f.w.document.querySelector('#startTime').value='20:00';f.w.document.querySelector('#endTime').value='06:00';
  f.w.document.querySelector('#eventForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));
  await new Promise(r=>setTimeout(r,10));
  assert.match(f.w.document.querySelector('#eventDialog [role=alert]').textContent,/Ende/);
  assert.equal(f.w.document.querySelector('#eventDialog').open,true);
  assert.equal(f.w.document.querySelector('#eventTitle').value,'Bettgehzeit');
  assert.equal(f.w.document.querySelector('#startTime').value,'20:00');
  assert.equal(f.w.document.querySelector('#endTime').value,'06:00');
  assert.ok(!f.calls.some(c=>c.table==='events'));
  f.w.testApp.openEvent();assert.equal(f.w.document.querySelector('#eventDialog [role=alert]'),null);
 }finally{f.close();}
});
test('week navigation triggers a new backend read',async()=>{
  const f=fixture();try {
    f.w.document.querySelector('#nextWeek').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(f.calls.some(c=>c.table==='events'));
  }finally{f.close();}
});
test('series metadata is visible but ineffective recurrence changes are disabled',()=>{
  const f=fixture();try {
    f.w.testApp.setSeries([{id:'s1',recurrence:'weekly',ends_on:'2027-01-01'}]);
    f.w.testApp.openEvent({id:'e1',series_id:'s1',created_by:'u1',title:'Test',event_date:'2026-10-01',reminders:[]});
    assert.equal(f.w.document.querySelector('#recurrence').value,'weekly');
    assert.equal(f.w.document.querySelector('#recurrence').disabled,true);
    assert.equal(f.w.document.querySelector('#recurrenceEnd').value,'2027-01-01');
  }finally{f.close();}
});
const makeEvent=(id,extra={})=>({id,title:id,event_date:utils.localDate(utils.addDays(new Date(),1)),event_type:'appointment',start_time:'15:00:00',created_by:'u1',reminders:[],...extra});
test('empty today still shows upcoming assigned appointments and more works',()=>{
 const f=fixture();try{
  f.w.testApp.setEvents(Array.from({length:7},(_,n)=>makeEvent('future'+n,{assignee_id:'u1'})));
  assert.match(f.w.document.querySelector('#todayList').textContent,/nichts eingetragen/);
  assert.equal(f.w.document.querySelectorAll('#upcomingList .event-card').length,5);
  assert.equal(f.w.document.querySelector('#moreUpcoming').classList.contains('hidden'),false);
  f.w.document.querySelector('#moreUpcoming').click();assert.equal(f.w.document.querySelectorAll('#upcomingList .event-card').length,7);
 }finally{f.close();}
});
test('shared filters persist between views and exclude other people in each list',()=>{
 const f=fixture();try{
  f.w.testApp.setEvents([makeEvent('mine',{assignee_id:'u1'}),makeEvent('other',{assignee_id:'u2'})]);
  f.w.document.querySelector('[data-filter=mine]').click();
  assert.equal(f.w.document.querySelectorAll('#upcomingList .event-card').length,1);
  f.w.testApp.navigate('week');assert.equal(f.w.document.querySelector('[data-filter=mine]').getAttribute('aria-pressed'),'true');
  assert.ok(!f.w.document.querySelector('#weekList [data-id=other]'));
  f.w.testApp.navigate('tasks');assert.equal(f.w.document.querySelectorAll('#tasksList .event-card').length,1);
  f.w.document.querySelector('[data-filter=all]').click();f.w.testApp.navigate('today');
  assert.equal(f.w.document.querySelectorAll('#upcomingList .event-card').length,2);
 }finally{f.close();}
});
test('all appointment assignments appear once as tasks, grouped by day',()=>{
 const f=fixture();try{
  f.w.testApp.setEvents([makeEvent('orthodontist',{assignee_id:'u1',transport_to_id:'u1',transport_from_id:'u1'}),makeEvent('school',{event_type:'school',assignee_id:'u1'}),makeEvent('plain')]);
  assert.equal(f.w.document.querySelectorAll('#tasksList .event-card').length,2);
  assert.equal(f.w.document.querySelectorAll('#tasksList>h3').length,1);
  assert.match(f.w.document.querySelector('#tasksList').textContent,/Bringen · Abholen · Zuständig/);
 }finally{f.close();}
});
test('unresolved task filter covers missing care assignee and keeps calendar selection',()=>{
 const f=fixture();try{
  f.w.testApp.setEvents([makeEvent('care',{event_type:'care',transport_to_id:'u1'}),makeEvent('assigned',{assignee_id:'u1'}),makeEvent('ride',{event_type:'transport'})]);
  f.w.testApp.navigate('tasks');f.w.document.querySelector('[data-filter=open]').click();
  assert.equal(f.w.document.querySelectorAll('#tasksList .event-card').length,2);
  assert.match(f.w.document.querySelector('#tasksList').textContent,/Zuständigkeit offen/);
  f.w.testApp.navigate('today');assert.equal(f.w.document.querySelector('[data-filter=open]').getAttribute('aria-pressed'),'true');
  assert.equal(f.w.document.querySelector('#openFilter').classList.contains('hidden'),false);
 }finally{f.close();}
});
test('compact cards expand separately from editing, own color and no redundant own name',()=>{
 const f=fixture();try{
  f.w.testApp.setPeople([{user_id:'u1',display_name:'Robert',color:'#0066ff'},{user_id:'u2',display_name:'Anna',color:'#ff0000'}]);
  f.w.testApp.setEvents([makeEvent('appointment',{assignee_id:'u2',transport_to_id:'u1',location:'Praxis',notes:'Notiz'})]);
  f.w.document.querySelector('[data-filter=mine]').click();
  const card=f.w.document.querySelector('#upcomingList .event-card');
  assert.match(card.style.getPropertyValue('--assignment'),/#0066ff/);assert.match(card.style.getPropertyValue('--assignment'),/#ff0000/);assert.ok(!card.textContent.includes('Robert'));
  assert.ok(card.textContent.includes('Anna'));assert.ok(!card.querySelector('summary').textContent.includes('Praxis'));
  assert.equal(card.querySelector('details').open,false);card.querySelector('details').open=true;
  assert.equal(f.w.document.querySelector('#eventDialog').open,false);
  card.querySelector('[data-edit-event]').click();assert.equal(f.w.document.querySelector('#eventDialog').open,true);
 }finally{f.close();}
});
test('card content and IDs cannot inject markup and readonly card keeps editor restrictions',()=>{
 const f=fixture();try{
  f.w.testApp.setRole('member');
  const card=f.w.testApp.card(makeEvent('x\" onclick=\"alert(1)',{title:'<img src=x onerror=alert(1)>',notes:'<script>alert(1)</script>',created_by:'u2'}));
  const host=f.w.document.createElement('div');host.innerHTML=card;
  assert.equal(host.querySelector('img,script,[onclick]'),null);assert.match(host.textContent,/Termin ansehen/);
 }finally{f.close();}
});
test('session cleanup clears upcoming items, filter and private content',()=>{
 const f=fixture();try{
  f.w.testApp.setEvents([makeEvent('private',{assignee_id:'u1'})]);f.w.document.querySelector('[data-filter=mine]').click();
  f.w.testApp.clearSession();assert.equal(f.w.document.querySelector('#upcomingList').textContent,'');
  f.w.testApp.setState();f.w.testApp.navigate('today');assert.equal(f.w.document.querySelector('[data-filter=all]').getAttribute('aria-pressed'),'true');
 }finally{f.close();}
});

test('notifications settings include device controls and self-service iPhone instructions',()=>{
 const f=fixture();try{
  f.w.testApp.openSettings('notifications');
  const root=f.w.document.querySelector('#pushSettings');
  assert.ok(root.querySelector('#enablePush'));assert.ok(root.querySelector('#testPush'));assert.ok(root.querySelector('#disablePush'));
  assert.match(root.textContent,/ChatGPT ist dafür nicht erforderlich/);assert.match(root.textContent,/iPhone-Abfrage/);assert.match(root.textContent,/09:00/);
 }finally{f.close();}
});
test('notification deep link opens its event after membership and removes the URL parameter',async()=>{
 const f=fixture();try{
  const id='11111111-1111-4111-8111-111111111111';
  f.dom.reconfigure({url:'https://vbcoco.github.io/Famkal/?event='+id});f.w.testApp.setEvents([makeEvent(id,{title:'Push target',assignee_id:'u1'})]);
  await f.w.testApp.openNotificationEvent();assert.equal(f.w.document.querySelector('#eventDialog').open,true);assert.equal(f.w.document.querySelector('#eventTitle').value,'Push target');assert.equal(new URL(f.w.location.href).searchParams.has('event'),false);
 }finally{f.close();}
});

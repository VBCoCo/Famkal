import { mountPushSettings, disablePushDevice } from './push-settings.js';
import { createClient } from './vendor/supabase.js';
import { mountProjectList } from './project-list.js';
import { parseAccessLink, redeemAccessLink, requestAccessLink, requestRecoveryEmail } from './access-links.js';
import { APP_VERSION, localDate, addDays, dateAtNoon, weekBounds, queryBounds, escapeHtml as esc, safeColor, eventTime, nextEvent, assignedTo, eventRoles, openAssignment, isTask, filterEvents, assignmentIds, eventEndDate, eventOnDay, eventsOverlap, cardTime, assignmentColors, layoutDayEvents, eventCalendarIds } from './calendar-utils.js';

const cfg = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let sb, user=null, member=null, members=[], testMembers=[], events=[], series=[], weekOffset=0, calendarFilter='all', taskFilter='all', taskLimit=50, upcomingLimit=5, pendingVacation=null, editingStamp=null;
const expandedEvents=new Set();
let profiles=[],calendars=[],selectedCalendars=null,familyDay=localDate();
let accessLink=null, pendingFamilyCode=null;
let refreshNumber=0, authNumber=0, pendingScope=null, recovery=false, initialized=false, currentView='today', toastTimer;
const admin = () => ['owner','admin'].includes(member?.role);
const toast = message => {
  clearTimeout(toastTimer);
  const dialog=$$('dialog[open]').at(-1);
  if(dialog) {
    $('#toast').classList.remove('show');
    let notice=dialog.querySelector('.dialog-notice');
    if(!notice){notice=document.createElement('p');notice.className='dialog-notice';notice.setAttribute('role','alert');dialog.prepend(notice);}
    notice.textContent=message;
    return;
  }
  $('#toast').textContent=message; $('#toast').classList.add('show');
  toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),5000);
};
const errorText = error => !navigator.onLine ? 'Offline: Zum Laden und Speichern ist eine Internetverbindung nötig.' :
  (error?.message || 'Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.');
function show(id) { ['auth','onboarding','app'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==id)); }
function clearSession() {
  authNumber++; refreshNumber++; user=null; member=null; members=[]; testMembers=[]; profiles=[]; calendars=[]; selectedCalendars=null; events=[]; series=[]; pendingVacation=null;editingStamp=null;
  weekOffset=0; currentView='today'; pendingScope=null; calendarFilter='all'; taskFilter='all'; taskLimit=50; upcomingLimit=5; expandedEvents.clear();
  $$('dialog[open]').forEach(d=>d.close());
  $('#settingsContent').replaceChildren(); $('#inviteLinkBox').classList.add('hidden');
  ['eventSummaryContent','familyBoard','todayList','upcomingList','weekList','tasksList','adminContent','nextTask'].forEach(id=>$('#'+id).replaceChildren());
  renderAccessLanding(null);show('auth');
}
async function busy(button, action) {
  if(button?.disabled) return;
  if(!navigator.onLine) return toast(errorText());
  if(button) button.disabled=true;
  try { await action(); } catch(error) { toast(errorText(error)); }
  finally { if(button) button.disabled=false; }
}
function check(result) { if(result.error) throw result.error; return result.data; }
function connectionStatus() {
  const offline=!navigator.onLine;
  $('#connectionStatus').textContent=offline?'Offline · Kalenderdaten benötigen Internet':'';
  $('#connectionStatus').classList.toggle('hidden',!offline);
}
function navigate(view) {
  if(view==='admin'&&!admin()) view='today';
  currentView=view;
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===view+'View'));
  $$('nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#title').textContent={today:'Heute',week:'Woche',family:'Familie',tasks:'Aufgaben',admin:'Admin',more:'Mehr'}[view];
  document.body.classList.toggle('family-mode',view==='family');
  if(view==='family')renderFamily();
  syncFilters();
}
function syncFilters() {
  const visible=['today','family','week','tasks'].includes(currentView), filter=currentView==='tasks'?taskFilter:calendarFilter;
  $('#calendarFilters').classList.toggle('hidden',!visible);
  $$('[data-filter]').forEach(button=>{const selected=button.dataset.filter===filter;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
}
async function loadMembership() {
  const request=++authNumber, userId=user?.id;
  if(!userId) return;
  const data=check(await sb.from('family_members').select('*').eq('user_id',userId).maybeSingle());
  if(request!==authNumber||userId!==user?.id) return;
  if(!data) { member=null; show('onboarding'); return; }
  member=data; show('app'); navigate(currentView); await refreshAll(); await openNotificationEvent();
}
async function openNotificationEvent() {
  const url=new URL(location.href),id=url.searchParams.get('event');
  if(!id||!member||!user)return;
  url.searchParams.delete('event');history.replaceState(null,'',url.pathname+url.search+url.hash);
  if(!/^[a-f0-9-]{36}$/i.test(id))return;
  const family=member.family_id,userId=user.id;
  const event=events.find(e=>e.id===id)||check(await sb.from('events').select('*,assignments:event_assignments(role,person_id,member_user_id,test_member_id),calendar_links:event_calendars(calendar_id)').eq('id',id).eq('family_id',family).maybeSingle());
  if(user?.id!==userId||member?.family_id!==family)return;
  if(event)openEvent(normalizeEvent(event));else toast('Der Termin ist nicht mehr verfügbar.');
}
async function fetchEvents(start,end,family) {
  const all=[], pageSize=500;
  for(let offset=0;;offset+=pageSize) {
    const page=check(await sb.from('events').select('*,assignments:event_assignments(role,person_id,member_user_id,test_member_id),calendar_links:event_calendars(calendar_id)').eq('family_id',family).lte('event_date',end)
      .or('end_date.gte.'+start+',and(end_date.is.null,event_date.gte.'+start+')').order('event_date').order('start_time',{nullsFirst:true}).order('id').range(offset,offset+pageSize-1));
    all.push(...page);
    if(page.length<pageSize) return all;
  }
}
async function refreshAll() {
  if(!member||!user) return;
  const request=++refreshNumber, family=member.family_id, userId=user.id, offset=weekOffset;
  const [start,end]=queryBounds(offset);
  const [people,items,recurrences,tests,persons,cals]=await Promise.all([
    sb.from('family_members').select('*').eq('family_id',family).order('display_name'),
    fetchEvents(start,end,family), sb.from('event_series').select('*').eq('family_id',family),sb.from('test_members').select('*').eq('family_id',family).eq('is_active',true).order('display_name'),
    sb.from('family_people').select('*').eq('family_id',family),sb.from('calendars').select('*').eq('family_id',family).order('sort_order').order('display_name')
  ]);
  const loadedPeople=check(people), loadedSeries=check(recurrences);
  if(request!==refreshNumber||family!==member?.family_id||userId!==user?.id) return;
  members=loadedPeople; events=items; series=loadedSeries;testMembers=check(tests).map(m=>({...m,user_id:m.id,is_test:true}));
  profiles=check(persons);calendars=check(cals);
  if(selectedCalendars===null){try{const saved=JSON.parse(localStorage.getItem('famkal-calendars-'+userId));selectedCalendars=Array.isArray(saved)?saved:calendars.filter(c=>c.is_active).map(c=>c.id);}catch{selectedCalendars=calendars.filter(c=>c.is_active).map(c=>c.id);}}
  selectedCalendars=selectedCalendars.filter(id=>calendars.some(c=>c.id===id));
  events=events.map(normalizeEvent);
  updateCalendarPicker();
  member=members.find(m=>m.user_id===userId);
  if(!member) return loadMembership();
  $('#avatar').textContent=(member.display_name||'?')[0].toUpperCase();
  $('#adminNav').classList.toggle('hidden',!admin());
  navigate(currentView); renderToday(); renderWeek(); renderTasks(); renderFamily(); fillPeople();
  if(admin()) renderAdmin(); else $('#adminContent').replaceChildren();
}
const allPeople=()=>profiles.length?profiles.filter(p=>p.is_active).map(p=>({...p,user_id:p.id})):[...members,...testMembers];
const myPersonId=()=>profiles.find(p=>p.linked_user_id===user?.id)?.id||user?.id;
const normalizeEvent=e=>({...e,calendar_people:(e.calendar_links||[]).map(link=>calendars.find(c=>c.id===link.calendar_id)?.person_id).filter(Boolean),requires_assignment:(e.calendar_links||[]).some(link=>calendars.find(c=>c.id===link.calendar_id)?.allow_family_create),all_task_person_ids:profiles.filter(p=>p.is_active&&p.include_in_all_tasks).map(p=>p.id)});
const displayCalendarIds=e=>eventCalendarIds(e,calendars,allPeople());
const selectedEvents=({tasks=false}={})=>calendars.length?events.filter(e=>eventCalendarIds(e,calendars,allPeople(),{includeBedtimeResponsibilities:tasks}).some(id=>selectedCalendars?.includes(id))):events;
const person=id=>allPeople().find(m=>m.user_id===id);
const typeIcon=type=>({school:'🎓',transport:'🚗',appointment:'📅',care:'🏠',bedtime:'🛏️',vacation:'🏖️'}[type]||'📅');
function card(event, {mine=false, task=false, day=event.event_date}={}) {
  const chips=[];
  for(const [role,label] of [['assignee','Zuständig']]) for(const id of assignmentIds(event,role))if(!mine||id!==myPersonId())chips.push(label+': '+esc(person(id)?.display_name||'Unbekannt'));
  if(event.assignee_all)chips.push('Zuständig: Alle in der Verantwortungsgruppe');
  const open=openAssignment(event), roles=eventRoles(event,mine?myPersonId():undefined);
  return '<article class="event-card'+(event.is_cancelled?' cancelled':'')+'" data-id="'+esc(event.id)+'" style="--assignment:'+assignmentColors(event,allPeople(),user?.id)+'"><details'+(expandedEvents.has(event.id)?' open':'')+'><summary><span class="event-heading"><small>'+
    typeIcon(event.event_type)+' '+esc(cardTime(event,day))+'</small><strong>'+esc(event.title)+'</strong>'+
    ((task||mine)&&roles.length?'<span class="event-role">'+roles.map(esc).join(' · ')+'</span>':'')+
    (event.is_cancelled?'<span class="assignment-open">Abgesagt'+(event.vacation_cancel_id?' · Urlaub':'')+'</span>':open?'<span class="assignment-open">'+esc(open)+'</span>':'')+'</span><span class="expand-icon" aria-hidden="true">⌄</span><span class="visually-hidden">Details ein- oder ausklappen</span></summary><div class="event-details">'+
    '<p class="calendar-membership">Kalender: '+displayCalendarIds(event).map(id=>esc(calendars.find(c=>c.id===id)?.display_name||'')).join(', ')+'</p><p>'+esc(event.event_date)+(eventEndDate(event)!==event.event_date?' bis '+esc(eventEndDate(event)):'')+'</p>'+
    (event.location?'<p>Ort: '+esc(event.location)+'</p>':'')+
    (event.end_time&&!event.all_day?'<p>Ende: '+esc(event.end_time.slice(0,5))+'</p>':'')+
    '<div class="chips">'+chips.map(x=>'<span class="chip">'+x+'</span>').join('')+
    (event.reminders||[]).map(x=>'<span class="chip">🔔 '+Number(x)+' Min. vor Beginn</span>').join('')+'</div>'+
    selfActions(event)+(event.notes?'<p class="event-notes">'+esc(event.notes)+'</p>':'')+
    (event.series_id?'<p class="small">Wiederkehrender Termin</p>':'')+
    (event.is_cancelled?(canEdit(event)?'<button type="button" class="secondary" data-restore-event="'+esc(event.id)+'">Wiederherstellen</button>':''):'<button type="button" class="secondary" data-edit-event="'+esc(event.id)+'">'+(canEdit(event)?'Bearbeiten':'Termin ansehen')+'</button>')+
    (event.event_type==='vacation'&&admin()?'<button type="button" class="secondary" data-restore-vacation="'+esc(event.id)+'">Urlaubsabsagen rückgängig</button>':'')+'</div></details></article>';
}
function bindCards() {
  $$('[data-self-event]').forEach(b=>b.onclick=()=>busy(b,async()=>{check(await sb.rpc('calendar_self_assign',{p_event:b.dataset.selfEvent,p_role:b.dataset.selfRole,p_take:b.dataset.selfTake==='true'}));await refreshAll();}));
  $$('.event-card details').forEach(element=>element.ontoggle=()=>{const id=element.closest('.event-card').dataset.id;if(element.open) expandedEvents.add(id); else expandedEvents.delete(id);});
  $$('[data-edit-event]').forEach(button=>button.onclick=()=>{const event=events.find(e=>e.id===button.dataset.editEvent);if(event)openEvent(event);});
  $$('[data-restore-event],[data-restore-vacation]').forEach(button=>button.onclick=()=>busy(button,async()=>{if(!confirm('Ausgewählte Absage'+(button.dataset.restoreVacation?'n dieses Urlaubs':'')+' wirklich rückgängig machen?'))return;check(await sb.rpc('calendar_cancel_v170',{p_id:button.dataset.restoreVacation||button.dataset.restoreEvent,p_cancel:false,p_scope:button.dataset.restoreVacation?'vacation':'single'}));await refreshAll();}));
}
function renderToday() {
  const today=localDate(), filtered=filterEvents(selectedEvents(),calendarFilter,myPersonId()), list=filtered.filter(e=>eventOnDay(e,today)), next=nextEvent(list), mine=calendarFilter==='mine';
  $('#todayList').innerHTML=list.length?list.map(e=>card(e,{mine,day:today})).join(''):'<div class="empty">'+(calendarFilter!=='all'?'Heute keine passenden Termine.':'Heute ist nichts eingetragen.')+'</div>';
  $('#nextTask').innerHTML=next?'<small>NÄCHSTER TERMIN</small><h2>'+esc(next.title)+'</h2><div>'+eventTime(next)+(eventRoles(next,mine?myPersonId():undefined).length?' · '+eventRoles(next,mine?myPersonId():undefined).map(esc).join(' · '):'')+'</div>':
    '<small>HEUTE</small><h2>Keine weiteren zeitgebundenen Termine</h2>';
  const upcoming=filtered.filter(e=>e.event_date>today&&e.event_date<=localDate(addDays(new Date(),120)));
  $('#upcomingList').innerHTML=upcoming.length?groupedCards(upcoming.slice(0,upcomingLimit),{mine}):'<div class="empty">Keine kommenden Termine'+(mine?' für dich':'')+'.</div>';
  $('#moreUpcoming').classList.toggle('hidden',upcoming.length<=upcomingLimit);
  if(calendarFilter==='cancelled')$('#nextTask').innerHTML='<small>ABGESAGT</small><h2>Abgesagte Termine</h2>';
  bindCards();
}
function renderWeek() {
  const [start,end]=weekBounds(weekOffset);
  $('#weekRange').textContent=start.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+'–'+end.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  let html='';
  for(let day=new Date(start);day<=end;day=addDays(day,1)) {
    const list=filterEvents(selectedEvents().filter(e=>eventOnDay(e,localDate(day))),calendarFilter,myPersonId());
    html+='<h3>'+day.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'})+'</h3>'+
      (list.length?list.map(e=>card(e,{mine:calendarFilter==='mine',day:localDate(day)})).join(''):'<div class="empty">Keine passenden Termine</div>');
  }
  $('#weekList').innerHTML=html; bindCards();
}
function renderTasks() {
  const today=localDate(), end=localDate(addDays(new Date(),120));
  const list=filterEvents(selectedEvents({tasks:true}).filter(e=>eventEndDate(e)>=today&&e.event_date<=end&&(calendarFilter==='cancelled'||isTask(e)||calendarFilter==='open')),calendarFilter,myPersonId());
  $('#tasksList').innerHTML=list.length?groupedCards(list.slice(0,taskLimit),{mine:calendarFilter==='mine',task:true}):'<div class="empty">Keine passenden Aufgaben.</div>';
  $('#moreTasks').classList.toggle('hidden',list.length<=taskLimit); bindCards();
}
function groupedCards(list,options) {
  let date='';return list.map(event=>{const day=event.event_date<localDate()?localDate():event.event_date;const heading=day!==date?'<h3>'+dateAtNoon(day).toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})+'</h3>':'';date=day;return heading+card(event,{...options,day});}).join('');
}
function fillPeople() {
  if(!$('#eventDialog').open){$('#assigneePeople').innerHTML=allPeople().map(m=>'<label class="checkbox-label"><input type="checkbox" value="'+esc(m.user_id)+'">'+esc(m.display_name)+(m.is_test?' (Test)':'')+'</label>').join('');}
}
function addReminder(value=15) {
  if($$('#reminders input').length>=10) return toast('Maximal zehn Erinnerungen pro Termin');
  const node=$('#reminderTpl').content.cloneNode(true);
  node.querySelector('input').value=value;
  node.querySelector('button').onclick=e=>e.target.closest('.reminder').remove();
  $('#reminders').append(node);
}
function toggleAllDay() {
  const allDay=$('#allDay').value==='true';
  ['startTime','endTime'].forEach(id=>{$('#'+id).disabled=allDay;$('#'+id).required=!allDay;$('#'+id).closest('.event-clock').classList.toggle('hidden',allDay);});
  $$('.event-time-row').forEach(row=>row.classList.toggle('all-day',allDay));
}
function canEdit(event) { if(member?.role==='owner')return true;const links=event.calendar_links||[];return links.length>0&&links.every(l=>{const c=calendars.find(c=>c.id===l.calendar_id);return c&&(c.person_id===myPersonId()||(c.allow_family_create&&event.created_by===user?.id));}); }
function openEventSummary(event) {
  if(!member||!event)return;
  $('#eventSummaryTitle').textContent=typeIcon(event.event_type)+' '+event.title;
  const people=(role)=>assignmentIds(event,role).map(id=>person(id)?.display_name||'Unbekannt').join(', ');
  const rows=[['Kalender',displayCalendarIds(event).map(id=>calendars.find(c=>c.id===id)?.display_name||'').join(', ')],
    ['Datum',dateAtNoon(event.event_date).toLocaleDateString('de-DE')+(eventEndDate(event)!==event.event_date?' bis '+dateAtNoon(eventEndDate(event)).toLocaleDateString('de-DE'):'')],
    ['Zeit',event.all_day?'Ganztägig':(event.start_time?.slice(0,5)||'')+' – '+(event.end_time?.slice(0,5)||'')],
    ['Ort',event.location],['Zuständig',event.assignee_all?'Alle in der Verantwortungsgruppe':people('assignee')],
    ['Status',event.is_cancelled?'Abgesagt':event.blocks_time===false?'Hinweis · belegt keine Zeit':''],
    ['Erinnerung',(event.reminders||[]).map(m=>m+' Min. vorher').join(', ')],['Serie',event.series_id?'Wiederkehrender Termin':'']];
  $('#eventSummaryContent').innerHTML='<dl class="event-facts">'+rows.filter(([,v])=>v).map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'+(event.notes?event.notes.length>180?'<details class="summary-notes"><summary>Notiz anzeigen</summary><p>'+esc(event.notes)+'</p></details>':'<p class="summary-notes">'+esc(event.notes)+'</p>':'');
  const button=$('#summaryEdit');button.classList.toggle('hidden',!canEdit(event)||Boolean(event.is_cancelled));
  button.onclick=()=>{const current=events.find(e=>e.id===event.id);$('#eventSummaryDialog').close();if(current)openEvent(current);};
  $('#eventSummaryDialog').showModal();
}
function openEvent(event=null) {
  if(!member) return;
  $('#eventDialog .dialog-notice')?.remove();
  $('#eventForm').reset(); $('#reminders').replaceChildren();
  editingStamp=event?.updated_at||null;fillPeople();
  $('#eventId').value=event?.id||''; $('#seriesId').value=event?.series_id||'';
  $('#eventHeading').textContent=event?'Termin bearbeiten':'Termin anlegen';
  const allowed=!event||canEdit(event);
  const deletable=event&&canEdit(event);
  $('#deleteEvent').classList.toggle('hidden',!deletable);
  const values={eventDate:event?.event_date||localDate(),eventType:event?.event_type||'appointment',eventTitle:event?.title||'',
    startTime:event?.start_time?.slice(0,5)||'',endTime:event?.end_time?.slice(0,5)||'',allDay:String(event?.all_day||false),
    eventEndDate:event?eventEndDate(event):localDate(),location:event?.location||'',notes:event?.notes||'',assignee:event?.assignee_id||''};
  Object.entries(values).forEach(([id,value])=>$('#'+id).value=value);
  $('#blocksTime').checked=event?.blocks_time!==false;
  fillEventCalendars(event);
  $('#assigneeAll').checked=!!event?.assignee_all;
  $$('#assigneePeople input').forEach(input=>{input.checked=!event?.assignee_all&&assignmentIds(event||{},'assignee').includes(input.value);input.disabled=false;});
  (event?.reminders??[member.default_reminder_minutes??15]).forEach(addReminder);
  const recurrence=series.find(s=>s.id===event?.series_id);
  $('#recurrence').value=recurrence?.recurrence||'none';
  $('#recurrenceEnd').value=recurrence?.ends_on||'';
  $$('#weekdayChoices input').forEach(input=>{input.checked=recurrence?.selected_weekdays?.includes(Number(input.value))||false;input.disabled=!!event;});
  $('#weekdayChoices').classList.toggle('hidden',$('#recurrence').value!=='custom');
  $('#recurrence').disabled=Boolean(event); $('#recurrenceEnd').disabled=Boolean(event);
  $('#seriesInfo').textContent=event?.series_id?'Rhythmus und Serienende sind hier schreibgeschützt. Einzelne Termine, Datum, Zeiten und Zuständigkeiten können geändert werden.':
    event?'Ein bestehender Einzeltermin bleibt ein Einzeltermin. Für eine neue Serie bitte einen neuen Termin anlegen.':'Ohne Enddatum wird die Serie für ein Jahr angelegt (maximal zwei Jahre).';
  $('#saveEvent').disabled=!allowed||!!event?.is_cancelled;$('#saveEvent').textContent='Speichern';
  if(event?.event_type==='vacation')$('#seriesInfo').textContent='Vorhandene Urlaubsabsagen bleiben bei einer Änderung des Zeitraums erhalten. Über die Terminkarte kannst du sie ausdrücklich rückgängig machen.';
  if(!allowed) $('#seriesInfo').textContent='Du kannst diesen Termin ansehen, aber nicht bearbeiten.';
  toggleAllDay();updateAutomaticCalendars(); $('#eventDialog').showModal();
}
function payload() {
  const allDay=$('#allDay').value==='true';
  return {family_id:member.family_id,event_type:$('#eventType').value,title:$('#eventTitle').value.trim(),event_date:$('#eventDate').value,
    calendar_ids:$$('#eventCalendars input:checked').map(x=>x.value),blocks_time:$('#blocksTime').checked,
    end_date:$('#eventEndDate').value,assignee_all:$('#assigneeAll').checked,expected_updated_at:editingStamp,
    assignments:$$('#assigneePeople input:checked').map(x=>({role:'assignee',person_id:x.value})),
    start_time:allDay?null:$('#startTime').value||null,end_time:allDay?null:$('#endTime').value||null,all_day:allDay,
    location:$('#location').value.trim(),notes:$('#notes').value.trim(),
    reminders:[...new Set($$('#reminders input').map(x=>Number(x.value)))]};
}
function validateEvent(data) {
  if(!data.title) throw new Error('Bitte einen Titel eingeben');
  if(!data.end_date||data.end_date<data.event_date)throw new Error('Das Enddatum muss am oder nach dem Startdatum liegen.');
  if(!data.all_day&&(!data.start_time||!data.end_time))throw new Error('Start- und Endzeit sind Pflicht.');
  if(!data.all_day&&new Date(data.end_date+'T'+data.end_time)-new Date(data.event_date+'T'+data.start_time)<60000)throw new Error('Ein Termin muss mindestens eine Minute dauern.');
  if(calendars.length&&!data.calendar_ids.length)throw new Error('Bitte einen Kalender wählen.');
  if(data.end_time&&(!data.start_time||(data.end_date===data.event_date&&data.end_time<data.start_time))) throw new Error('Ende liegt vor Anfang. Für einen Termin über Nacht das Enddatum auf den nächsten Tag setzen.');
  if($('#recurrence').value==='custom'&&!$$('#weekdayChoices input:checked').length)throw new Error('Bitte mindestens einen Wochentag wählen.');
  if(data.reminders.some(n=>!Number.isInteger(n)||n<0||n>10080)) throw new Error('Erinnerungen: ganze Minuten von 0 bis 10080');
}
function askScope(action) {
  pendingScope=action;
  $$('#scopeDialog [data-scope]').forEach(b=>b.disabled=!admin()&&['series','following'].includes(b.dataset.scope));
  $('#scopeDialog').showModal();
}
async function done() {
  if($('#vacationDialog').open)$('#vacationDialog').close();pendingVacation=null;
  $('#eventDialog').close(); if($('#scopeDialog').open) $('#scopeDialog').close();
  toast('Gespeichert'); await refreshAll();
}
async function saveEvent(event) {
  event.preventDefault();
  $('#eventDialog .dialog-notice')?.remove();
  await busy($('#saveEvent'),async()=>{
    const data=payload(),id=$('#eventId').value,seriesId=$('#seriesId').value;
    validateEvent(data);
    if(data.event_type==='vacation'&&!id)return vacationPreview(data);
    const save=async scope=>{const saved=check(await sb.rpc('save_calendar_event_v170',{p_event:data,p_id:id||null,p_scope:scope,p_recurrence:id?'none':$('#recurrence').value,p_until:$('#recurrenceEnd').value||null,p_weekdays:$$('#weekdayChoices input:checked').map(x=>Number(x.value))}));if(!saved)throw new Error('Nicht gespeichert: Keine Bestätigung vom Server.');await done();};
    if(id&&seriesId)return askScope(save);
    return save('single');
  });
}
async function deleteEvent() {
  if(!confirm('Termin wirklich absagen? Er bleibt erhalten und kann wiederhergestellt werden.')) return;
  await busy($('#deleteEvent'),async()=>{
    const id=$('#eventId').value;
    if($('#seriesId').value) return askScope(async scope=>{
      check(await sb.rpc('calendar_cancel_v170',{p_id:id,p_scope:scope,p_cancel:true})); await done();
    });
    check(await sb.rpc('calendar_cancel_v170',{p_id:id,p_scope:'single',p_cancel:true}));
    await done();
  });
}
function renderAdmin() {
  $('#adminContent').innerHTML='<h2>Administration</h2><div class="admin-grid"><div class="card"><h3>Familienmitglieder</h3><div id="memberList"></div></div>'+
    '<div class="card"><h3>Mitglied einladen</h3><p>Einmaliger Einladungslink, maximal eine Stunde gültig. Du gibst ihn persönlich weiter; es wird keine E-Mail versendet.</p><label>Kalender<select id="inviteCalendar">'+calendars.filter(c=>c.is_active&&!profiles.find(p=>p.id===c.person_id)?.linked_user_id).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.display_name)+'</option>').join('')+'</select></label><label>E-Mail der Person<input id="inviteEmail" type="email" maxlength="254" placeholder="oma@example.de"></label><button id="makeInvite" class="primary">Einladungslink erstellen</button><div id="inviteResult"></div></div></div>';
  renderCalendarAdmin();
  $('#memberList').innerHTML=members.map(m=>'<div class="member"><span class="dot" style="background:'+safeColor(m.color)+'"></span><main><b>'+esc(m.display_name)+'</b><small>'+esc({owner:'Eigentümer',admin:'Administrator',member:'Mitglied'}[m.role])+'</small></main>'+
    (member.role==='owner'||m.role==='member'?'<button data-edit-member="'+esc(m.user_id)+'">Bearbeiten</button>':'')+
    ((m.role==='member'||m.user_id===user.id||(member.role==='owner'&&m.role==='admin'))?'<button data-reset-member="'+esc(m.user_id)+'">Reset-Link</button>':'')+'</div>').join('');
  $('#memberList').insertAdjacentHTML('afterend','<h3>Testmitglieder ohne Anmeldung</h3><p class="small">Nur für Farben und Zuordnungen; kein Login und keine Berechtigungen.</p>'+testMembers.map(m=>'<div class="member"><span class="dot" style="background:'+safeColor(m.color)+'"></span><main>'+esc(m.display_name)+'</main><button type="button" data-test-edit="'+esc(m.id)+'">Bearbeiten</button></div>').join('')+'<button type="button" id="createTestMember" class="secondary">Testmitglied in Pink hinzufügen</button>');
  $('#createTestMember').onclick=()=>busy($('#createTestMember'),async()=>{check(await sb.rpc('manage_test_member',{p_name:'Test',p_color:'#ff69b4'}));await refreshAll();});
  $$('[data-test-edit]').forEach(button=>button.onclick=()=>editTestMember(button.dataset.testEdit));
  $('#makeInvite').onclick=()=>busy($('#makeInvite'),async()=>{
    if(!$('#inviteEmail').reportValidity()||!$('#inviteEmail').value.trim()) throw new Error('Bitte eine gültige E-Mail eingeben');
    const email=$('#inviteEmail').value.trim(), result=await requestAccessLink(sb,'invite',email,$('#inviteCalendar').value);
    showAccessResult($('#inviteResult'),result);
  });
  $$('[data-edit-member]').forEach(b=>b.onclick=()=>editMember(b.dataset.editMember));
  $$('[data-reset-member]').forEach(b=>b.onclick=()=>busy(b,async()=>{
    const target=members.find(m=>m.user_id===b.dataset.resetMember);
    if(!confirm('Reset-Link für '+target.display_name+' erstellen? Der Link ermöglicht Zugang zu diesem Konto und darf nur dieser Person übergeben werden.'))return;
    const result=await requestAccessLink(sb,'recovery',target.user_id);
    showAccessResult($('#inviteResult'),result);
  }));
}
function editTestMember(id) {
 const target=testMembers.find(m=>m.id===id);if(!target||!admin())return;
 $('#settingsHeading').textContent='Testmitglied';
 $('#settingsContent').innerHTML='<label>Name<input id="testName" maxlength="80" value="'+esc(target.display_name)+'"></label>'+colorField('testColor','Farbe',target.color)+'<button type="button" id="saveTestMember" class="primary">Speichern</button><button type="button" id="removeTestMember" class="danger-btn">Testmitglied entfernen</button><p class="small">Termine bleiben erhalten. Nur die Zuordnungen zu diesem Testmitglied werden entfernt.</p>';
 $('#saveTestMember').onclick=()=>busy($('#saveTestMember'),async()=>{check(await sb.rpc('manage_test_member',{p_id:id,p_name:$('#testName').value.trim(),p_color:$('#testColor').value}));$('#settingsDialog').close();await refreshAll();});
 $('#removeTestMember').onclick=()=>busy($('#removeTestMember'),async()=>{if(!confirm('Testmitglied '+target.display_name+' entfernen und seine Zuordnungen lösen? Termine und andere Zuständige bleiben erhalten.'))return;check(await sb.rpc('manage_test_member',{p_id:id,p_remove:true}));$('#settingsDialog').close();await refreshAll();});
 $('#settingsDialog').showModal();
}
async function vacationPreview(data) {
 if(!admin())throw new Error('Urlaub mit Terminprüfung benötigt Administratorrechte.');
 const rows=(await fetchEvents(data.event_date,data.end_date,member.family_id)).filter(e=>!e.is_cancelled&&eventsOverlap(e,data)&&(e.calendar_links||[]).some(l=>data.calendar_ids.includes(l.calendar_id)));
 pendingVacation={data,rows,selected:[]};
 $('#vacationRange').textContent=data.title+' · '+data.event_date+' bis '+data.end_date;
 const groups=new Map();for(const event of rows){const key=event.series_id||event.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);}
 $('#vacationChoices').innerHTML=rows.length?[...groups].map(([key,list])=>'<fieldset><legend>'+esc(list[0].title)+(list[0].series_id?' · Serie':'')+'</legend>'+(list.length>1?'<label class="checkbox-label"><input type="checkbox" data-vacation-group="'+esc(key)+'">Alle '+list.length+' Vorkommen in dieser Auswahl</label>':'')+list.map(e=>'<label class="checkbox-label"><input type="checkbox" data-vacation-id="'+esc(e.id)+'" data-group="'+esc(key)+'">'+esc(e.event_date)+' '+esc(cardTime(e))+' · '+esc(e.title)+'</label>').join('')+'</fieldset>').join(''):'<p>Keine aktiven Termine überschneiden sich mit dem Urlaub.</p>';
 $$('[data-vacation-group]').forEach(input=>input.onchange=()=>$$('[data-vacation-id]').filter(x=>x.dataset.group===input.dataset.vacationGroup).forEach(x=>x.checked=input.checked));
 $('#vacationChoices').classList.remove('hidden');$('#vacationNext').classList.remove('hidden');$('#vacationReview').classList.add('hidden');$('#vacationBack').classList.add('hidden');$('#vacationSave').classList.add('hidden');$('#vacationDialog .dialog-notice')?.remove();$('#vacationDialog').showModal();
}
function bindVacation() {
 $('#vacationNext').onclick=()=>{if(!pendingVacation)return;const ids=$$('[data-vacation-id]:checked').map(x=>x.dataset.vacationId);pendingVacation.selected=pendingVacation.rows.filter(e=>ids.includes(e.id));$('#vacationReview').innerHTML='<h3>Bestätigung</h3><p>Urlaub: '+esc(pendingVacation.data.title)+' · '+esc(pendingVacation.data.event_date)+' bis '+esc(pendingVacation.data.end_date)+'</p><p>'+pendingVacation.selected.length+' Termine werden abgesagt. Alle anderen bleiben erhalten.</p><ul>'+pendingVacation.selected.map(e=>'<li>'+esc(e.event_date)+' · '+esc(e.title)+'</li>').join('')+'</ul>';$('#vacationReview').classList.remove('hidden');$('#vacationChoices').classList.add('hidden');$('#vacationNext').classList.add('hidden');$('#vacationBack').classList.remove('hidden');$('#vacationSave').classList.remove('hidden');$('#vacationSave').textContent=pendingVacation.selected.length?'Urlaub speichern und '+pendingVacation.selected.length+' Termine absagen':'Urlaub speichern';};
 $('#vacationBack').onclick=()=>{$('#vacationChoices').classList.remove('hidden');$('#vacationNext').classList.remove('hidden');$('#vacationReview').classList.add('hidden');$('#vacationBack').classList.add('hidden');$('#vacationSave').classList.add('hidden');};
 $('#vacationSave').onclick=()=>busy($('#vacationSave'),async()=>{if(!pendingVacation)throw new Error('Bitte Vorschau erneut öffnen.');check(await sb.rpc('save_calendar_event_v170',{p_event:pendingVacation.data,p_cancel:pendingVacation.selected.map(e=>({id:e.id,updated_at:e.updated_at}))}));await done();});
 $('#vacationDialog').addEventListener('close',()=>{pendingVacation=null;});
}
function showAccessResult(root,result) {
  root.innerHTML='<p>'+esc(result.message)+'</p><label>Persönlicher Link<input type="text" readonly class="access-link"></label><button type="button" class="secondary">Link kopieren</button>';
  root.querySelector('input').value=result.url;
  root.querySelector('button').onclick=async()=>{
    try{await navigator.clipboard.writeText(result.url);toast('Link kopiert');}
    catch{root.querySelector('input').select();toast('Bitte den markierten Link kopieren');}
  };
}
function editMember(id) {
  const target=members.find(m=>m.user_id===id),owner=member.role==='owner';
  $('#settingsHeading').textContent='Mitglied bearbeiten';
  $('#settingsContent').innerHTML='<label>Name<input id="mName" maxlength="80" value="'+esc(target.display_name)+'"></label>'+colorField('mColor','Farbe',target.color)+
    '<label>Rolle<select id="mRole"><option value="member">Mitglied</option>'+(owner?'<option value="admin">Administrator</option><option value="owner">Eigentümer</option>':'')+'</select></label><button id="saveMember" class="primary">Speichern</button>';
  $('#mRole').value=target.role; $('#mRole').disabled=!owner;
  $('#saveMember').onclick=()=>busy($('#saveMember'),async()=>{
    check(await sb.rpc('admin_update_member',{p_user_id:id,p_role:$('#mRole').value,p_color:$('#mColor').value,p_display_name:$('#mName').value.trim()}));
    $('#settingsDialog').close(); await refreshAll();
  });
  $('#settingsDialog').showModal();
}
async function updateProfile(data) {
  const rows=check(await sb.from('family_members').update(data).eq('family_id',member.family_id).eq('user_id',user.id).select('user_id'));
  if(rows.length!==1) throw new Error('Profil konnte nicht gespeichert werden');
  await loadMembership();
}
function openSettings(action) {
  if(action==='install') return toast('iPhone: In Safari öffnen → Teilen → Zum Home-Bildschirm.');
  $('#settingsDialog').showModal();
  if(action==='project') {
    $('#settingsHeading').textContent='Projekt & offene Punkte';
    const root=document.createElement('div'), family=member.family_id, userId=user.id;
    $('#settingsContent').replaceChildren(root);
    mountProjectList(root,sb,family,()=>member?.family_id===family&&user?.id===userId&&root.parentNode===$('#settingsContent')&&$('#settingsDialog').open);
  } else if(action==='notifications') {
    $('#settingsHeading').textContent='Benachrichtigungen';
    $('#settingsContent').innerHTML='<div id="pushSettings"></div>'+
      '<label>Standard-Vorlauf in Minuten<input id="defaultReminder" type="number" min="0" max="10080" step="1" value="'+member.default_reminder_minutes+'"></label>'+
      '<label class="checkbox-label"><input id="notifyAssignments" type="checkbox" '+(member.notify_assignments?'checked':'')+'> Neue eigene Aufgaben melden (vorbereitet)</label>'+
      '<label class="checkbox-label"><input id="notifyChanges" type="checkbox" '+(member.notify_changes?'checked':'')+'> Änderungen melden (vorbereitet)</label><button id="saveNotify" class="primary">Einstellungen speichern</button>';
    const pushRoot=$('#pushSettings'), pushUser=user.id;
    mountPushSettings(pushRoot,sb,pushUser,cfg.VAPID_PUBLIC_KEY,()=>user?.id===pushUser&&pushRoot.parentNode===$('#settingsContent')&&$('#settingsDialog').open);
    $('#saveNotify').onclick=()=>busy($('#saveNotify'),async()=>{
      const minutes=Number($('#defaultReminder').value);
      if(!Number.isInteger(minutes)||minutes<0||minutes>10080) throw new Error('Bitte ganze Minuten von 0 bis 10080 eingeben');
      await updateProfile({default_reminder_minutes:minutes,notify_assignments:$('#notifyAssignments').checked,notify_changes:$('#notifyChanges').checked});
      $('#settingsDialog').close(); toast('Gespeichert');
    });
  } else {
    $('#settingsHeading').textContent='Mein Profil';
    $('#settingsContent').innerHTML='<p class="app-version small">Famkal '+APP_VERSION+'</p><label>Name<input id="profileName" maxlength="80" value="'+esc(member.display_name)+'"></label>'+colorField('profileColor','Farbe',member.color)+'<button id="saveProfile" class="primary">Speichern</button><hr><button id="showProject" type="button">Projekt & offene Punkte</button>';
    $('#showProject').onclick=()=>openSettings('project');
    $('#saveProfile').onclick=()=>busy($('#saveProfile'),async()=>{
      await updateProfile({display_name:$('#profileName').value.trim(),color:$('#profileColor').value});
      $('#settingsDialog').close(); toast('Gespeichert');
    });
  }
}
function colorField(id,label,value) {
 return '<label>'+esc(label)+'<span class="color-control"><input id="'+esc(id)+'" type="color" value="'+safeColor(value)+'" aria-label="'+esc(label)+' wählen"></span></label>';
}
function renderAccessLanding(link=accessLink,error='') {
 const active=!!link||!!error,invite=link?.kind==='invite';
 $('#authForm').classList.toggle('hidden',active);
 $('#forgotPassword').classList.toggle('hidden',active);
 $('#newAccountInfo').classList.toggle('hidden',active);
 $('#inviteLinkBox').classList.toggle('hidden',!active);
 $('#authHeading').textContent=error?'Link nicht verfügbar':active?(invite?'Einladung annehmen':'Passwort zurücksetzen'):'Leonhards Kalender';
 $('#authIntro').textContent=active?(error?'Bitte deinen Familien-Admin um einen neuen persönlichen Link.':invite?'Willkommen beim Familienkalender.':'Lege ein neues Passwort für dein Konto fest.'):'Gemeinsame Termine, Fahrdienste und Erinnerungen.';
 $('#accessInstructions').textContent=invite?'Tippe auf „Einladung annehmen“ und lege danach dein eigenes Passwort fest. Anschließend erhältst du Zugang zum Familienkalender.':'Tippe auf „Neues Passwort festlegen“, um deinen persönlichen Reset-Link zu verwenden.';
 $('#redeemLink').textContent=invite?'Einladung annehmen':'Neues Passwort festlegen';
 $('#redeemLink').classList.toggle('hidden',!!error);
 $('#accessInstructions').classList.toggle('hidden',!!error);
 $('#authInfo').textContent=error;
 $('#authInfo').classList.toggle('danger',!!error);
}
function bindUI() {
  $('#authForm').onsubmit=e=>{e.preventDefault(); busy($('#authSubmit'),async()=>{
    const email=$('#email').value.trim(), password=$('#password').value;
    const result=await sb.auth.signInWithPassword({email,password});
    const data=check(result); $('#password').value='';
    $('#authInfo').textContent='';
    if(data.session) { user=data.user; await loadMembership(); }
  }); };
  $('#forgotPassword').onclick=()=>busy($('#forgotPassword'),async()=>{
    const input=$('#email');
    if(!input.reportValidity()) {$('#authInfo').textContent='Bitte zuerst deine Famkal-E-Mail-Adresse eintragen.';return;}
    let last=0;try{last=Number(sessionStorage.getItem('famkal-recovery-requested-at'))||0;}catch{}
    if(Date.now()-last<60000) {$('#authInfo').textContent='Bitte mindestens eine Minute warten, bevor du erneut eine Recovery-Mail anforderst. Prüfe auch deinen Spam-Ordner.';return;}
    $('#authInfo').textContent='Recovery-Mail wird angefordert …';
    try {
      const message=await requestRecoveryEmail(sb,input.value.trim());
      try{sessionStorage.setItem('famkal-recovery-requested-at',String(Date.now()));}catch{}
      $('#authInfo').textContent=message;
    }catch(error){$('#authInfo').textContent=errorText(error);}
  });
  $('#redeemLink').onclick=()=>busy($('#redeemLink'),async()=>{
    if(!accessLink)throw new Error('Bitte einen neuen Link beim Admin anfordern');
    $('#authInfo').textContent='';$('#authInfo').classList.remove('danger');
    let data;try{data=await redeemAccessLink(sb,accessLink);}catch(error){$('#authInfo').textContent=errorText(error);$('#authInfo').classList.add('danger');throw error;}user=data.user;
    pendingFamilyCode=accessLink.familyCode;recovery=true;
    $('#passwordForm').reset();$('#passwordHeading').textContent=accessLink.kind==='invite'?'Dein Passwort festlegen':'Neues Passwort';
    if(!$('#passwordDialog').open)$('#passwordDialog').showModal();
  });
  $('#passwordForm').onsubmit=e=>{e.preventDefault(); busy($('#savePassword'),async()=>{
    if($('#newPassword').value!==$('#confirmPassword').value) throw new Error('Die Passwörter stimmen nicht überein');
    if($('#newPassword').value.length<12)throw new Error('Mindestens zwölf Zeichen erforderlich');
    check(await sb.auth.updateUser({password:$('#newPassword').value}));
    if(pendingFamilyCode) {check(await sb.rpc('join_family',{p_code:pendingFamilyCode}));pendingFamilyCode=null;}
    $('#passwordForm').reset(); $('#passwordDialog').close(); recovery=false;
    accessLink=null;$('#inviteLinkBox').classList.add('hidden');
    history.replaceState(null,'',location.pathname); toast('Passwort geändert'); await loadMembership();
  }); };
  $('#cancelPassword').onclick=()=>busy($('#cancelPassword'),async()=>{check(await sb.auth.signOut());accessLink=null;pendingFamilyCode=null;recovery=false;$('#passwordForm').reset();clearSession();history.replaceState(null,'',location.pathname);});
  $('#joinFamilyBtn').onclick=()=>busy($('#joinFamilyBtn'),async()=>{check(await sb.rpc('join_family',{p_code:$('#inviteCode').value.trim()}));await loadMembership();});
  const logout=button=>busy(button,async()=>{try{await disablePushDevice(sb);}catch{/* Sign-out still revokes the session if push cleanup fails. */}check(await sb.auth.signOut());clearSession();});
  $('#logout').onclick=()=>logout($('#logout')); $('#onboardingLogout').onclick=()=>logout($('#onboardingLogout'));
  $$('nav [data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
  $('#availabilityInfo').onclick=()=>{ $('#settingsHeading').textContent='Verfügbarkeit';$('#settingsContent').innerHTML='<p>Ohne eingetragenen Termin ist eine Person nicht automatisch bestätigt verfügbar. Die Kalender zeigen nur die erfassten Termine.</p><p>Termine mit „Belegt diese Zeit“ markieren eine Belegung; Hinweise belegen keine Zeit. Abgesagte Termine zählen nicht als Belegung.</p>';$('#settingsDialog').showModal(); };
  $('#add').onclick=()=>openEvent(); $('#avatar').onclick=()=>openSettings('profile');
  $('#refresh').onclick=()=>busy($('#refresh'),refreshAll);
  const changeWeek=async delta=>{weekOffset+=delta; $('#weekList').innerHTML='<div class="empty">Termine werden geladen …</div>'; try{await refreshAll();}catch(error){$('#weekList').innerHTML='<div class="empty">Termine konnten nicht geladen werden. Bitte aktualisieren.</div>';toast(errorText(error));}};
  $('#prevWeek').onclick=()=>changeWeek(-1); $('#nextWeek').onclick=()=>changeWeek(1);
  $('#addReminder').onclick=()=>addReminder(); $('#allDay').onchange=toggleAllDay;
  $('#eventForm').addEventListener('change',updateAutomaticCalendars);
  $('#eventForm').onsubmit=saveEvent; $('#deleteEvent').onclick=deleteEvent;
  $$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
  $('#scopeDialog').addEventListener('close',()=>{pendingScope=null;});
  $$('#scopeDialog [data-scope]').forEach(b=>b.onclick=()=>{
    if(b.dataset.scope==='cancel') { pendingScope=null; $('#scopeDialog').close(); return; }
    return busy(b,async()=>{
    const action=pendingScope;
    if(b.dataset.scope==='cancel') { pendingScope=null; $('#scopeDialog').close(); return; }
    if(!action) return;
    $$('#scopeDialog button').forEach(x=>x.disabled=true);
    try { await action(b.dataset.scope); }
    finally { if($('#scopeDialog').open) $$('#scopeDialog [data-scope]').forEach(x=>x.disabled=!admin()&&['following','series'].includes(x.dataset.scope)); }
    });
  });
  $$('[data-filter]').forEach(b=>b.onclick=()=>{calendarFilter=taskFilter=b.dataset.filter;taskLimit=50;upcomingLimit=5;syncFilters();renderToday();renderWeek();renderTasks();renderFamily();});
  $('#assigneeAll').onchange=()=>{if($('#assigneeAll').checked)$$('#assigneePeople input').forEach(x=>x.checked=false);};
  $('#assigneePeople').addEventListener('change',e=>{if(e.target.matches('input[type=checkbox]')&&e.target.checked)$('#assigneeAll').checked=false;});
  $('#recurrence').onchange=()=>$('#weekdayChoices').classList.toggle('hidden',$('#recurrence').value!=='custom');
  $('#eventType').onchange=()=>{const type=$('#eventType').value,id=$('#eventId').value;if(!id){if(type==='bedtime'){$('#eventEndDate').value=localDate(addDays(dateAtNoon($('#eventDate').value),1));if(!$('#startTime').value)$('#startTime').value='20:00';if(!$('#endTime').value)$('#endTime').value='06:00';}if(type==='vacation'){$('#allDay').value='true';$('#recurrence').value='none';$('#weekdayChoices').classList.add('hidden');toggleAllDay();}}$('#recurrence').disabled=!!id||type==='vacation';$('#recurrenceEnd').disabled=!!id||type==='vacation';$('#saveEvent').textContent=type==='vacation'&&!id?'Nächster Schritt':'Speichern';};
  $('#eventDate').onchange=()=>{if($('#eventEndDate').value<$('#eventDate').value)$('#eventEndDate').value=$('#eventDate').value;};
  $('#calendarPicker').onclick=()=>{$('#calendarPickerDialog').showModal();updateCalendarPicker();};
  $('#showAllCalendars').onclick=()=>setCalendarSelection(calendars.filter(c=>c.is_active).map(c=>c.id));
  $('#showMyCalendar').onclick=()=>setCalendarSelection(calendars.filter(c=>c.person_id===myPersonId()).map(c=>c.id));
  $('#familyDay').onchange=()=>changeFamilyDay($('#familyDay').value);
  $('#prevFamilyDay').onclick=()=>changeFamilyDay(localDate(addDays(dateAtNoon(familyDay),-1)));
  $('#nextFamilyDay').onclick=()=>changeFamilyDay(localDate(addDays(dateAtNoon(familyDay),1)));
  $('#familyToday').onclick=()=>changeFamilyDay(localDate());
  bindVacation();
  $('#moreUpcoming').onclick=()=>{upcomingLimit+=10;renderToday();};
  $('#moreTasks').onclick=()=>{taskLimit+=50;renderTasks();};
  $$('#moreView [data-action]').forEach(b=>b.onclick=()=>openSettings(b.dataset.action));
}
async function setupPwa() {
  if(!('serviceWorker' in navigator)) return;
  try {
    const reg=await navigator.serviceWorker.register('./service-worker.js');
    const offerUpdate=()=>{
      if(!reg.waiting||!navigator.serviceWorker.controller) return;
      $('#updateApp').classList.remove('hidden');
      $('#updateApp').onclick=()=>{ $$('dialog[open]').forEach(d=>d.close()); reg.waiting.postMessage({type:'SKIP_WAITING'}); };
    };
    offerUpdate();
    reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offerUpdate));
    navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());
    await reg.update();
  } catch { console.warn('PWA-Registrierung fehlgeschlagen'); }
}
async function start() {
  connectionStatus(); window.addEventListener('offline',connectionStatus);
  window.addEventListener('online',()=>{connectionStatus();if(member)refreshAll().catch(e=>toast(errorText(e)));});
  try {
    sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{detectSessionInUrl:false}});
    bindUI();
    try { accessLink=parseAccessLink(location.hash); }
    catch(error) { history.replaceState(null,'',location.pathname);show('auth');renderAccessLanding(null,errorText(error));setupPwa();return; }
    if(accessLink)history.replaceState(null,'',location.pathname);
    sb.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY') recovery=true;
      // Supabase callbacks must not await other auth methods while its lock is held.
      setTimeout(()=>{
        if(!session) { if(!accessLink)clearSession(); return; }
        const changed=user?.id!==session.user.id; user=session.user;
        if(accessLink)return;
        if(initialized&&(changed||event==='SIGNED_IN')) loadMembership().catch(e=>toast(errorText(e)));
      },0);
    });
    const data=check(await sb.auth.getSession());
    if(accessLink){show('auth');renderAccessLanding();}
    else if(data.session) {
      user=data.session.user;
      await loadMembership();
    } else show('auth');
    initialized=true;
  } catch(error) { $('#authInfo').textContent=errorText(error); toast(errorText(error)); }
  setupPwa();
}
function setCalendarSelection(ids) {
 selectedCalendars=ids;try{localStorage.setItem('famkal-calendars-'+user.id,JSON.stringify(ids));}catch{}
 updateCalendarPicker();renderToday();renderWeek();renderTasks();renderFamily();
}
function updateCalendarPicker() {
 if(!$('#calendarPicker'))return;
 $('#calendarPicker').textContent='Kalender · '+(selectedCalendars?.length??calendars.filter(c=>c.is_active).length);
 $('#calendarChoices').innerHTML=calendars.map(c=>'<label class="checkbox-label"><input type="checkbox" value="'+esc(c.id)+'" '+(selectedCalendars?.includes(c.id)?'checked':'')+'>'+esc(c.display_name)+(c.is_active?'':' · archiviert')+'</label>').join('');
 $$('#calendarChoices input').forEach(x=>x.onchange=()=>setCalendarSelection($$('#calendarChoices input:checked').map(x=>x.value)));
 $('#showMyCalendar').disabled=!calendars.some(c=>c.person_id===myPersonId());
}
function updateAutomaticCalendars() {
 const bedtime=$('#eventType').value==='bedtime';$('#bedtimeAssignmentInfo').classList.toggle('hidden',!bedtime);$('#calendarDisplayHint').textContent=bedtime?'Bettgehzeit erscheint nur in Leos Kalender.':'Zuständige sehen den Termin automatisch auch in ihrem Kalender.';
 const explicit=$$('#eventCalendars input:checked').map(x=>x.value);
 const event={calendar_links:explicit.map(calendar_id=>({calendar_id})),assignee_all:$('#assigneeAll').checked,
  assignments:$$('#assigneePeople input:checked').map(x=>({role:'assignee',person_id:x.value}))};
 const extra=displayCalendarIds(event).filter(id=>!explicit.includes(id)).map(id=>calendars.find(c=>c.id===id)?.display_name).filter(Boolean);
 $('#automaticCalendars').textContent=!bedtime&&extra.length?'Automatisch auch in: '+extra.join(', '):'';
 $('#calendarDisplayHint').classList.toggle('hidden',!bedtime&&extra.length>0);
}
function fillEventCalendars(event) {
 const own=calendars.find(c=>c.person_id===myPersonId()&&c.is_active),defaultCalendar=own||calendars.find(c=>c.allow_family_create&&c.is_active);
 const selected=event?(event.calendar_links||[]).map(l=>l.calendar_id):defaultCalendar?[defaultCalendar.id]:[];
 $('#eventCalendars').innerHTML=calendars.filter(c=>c.is_active||selected.includes(c.id)).map(c=>'<label class="checkbox-label"><input type="checkbox" value="'+esc(c.id)+'" '+(selected.includes(c.id)?'checked':'')+' '+(member?.role==='owner'||c.person_id===myPersonId()||c.allow_family_create?'':'disabled')+'>'+esc(c.display_name)+(c.is_active?'':' · archiviert')+'</label>').join('');
}
async function changeFamilyDay(day) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
 familyDay=day;const today=dateAtNoon(localDate());const distance=Math.round((dateAtNoon(day)-today)/86400000);
 weekOffset=Math.floor((distance+((today.getDay()+6)%7))/7);await busy(null,refreshAll);
}
function renderFamily() {
 const root=$('#familyBoard');if(!root)return;$('#familyDay').value=familyDay;
 const visible=calendars.filter(c=>selectedCalendars?.includes(c.id));
 if(!visible.length){root.innerHTML='<div class="empty">Bitte Kalender einblenden.</div>';return;}
 const filtered=filterEvents(events,calendarFilter,myPersonId());
 let html='<div class="family-scroll" tabindex="0" aria-label="Familienkalender, ausgewählte Kalender nebeneinander, vertikal verschiebbar"><div class="family-grid" style="--columns:'+visible.length+'"><div class="family-corner">Zeit</div>'+visible.map(c=>'<div class="family-column-heading"><strong>'+esc(c.display_name)+'</strong>'+(c.is_active?'':'<small>Archiviert</small>')+'</div>').join('');
 const hasAllDay=filtered.some(e=>e.all_day&&eventOnDay(e,familyDay)&&displayCalendarIds(e).some(id=>visible.some(c=>c.id===id)));
 if(hasAllDay)html+='<div class="family-allday-label" aria-label="Ganztägig">Tag</div>'+visible.map(c=>{const list=filtered.filter(e=>e.all_day&&eventOnDay(e,familyDay)&&displayCalendarIds(e).includes(c.id));return '<div class="family-allday">'+list.map(e=>'<button type="button" data-family-event="'+esc(e.id)+'" class="family-all-event" style="--assignment:'+assignmentColors(e,allPeople())+'" aria-label="'+esc(e.title+' · Ganztägig')+'"><span class="family-event-icon" aria-hidden="true">'+typeIcon(e.event_type)+'</span><strong>'+esc(e.title)+'</strong></button>').join('')+'</div>';}).join('');
 html+='<div class="family-hours">'+Array.from({length:24},(_,i)=>'<span style="top:'+i*48+'px">'+String(i).padStart(2,'0')+':00</span>').join('')+'</div>';
 html+=visible.map(c=>{
  const rows=layoutDayEvents(filtered.filter(e=>!e.all_day&&eventOnDay(e,familyDay)&&displayCalendarIds(e).includes(c.id)),familyDay);
  return '<div class="family-day-column">'+rows.map(({event:e,start,end,lane,lanes})=>'<button type="button" class="family-time-event'+(e.blocks_time===false?' time-hint':'')+(e.is_cancelled?' cancelled':'')+'" data-family-event="'+esc(e.id)+'" style="top:'+start*.8+'px;height:'+Math.max(.8,(end-start)*.8)+'px;left:calc('+lane*100/lanes+'% + 3px);width:calc('+100/lanes+'% - 6px);--assignment:'+assignmentColors(e,allPeople())+'" aria-label="'+esc(c.display_name+' · '+e.title+' · '+cardTime(e,familyDay))+'"><span class="family-event-meta"><span class="family-event-icon" aria-hidden="true">'+typeIcon(e.event_type)+'</span><small>'+esc(start===0&&e.event_date<familyDay?'00:00':e.start_time?.slice(0,5))+'</small></span><strong>'+esc(e.title)+'</strong>'+'</button>').join('')+'</div>';
 }).join('')+'</div></div>';
 const old=root.querySelector('.family-scroll');const y=old?.scrollTop??330;
 root.innerHTML=html;const scroll=root.querySelector('.family-scroll');scroll.scrollTop=y;
 $$('[data-family-event]').forEach(b=>b.onclick=()=>{const e=events.find(e=>e.id===b.dataset.familyEvent);if(e)openEventSummary(e);});
}
function renderCalendarAdmin() {
 if(member?.role!=='owner')return;
 $('#adminContent').insertAdjacentHTML('afterbegin','<div class="card"><h2>Kalender verwalten</h2><p class="small">Personen ohne Login sind sofort nutzbar. Einladungen verbinden später den vorhandenen Kalender.</p>'+calendars.map(c=>'<div class="member"><main><b>'+esc(c.display_name)+'</b><small>'+(profiles.find(p=>p.id===c.person_id)?.linked_user_id?'Konto verknüpft':'Ohne Login')+(c.is_active?'':' · archiviert')+'</small></main><button type="button" data-calendar-edit="'+esc(c.id)+'">Bearbeiten</button></div>').join('')+'<button type="button" id="newCalendar" class="secondary">+ Kalender hinzufügen</button></div>');
 $('#newCalendar').onclick=()=>editCalendar();$$('[data-calendar-edit]').forEach(b=>b.onclick=()=>editCalendar(b.dataset.calendarEdit));
}
function editCalendar(id=null) {
 const c=calendars.find(c=>c.id===id),p=profiles.find(p=>p.id===c?.person_id);
 $('#settingsHeading').textContent=c?'Kalender verwalten':'Kalender hinzufügen';
 $('#settingsContent').innerHTML='<label>Anzeigename<input id="calName" maxlength="80" required value="'+esc(c?.display_name||'')+'"></label>'+colorField('calColor','Personenfarbe',p?.color||'#819b61')+'<label>Reihenfolge<input id="calOrder" type="number" step="1" value="'+(c?.sort_order??calendars.length)+'"></label><label class="checkbox-label"><input type="checkbox" id="calActive" '+(c?.is_active!==false?'checked':'')+'>Kalender aktiv</label><label class="checkbox-label"><input type="checkbox" id="calAll" '+(p?.include_in_all_tasks?'checked':'')+'>Gehört zur Verantwortungsgruppe „Alle“</label><p class="small">Die Gruppe gilt auch für bestehende „Alle“-Termine. Archivieren erhält alle Termine. Ein neuer Kalender erweitert die Gruppe nicht automatisch.</p><button type="button" id="saveCalendar" class="primary">Speichern</button>';
 $('#saveCalendar').onclick=()=>busy($('#saveCalendar'),async()=>{
  if(!$('#calName').reportValidity()||!$('#calOrder').reportValidity())return;
  check(await sb.rpc('manage_calendar',{p_id:id,p_name:$('#calName').value.trim(),p_color:$('#calColor').value,p_order:Number($('#calOrder').value),p_active:$('#calActive').checked,p_all:$('#calAll').checked}));
  $('#settingsDialog').close();await refreshAll();toast('Kalender gespeichert');
 });$('#settingsDialog').showModal();
}
function selfActions(event) {
 if(event.is_cancelled||!myPersonId())return '';
 return '<div class="self-actions">'+[['assignee','Zuständigkeit']].filter(([r])=>r!=='assignee'||!event.assignee_all).map(([r,label])=>{const take=!assignmentIds(event,r).includes(myPersonId());return '<button type="button" class="secondary compact" data-self-event="'+esc(event.id)+'" data-self-role="'+r+'" data-self-take="'+take+'">'+label+(take?' übernehmen':' abgeben')+'</button>';}).join('')+'</div>';
}

start();

import { createClient } from './vendor/supabase.js';
import { mountProjectList } from './project-list.js';
import { parseAccessLink, redeemAccessLink, requestAccessLink } from './access-links.js';
import { APP_VERSION, localDate, addDays, dateAtNoon, weekBounds, queryBounds, escapeHtml as esc, safeColor, eventTime, nextEvent } from './calendar-utils.js';

const cfg = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let sb, user=null, member=null, members=[], events=[], series=[], weekOffset=0, taskFilter='mine', taskLimit=50;
let accessLink=null, pendingFamilyCode=null;
let refreshNumber=0, authNumber=0, pendingScope=null, recovery=false, initialized=false, currentView='today', toastTimer;
const admin = () => ['owner','admin'].includes(member?.role);
const toast = message => {
  clearTimeout(toastTimer);
  $('#toast').textContent=message; $('#toast').classList.add('show');
  toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),5000);
};
const errorText = error => !navigator.onLine ? 'Offline: Zum Laden und Speichern ist eine Internetverbindung nötig.' :
  (error?.message || 'Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.');
function show(id) { ['auth','onboarding','app'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==id)); }
function clearSession() {
  authNumber++; refreshNumber++; user=null; member=null; members=[]; events=[]; series=[];
  weekOffset=0; currentView='today'; pendingScope=null;
  $$('dialog[open]').forEach(d=>d.close());
  $('#settingsContent').replaceChildren(); $('#inviteLinkBox').classList.add('hidden');
  ['todayList','weekList','tasksList','adminContent','nextTask'].forEach(id=>$('#'+id).replaceChildren());
  show('auth');
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
  $('#title').textContent={today:'Heute',week:'Woche',tasks:'Aufgaben',admin:'Admin',more:'Mehr'}[view];
}
async function loadMembership() {
  const request=++authNumber, userId=user?.id;
  if(!userId) return;
  const data=check(await sb.from('family_members').select('*').eq('user_id',userId).maybeSingle());
  if(request!==authNumber||userId!==user?.id) return;
  if(!data) { member=null; show('onboarding'); return; }
  member=data; show('app'); navigate(currentView); await refreshAll();
}
async function fetchEvents(start,end,family) {
  const all=[], pageSize=500;
  for(let offset=0;;offset+=pageSize) {
    const page=check(await sb.from('events').select('*').eq('family_id',family).gte('event_date',start).lte('event_date',end)
      .eq('is_cancelled',false).order('event_date').order('start_time',{nullsFirst:true}).order('id').range(offset,offset+pageSize-1));
    all.push(...page);
    if(page.length<pageSize) return all;
  }
}
async function refreshAll() {
  if(!member||!user) return;
  const request=++refreshNumber, family=member.family_id, userId=user.id, offset=weekOffset;
  const [start,end]=queryBounds(offset);
  const [people,items,recurrences]=await Promise.all([
    sb.from('family_members').select('*').eq('family_id',family).order('display_name'),
    fetchEvents(start,end,family), sb.from('event_series').select('*').eq('family_id',family)
  ]);
  const loadedPeople=check(people), loadedSeries=check(recurrences);
  if(request!==refreshNumber||family!==member?.family_id||userId!==user?.id) return;
  members=loadedPeople; events=items; series=loadedSeries;
  member=members.find(m=>m.user_id===userId);
  if(!member) return loadMembership();
  $('#avatar').textContent=(member.display_name||'?')[0].toUpperCase();
  $('#adminNav').classList.toggle('hidden',!admin());
  navigate(currentView); renderToday(); renderWeek(); renderTasks(); fillPeople();
  if(admin()) renderAdmin(); else $('#adminContent').replaceChildren();
}
const person=id=>members.find(m=>m.user_id===id);
const typeIcon=type=>({school:'🎓',transport:'🚗',appointment:'📅',care:'🏠',bedtime:'🛏️'}[type]||'📅');
function card(event) {
  const p=person(event.assignee_id)||person(event.transport_from_id)||person(event.transport_to_id), chips=[];
  if(event.transport_to_id) chips.push('Bringt: '+esc(person(event.transport_to_id)?.display_name||'Unbekannt'));
  if(event.transport_from_id) chips.push('Holt: '+esc(person(event.transport_from_id)?.display_name||'Unbekannt'));
  if(event.assignee_id) chips.push('Zuständig: '+esc(person(event.assignee_id)?.display_name||'Unbekannt'));
  return '<article class="event-card" tabindex="0" role="button" data-id="'+esc(event.id)+'" style="--person:'+safeColor(p?.color)+'"><small>'+
    typeIcon(event.event_type)+' '+eventTime(event)+'</small><h3>'+esc(event.title)+'</h3>'+
    (event.location?'<div>'+esc(event.location)+'</div>':'')+'<div class="chips">'+
    chips.map(x=>'<span class="chip">'+x+'</span>').join('')+
    (event.reminders||[]).map(x=>'<span class="chip">🔔 '+Number(x)+' Min. (vorbereitet)</span>').join('')+'</div></article>';
}
function bindCards() {
  $$('.event-card').forEach(element=>{
    const open=()=>openEvent(events.find(e=>e.id===element.dataset.id));
    element.onclick=open; element.onkeydown=e=>{if(e.key==='Enter'||e.key===' ') { e.preventDefault(); open(); }};
  });
}
function renderToday() {
  const list=events.filter(e=>e.event_date===localDate()), next=nextEvent(list);
  $('#todayList').innerHTML=list.length?list.map(card).join(''):'<div class="empty">Heute ist nichts eingetragen.</div>';
  $('#nextTask').innerHTML=next?'<small>NÄCHSTER TERMIN</small><h2>'+esc(next.title)+'</h2><div>'+eventTime(next)+' · '+esc(person(next.assignee_id)?.display_name||'noch ungeklärt')+'</div>':
    '<small>HEUTE</small><h2>Keine weiteren zeitgebundenen Termine</h2>';
  bindCards();
}
function renderWeek() {
  const [start,end]=weekBounds(weekOffset);
  $('#weekRange').textContent=start.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+'–'+end.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  let html='';
  for(let day=new Date(start);day<=end;day=addDays(day,1)) {
    const list=events.filter(e=>e.event_date===localDate(day));
    html+='<h3>'+day.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'})+'</h3>'+
      (list.length?list.map(card).join(''):'<div class="empty">Keine Termine</div>');
  }
  $('#weekList').innerHTML=html; bindCards();
}
function renderTasks() {
  const today=localDate(), end=localDate(addDays(new Date(),120));
  let list=events.filter(e=>e.event_date>=today&&e.event_date<=end&&['transport','care','bedtime'].includes(e.event_type));
  if(taskFilter==='mine') list=list.filter(e=>[e.assignee_id,e.transport_to_id,e.transport_from_id].includes(user.id));
  if(taskFilter==='open') list=list.filter(e=>!e.assignee_id&&!e.transport_to_id&&!e.transport_from_id);
  $('#tasksList').innerHTML=list.length?list.slice(0,taskLimit).map(e=>'<h4>'+dateAtNoon(e.event_date).toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})+'</h4>'+card(e)).join(''):'<div class="empty">Keine passenden Aufgaben.</div>';
  $('#moreTasks').classList.toggle('hidden',list.length<=taskLimit); bindCards();
}
function fillPeople() {
  const opts='<option value="">— ungeklärt —</option>'+members.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
  if(!$('#eventDialog').open) ['assignee','transportTo','transportFrom'].forEach(id=>$('#'+id).innerHTML=opts);
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
  ['startTime','endTime'].forEach(id=>$('#'+id).disabled=allDay);
}
function canEdit(event) { return admin()||[event.created_by,event.assignee_id,event.transport_to_id,event.transport_from_id].includes(user.id); }
function openEvent(event=null) {
  if(!member) return;
  $('#eventForm').reset(); $('#reminders').replaceChildren();
  $('#eventId').value=event?.id||''; $('#seriesId').value=event?.series_id||'';
  $('#eventHeading').textContent=event?'Termin bearbeiten':'Termin anlegen';
  const allowed=!event||canEdit(event);
  const deletable=event&&(admin()||event.created_by===user.id);
  $('#deleteEvent').classList.toggle('hidden',!deletable);
  const values={eventDate:event?.event_date||localDate(),eventType:event?.event_type||'appointment',eventTitle:event?.title||'',
    startTime:event?.start_time?.slice(0,5)||'',endTime:event?.end_time?.slice(0,5)||'',allDay:String(event?.all_day||false),
    location:event?.location||'',notes:event?.notes||'',assignee:event?.assignee_id||'',transportTo:event?.transport_to_id||'',transportFrom:event?.transport_from_id||''};
  Object.entries(values).forEach(([id,value])=>$('#'+id).value=value);
  (event?.reminders??[member.default_reminder_minutes??15]).forEach(addReminder);
  const recurrence=series.find(s=>s.id===event?.series_id);
  $('#recurrence').value=recurrence?.recurrence||'none';
  $('#recurrenceEnd').value=recurrence?.ends_on||'';
  $('#recurrence').disabled=Boolean(event); $('#recurrenceEnd').disabled=Boolean(event);
  $('#seriesInfo').textContent=event?.series_id?'Rhythmus und Serienende sind hier schreibgeschützt. Einzelne Termine, Datum, Zeiten und Zuständigkeiten können geändert werden.':
    event?'Ein bestehender Einzeltermin bleibt ein Einzeltermin. Für eine neue Serie bitte einen neuen Termin anlegen.':'Ohne Enddatum wird die Serie für ein Jahr angelegt (maximal zwei Jahre).';
  $('#saveEvent').disabled=!allowed;
  if(!allowed) $('#seriesInfo').textContent='Du kannst diesen Termin ansehen, aber nicht bearbeiten.';
  toggleAllDay(); $('#eventDialog').showModal();
}
function payload() {
  const allDay=$('#allDay').value==='true';
  return {family_id:member.family_id,event_type:$('#eventType').value,title:$('#eventTitle').value.trim(),event_date:$('#eventDate').value,
    start_time:allDay?null:$('#startTime').value||null,end_time:allDay?null:$('#endTime').value||null,all_day:allDay,
    location:$('#location').value.trim(),notes:$('#notes').value.trim(),assignee_id:$('#assignee').value||null,
    transport_to_id:$('#transportTo').value||null,transport_from_id:$('#transportFrom').value||null,
    reminders:[...new Set($$('#reminders input').map(x=>Number(x.value)))]};
}
function validateEvent(data) {
  if(!data.title) throw new Error('Bitte einen Titel eingeben');
  if(data.end_time&&(!data.start_time||data.end_time<data.start_time)) throw new Error('Das Ende muss nach dem Beginn liegen (gleicher Tag).');
  if(data.reminders.some(n=>!Number.isInteger(n)||n<0||n>10080)) throw new Error('Erinnerungen: ganze Minuten von 0 bis 10080');
}
function askScope(action) {
  pendingScope=action;
  $$('#scopeDialog [data-scope]').forEach(b=>b.disabled=!admin()&&['series','following'].includes(b.dataset.scope));
  $('#scopeDialog').showModal();
}
async function done() {
  $('#eventDialog').close(); if($('#scopeDialog').open) $('#scopeDialog').close();
  toast('Gespeichert'); await refreshAll();
}
async function saveEvent(event) {
  event.preventDefault();
  await busy($('#saveEvent'),async()=>{
    const data=payload(),id=$('#eventId').value,seriesId=$('#seriesId').value;
    validateEvent(data);
    if(id&&seriesId) return askScope(async scope=>{
      check(await sb.rpc('update_series_scope',{p_occurrence_id:id,p_scope:scope,p_patch:data})); await done();
    });
    if(id) {
      const {family_id,...changes}=data;
      const rows=check(await sb.from('events').update(changes).eq('id',id).select('id'));
      if(rows.length!==1) throw new Error('Nicht gespeichert: Der Termin fehlt oder du hast keine Berechtigung.');
    } else if($('#recurrence').value!=='none') {
      check(await sb.rpc('create_event_series',{p_event:data,p_recurrence:$('#recurrence').value,p_until:$('#recurrenceEnd').value||null}));
    } else {
      check(await sb.from('events').insert({...data,created_by:user.id}).select('id').single());
    }
    await done();
  });
}
async function deleteEvent() {
  if(!confirm('Termin wirklich löschen?')) return;
  await busy($('#deleteEvent'),async()=>{
    const id=$('#eventId').value;
    if($('#seriesId').value) return askScope(async scope=>{
      check(await sb.rpc('delete_series_scope',{p_occurrence_id:id,p_scope:scope})); await done();
    });
    const rows=check(await sb.from('events').delete().eq('id',id).select('id'));
    if(rows.length!==1) throw new Error('Nicht gelöscht: Der Termin fehlt oder du hast keine Berechtigung.');
    await done();
  });
}
function renderAdmin() {
  $('#adminContent').innerHTML='<h2>Administration</h2><div class="admin-grid"><div class="card"><h3>Familienmitglieder</h3><div id="memberList"></div></div>'+
    '<div class="card"><h3>Mitglied einladen</h3><p>Einmaliger Einladungslink, maximal eine Stunde gültig. Du gibst ihn persönlich weiter; es wird keine E-Mail versendet.</p><label>E-Mail der Person<input id="inviteEmail" type="email" maxlength="254" placeholder="oma@example.de"></label><button id="makeInvite" class="primary">Einladungslink erstellen</button><div id="inviteResult"></div></div></div>';
  $('#memberList').innerHTML=members.map(m=>'<div class="member"><span class="dot" style="background:'+safeColor(m.color)+'"></span><main><b>'+esc(m.display_name)+'</b><small>'+esc({owner:'Eigentümer',admin:'Administrator',member:'Mitglied'}[m.role])+'</small></main>'+
    (member.role==='owner'||m.role==='member'?'<button data-edit-member="'+esc(m.user_id)+'">Bearbeiten</button>':'')+
    ((m.role==='member'||m.user_id===user.id||(member.role==='owner'&&m.role==='admin'))?'<button data-reset-member="'+esc(m.user_id)+'">Reset-Link</button>':'')+'</div>').join('');
  $('#makeInvite').onclick=()=>busy($('#makeInvite'),async()=>{
    if(!$('#inviteEmail').reportValidity()||!$('#inviteEmail').value.trim()) throw new Error('Bitte eine gültige E-Mail eingeben');
    const email=$('#inviteEmail').value.trim(), result=await requestAccessLink(sb,'invite',email);
    showAccessResult($('#inviteResult'),result);
  });
  $$('[data-edit-member]').forEach(b=>b.onclick=()=>editMember(b.dataset.editMember));
  $$('[data-reset-member]').forEach(b=>b.onclick=()=>busy(b,async()=>{
    const target=person(b.dataset.resetMember);
    if(!confirm('Reset-Link für '+target.display_name+' erstellen? Der Link ermöglicht Zugang zu diesem Konto und darf nur dieser Person übergeben werden.'))return;
    const result=await requestAccessLink(sb,'recovery',target.user_id);
    showAccessResult($('#inviteResult'),result);
  }));
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
  const target=person(id),owner=member.role==='owner';
  $('#settingsHeading').textContent='Mitglied bearbeiten';
  $('#settingsContent').innerHTML='<label>Name<input id="mName" maxlength="80" value="'+esc(target.display_name)+'"></label><label>Farbe<input id="mColor" type="color" value="'+safeColor(target.color)+'"></label>'+
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
    $('#settingsContent').innerHTML='<p>Push ist noch nicht eingerichtet. Erinnerungszeiten und Einstellungen werden gespeichert, aber es werden noch keine Nachrichten versendet.</p>'+
      '<label>Standard-Vorlauf in Minuten<input id="defaultReminder" type="number" min="0" max="10080" step="1" value="'+member.default_reminder_minutes+'"></label>'+
      '<label class="checkbox-label"><input id="notifyAssignments" type="checkbox" '+(member.notify_assignments?'checked':'')+'> Neue eigene Aufgaben melden (vorbereitet)</label>'+
      '<label class="checkbox-label"><input id="notifyChanges" type="checkbox" '+(member.notify_changes?'checked':'')+'> Änderungen melden (vorbereitet)</label><button id="saveNotify" class="primary">Einstellungen speichern</button>';
    $('#saveNotify').onclick=()=>busy($('#saveNotify'),async()=>{
      const minutes=Number($('#defaultReminder').value);
      if(!Number.isInteger(minutes)||minutes<0||minutes>10080) throw new Error('Bitte ganze Minuten von 0 bis 10080 eingeben');
      await updateProfile({default_reminder_minutes:minutes,notify_assignments:$('#notifyAssignments').checked,notify_changes:$('#notifyChanges').checked});
      $('#settingsDialog').close(); toast('Gespeichert');
    });
  } else {
    $('#settingsHeading').textContent='Mein Profil';
    $('#settingsContent').innerHTML='<label>Name<input id="profileName" maxlength="80" value="'+esc(member.display_name)+'"></label><label>Farbe<input id="profileColor" type="color" value="'+safeColor(member.color)+'"></label><button id="saveProfile" class="primary">Speichern</button><hr><button id="showProject" type="button">Projekt & offene Punkte</button>';
    $('#showProject').onclick=()=>openSettings('project');
    $('#saveProfile').onclick=()=>busy($('#saveProfile'),async()=>{
      await updateProfile({display_name:$('#profileName').value.trim(),color:$('#profileColor').value});
      $('#settingsDialog').close(); toast('Gespeichert');
    });
  }
}
function bindUI() {
  $('#authForm').onsubmit=e=>{e.preventDefault(); busy($('#authSubmit'),async()=>{
    const email=$('#email').value.trim(), password=$('#password').value;
    const result=await sb.auth.signInWithPassword({email,password});
    const data=check(result); $('#password').value='';
    $('#authInfo').textContent='';
    if(data.session) { user=data.user; await loadMembership(); }
  }); };
  $('#forgotPassword').onclick=()=>{$('#authInfo').textContent='Bitte deinen Familien-Admin um einen persönlichen Reset-Link bitten. Wenn der einzige Owner keinen Zugang mehr hat, erfolgt die Wiederherstellung über das Supabase-Dashboard.';};
  $('#redeemLink').onclick=()=>busy($('#redeemLink'),async()=>{
    if(!accessLink)throw new Error('Bitte einen neuen Link beim Admin anfordern');
    const data=await redeemAccessLink(sb,accessLink);user=data.user;
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
  const logout=button=>busy(button,async()=>{check(await sb.auth.signOut());clearSession();});
  $('#logout').onclick=()=>logout($('#logout')); $('#onboardingLogout').onclick=()=>logout($('#onboardingLogout'));
  $$('nav [data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
  $('#add').onclick=()=>openEvent(); $('#avatar').onclick=()=>openSettings('profile');
  $('#refresh').onclick=()=>busy($('#refresh'),refreshAll);
  const changeWeek=async delta=>{weekOffset+=delta; $('#weekList').innerHTML='<div class="empty">Termine werden geladen …</div>'; try{await refreshAll();}catch(error){$('#weekList').innerHTML='<div class="empty">Termine konnten nicht geladen werden. Bitte aktualisieren.</div>';toast(errorText(error));}};
  $('#prevWeek').onclick=()=>changeWeek(-1); $('#nextWeek').onclick=()=>changeWeek(1);
  $('#addReminder').onclick=()=>addReminder(); $('#allDay').onchange=toggleAllDay;
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
  $$('[data-filter]').forEach(b=>b.onclick=()=>{taskFilter=b.dataset.filter;taskLimit=50;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTasks();});
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
    catch(error) { history.replaceState(null,'',location.pathname);show('auth');$('#authInfo').textContent=errorText(error);setupPwa();return; }
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
    if(accessLink){show('auth');$('#inviteLinkBox').classList.remove('hidden');$('#authInfo').textContent='Dieser persönliche Link meldet dich beim eingeladenen Konto an. Bitte nur deinen eigenen Link öffnen.';}
    else if(data.session) {
      user=data.session.user;
      await loadMembership();
    } else show('auth');
    initialized=true;
  } catch(error) { $('#authInfo').textContent=errorText(error); toast(errorText(error)); }
  setupPwa();
}
start();

export const APP_VERSION = '1.7.6';
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dateAtNoon(value) { return new Date(`${value}T12:00:00`); }
export function addDays(date, count) { const result = new Date(date); result.setDate(result.getDate()+count); return result; }
export function weekBounds(offset = 0, now = new Date()) {
  const day = addDays(dateAtNoon(localDate(now)), offset*7);
  const start = addDays(day, -((day.getDay()+6)%7));
  return [start, addDays(start,6)];
}
export function queryBounds(offset = 0, now = new Date()) {
  const [start,end] = weekBounds(offset,now);
  const today = localDate(now);
  return [localDate(start)<today ? localDate(start) : today, localDate(end)>localDate(addDays(now,120)) ? localDate(end) : localDate(addDays(now,120))];
}
export function escapeHtml(value) { return String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(value??'') ? value : '#888888'; }
export function eventTime(event) { return event.all_day ? 'Ganztägig' : event.start_time?.slice(0,5)||'Ohne Uhrzeit'; }
export function assignmentIds(event,role) {
  if(role!=='assignee')return [];
  if(Array.isArray(event.assignments))return [...new Set(event.assignments.filter(a=>a.role===role).map(a=>a.person_id||a.member_user_id||a.test_member_id).filter(Boolean))];
  return [event.assignee_id].filter(Boolean);
}
// Display membership is derived; explicit calendar links remain the write boundary.
export function eventCalendarIds(event,calendars,people=[],{includeBedtimeResponsibilities=false}={}) {
 if(event.event_type==='bedtime'&&!includeBedtimeResponsibilities)return calendars.filter(c=>c.allow_family_create).map(c=>c.id);
 const ids=new Set((event.calendar_links||[]).map(l=>l.calendar_id));
 const responsible=new Set(['assignee'].flatMap(role=>assignmentIds(event,role)));
 if(event.assignee_all){const all=event.all_task_person_ids||people.filter(p=>p.is_active!==false&&p.include_in_all_tasks!==false).map(p=>p.user_id||p.id);all.forEach(id=>responsible.add(id));}
 calendars.filter(c=>responsible.has(c.person_id)).forEach(c=>ids.add(c.id));
 return [...ids];
}
export function assignedTo(event, userId) { return !!userId && ((event.calendar_people||[]).includes(userId) || (event.assignee_all && (!event.all_task_person_ids||event.all_task_person_ids.includes(userId))) || ['assignee'].some(role=>assignmentIds(event,role).includes(userId))); }
export function eventRoles(event, userId) {
  return [['assignee','Zuständig']]
    .filter(([role])=>(role==='assignee'&&event.assignee_all&&(!userId||!event.all_task_person_ids||event.all_task_person_ids.includes(userId)))||assignmentIds(event,role).some(id=>!userId||id===userId)).map(([,label])=>label);
}
export function openAssignment(event) {
  if(event.requires_assignment===false&&['appointment','school','vacation'].includes(event.event_type))return '';
  if(event.event_type==='transport' && !event.assignee_all && !assignmentIds(event,'assignee').length) return 'Fahrt ungeklärt';
  if(['care','bedtime'].includes(event.event_type) && !event.assignee_all && !assignmentIds(event,'assignee').length) return 'Zuständigkeit offen';
  return eventRoles(event).length ? '' : 'Zuständigkeit offen';
}
export function isTask(event) { return eventRoles(event).length>0 || ['transport','care','bedtime'].includes(event.event_type); }
export function filterEvents(events, filter, userId) {
  return events.filter(event=>filter==='cancelled' ? !!event.is_cancelled : !event.is_cancelled && (filter==='mine' ? assignedTo(event,userId) : filter==='open' ? !!openAssignment(event) : true));
}
export const eventEndDate=event=>event.end_date||event.event_date;
export function eventOnDay(event,day) {return event.event_date<=day&&eventEndDate(event)>=day&&!(day===eventEndDate(event)&&day>event.event_date&&!event.all_day&&event.end_time?.startsWith('00:00'));}
export function eventSpan(event) {
  const end=eventEndDate(event);
  return [new Date(event.event_date+'T'+(event.all_day?'00:00:00':event.start_time||'00:00:00')),event.all_day||!event.end_time?dateAtMidnight(localDate(addDays(dateAtNoon(end),1))):new Date(end+'T'+event.end_time)];
}
function dateAtMidnight(value){return new Date(value+'T00:00:00');}
export function eventsOverlap(a,b){const [as,ae]=eventSpan(a),[bs,be]=eventSpan(b);return as<be&&bs<ae;}
export function cardTime(event,day=event.event_date) {
  if(event.all_day)return 'Ganztägig';
  if(day>event.event_date)return day===eventEndDate(event)&&event.end_time?'Bis '+event.end_time.slice(0,5):'Läuft weiter';
  return eventTime(event)+(eventEndDate(event)>event.event_date?' → '+dateAtNoon(eventEndDate(event)).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+(event.end_time?' '+event.end_time.slice(0,5):''):'');
}
export function assignmentColors(event,people,userId) {
  const ids=event.assignee_all?people.filter(p=>p.include_in_all_tasks!==false).map(p=>p.user_id):assignmentIds(event,'assignee');
  const colors=[...new Set(ids.map(id=>safeColor(people.find(p=>p.user_id===id)?.color)))];
  if(!colors.length)return '#888888';
  return colors.length===1?colors[0]:'linear-gradient(180deg,'+colors.join(',')+')';
}
export function nextEvent(events, now = new Date()) {
  const today=localDate(now);
  return events.find(e=>e.event_date===today && !e.all_day && e.start_time && new Date(`${e.event_date}T${e.start_time}`)>=now);
}

export function daySegment(event,day) {
 if(!eventOnDay(event,day)||event.all_day)return null;
 const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
 return {start:day===event.event_date?minute(event.start_time||'00:00'):0,
 end:day===eventEndDate(event)?minute(event.end_time||'24:00'):1440};
}
export function layoutDayEvents(events,day) {
 const rows=events.map(event=>({event,...daySegment(event,day)})).filter(x=>Number.isFinite(x.start)&&x.end>x.start).sort((a,b)=>a.start-b.start||b.end-a.end);
 let group=[],ends=[];
 const finish=()=>{for(const row of group)row.lanes=ends.length;group=[];ends=[];};
 for(const row of rows){
  if(group.length&&ends.every(end=>end<=row.start))finish();
  let lane=ends.findIndex(end=>end<=row.start);if(lane<0)lane=ends.length;
  row.lane=lane;ends[lane]=row.end;group.push(row);
 }
 finish();return rows;
}

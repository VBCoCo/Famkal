export const APP_VERSION = '1.6.0';
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
  if(Array.isArray(event.assignments))return [...new Set(event.assignments.filter(a=>a.role===role).map(a=>a.person_id||a.member_user_id||a.test_member_id).filter(Boolean))];
  return [event[{assignee:'assignee_id',to:'transport_to_id',from:'transport_from_id'}[role]]].filter(Boolean);
}
export function assignedTo(event, userId) { return !!userId && (event.assignee_all || ['assignee','to','from'].some(role=>assignmentIds(event,role).includes(userId))); }
export function eventRoles(event, userId) {
  return [['to','Bringen'],['from','Abholen'],['assignee','Zuständig']]
    .filter(([role])=>(role==='assignee'&&event.assignee_all)||assignmentIds(event,role).some(id=>!userId||id===userId)).map(([,label])=>label);
}
export function openAssignment(event) {
  if(event.event_type==='transport' && !assignmentIds(event,'to').length && !assignmentIds(event,'from').length) return 'Fahrt ungeklärt';
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
  const ids=event.assignee_all?people.map(p=>p.user_id):[...assignmentIds(event,'assignee'),...assignmentIds(event,'to'),...assignmentIds(event,'from')];
  const colors=[...new Set(ids.map(id=>safeColor(people.find(p=>p.user_id===id)?.color)))];
  if(!colors.length)return '#888888';
  return colors.length===1?colors[0]:'linear-gradient(135deg,'+colors.join(',')+')';
}
export function nextEvent(events, now = new Date()) {
  const today=localDate(now);
  return events.find(e=>e.event_date===today && !e.all_day && e.start_time && new Date(`${e.event_date}T${e.start_time}`)>=now);
}

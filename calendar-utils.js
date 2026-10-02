export const APP_VERSION = '1.3.1';
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
export function nextEvent(events, now = new Date()) {
  const today=localDate(now);
  return events.find(e=>e.event_date===today && !e.all_day && e.start_time && new Date(`${e.event_date}T${e.start_time}`)>=now);
}

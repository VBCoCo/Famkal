import test from 'node:test';
import assert from 'node:assert/strict';
import {localDate,addDays,weekBounds,queryBounds,safeColor,escapeHtml,eventTime,nextEvent,assignedTo,eventRoles,openAssignment,isTask,filterEvents,eventOnDay,eventsOverlap,assignmentColors,cardTime} from '../calendar-utils.js';
process.env.TZ='Europe/Berlin';
test('German midnight stays on the local calendar day',()=>{
  assert.equal(localDate(new Date('2026-10-01T00:30:00+02:00')),'2026-10-01');
  assert.equal(localDate(new Date('2026-01-01T00:15:00+01:00')),'2026-01-01');
});
test('all and normalized multiple assignment reach every selected user',()=>{
 const multi={assignments:[{role:'assignee',member_user_id:'u1'},{role:'assignee',member_user_id:'u2'},{role:'to',test_member_id:'pink'}]};
 assert.equal(assignedTo(multi,'u2'),true);assert.equal(assignedTo(multi,'u3'),false);assert.equal(openAssignment(multi),'');
 assert.equal(assignedTo({assignee_all:true},'u3'),true);assert.equal(isTask({assignee_all:true}),true);
 assert.equal(assignmentColors(multi,[{user_id:'u1',color:'#0066ff'},{user_id:'u2',color:'#ff0000'},{user_id:'pink',color:'#ff69b4'}]),'linear-gradient(135deg,#0066ff,#ff0000,#ff69b4)');
 assert.ok(!assignmentColors({assignee_all:true},[{user_id:'x',color:'url(secret)'}]).includes('secret'));
});
test('overnight and inclusive all-day spans cross days and daylight-saving changes',()=>{
 const night={event_date:'2026-10-24',end_date:'2026-10-25',start_time:'20:00:00',end_time:'06:00:00'};
 assert.equal(eventOnDay(night,'2026-10-25'),true);assert.equal(eventOnDay(night,'2026-10-26'),false);assert.equal(cardTime(night,'2026-10-25'),'Bis 06:00');
 assert.equal(eventsOverlap(night,{event_date:'2026-10-25',end_date:'2026-10-26',all_day:true}),true);
 assert.equal(eventsOverlap(night,{event_date:'2026-10-25',start_time:'06:00:00',end_time:'07:00:00'}),false);
 assert.equal(eventOnDay({...night,end_time:'00:00:00'},'2026-10-25'),false);
 assert.equal(eventOnDay({event_date:'2026-10-01',end_date:'2026-10-15',all_day:true},'2026-10-15'),true);
 assert.equal(eventsOverlap({event_date:'2026-10-01',all_day:true,start_time:'20:00:00'},{event_date:'2026-10-01',start_time:'07:00:00',end_time:'08:00:00'}),true);
});
test('all assignment roles count across event types and do not match missing user',()=>{
 for(const key of ['assignee_id','transport_to_id','transport_from_id'])for(const event_type of ['appointment','school','transport','care','bedtime']){
  const event={event_type,[key]:'u1'};assert.equal(assignedTo(event,'u1'),true);assert.equal(isTask(event),true);
  assert.equal(filterEvents([event],'mine','u2').length,0);
 }
 assert.equal(assignedTo({},undefined),false);
 assert.equal(isTask({event_type:'appointment'}),false);
 assert.deepEqual(eventRoles({assignee_id:'u1',transport_to_id:'u1',transport_from_id:'u2'},'u1'),['Bringen','Zuständig']);
});
test('unresolved roles follow event type without inventing unrequested return journeys',()=>{
 assert.equal(openAssignment({event_type:'transport',transport_to_id:'u1'}),'');
 assert.equal(openAssignment({event_type:'transport',assignee_id:'u1'}),'Fahrt ungeklärt');
 assert.equal(openAssignment({event_type:'care',transport_to_id:'u1'}),'Zuständigkeit offen');
 assert.equal(openAssignment({event_type:'bedtime',assignee_id:'u1'}),'');
 assert.equal(openAssignment({event_type:'appointment'}),'Zuständigkeit offen');
});
test('calendar arithmetic survives daylight saving transitions',()=>{
  const d=new Date('2026-03-28T12:00:00+01:00');
  assert.equal(localDate(addDays(d,1)),'2026-03-29');
  assert.equal(localDate(addDays(d,2)),'2026-03-30');
  const [start,end]=weekBounds(0,new Date('2026-10-25T12:00:00+01:00'));
  assert.equal(localDate(start),'2026-10-19'); assert.equal(localDate(end),'2026-10-25');
});
test('past and distant future weeks are included in queries',()=>{
  const now=new Date('2026-10-01T12:00:00+02:00');
  assert.ok(queryBounds(-52,now)[0]<'2026-01-01');
  assert.ok(queryBounds(52,now)[1]>'2027-09-01');
});
test('stored HTML cannot be injected through names or colors',()=>{
  assert.equal(safeColor('"><img src=x onerror=alert(1)>'),'#888888');
  assert.equal(safeColor('#f39a3f'),'#f39a3f');
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('all-day display ignores residual times and next event ignores past items',()=>{
  assert.equal(eventTime({all_day:true,start_time:'13:00'}),'Ganztägig');
  const now=new Date('2026-10-01T14:00:00+02:00');
  const events=[{event_date:'2026-10-01',start_time:'09:00:00'}, {event_date:'2026-10-01',all_day:true,start_time:'15:00:00'}, {event_date:'2026-10-01',start_time:'16:00:00'}];
  assert.equal(nextEvent(events,now),events[2]);
  assert.equal(nextEvent(events.slice(0,2),now),undefined);
});

import {localDate,addDays,dateAtNoon} from './calendar-utils.js';
const next=day=>localDate(addDays(dateAtNoon(day),1));
const previous=day=>localDate(addDays(dateAtNoon(day),-1));
// Account-local, in-memory cache. A failed load never marks a range as complete.
export class EventCache {
  constructor(){this.ranges=[];this.rows=new Map();this.queue=Promise.resolve();}
  missing(start,end){let cursor=start;const gaps=[];for(const [a,b] of this.ranges){if(b<cursor)continue;if(a>end)break;if(a>cursor)gaps.push([cursor,previous(a)]);if(b>=cursor)cursor=next(b);if(cursor>end)break;}if(cursor<=end)gaps.push([cursor,end]);return gaps;}
  remember(start,end,rows){for(const [id,e] of this.rows)if(e.event_date<=end&&(e.end_date||e.event_date)>=start)this.rows.delete(id);for(const e of rows)this.rows.set(e.id,e);const merged=[];for(const range of [...this.ranges,[start,end]].sort((a,b)=>a[0].localeCompare(b[0]))){const last=merged.at(-1);if(last&&range[0]<=next(last[1]))last[1]=last[1]>range[1]?last[1]:range[1];else merged.push([...range]);}this.ranges=merged;}
  load(ranges,fetch){const work=async()=>{for(const [a,b] of ranges)for(const [start,end] of this.missing(a,b)){const rows=await fetch(start,end);this.remember(start,end,rows);}return [...this.rows.values()].sort((a,b)=>a.event_date.localeCompare(b.event_date)||(a.start_time||'').localeCompare(b.start_time||'')||a.id.localeCompare(b.id));};const promise=this.queue.then(work);this.queue=promise.catch(()=>{});return promise;}
}
export const isSessionError=error=>['42501','PGRST301','PGRST302','PGRST303'].includes(error?.code)||/permission denied|JWT.*expired|invalid.*JWT/i.test(error?.message||'');
async function authCall(action){let timer;try{return await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Die Anmeldung konnte nicht rechtzeitig geprüft werden. Bitte Verbindung prüfen und erneut versuchen.')),15000);})]);}finally{clearTimeout(timer);}}
export async function sessionRead(client,userId,read){
  const session=await authCall(()=>client.auth.getSession());if(session.error)throw session.error;
  if(session.data?.session?.user?.id!==userId)throw Object.assign(new Error('Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.'),{code:'SESSION_REQUIRED'});
  try{return await read();}catch(error){if(!isSessionError(error))throw error;const refreshed=await authCall(()=>client.auth.refreshSession());if(refreshed.error){if(refreshed.error.status>=500||refreshed.error.name==='AuthRetryableFetchError')throw refreshed.error;throw Object.assign(new Error('Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.'),{code:'SESSION_REQUIRED'});}if(refreshed.data?.session?.user?.id!==userId)throw Object.assign(new Error('Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.'),{code:'SESSION_REQUIRED'});return read();}
}

const ORIGIN='https://vbcoco.github.io';
const APP=ORIGIN+'/Famkal/';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function validSubscription(value) {
 try {
  const url=new URL(value.endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||value.endpoint.length>2048||url.pathname==='/')return false;
  if(!['fcm.googleapis.com','updates.push.services.mozilla.com'].includes(url.hostname)&&!/^([a-z0-9-]+\.)?push\.apple\.com$/.test(url.hostname))return false;
  const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const key=decode(value.keys.p256dh),auth=decode(value.keys.auth);
  return key.length===65&&key[0]===4&&auth.length===16;
 } catch {return false;}
}
function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export function reminderPayload(job) {
 const time=new Date(job.start_at).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});
 return {title:'Famkal · Erinnerung',body:String(job.title).slice(0,160)+' · '+time+(job.roles?' · '+String(job.roles).slice(0,80):''),tag:'famkal-'+job.tag,url:APP+'?event='+encodeURIComponent(job.event_id)};
}
export function makeHandler(createClient,env,send) {
 return async request=>{
  const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  if(request.headers.get('origin')&&request.headers.get('origin')!==ORIGIN)return reply(403,{error:'Nicht erlaubter Ursprung'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Nur POST erlaubt'});
  const bearer=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1],cron=request.headers.get('x-famkal-cron');
  if(!bearer&&!cron)return reply(401,{error:'Bitte anmelden'});
  try {
   const raw=await request.text();if(raw.length>1024)return reply(413,{error:'Anfrage zu groß'});
   let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Ungültige Anfrage'});}
   if(!body||!['test','drain'].includes(body.action))return reply(400,{error:'Ungültige Aktion'});
   const backend=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
   const configResult=await backend.rpc('push_config');
   if(configResult.error||!configResult.data?.privateKey)return reply(503,{error:'Push-Versand ist noch nicht bereit'});
   const config=configResult.data;
   if(body.action==='drain') {
    if(!equalSecret(cron,config.cronSecret))return reply(401,{error:'Nicht autorisiert'});
    const claimed=await backend.rpc('claim_push');if(claimed.error)throw Error('claim');
    let sent=0,skipped=0,failed=0;
    const tickets=claimed.data??[];
    const deliver=async ticket=>{
     const prepared=await backend.rpc('prepare_push',{p_id:ticket.id,p_token:ticket.token});
     if(prepared.error)throw Error('prepare');
     const job=prepared.data;if(!job){skipped++;return;}
     let status=400;
     if(validSubscription(job.subscription)) {
      const remaining=Math.ceil((Math.min(new Date(job.start_at).getTime()+300000,new Date(job.start_at).getTime()-job.reminder_minutes*60000+600000)-Date.now())/1000);
      try {status=await send(job.subscription,reminderPayload(job),config,{ttl:Math.max(1,Math.min(600,remaining)),topic:ticket.id.replace(/-/g,'')});}catch{status=503;}
     }
     const finished=await backend.rpc('finish_push',{p_id:ticket.id,p_token:ticket.token,p_status:status});if(finished.error)throw Error('finish');
     if(status>=200&&status<300)sent++;else failed++;
    };
    for(let offset=0;offset<tickets.length;offset+=5)await Promise.all(tickets.slice(offset,offset+5).map(deliver));
    return reply(200,{sent,skipped,failed});
   }
   if(!uuid(body.subscription_id)||!bearer)return reply(400,{error:'Gültiges Gerät erforderlich'});
   const auth=await backend.auth.getUser(bearer);
   if(auth.error||!auth.data?.user)return reply(401,{error:'Bitte erneut anmelden'});
   const claimed=await backend.rpc('claim_push_test',{p_id:body.subscription_id,p_user:auth.data.user.id});
   if(claimed.error)throw Error('test');
   if(!claimed.data)return reply(429,{error:'Gerät nicht aktiv oder Test zu früh. Bitte eine Minute warten.'});
   if(!validSubscription(claimed.data))return reply(400,{error:'Ungültige Geräteanmeldung'});
   let status;try{status=await send(claimed.data,{title:'Famkal · Testnachricht',body:'Push-Erinnerungen sind auf diesem Gerät eingerichtet.',tag:'famkal-test',url:APP},config,{ttl:60,topic:'famkal-test'});}catch{status=503;}
   if([404,410].includes(status)) {await backend.rpc('expire_push',{p_id:body.subscription_id});return reply(410,{error:'Geräteanmeldung abgelaufen. Bitte neu aktivieren.'});}
   if(status<200||status>=300)return reply(502,{error:'Push-Dienst derzeit nicht erreichbar. Bitte später erneut testen.'});
   return reply(200,{message:'Testnachricht an den Push-Dienst übergeben. Bitte auf deinem Gerät prüfen.'});
  } catch {return reply(500,{error:'Push-Versand fehlgeschlagen. Bitte später erneut versuchen.'});}
 };
}

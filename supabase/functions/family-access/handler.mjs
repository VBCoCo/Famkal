const ORIGIN='https://vbcoco.github.io';
const APP='https://vbcoco.github.io/Famkal/';
export function makeHandler(createClient,env) {
 return async request=>{
  const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  if(request.headers.get('origin')&&request.headers.get('origin')!==ORIGIN) return reply(403,{error:'Nicht erlaubter Ursprung'});
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(request.method!=='POST') return reply(405,{error:'Nur POST erlaubt'});
  const bearer=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if(!bearer) return reply(401,{error:'Bitte anmelden'});
  if(Number(request.headers.get('content-length')||0)>2048) return reply(413,{error:'Anfrage zu groß'});
  try {
   const raw=await request.text();
   if(raw.length>2048) return reply(413,{error:'Anfrage zu groß'});
   let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Ungültige Anfrage'});}
   const calendarId=body.calendar_id;
   if(body.action==='invite'&&(typeof calendarId!=='string'||!/^[a-f0-9-]{36}$/i.test(calendarId)))return reply(400,{error:'Bitte einen Kalender wählen'});
   const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
   if(!['invite','recovery'].includes(body.action)||(body.action==='invite'&&(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)))||(body.action==='recovery'&&(typeof body.target_user_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.target_user_id))))return reply(400,{error:'Aktion und gültiges Ziel erforderlich'});
   const privileged=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await privileged.auth.getUser(bearer);
   if(auth.error||!auth.data?.user) return reply(401,{error:'Anmeldung abgelaufen'});
   // Authorization, family boundaries and rate limits are checked in PostgreSQL.
   const prepared=await privileged.rpc('prepare_family_access_link_v170',{p_actor:auth.data.user.id,p_email:email,p_action:body.action,p_target_user:body.action==='recovery'?body.target_user_id:null,p_calendar:body.action==='invite'?calendarId:null});
   if(prepared.error)return reply(403,{error:prepared.error.message});
   const ticket=prepared.data;
   const generated=await privileged.auth.admin.generateLink({type:ticket.link_type,email:ticket.email,options:{redirectTo:APP}});
   if(generated.error||!generated.data?.properties?.hashed_token||!generated.data?.user?.id) return reply(502,{error:'Link konnte nicht erstellt werden. Bitte später erneut versuchen.'});
   const finished=await privileged.rpc('finish_family_access_link',{p_request:ticket.request_id,p_target:generated.data.user.id});
   if(finished.error)return reply(403,{error:finished.error.message});
   const fragment=new URLSearchParams({famkal_type:ticket.link_type,token_hash:generated.data.properties.hashed_token});
   if(finished.data.family_code) fragment.set('family_code',finished.data.family_code);
   // Tokens are returned only to the authorized caller. Never log or persist them.
   return reply(200,{url:APP+'#'+fragment.toString(),kind:ticket.link_type,message:'Nur persönlich an die betreffende Person weitergeben. Einmal verwendbar; spätestens nach einer Stunde abgelaufen.'});
  } catch {return reply(500,{error:'Link konnte nicht erstellt werden. Bitte erneut versuchen.'});}
 };
}

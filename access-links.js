export function parseAccessLink(hash) {
 const params=new URLSearchParams(hash.replace(/^#/,'')),kind=params.get('famkal_type'),token=params.get('token_hash'),familyCode=params.get('family_code');
 if(params.has('error')) throw new Error('Der persönliche Link ist ungültig, abgelaufen oder bereits verwendet. Bitte deinen Familien-Admin um einen neuen Einladungslink bitten oder eine neue Recovery-Mail anfordern.');
 if(params.has('access_token')||params.has('refresh_token')||params.get('type')==='recovery') {
  const accessToken=params.get('access_token'),refreshToken=params.get('refresh_token');
  if(params.get('type')!=='recovery'||!accessToken||accessToken.length>8192||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(accessToken)||!refreshToken||!/^[-\w.]{8,2048}$/.test(refreshToken)) throw new Error('Reset-Link ist unvollständig. Bitte eine neue Recovery-Mail anfordern oder deinen Familien-Administrator kontaktieren.');
  return {kind:'recovery',accessToken,refreshToken,familyCode:null};
 }
 if(!kind&&!token) return null;
 if(!['invite','recovery'].includes(kind)||!token||!/^[a-f0-9]{32,128}$/i.test(token)|| (kind==='invite'&&(!familyCode||!/^[a-f0-9]{32}$/i.test(familyCode)))) throw new Error('Einladungs- oder Reset-Link ist unvollständig. Bitte beim Admin einen neuen Link anfordern.');
 return {kind,token,familyCode:kind==='invite'?familyCode:null};
}
export async function redeemAccessLink(sb,link) {
 const result=link.accessToken?await sb.auth.setSession({access_token:link.accessToken,refresh_token:link.refreshToken}):await sb.auth.verifyOtp({token_hash:link.token,type:link.kind});
 if(result.error||!result.data?.session) throw new Error('Link ist ungültig, abgelaufen oder bereits verwendet. Bitte beim Admin einen neuen Link anfordern.');
 return result.data;
}
export const RECOVERY_MESSAGE='Falls für diese Adresse eine Wiederherstellung möglich ist, erhältst du eine E-Mail. Falls du keine E-Mail erhältst, prüfe bitte deinen Spam-Ordner und wende dich anschließend an deinen Familien-Administrator.';
export async function requestRecoveryEmail(sb,email) {
 const result=await sb.auth.resetPasswordForEmail(email,{redirectTo:'https://vbcoco.github.io/Famkal/'});
 // Account existence, organization membership and mail quota must not be exposed.
 if(result.error&&(!result.error.status||result.error.status>=500)) throw new Error('Die Anfrage konnte gerade nicht abgeschlossen werden. Bitte Verbindung prüfen und später erneut versuchen. Du kannst dich auch an deinen Familien-Administrator wenden.');
 return RECOVERY_MESSAGE;
}
export async function requestAccessLink(sb,action,target,calendarId) {
 const result=await sb.functions.invoke('family-access',{body:action==='invite'?{action,email:target,calendar_id:calendarId}:{action,target_user_id:target}});
 if(result.error) {
  let message='Link konnte nicht erstellt werden. Bitte Rechte und Verbindung prüfen.';
  try { const details=await result.error.context?.json();if(details?.error)message=details.error; }catch{}
  throw new Error(message);
 }
 const url=new URL(result.data.url);
 if(url.origin!=='https://vbcoco.github.io'||url.pathname!=='/Famkal/'||!parseAccessLink(url.hash)) throw new Error('Ungültiger Link vom Server');
 return result.data;
}

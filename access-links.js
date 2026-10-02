export function parseAccessLink(hash) {
 const params=new URLSearchParams(hash.replace(/^#/,'')),kind=params.get('famkal_type'),token=params.get('token_hash'),familyCode=params.get('family_code');
 if(!kind&&!token) return null;
 if(!['invite','recovery'].includes(kind)||!token||!/^[a-f0-9]{32,128}$/i.test(token)|| (kind==='invite'&&(!familyCode||!/^[a-f0-9]{32}$/i.test(familyCode)))) throw new Error('Einladungs- oder Reset-Link ist unvollständig. Bitte beim Admin einen neuen Link anfordern.');
 return {kind,token,familyCode:kind==='invite'?familyCode:null};
}
export async function redeemAccessLink(sb,link) {
 const result=await sb.auth.verifyOtp({token_hash:link.token,type:link.kind});
 if(result.error||!result.data?.session) throw new Error('Link ist ungültig, abgelaufen oder bereits verwendet. Bitte beim Admin einen neuen Link anfordern.');
 return result.data;
}
export async function requestAccessLink(sb,action,target) {
 const result=await sb.functions.invoke('family-access',{body:action==='invite'?{action,email:target}:{action,target_user_id:target}});
 if(result.error) {
  let message='Link konnte nicht erstellt werden. Bitte Rechte und Verbindung prüfen.';
  try { const details=await result.error.context?.json();if(details?.error)message=details.error; }catch{}
  throw new Error(message);
 }
 const url=new URL(result.data.url);
 if(url.origin!=='https://vbcoco.github.io'||url.pathname!=='/Famkal/'||!parseAccessLink(url.hash)) throw new Error('Ungültiger Link vom Server');
 return result.data;
}

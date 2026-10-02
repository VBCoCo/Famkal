// Real Auth integration check using disposable, isolated fixture accounts.
// No privileged client, service key or extra server endpoint is used.
// Usage: node tests/auth-e2e.mjs /path/to/temporary-fixtures.json
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {createClient} from '@supabase/supabase-js';
const fixtures=JSON.parse(await readFile(process.argv[2],'utf8'));
const context={window:{}};vm.runInNewContext(await readFile(new URL('../config.js',import.meta.url),'utf8'),context);
const config=context.window.APP_CONFIG;
const client=()=>createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const passed=[];
const must=(condition,label)=>{if(!condition)throw new Error(label);passed.push(label);};
const ok=(result,label)=>{if(result.error)throw new Error(label+': '+result.error.message);return result.data;};
const password=()=>`Famkal9!${randomUUID()}`;
async function call(jwt,body){
 const response=await fetch(config.SUPABASE_URL+'/functions/v1/family-access',{method:'POST',headers:{authorization:'Bearer '+jwt,apikey:config.SUPABASE_ANON_KEY,'content-type':'application/json',origin:'https://vbcoco.github.io'},body:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
try {
 const signup=await client().auth.signUp({email:`famkal-e2e-${fixtures.run}-public@example.com`,password:password()});
 must(signup.error?.code==='signup_disabled','Public registration rejected');
 const a=fixtures.owners[0];
 const owner=client(),ownerSession=ok(await owner.auth.signInWithPassword({email:a.email,password:a.password}),'Test owner login').session;
 const invitation=await call(ownerSession.access_token,{action:'invite',email:fixtures.invite_email});
 must(invitation.status===200&&invitation.data.kind==='invite','Owner can generate invitation without SMTP');
 const fragment=new URLSearchParams(new URL(invitation.data.url).hash.slice(1));
 must(fragment.get('family_code')?.length===32,'Invitation has reserved family code');
 const member=client(),redeemed=ok(await member.auth.verifyOtp({type:'invite',token_hash:fragment.get('token_hash')}),'Redeem invite');
 must(!!redeemed.session&&redeemed.user.email===fixtures.invite_email,'Invite creates correct authenticated session');
 const weak=await member.auth.updateUser({password:'Short123'});
 must(weak.error?.code==='weak_password','Server rejects password below twelve characters');
 const newPassword=password();ok(await member.auth.updateUser({password:newPassword}),'Set invited password');
 ok(await member.rpc('join_family',{p_code:fragment.get('family_code')}),'Join invited family');
 must(ok(await member.rpc('my_family_id'),'Check family')===a.family,'Invitee joins intended family');
 must(!!(await client().auth.verifyOtp({type:'invite',token_hash:fragment.get('token_hash')})).error,'Used invitation cannot be redeemed again');
 const signedIn=ok(await client().auth.signInWithPassword({email:fixtures.invite_email,password:newPassword}),'Invited account login');
 must(!!signedIn.session,'Invited account can log in with chosen password');
 must((await call(signedIn.session.access_token,{action:'invite',email:`famkal-e2e-${fixtures.run}-denied@example.com`})).status===403,'Member cannot issue invitations');
 const b=fixtures.owners[1],second=client();
 const secondSession=ok(await second.auth.signInWithPassword({email:b.email,password:b.password}),'Recovery test owner login').session;
 const recovery=await call(secondSession.access_token,{action:'recovery',target_user_id:b.id});
 must(recovery.status===200&&recovery.data.kind==='recovery','Owner can generate own recovery link without SMTP');
 const resetHash=new URLSearchParams(new URL(recovery.data.url).hash.slice(1));
 must(!resetHash.has('family_code'),'Recovery does not grant a family invitation');
 const reset=client();ok(await reset.auth.verifyOtp({type:'recovery',token_hash:resetHash.get('token_hash')}),'Redeem recovery');
 const resetPassword=password();ok(await reset.auth.updateUser({password:resetPassword}),'Change recovered password');
 must(!!(await client().auth.signInWithPassword({email:b.email,password:b.password})).error,'Old recovered password is rejected');
 must(!!ok(await client().auth.signInWithPassword({email:b.email,password:resetPassword}),'Recovered account login').session,'Recovered account accepts new password');
 console.log(JSON.stringify({ok:true,passed}));
} catch(error) {console.log(JSON.stringify({ok:false,passed,failed:error.message}));process.exitCode=1;}

import test from 'node:test';import assert from 'node:assert/strict';
import {parseAccessLink,redeemAccessLink,requestAccessLink,requestRecoveryEmail,RECOVERY_MESSAGE} from '../access-links.js';
const token='a'.repeat(56),code='b'.repeat(32);
test('standard mail recovery accepts only complete recovery fragments and rejects expired links',()=>{
 assert.deepEqual(parseAccessLink('#type=recovery&access_token=header.payload.signature&refresh_token=refresh-token'),{kind:'recovery',accessToken:'header.payload.signature',refreshToken:'refresh-token',familyCode:null});
 assert.throws(()=>parseAccessLink('#type=recovery&access_token=header.payload.signature'));
 assert.throws(()=>parseAccessLink('#type=invite&access_token=header.payload.signature&refresh_token=refresh-token'));
 assert.throws(()=>parseAccessLink('#error=access_denied&error_code=otp_expired'),/abgelaufen/);
});
test('mail fragment session is validated by Auth and invalid tokens are rejected',async()=>{
 let args;const sb={auth:{setSession:async value=>{args=value;return {data:{session:{},user:{id:'u'}}};}}};
 const link={kind:'recovery',accessToken:'header.payload.signature',refreshToken:'refresh-token'};
 await redeemAccessLink(sb,link);assert.deepEqual(args,{access_token:link.accessToken,refresh_token:link.refreshToken});
 sb.auth.setSession=async()=>({error:{}});await assert.rejects(redeemAccessLink(sb,link),/ungültig/);
});
test('recovery requests do not disclose unknown accounts, mail authorization or mail quota',async()=>{
 let sent;const sb={auth:{resetPasswordForEmail:async(...args)=>{sent=args;return {data:{}};}}};
 assert.equal(await requestRecoveryEmail(sb,'owner@example.com'),RECOVERY_MESSAGE);
 assert.deepEqual(sent,['owner@example.com',{redirectTo:'https://vbcoco.github.io/Famkal/'}]);
 for(const status of [400,403,429]){sb.auth.resetPasswordForEmail=async()=>({error:{status,message:'private details'}});assert.equal(await requestRecoveryEmail(sb,'owner@example.com'),RECOVERY_MESSAGE);}
 sb.auth.resetPasswordForEmail=async()=>({error:{status:503}});await assert.rejects(requestRecoveryEmail(sb,'owner@example.com'),/Verbindung/);
});
test('invite links require an Auth token and family code, recovery needs no family code',()=>{
 assert.deepEqual(parseAccessLink('#famkal_type=invite&token_hash='+token+'&family_code='+code),{kind:'invite',token,familyCode:code});
 assert.equal(parseAccessLink('#famkal_type=recovery&token_hash='+token).familyCode,null);
 assert.throws(()=>parseAccessLink('#famkal_type=invite&token_hash='+token));
 assert.throws(()=>parseAccessLink('#famkal_type=evil&token_hash='+token));
});
test('redemption consumes the specified token and rejects reused or expired links',async()=>{
 let args;const sb={auth:{verifyOtp:async value=>{args=value;return {data:{session:{},user:{id:'u'}}};}}};
 await redeemAccessLink(sb,{kind:'invite',token});assert.deepEqual(args,{type:'invite',token_hash:token});
 sb.auth.verifyOtp=async()=>({error:{}});await assert.rejects(redeemAccessLink(sb,{kind:'invite',token}),/abgelaufen/);
});
test('request rejects a foreign-origin response and uses a target ID for resets',async()=>{
 let body;const sb={functions:{invoke:async(name,args)=>{body=args.body;return {data:{url:'https://evil.invalid/#token_hash='+token}};}}};
 await assert.rejects(requestAccessLink(sb,'recovery','u'),/Ungültiger Link/);assert.deepEqual(body,{action:'recovery',target_user_id:'u'});
});

import test from 'node:test';import assert from 'node:assert/strict';
import {parseAccessLink,redeemAccessLink,requestAccessLink} from '../access-links.js';
const token='a'.repeat(56),code='b'.repeat(32);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {createECDH,randomBytes} from 'node:crypto';
import {makeHandler,validSubscription,reminderPayload} from '../supabase/functions/send-reminders/handler.mjs';
const id='11111111-1111-4111-8111-111111111111';
const curve=createECDH('prime256v1');curve.generateKeys();
const subscription={endpoint:'https://web.push.apple.com/test',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
const vapid=webpush.generateVAPIDKeys();
function fixture({user='owner',job=true,status=201,sendError=false,testAllowed=true}={}) {
 const calls=[],sent=[],config={...vapid,cronSecret:'private-cron-secret'};
 const client={auth:{getUser:async token=>({data:{user:token==='valid'?{id:user}:null},error:null})},rpc:async(name,args)=>{
  calls.push({name,args});return {error:null,data: name==='push_config'?config:name==='claim_push'?[{id,token:id}]:name==='prepare_push'?(job?{subscription,event_id:id,title:'Kieferorthopäde',roles:'Bringen · Zuständig',start_at:new Date(Date.now()+60000).toISOString(),reminder_minutes:1,tag:id}:null):name==='claim_push_test'?(testAllowed?subscription:null):null};
 }};
 const handler=makeHandler(()=>client,()=>'',async(sub,payload,keys,options)=>{sent.push({sub,payload,options});if(sendError)throw Error('Network secret');return status;});
 const request=(body,headers={})=>handler(new Request('https://project.supabase.co/functions/v1/send-reminders',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 return {calls,sent,request};
}
test('push endpoints reject SSRF, credentials, redirects and malformed keys',()=>{
 assert.equal(validSubscription(subscription),true);
 for(const endpoint of ['https://127.0.0.1/private','https://web.push.apple.com.evil.test/x','https://secret@web.push.apple.com/x','http://web.push.apple.com/x','https://web.push.apple.com:8443/x','https://web.push.apple.com/x#secret'])assert.equal(validSubscription({...subscription,endpoint}),false);
 assert.equal(validSubscription({...subscription,keys:{auth:'x',p256dh:'x'}}),false);
});
test('real library encrypts a valid notification and creates VAPID authorization',()=>{
 const details=webpush.generateRequestDetails(subscription,JSON.stringify({title:'Test'}),{vapidDetails:{...vapid,subject:'https://vbcoco.github.io/Famkal/'},TTL:60,contentEncoding:'aes128gcm'});
 assert.ok(details.body.length>50);assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.match(details.headers.Authorization,/vapid/);assert.equal(details.endpoint,subscription.endpoint);
});
test('anonymous, forged cron, wrong origin and invalid user cannot send',async()=>{
 const f=fixture();
 assert.equal((await f.request({action:'drain'})).status,401);
 assert.equal((await f.request({action:'drain'},{'x-famkal-cron':'forged'})).status,401);
 assert.equal((await f.request({action:'test',subscription_id:id},{authorization:'Bearer invalid'})).status,401);
 assert.equal((await f.request({action:'test',subscription_id:id},{authorization:'Bearer valid',origin:'https://evil.test'})).status,403);
 assert.equal(f.sent.length,0);assert.ok(!f.calls.some(x=>['claim_push','claim_push_test'].includes(x.name)));
});
test('explicit test targets only server-authorized own subscription and is uncached',async()=>{
 const f=fixture();const r=await f.request({action:'test',subscription_id:id,user_id:'outsider',endpoint:'https://evil.test'},{authorization:'Bearer valid'});
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(f.calls.find(x=>x.name==='claim_push_test').args,{p_id:id,p_user:'owner'});assert.equal(f.sent[0].sub.endpoint,subscription.endpoint);assert.equal(f.sent[0].options.ttl,60);
 const denied=fixture({testAllowed:false});assert.equal((await denied.request({action:'test',subscription_id:id},{authorization:'Bearer valid'})).status,429);assert.equal(denied.sent.length,0);
});
test('drain revalidates every claim and records successful delivery with stable tag',async()=>{
 const f=fixture();const r=await f.request({action:'drain'},{'x-famkal-cron':'private-cron-secret'});assert.equal(r.status,200);assert.equal((await r.json()).sent,1);
 const sent=f.sent[0];assert.match(sent.payload.body,/Bringen · Zuständig/);assert.equal(sent.payload.url,'https://vbcoco.github.io/Famkal/?event='+id);assert.equal(sent.payload.tag,'famkal-'+id);
 assert.ok(f.calls.some(x=>x.name==='prepare_push'));assert.equal(f.calls.find(x=>x.name==='finish_push').args.p_status,201);
 const cancelled=fixture({job:false});await cancelled.request({action:'drain'},{'x-famkal-cron':'private-cron-secret'});assert.equal(cancelled.sent.length,0);
});
test('expired devices deactivate, retryable failures stay retryable and responses hide secrets',async()=>{
 const expired=fixture({status:410});const r=await expired.request({action:'test',subscription_id:id},{authorization:'Bearer valid'});assert.equal(r.status,410);assert.ok(expired.calls.some(x=>x.name==='expire_push'));
 const failed=fixture({sendError:true});const reply=await failed.request({action:'drain'},{'x-famkal-cron':'private-cron-secret'});assert.equal(failed.calls.find(x=>x.name==='finish_push').args.p_status,503);assert.ok(!(await reply.text()).includes('secret'));
});
test('notification times use German time during both DST offsets',()=>{
 for(const [start,time] of [['2026-07-01T18:00:00Z','20:00'],['2026-12-01T19:00:00Z','20:00']])assert.ok(reminderPayload({title:'Bettgehzeit',start_at:start,event_id:id,tag:id}).body.includes(time));
});

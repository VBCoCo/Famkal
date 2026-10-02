import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';
import {makeHandler} from './handler.mjs';
// Verify the runtime's Node crypto compatibility without contacting a push service.
const probe=webpush.generateVAPIDKeys();
webpush.generateRequestDetails({endpoint:'https://web.push.apple.com/runtime-probe',keys:{p256dh:probe.publicKey,auth:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))}},'runtime probe',{
 vapidDetails:{subject:'https://vbcoco.github.io/Famkal/',...probe},contentEncoding:'aes128gcm',TTL:1
});
const send=async(subscription:object,payload:object,config:any,options:any)=>{
 const details=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{
  vapidDetails:{subject:'https://vbcoco.github.io/Famkal/',publicKey:config.publicKey,privateKey:config.privateKey},
  contentEncoding:'aes128gcm',TTL:options.ttl,urgency:'high',topic:options.topic
 });
 const result=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:new Uint8Array(details.body),redirect:'error',signal:AbortSignal.timeout(8000)});
 await result.body?.cancel();
 return result.status;
};
Deno.serve(makeHandler(createClient,(name:string)=>Deno.env.get(name),send));

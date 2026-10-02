// Explicit isolated test family; credentials are supplied through stdin, never committed.
import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
let input='';for await(const chunk of process.stdin)input+=chunk;
const fixture=JSON.parse(input),context={window:{}};
vm.runInNewContext(await readFile(new URL('../config.js',import.meta.url),'utf8'),context);
const cfg=context.window.APP_CONFIG,sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const curve=createECDH('prime256v1');curve.generateKeys();
const endpoint='https://web.push.apple.com/famkal-api-test-'+fixture.uid;
const subscription={endpoint,keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
let checks=0;const ok=r=>{if(r.error)throw Error(r.error.message);checks++;return r.data;};
try {
 const session=ok(await sb.auth.signInWithPassword({email:fixture.email,password:fixture.password}));assert.equal(session.user.id,fixture.uid);
 const id=ok(await sb.rpc('register_push',{p_subscription:subscription,p_agent:'Isolated API check'}));
 assert.equal(ok(await sb.rpc('register_push',{p_subscription:subscription})),id);
 const own=ok(await sb.from('push_subscriptions').select('id,is_active').eq('user_id',fixture.uid));assert.equal(own.length,1);assert.equal(own[0].is_active,true);
 const secrets=await sb.rpc('push_config');assert.ok(secrets.error);assert.equal(secrets.data,null);checks++;
 const direct=await sb.from('push_subscriptions').update({is_active:false}).eq('id',id);assert.ok(direct.error);checks++;
 const invalid=await sb.rpc('register_push',{p_subscription:{...subscription,endpoint:'https://127.0.0.1/private'}});assert.ok(invalid.error);checks++;
 // Auth verification and ownership denial: no push provider is contacted.
 const foreign=await sb.functions.invoke('send-reminders',{body:{action:'test',subscription_id:'00000000-0000-4000-8000-000000000000'}});assert.ok(foreign.error);assert.equal(foreign.error.context.status,429);checks++;
 ok(await sb.rpc('disable_push',{p_endpoint:endpoint}));
 const inactive=ok(await sb.from('push_subscriptions').select('is_active').eq('id',id).single());assert.equal(inactive.is_active,false);
 console.log(`${checks} real push API checks passed; no device notification sent`);
} finally {await sb.auth.signOut();}

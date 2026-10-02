import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPushSettings,pushSupport,disablePushDevice} from '../push-settings.js';
const wait=()=>new Promise(r=>setTimeout(r,15));
function fixture({permission='default',active=false,current=true,ios=false,installed=true}={}){
 const dom=new JSDOM('<div id="root"></div>'),w=dom.window,calls=[];let sub=active?subscription():null;
 function subscription(){return {endpoint:'https://web.push.apple.com/test',toJSON:()=>({endpoint:'https://web.push.apple.com/test',keys:{auth:'a',p256dh:'b'}}),unsubscribe:async()=>{calls.push('unsubscribe');sub=null;return true;}};}
 Object.defineProperty(w.navigator,'userAgent',{value:ios?'iPhone':'Chrome'});Object.defineProperty(w.navigator,'standalone',{value:installed});
 w.matchMedia=()=>({matches:installed});w.PushManager=function(){};
 w.Notification={permission,requestPermission:async()=>{calls.push('permission');w.Notification.permission='granted';return 'granted';}};
 const reg={pushManager:{getSubscription:async()=>sub,subscribe:async options=>{calls.push({subscribe:options});sub=subscription();return sub;}}};
 Object.defineProperty(w.navigator,'serviceWorker',{value:{ready:Promise.resolve(reg),getRegistration:async()=>reg}});
 const sb={from(){const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:active?{id:'own-device',is_active:true}:null,error:null})};return query;},rpc:async(name,args)=>{calls.push({name,args});return {data:name==='register_push'?'own-device':null,error:null};},functions:{invoke:async(name,args)=>{calls.push({name,args});return {data:{message:'Test übergeben'},error:null};}}};
 const root=w.document.getElementById('root');
 mountPushSettings(root,sb,'owner','B'+'a'.repeat(86),()=>current);
 return {dom,w,root,calls,sb,setCurrent(value){current=value;},close:()=>dom.window.close()};
}
test('iPhone Safari tab explains installation and never requests permission automatically',async()=>{
 const f=fixture({ios:true,installed:false});try{await wait();assert.match(f.root.textContent,/Symbol auf dem Home-Bildschirm/);assert.equal(f.root.querySelector('#enablePush').disabled,true);assert.equal(f.calls.length,0);}finally{f.close();}
});
test('device activation asks permission on click, registers own subscription, test is explicit',async()=>{
 const f=fixture();try{
  await wait();assert.equal(f.calls.length,0);f.root.querySelector('#enablePush').click();assert.equal(f.calls[0],'permission');await wait();
  assert.equal(f.calls.find(c=>c.name==='register_push').args.p_subscription.endpoint,'https://web.push.apple.com/test');assert.equal(f.root.querySelector('#testPush').disabled,false);
  assert.ok(!f.calls.some(c=>c.name==='send-reminders'));f.root.querySelector('#testPush').click();await wait();
  assert.deepEqual(f.calls.find(c=>c.name==='send-reminders').args.body,{action:'test',subscription_id:'own-device'});assert.match(f.root.textContent,/Test übergeben/);
 }finally{f.close();}
});
test('denied permission shows settings instructions and keeps activation disabled',async()=>{
 const f=fixture({permission:'denied'});try{await wait();assert.match(f.root.textContent,/blockiert/);assert.match(f.root.textContent,/iPhone-Einstellungen/);assert.equal(f.root.querySelector('#enablePush').disabled,true);}finally{f.close();}
});
test('deactivation and logout unregister backend before unsubscribing only this device',async()=>{
 const f=fixture({active:true,permission:'granted'});try{
  await wait();f.root.querySelector('#disablePush').click();await wait();assert.equal(f.calls[0].name,'disable_push');assert.equal(f.calls[1],'unsubscribe');assert.equal(f.root.querySelector('#enablePush').disabled,false);
 }finally{f.close();}
 const logout=fixture({active:true});try{await wait();await disablePushDevice(logout.sb,logout.w);assert.equal(logout.calls[0].name,'disable_push');assert.equal(logout.calls[1],'unsubscribe');}finally{logout.close();}
});
test('closed or changed account never registers a stale device',async()=>{
 const f=fixture();try{await wait();f.setCurrent(false);f.root.querySelector('#enablePush').click();await wait();assert.ok(!f.calls.some(c=>c.name==='register_push'));}finally{f.close();}
});
test('unsupported devices receive an explanation, not an activation promise',()=>{
 assert.match(pushSupport({navigator:{userAgent:'Other',platform:'',maxTouchPoints:0},matchMedia:()=>({matches:false})}),/unterstützt keine/);
});

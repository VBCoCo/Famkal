import test from 'node:test';import assert from 'node:assert/strict';
import {makeHandler} from '../supabase/functions/family-access/handler.mjs';
function fixture({authError=null,prepareError=null,finishError=null}={}) {
 const calls=[],client={auth:{getUser:async token=>{calls.push(['verify',token]);return {data:{user:{id:'verified-actor'}},error:authError};},admin:{generateLink:async params=>{calls.push(['generate',params]);return {data:{properties:{hashed_token:'a'.repeat(56)},user:{id:'target'}}};}}},
 rpc:async(name,args)=>{calls.push([name,args]);return name.startsWith('prepare')?{data:{request_id:'request',email:'target@example.invalid',link_type:'invite'},error:prepareError}:{data:{family_code:'b'.repeat(32)},error:finishError};}};
 return {calls,handler:makeHandler(()=>client,()=> 'server-only')};
}
const request=(body,headers={authorization:'Bearer test-token'})=>new Request('https://example.invalid',{method:'POST',headers,body:JSON.stringify(body)});
test('anonymous and invalid sessions cannot generate links',async()=>{
 const f=fixture();assert.equal((await f.handler(request({action:'invite',calendar_id:'11111111-1111-4111-8111-111111111111',email:'x@example.invalid'},{}))).status,401);assert.equal(f.calls.length,0);
 const g=fixture({authError:{}});assert.equal((await g.handler(request({action:'invite',calendar_id:'11111111-1111-4111-8111-111111111111',email:'x@example.invalid'}))).status,401);assert.equal(g.calls.length,1);
});
test('database denial stops privileged Auth call',async()=>{
 const f=fixture({prepareError:{message:'Not an admin'}});assert.equal((await f.handler(request({action:'invite',calendar_id:'11111111-1111-4111-8111-111111111111',email:'x@example.invalid'}))).status,403);assert.ok(!f.calls.some(x=>x[0]==='generate'));
});
test('identity and redirect are server-controlled, response is uncached and token in fragment',async()=>{
 const f=fixture(),response=await f.handler(request({action:'invite',calendar_id:'11111111-1111-4111-8111-111111111111',email:'x@example.invalid',actor:'attacker',redirectTo:'https://evil.invalid'}));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(f.calls.find(x=>x[0]==='prepare_family_access_link_v170')[1].p_actor,'verified-actor');
 assert.equal(f.calls.find(x=>x[0]==='generate')[1].options.redirectTo,'https://vbcoco.github.io/Famkal/');
 const data=await response.json(),url=new URL(data.url);assert.equal(url.search,'');assert.match(url.hash,/token_hash=/);
});
test('revoked membership during generation does not return a login token',async()=>{
 const f=fixture({finishError:{message:'Permission changed'}}),response=await f.handler(request({action:'invite',calendar_id:'11111111-1111-4111-8111-111111111111',email:'x@example.invalid'}));assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/token_hash|aaaaaa/);
});
test('other origins and unsupported actions are rejected',async()=>{
 const f=fixture();assert.equal((await f.handler(request({action:'invite',calendar_id:'11111111-1111-4111-8111-111111111111',email:'x@example.invalid'},{origin:'https://evil.invalid'}))).status,403);
 assert.equal((await f.handler(request({action:'signup',email:'x@example.invalid'}))).status,400);
});

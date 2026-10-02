import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountProjectList} from '../project-list.js';
const item={id:'i1',item_no:1,title:'<img src=x onerror=alert(1)>',description:'Beschreibung',status:'collected',category:'feature',priority:'high',created_at:'2026-10-02T06:00:00Z',updated_at:'2026-10-02T06:00:00Z'};
function fixture({error=null,historyError=null}={}) {
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),calls=[];
 const sb={from(table){const q={filters:[],select(){return this;},eq(...args){this.filters.push(args);return this;},order(){return this;},range(){return this;},then(resolve){calls.push({table,filters:this.filters});return Promise.resolve({data:table==='project_items'?[item,{...item,id:'i2',item_no:2,title:'Erledigter Punkt',status:'verified',completed_version:'1.1.0'}]:table==='project_releases'?[{id:'r1',version:'1.1.0',status:'released',notes:'Freigegeben',created_at:item.created_at,released_at:item.created_at}]:[{operation:'INSERT',changed_at:item.created_at,source:'chat',change_note:'Aufgenommen',old_values:null,new_values:item}],error:table==='project_item_history'?historyError:error}).then(resolve);}};return q;}};
 return {dom,root,sb,calls};
}
test('project list defaults to open, escapes content and filters completed items',async()=>{
 const f=fixture();try{await mountProjectList(f.root,f.sb,'family');
  assert.equal(f.root.querySelector('img'),null);assert.match(f.root.textContent,/<img/);assert.doesNotMatch(f.root.textContent,/Erledigter Punkt/);
  f.root.querySelector('[data-project-filter=done]').click();assert.match(f.root.textContent,/Erledigter Punkt/);
  assert.ok(f.calls.every(call=>call.filters.some(([key,value])=>key==='family_id'&&value==='family')));
 }finally{f.dom.window.close();}
});
test('history is loaded only on request and scoped to item and family',async()=>{
 const f=fixture();try{await mountProjectList(f.root,f.sb,'family');assert.equal(f.calls.length,2);
  f.root.querySelector('[data-project-history]').click();await new Promise(r=>setTimeout(r,10));
  assert.match(f.root.textContent,/Aufgenommen/);assert.match(f.root.textContent,/Chat/);
  assert.deepEqual(f.calls[2].filters,[['family_id','family'],['item_id','i1']]);
  assert.equal(f.root.querySelector('input,textarea,select'),null);
 }finally{f.dom.window.close();}
});
test('failed reads show an actionable error rather than empty backlog',async()=>{
 const f=fixture({error:{message:'denied'}});try{await mountProjectList(f.root,f.sb,'family');assert.match(f.root.textContent,/konnte nicht geladen/);assert.match(f.root.textContent,/Erneut laden/);}finally{f.dom.window.close();}
});
test('stale project response cannot overwrite a closed profile or another session',async()=>{
 const f=fixture();try{await mountProjectList(f.root,f.sb,'family',()=>false);assert.doesNotMatch(f.root.textContent,/Beschreibung/);}finally{f.dom.window.close();}
});

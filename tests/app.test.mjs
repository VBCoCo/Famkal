import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*$/gm,'');
import * as utils from '../calendar-utils.js';
function fixture({rows=[]}={}) {
  const dom=new JSDOM(html,{url:'https://vbcoco.github.io/Famkal/',runScripts:'outside-only'});
  const w=dom.window,calls=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  const sb={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({data:{}})},from(table){
    const q={action:'read',filters:[],select(){return this;},eq(...args){this.filters.push(args);return this;},gte(){return this;},lte(){return this;},order(){return this;},range(){return this;},update(){this.action='update';return this;},insert(){this.action='insert';return this;},delete(){this.action='delete';return this;},maybeSingle(){return this;},single(){return this;},then(resolve){calls.push({table,action:this.action});return Promise.resolve({data:table==='family_members'&&this.action==='read'?[member]:rows,error:null}).then(resolve);}};
    return q;
  },rpc:async()=>({data:null,error:null})};
  const member={user_id:'u1',family_id:'f1',display_name:'Robert',color:'#355c50',role:'owner',default_reminder_minutes:0};
  Object.assign(w,{...utils,esc:utils.escapeHtml,createClient:()=>sb});
  w.eval(app.replace(/start\(\);\s*$/,'sb=createClient(); bindUI();')+'\nwindow.testApp={openEvent,payload,card,askScope,setState(){user={id:"u1"};member='+JSON.stringify(member)+';members=[member];events=[];series=[];},setRole(role){member.role=role;},setSeries(value){series=value;},refreshAll};');
  w.testApp.setState();
  return {dom,w,calls,close:()=>dom.window.close()};
}
test('event editor preserves zero-minute default and all-day clears payload times',()=>{
  const f=fixture();try {
    f.w.testApp.openEvent();
    assert.equal(f.w.document.querySelector('#reminders input').value,'0');
    f.w.document.querySelector('#startTime').value='14:00';f.w.document.querySelector('#allDay').value='true';
    assert.equal(f.w.testApp.payload().start_time,null);
  }finally{f.close();}
});
test('cancel closes series scope without submitting an action',async()=>{
  const f=fixture();try {
    let calls=0;f.w.testApp.askScope(()=>{calls++;});
    f.w.document.querySelector('[data-scope=cancel]').click();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.w.document.querySelector('#scopeDialog').open,false);assert.equal(calls,0);
  }finally{f.close();}
});
test('member cannot choose following or whole-series scope',()=>{
  const f=fixture();try {f.w.testApp.setRole('member');f.w.testApp.askScope(()=>{});
    assert.equal(f.w.document.querySelector('[data-scope=following]').disabled,true);
    assert.equal(f.w.document.querySelector('[data-scope=series]').disabled,true);
    assert.equal(f.w.document.querySelector('[data-scope=single]').disabled,false);
  }finally{f.close();}
});
test('zero-row update is not reported as saved',async()=>{
  const f=fixture();try {
    f.w.testApp.openEvent({id:'e1',created_by:'u1',event_date:'2026-10-01',title:'Test',event_type:'appointment',all_day:true,reminders:[]});
    f.w.document.querySelector('#eventForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(f.w.document.querySelector('#toast').textContent,/Nicht gespeichert/);
    assert.equal(f.w.document.querySelector('#eventDialog').open,true);
  }finally{f.close();}
});
test('week navigation triggers a new backend read',async()=>{
  const f=fixture();try {
    f.w.document.querySelector('#nextWeek').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(f.calls.some(c=>c.table==='events'));
  }finally{f.close();}
});
test('series metadata is visible but ineffective recurrence changes are disabled',()=>{
  const f=fixture();try {
    f.w.testApp.setSeries([{id:'s1',recurrence:'weekly',ends_on:'2027-01-01'}]);
    f.w.testApp.openEvent({id:'e1',series_id:'s1',created_by:'u1',title:'Test',event_date:'2026-10-01',reminders:[]});
    assert.equal(f.w.document.querySelector('#recurrence').value,'weekly');
    assert.equal(f.w.document.querySelector('#recurrence').disabled,true);
    assert.equal(f.w.document.querySelector('#recurrenceEnd').value,'2027-01-01');
  }finally{f.close();}
});

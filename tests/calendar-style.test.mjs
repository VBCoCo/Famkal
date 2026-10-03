import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {assignmentColors} from '../calendar-utils.js';

test('card border stays transparent across the complete stylesheet for every assignment',()=>{
  const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  const people=[{user_id:'robert',color:'#0061fe'},{user_id:'pink',color:'#ff69b4'}];
  const events=[{assignee_id:'robert'},{assignments:[{role:'assignee',test_member_id:'pink'}]},{assignee_all:true},{}];
  const dom=new JSDOM('<style>'+css+'</style>'+events.map((event,i)=>'<article class="event-card" id="card'+i+'" style="--assignment:'+assignmentColors(event,people)+'"></article>').join('')+'<article class="event-card cancelled" id="cancelled"></article>');
  try {
    const rules=[...dom.window.document.styleSheets[0].cssRules];
    const base=rules.filter(rule=>rule.selectorText==='.event-card');
    assert.equal(base.length,1,'card base styles must have one owner');
    assert.match(base[0].style.getPropertyValue('background'),/var\(--assignment/);
    for(let i=0;i<events.length;i++){
      const card=dom.window.document.getElementById('card'+i),style=dom.window.getComputedStyle(card);
      assert.equal(style.borderLeftColor,'rgba(0, 0, 0, 0)');
      assert.equal(style.borderTopColor,'rgba(0, 0, 0, 0)');
      assert.equal(style.borderLeftWidth,'10px');
      assert.equal(style.borderTopWidth,'2px');
    }
    assert.equal(dom.window.document.getElementById('card0').style.getPropertyValue('--assignment'),'#0061fe');
    assert.equal(dom.window.document.getElementById('card1').style.getPropertyValue('--assignment'),'#ff69b4');
    assert.equal(dom.window.document.getElementById('card2').style.getPropertyValue('--assignment'),'linear-gradient(180deg,#0061fe,#ff69b4)');
    assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById('cancelled')).getPropertyValue('--event-surface'),'#f3f3f3');
  } finally {dom.window.close();}
});

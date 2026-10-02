const check=result=>{if(result.error)throw result.error;return result.data;};
export function pushSupport(w=window) {
 const ios=/iPad|iPhone|iPod/.test(w.navigator.userAgent)||(w.navigator.platform==='MacIntel'&&w.navigator.maxTouchPoints>1);
 if(ios&&!w.navigator.standalone&&!w.matchMedia('(display-mode: standalone)').matches)return 'Öffne Famkal über das Symbol auf dem Home-Bildschirm. In einem normalen Safari-Tab können iPhone-Mitteilungen nicht aktiviert werden.';
 if(!('serviceWorker' in w.navigator)||!('PushManager' in w)||!('Notification' in w))return 'Dieser Browser unterstützt keine Push-Mitteilungen. Auf dem iPhone wird iOS 16.4 oder neuer benötigt.';
 return '';
}
export function applicationKey(value) {
 return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
const registration=w=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('App noch nicht bereit. Bitte Famkal aktualisieren und erneut öffnen.')),8000);w.navigator.serviceWorker.ready.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
export async function disablePushDevice(sb,w=window) {
 const {navigator}=w;
 if(!navigator.serviceWorker)return;
 const reg=await navigator.serviceWorker.getRegistration();
 const subscription=await reg?.pushManager?.getSubscription();
 if(subscription){check(await sb.rpc('disable_push',{p_endpoint:subscription.endpoint}));await subscription.unsubscribe();}
}
export function mountPushSettings(root,sb,userId,publicKey,isCurrent=()=>true) {
 const w=root.ownerDocument.defaultView,{navigator,Notification}=w;
 root.innerHTML='<h3>Erinnerungen auf diesem Gerät</h3><p id="pushStatus" role="status">Gerätestatus wird geprüft …</p><div class="push-actions"><button type="button" id="enablePush" class="primary" disabled>Push-Erinnerungen aktivieren</button><button type="button" id="testPush" class="secondary" disabled>Testnachricht senden</button><button type="button" id="disablePush" class="secondary" disabled>Auf diesem Gerät deaktivieren</button></div>'+
 '<details class="push-guide"><summary>iPhone: Mitteilungen Schritt für Schritt einrichten</summary><ol><li>Famkal in Safari öffnen. Teilen → Zum Home-Bildschirm → falls angeboten „Als Web-App öffnen“ einschalten → Hinzufügen.</li><li>Famkal über das neue Symbol öffnen und mit deinem eigenen Familienkonto anmelden. Wenn du das bereits getan hast, beginne mit Schritt 3.</li><li>Mehr → Benachrichtigungen → „Push-Erinnerungen aktivieren“ antippen.</li><li>Die iPhone-Abfrage mit „Erlauben“ bestätigen.</li><li>„Testnachricht senden“ antippen und prüfen, ob sie ankommt. Danach auch bei geschlossener Famkal-App testen.</li></ol><p>Bereits abgelehnt? iPhone-Einstellungen → Mitteilungen → Famkal beziehungsweise den gewählten App-Namen → Mitteilungen erlauben. Dort Sperrbildschirm, Banner und Töne einstellen. Ein aktiver Fokus kann Mitteilungen stummschalten.</p><p>Jede Person aktiviert jedes eigene Gerät selbst. ChatGPT ist dafür nicht erforderlich.</p></details>'+
 '<p class="small">Erinnerungen gehen an Bringt, Holt und Zuständig. Bei „Alle“ an sämtliche echten Familienmitglieder mit aktivierten Geräten. Ganztägige Termine beziehen sich auf 09:00 Uhr deutscher Zeit. Testmitglieder erhalten keine Nachrichten. Internet ist erforderlich; iOS und Fokus-Einstellungen können die Anzeige verzögern.</p>';
 const $=selector=>root.querySelector(selector),status=$('#pushStatus');let deviceId=null,sub=null;
 const say=text=>{if(isCurrent())status.textContent=text;};
 const controls=(active,blocked=false)=>{if(!isCurrent())return;$('#enablePush').disabled=blocked||active;$('#testPush').disabled=!active;$('#disablePush').disabled=!active;};
 const run=async(action)=>{root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();}catch(error){say(error?.message||'Aktion fehlgeschlagen. Bitte erneut versuchen.');}finally{controls(!!deviceId,!!pushSupport(w)||Notification.permission==='denied');}};
 async function inspect(){
  const unsupported=pushSupport(w);if(unsupported){say(unsupported);controls(false,true);return;}
  if(!publicKey){say('Push-Versand ist noch nicht eingerichtet.');controls(false,true);return;}
  if(Notification.permission==='denied'){say('Mitteilungen sind blockiert. Bitte in den iPhone-Einstellungen erlauben; siehe Anleitung.');controls(false,true);return;}
  const reg=await registration(w);if(!isCurrent())return;
  sub=await reg.pushManager.getSubscription();if(!isCurrent())return;
  const row=sub?check(await sb.from('push_subscriptions').select('id,is_active').eq('user_id',userId).eq('endpoint',sub.endpoint).maybeSingle()):null;
  if(!isCurrent())return;deviceId=row?.is_active?row.id:null;
  controls(!!deviceId);say(deviceId?'Push-Erinnerungen sind auf diesem Gerät aktiviert. Eine Testnachricht prüft die Zustellung.':'Push-Erinnerungen sind auf diesem Gerät noch nicht aktiviert.');
 }
 $('#enablePush').onclick=()=>run(async()=>{
  // Request immediately in the user click handler, before asynchronous setup.
  const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  if(!isCurrent())return;if(permission!=='granted')throw Error('Mitteilungen wurden nicht erlaubt. Du kannst sie später aktivieren; siehe Anleitung.');
  const reg=await registration(w);if(!isCurrent())return;
  sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(publicKey)});
  if(!isCurrent())return;
  deviceId=check(await sb.rpc('register_push',{p_subscription:sub.toJSON(),p_agent:navigator.userAgent}));
  say('Push-Erinnerungen sind aktiviert. Bitte jetzt die Testnachricht senden.');
 });
 $('#testPush').onclick=()=>run(async()=>{
  if(!isCurrent()||!deviceId)return;
  const result=await sb.functions.invoke('send-reminders',{body:{action:'test',subscription_id:deviceId}});
  if(result.error){let message='Testnachricht fehlgeschlagen. Bitte eine Minute warten und erneut versuchen.';try{message=(await result.error.context.json()).error||message;}catch{}throw Error(message);}
  say(result.data.message);
 });
 $('#disablePush').onclick=()=>run(async()=>{
  check(await sb.rpc('disable_push',{p_endpoint:sub.endpoint}));deviceId=null;
  await sub.unsubscribe();sub=null;say('Erinnerungen sind auf diesem Gerät deaktiviert. Andere Geräte bleiben aktiviert.');
 });
 inspect().catch(error=>{say(error.message);controls(false,!!pushSupport(w));});
}

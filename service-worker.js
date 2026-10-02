const CACHE='famkal-shell-1.5.0';
const SHELL=['./','./index.html','./styles.css','./app.js','./access-links.js','./project-list.js','./calendar-utils.js','./vendor/supabase.js','./config.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>(key.startsWith('famkal-shell-')||key.startsWith('familienkalender-'))&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Never intercept Auth/REST, POSTs or cache personal calendar data.
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  event.respondWith((async()=>{
    try { return await fetch(request); }
    catch {
      const cached=await caches.match(request,{ignoreSearch:true});
      if(cached)return cached;
      if(request.mode==='navigate')return (await caches.match(new URL('./index.html',self.registration.scope).href))||Response.error();
      return Response.error();
    }
  })());
});
self.addEventListener('push',event=>{
  let data={title:'Familienkalender',body:'Neue Erinnerung'};
  try { data={...data,...event.data?.json()}; } catch { /* Invalid payload: generic notification only. */ }
  event.waitUntil(self.registration.showNotification(String(data.title),{body:String(data.body),icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',data:{url:data.url||'./'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const scope=new URL(self.registration.scope);
  let target;
  try { target=new URL(event.notification.data?.url||'./',scope); } catch { target=scope; }
  if(target.origin!==scope.origin||!target.pathname.startsWith(scope.pathname))target=scope;
  event.waitUntil(clients.openWindow(target.href));
});

const CACHE='familienkalender-v1';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest']))));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));
self.addEventListener('push',e=>{const d=e.data?.json()||{title:'Familienkalender',body:'Neue Erinnerung'};e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',data:{url:d.url||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow(e.notification.data?.url||'./'))});

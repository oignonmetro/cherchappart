/* ChercheAppart — service worker (Web Push).
   Affiche les notifications d'annonces et ouvre l'annonce au clic. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "ChercheAppart";
  const options = {
    body: data.body || "Nouvelle annonce correspondant à vos critères.",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    data: { url: data.url || "./" },
    tag: "chercheappart-annonce",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});

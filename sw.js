// Workbench service worker: keeps a copy of the app on this device so it opens offline, and
// fetches the newest version from GitHub Pages whenever there is a connection.
const CACHE = "workbench-app-v3";
const SHELL = ["./index.html", "./install.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/favicon-32.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("workbench-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The app's own files: try the network first (a quick "has it changed?" check), fall back to the
// saved copy when offline or when the network is too slow. Each page is saved under its own name
// ("/" counts as index.html). Everything else (YouTube, radio stations, AI) goes straight to the
// network as before.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = url.origin + (url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname);
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const saved = (await cache.match(key, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match(new URL("index.html", self.registration.scope).href) : undefined);
      const net = fetch(req, { cache: "no-cache" }).then((res) => {
        if (res && res.ok && res.type === "basic") cache.put(key, res.clone());
        return res;
      });
      if (!saved) return net;
      // with a saved copy, wait at most 4 seconds for the network before opening the saved one
      const slow = new Promise((r) => setTimeout(() => r(null), 4000));
      try {
        const res = await Promise.race([net, slow]);
        return res && res.ok ? res : saved;
      } catch {
        return saved;
      }
    })(),
  );
});

// Phone notifications from the Workbench Hub on the rig (reminders, follow-ups, money to
// collect), even when Workbench is closed. If Workbench is open on screen, it shows its own
// banner instead. Tapping a notification opens the job or customer it's about.
self.addEventListener("push", (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    m = { title: "Workbench", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const seen = wins.find((c) => c.visibilityState === "visible");
      if (seen) return seen.postMessage({ type: "wb-push", msg: m });
      await self.registration.showNotification(m.title || "Workbench", { body: m.body || "", tag: m.tag || "wb", data: { open: m.open || "" }, icon: "icons/icon-192.png", badge: "icons/favicon-32.png" });
    })(),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || "";
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const w = wins.find((c) => c.url.startsWith(self.registration.scope)) || wins[0];
      if (w) {
        await w.focus();
        if (open) w.postMessage({ type: "wb-open", open });
        return;
      }
      await self.clients.openWindow(self.registration.scope + (open ? "#open=" + encodeURIComponent(open) : ""));
    })(),
  );
});

/* ChercheAppart — service worker de l'extension.
 *
 * - Toutes les N minutes (réglable, défaut 15) : ouvre en arrière-plan un
 *   onglet sur chacune de vos recherches sauvegardées ; le content script
 *   (content-watch.js) extrait les annonces et les envoie ici.
 * - Reçoit aussi passivement les annonces si vous naviguez vous-même sur
 *   une de ces pages entre deux passages programmés.
 * - Envoie les annonces vers Supabase (avec VOTRE session, via un handshake
 *   déclenché depuis le site — bouton "Connecter l'extension").
 *
 * La notification push (qui exige une clé secrète) reste envoyée par le
 * serveur (GitHub Actions), au prochain passage (≤ 30 min) : ce module ne
 * fait qu'alimenter la table `listings` en toute sécurité.
 */

const SUPABASE_URL = "https://plxzievikemytnssnqxm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JTsOY0fdpFHQz-b-uepKcA_N9u_i2EK";
const EXT_LABEL = "🧩 Extension navigateur (Leboncoin/PAP/SeLoger)";
const DEFAULTS = { intervalMinutes: 15, watchedUrls: [] };
const MIN_INTERVAL = 5;

const pendingTabs = new Map(); // tabId -> { timeout } pour les onglets qu'ON a ouverts

/* ---------------- Config & alarme ---------------- */
async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULTS, ...(config || {}) };
}

async function scheduleAlarm() {
  const { intervalMinutes } = await getConfig();
  chrome.alarms.create("chercheappart-refresh", {
    periodInMinutes: Math.max(MIN_INTERVAL, Number(intervalMinutes) || DEFAULTS.intervalMinutes),
  });
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "chercheappart-refresh") refreshAll();
});

async function refreshAll() {
  const { watchedUrls } = await getConfig();
  for (const w of watchedUrls) {
    if (w && w.url) await refreshOne(w);
  }
}

async function refreshOne(watched) {
  try {
    const tab = await chrome.tabs.create({ url: watched.url, active: false });
    const timeout = setTimeout(() => safeCloseTab(tab.id), 25000);
    pendingTabs.set(tab.id, { timeout });
  } catch (e) {
    console.warn("ChercheAppart: impossible d'ouvrir", watched.url, e.message);
  }
}

function safeCloseTab(tabId) {
  const p = pendingTabs.get(tabId);
  if (p) { clearTimeout(p.timeout); pendingTabs.delete(tabId); }
  chrome.tabs.remove(tabId).catch(() => {});
}

/* ---------------- Session Supabase (handshake depuis le site) ---------------- */
async function getValidSession() {
  const { session } = await chrome.storage.local.get("session");
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - now > 60) return session;

  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!r.ok) {
    console.warn("ChercheAppart: session expirée, reconnectez l'extension depuis le site.");
    return null;
  }
  const data = await r.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: session.user,
  };
  await chrome.storage.local.set({ session: updated });
  return updated;
}

/* ---------------- Appels Supabase (REST direct, sans SDK) ---------------- */
async function pgFetch(path, options = {}) {
  const session = await getValidSession();
  if (!session) throw new Error("extension non connectée");
  const { prefer, ...rest } = options;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
      ...(rest.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : [];
}

let cachedSearchId = null;
async function ensureSearchId(userId) {
  if (cachedSearchId) return cachedSearchId;
  const existing = await pgFetch(
    `searches?user_id=eq.${userId}&label=eq.${encodeURIComponent(EXT_LABEL)}&select=id&limit=1`
  );
  if (existing[0]?.id) { cachedSearchId = existing[0].id; return cachedSearchId; }
  const created = await pgFetch("searches", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, label: EXT_LABEL, criteria: { kind: "extension" }, active: true }),
  });
  cachedSearchId = created[0].id;
  return cachedSearchId;
}

function stableHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function handleListings(site, listings) {
  if (!listings || !listings.length) return;
  const session = await getValidSession();
  if (!session) { console.warn("ChercheAppart: extension non connectée — annonces ignorées."); return; }
  const userId = session.user.id;
  const searchId = await ensureSearchId(userId);
  const rows = listings.map((l) => ({
    search_id: searchId,
    user_id: userId,
    external_id: `${site}-${stableHash(l.url)}`,
    data: { title: l.title, url: l.url, price: l.price, image: l.image, source: site },
  }));
  try {
    await pgFetch("listings?on_conflict=search_id,external_id", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: JSON.stringify(rows),
    });
    console.log(`ChercheAppart: ${rows.length} annonce(s) envoyée(s) (${site}).`);
  } catch (e) {
    console.warn("ChercheAppart: envoi Supabase échoué —", e.message);
  }
}

/* ---------------- Messages (content scripts + site + options) ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "chercheappart:session" && msg.session) {
    chrome.storage.local.set({ session: msg.session });
    cachedSearchId = null; // un nouvel utilisateur peut s'être connecté
    sendResponse?.({ ok: true });
    return;
  }
  if (msg?.type === "chercheappart:get-status") {
    (async () => {
      const session = await getValidSession().catch(() => null);
      const config = await getConfig();
      sendResponse({ connected: Boolean(session), email: session?.user?.email || null, config });
    })();
    return true; // réponse asynchrone
  }
  if (msg?.type === "chercheappart:set-config") {
    (async () => {
      await chrome.storage.local.set({ config: msg.config });
      await scheduleAlarm();
      sendResponse?.({ ok: true });
    })();
    return true;
  }
  if (msg?.type === "chercheappart:manual-check") {
    refreshAll().then(() => sendResponse?.({ ok: true }));
    return true;
  }
  if (msg?.type === "chercheappart:listings" && sender.tab) {
    handleListings(msg.site, msg.listings).finally(() => {
      if (pendingTabs.has(sender.tab.id)) safeCloseTab(sender.tab.id);
    });
    return;
  }
});

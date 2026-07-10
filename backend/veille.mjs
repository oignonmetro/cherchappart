/**
 * ChercheAppart — worker de veille (le "serveur").
 *
 * Exécuté par GitHub Actions (cron toutes les 30 min). Pour chaque recherche
 * active de chaque utilisateur : interroge Bien'ici, insère les nouvelles
 * annonces dans Supabase, et envoie une notification Web Push.
 *
 * 100 % gratuit : GitHub Actions (cron) + Supabase (base) + Web Push (VAPID).
 *
 * Variables d'environnement (secrets GitHub) :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:vous@ex.com)
 */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { ingestEmails } from "./email-ingest.mjs";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:admin@example.com",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Secrets Supabase non configurés — veille ignorée (voir SETUP.md). Sortie propre.");
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("VAPID non configuré : les annonces seront stockées sans notification push.");
}

/* ---------------- Bien'ici ---------------- */
const SUGGEST = "https://res.bienici.com/suggest.json";
const SEARCH = "https://www.bienici.com/realEstateAds.json";
const zoneCache = new Map();

async function resolveZones(villes = []) {
  const ids = [];
  for (const ville of villes) {
    const key = ville.toLowerCase().trim();
    if (!key) continue;
    if (zoneCache.has(key)) { ids.push(...zoneCache.get(key)); continue; }
    try {
      const r = await fetch(`${SUGGEST}?q=${encodeURIComponent(ville)}`);
      if (!r.ok) continue;
      const arr = await r.json();
      let picked = arr.find((x) =>
        ["city", "arrondissement", "department", "postalCode"].includes(x.type) &&
        (x.name || "").toLowerCase().startsWith(key.slice(0, 4)));
      picked = picked || arr[0];
      const z = (picked && picked.zoneIds) || [];
      zoneCache.set(key, z);
      ids.push(...z);
    } catch (e) {
      console.warn(`Zone '${ville}' non résolue : ${e.message}`);
    }
  }
  return [...new Set(ids)];
}

function buildFilters(c, zoneIds) {
  const map = { appartement: "flat", maison: "house" };
  const types = (c.typeBien || []).map((t) => map[t]).filter(Boolean);
  const f = {
    size: 60, from: 0, page: 1,
    filterType: c.transaction === "vente" ? "buy" : "rent",
    propertyType: types.length ? types : ["flat"],
    sortBy: "publicationDate", sortOrder: "desc",
    onTheMarketTypes: c.ownerType === "private" ? ["by-individuals"]
      : c.ownerType === "pro" ? ["with-agencies"] : ["with-agencies", "by-individuals"],
  };
  if (zoneIds.length) f.zoneIdsByTypes = { zoneIds };
  if (c.prixMin != null) f.minPrice = c.prixMin;
  if (c.prixMax != null) f.maxPrice = c.prixMax;
  if (c.surfaceMin != null) f.minArea = c.surfaceMin;
  if (c.surfaceMax != null) f.maxArea = c.surfaceMax;
  if (c.piecesMin != null) f.minRooms = c.piecesMin;
  if (c.piecesMax != null) f.maxRooms = c.piecesMax;
  return f;
}

const excluded = (l, mots = []) => {
  const hay = `${l.title} ${l.location}`.toLowerCase();
  return mots.some((m) => m && hay.includes(m.toLowerCase()));
};

const PAGE_SIZE = 60;
const MAX_PAGES = Number(process.env.BIENICI_MAX_PAGES || 4); // jusqu'à 240 annonces récentes

function mapAd(ad, unit) {
  const ph = ad.photos && ad.photos[0];
  return {
    external_id: String(ad.id),
    title: ad.title || (ad.description || "").slice(0, 80) || "Annonce Bien'ici",
    url: `https://www.bienici.com/annonce/${ad.id}`,
    price: typeof ad.price === "number"
      ? Math.round(ad.price).toLocaleString("fr-FR") + unit : "",
    surface: ad.surfaceArea ? Math.round(ad.surfaceArea) : null,
    rooms: ad.roomsQuantity || null,
    location: [ad.city, ad.postalCode].filter(Boolean).join(" "),
    image: ph ? (ph.url_photo || ph.url || "") : "",
    source: "bienici",
  };
}

async function searchBienici(c) {
  const zones = await resolveZones(c.villes || []);
  const unit = c.transaction === "vente" ? " €" : " €/mois";
  const byId = new Map();

  // Pagination : on parcourt plusieurs pages pour capter davantage d'annonces récentes.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const filters = buildFilters(c, zones);
    filters.page = page;
    filters.from = (page - 1) * PAGE_SIZE;
    const url = `${SEARCH}?filters=${encodeURIComponent(JSON.stringify(filters))}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      if (page === 1) throw new Error(`Bien'ici HTTP ${r.status}`);
      break; // on garde ce qu'on a déjà
    }
    const ads = (await r.json()).realEstateAds || [];
    for (const ad of ads) byId.set(String(ad.id), mapAd(ad, unit));
    if (ads.length < PAGE_SIZE) break; // dernière page atteinte
  }
  return [...byId.values()];
}

/* ---------------- Notifications ----------------
 * Point unique de dispatch : Bien'ici, l'ingestion e-mail ET l'extension
 * navigateur insèrent simplement des lignes dans `listings` (notified=false
 * par défaut). Ce module regroupe par utilisateur tout ce qui n'a pas encore
 * été notifié, envoie UNE notification groupée, puis marque ces lignes.
 * Ainsi l'extension (qui écrit directement dans Supabase, sans jamais voir
 * la clé VAPID) profite du même mécanisme de notification, au prochain
 * passage du worker (≤ 30 min). */
async function notify(userId, newItems) {
  if (!pushEnabled || !newItems.length) return;
  const { data: subs } = await supabase
    .from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs || !subs.length) return;

  const top = newItems[0];
  const payload = JSON.stringify({
    title: `${newItems.length} nouvelle(s) annonce(s)`,
    body: `${top.price} · ${top.location} — ${top.title}`.slice(0, 120),
    url: top.url,
  });

  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
    } catch (e) {
      // Abonnement expiré (410/404) : on le supprime.
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.warn(`Push échoué (${e.statusCode || e.message})`);
      }
    }
  }
}

/* ---------------- Boucle principale ---------------- */
async function run() {
  const { data: searches, error } = await supabase
    .from("searches").select("*").eq("active", true);
  if (error) { console.error("Lecture des recherches:", error.message); process.exit(1); }

  console.log(`${searches.length} recherche(s) active(s).`);
  let totalNew = 0;

  for (const s of searches) {
    const c = s.criteria || {};
    let found;
    try {
      found = await searchBienici(c);
    } catch (e) {
      console.warn(`Recherche ${s.id} : ${e.message}`);
      continue;
    }
    const mots = c.motsExclus || [];
    const rows = found
      .filter((l) => !excluded(l, mots))
      .map((l) => ({
        search_id: s.id, user_id: s.user_id,
        external_id: l.external_id, data: l,
      }));

    if (!rows.length) continue;

    // Insère en ignorant les doublons ; "select" renvoie uniquement les lignes réellement insérées.
    const { data: inserted, error: insErr } = await supabase
      .from("listings")
      .upsert(rows, { onConflict: "search_id,external_id", ignoreDuplicates: true })
      .select("data");

    if (insErr) { console.warn(`Insert ${s.id}: ${insErr.message}`); continue; }
    const newCount = (inserted || []).length;
    if (newCount) {
      totalNew += newCount;
      console.log(`  recherche ${s.label || s.id}: +${newCount} nouvelle(s)`);
    }
  }
  console.log(`Bien'ici : ${totalNew} nouvelle(s) annonce(s).`);

  // Ingestion des alertes e-mail Leboncoin / PAP / SeLoger.
  try {
    const res = await ingestEmails(supabase);
    if (res && res.new) totalNew += res.new;
  } catch (e) {
    console.warn("Ingestion e-mail échouée :", e.message);
  }

  // Dispatch unifié : Bien'ici + e-mail + extension navigateur (celle-ci a pu
  // insérer des annonces directement dans Supabase depuis le dernier passage).
  const notifiedCount = await dispatchPendingNotifications();
  console.log(`Notifications envoyées pour ${notifiedCount} annonce(s).`);

  console.log(`Terminé. ${totalNew} nouvelle(s) annonce(s) au total.`);
}

async function dispatchPendingNotifications() {
  const { data: pending, error } = await supabase
    .from("listings").select("id, user_id, data").eq("notified", false);
  if (error) { console.warn("Lecture des annonces à notifier :", error.message); return 0; }
  if (!pending || !pending.length) return 0;

  const byUser = new Map();
  for (const row of pending) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }

  let count = 0;
  for (const [userId, rows] of byUser) {
    await notify(userId, rows.map((r) => r.data));
    const ids = rows.map((r) => r.id);
    const { error: updErr } = await supabase.from("listings").update({ notified: true }).in("id", ids);
    if (updErr) console.warn(`Marquage notified (user ${userId}) :`, updErr.message);
    else count += ids.length;
  }
  return count;
}

run().catch((e) => { console.error(e); process.exit(1); });

/**
 * ChercheAppart — agent local (Leboncoin / PAP / SeLoger).
 *
 * Tourne sur VOTRE machine (donc VOTRE IP résidentielle), avec un vrai
 * navigateur : c'est la seule façon gratuite de passer DataDome, qui bloque
 * les IP de datacenter (serveurs, GitHub Actions...). Ce n'est PAS une
 * extension Chrome : un simple script Node, planifiable (Task Scheduler / cron).
 *
 * Pour chaque URL de recherche (générée dans l'onglet « Recherches » du site) :
 *   - ouvre la page dans un navigateur, laisse le challenge anti-bot se résoudre ;
 *   - extrait les annonces de la 1re page (extraction générique et tolérante) ;
 *   - insère les nouvelles dans Supabase (table listings), dédupliquées.
 *
 * Les notifications push partent ensuite via le worker serveur habituel
 * (dispatch unifié) : rien à faire de plus ici.
 *
 * Config :
 *   - .env         : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL, HEADLESS
 *   - config.json  : { "urls": ["https://www.leboncoin.fr/recherche?...", ...] }
 *
 * Options CLI :
 *   --dry-run          n'écrit pas dans Supabase, affiche ce qui serait inséré
 *   --url <url>        teste une seule URL (ignore config.json)
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, ".env"));

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OWNER_EMAIL,
  HEADLESS = "true",
} = process.env;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const urlArgIdx = argv.indexOf("--url");
const singleUrl = urlArgIdx !== -1 ? argv[urlArgIdx + 1] : null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const EXT_LABEL = "🖥️ Agent local (Leboncoin/PAP/SeLoger)";

/* ---------------- utils ---------------- */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const siteFromUrl = (u) => {
  const h = new URL(u).hostname;
  if (h.includes("leboncoin")) return "leboncoin";
  if (h.includes("seloger")) return "seloger";
  if (h.includes("pap.fr")) return "pap";
  if (h.includes("bienici")) return "bienici";
  return "autre";
};
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

function loadUrls() {
  if (singleUrl) return [singleUrl];
  const p = join(HERE, "config.json");
  if (!existsSync(p)) { console.error("config.json manquant (voir config.example.json)."); process.exit(1); }
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  return (cfg.urls || []).filter(Boolean);
}

/* ---------------- extraction (identique à l'extension, éprouvée) ---------------- */
function extractListingsInPage() {
  const ID_RE = /(\d{6,})/;
  const candidates = [];
  document.querySelectorAll("a[href]").forEach((a) => {
    const raw = a.getAttribute("href") || "";
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;
    let href; try { href = new URL(raw, location.href).toString(); } catch { return; }
    if (!href.startsWith(location.origin)) return;
    const m = href.match(ID_RE); if (!m) return;
    candidates.push({ a, href, id: m[1] });
  });
  const seen = new Map();
  for (const { a, href, id } of candidates) {
    if (seen.has(id)) continue;
    let container = null, node = a;
    for (let i = 0; i < 6 && node; i++) {
      const ids = new Set();
      node.querySelectorAll("a[href]").forEach((x) => {
        const mm = (x.getAttribute("href") || "").match(ID_RE); if (mm) ids.add(mm[1]);
      });
      if (ids.size > 1) break;
      const t = node.textContent || "";
      if (t.trim().length < 400 && /\d[\d\s]{2,}\s?€/.test(t)) { container = node; break; }
      node = node.parentElement;
    }
    if (!container) continue;
    const text = (container.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 5) continue;
    const priceMatch = text.match(/(\d[\d\s]{2,})\s?€/);
    const img = container.querySelector("img");
    seen.set(id, {
      id, url: href.split("?")[0], title: text.slice(0, 90),
      price: priceMatch ? priceMatch[1].replace(/\s+/g, " ").trim() + " €" : "",
      image: img ? (img.currentSrc || img.src || "") : "",
    });
  }
  return [...seen.values()];
}

/* ---------------- Supabase ---------------- */
async function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env (voir .env.example).");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return sb;
}

async function resolveOwnerId(sb) {
  if (!OWNER_EMAIL) { console.error("OWNER_EMAIL requis dans .env (votre e-mail de connexion au site)."); process.exit(1); }
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("listUsers: " + error.message);
    const u = data.users.find((x) => (x.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`Aucun compte avec l'e-mail ${OWNER_EMAIL} — connectez-vous une fois sur le site.`);
}

async function ensureSearchId(sb, userId) {
  const { data: ex } = await sb.from("searches").select("id").eq("user_id", userId).eq("label", EXT_LABEL).maybeSingle();
  if (ex?.id) return ex.id;
  const { data, error } = await sb.from("searches")
    .insert({ user_id: userId, label: EXT_LABEL, criteria: { kind: "agent" }, active: true }).select("id").single();
  if (error) throw new Error("ensureSearchId: " + error.message);
  return data.id;
}

/* ---------------- navigateur ---------------- */
async function launchBrowser() {
  const userDataDir = join(HERE, ".userdata"); // persiste cookies / clearance DataDome entre exécutions
  const opts = {
    headless: HEADLESS !== "false",
    userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris",
    viewport: { width: 1366, height: 900 },
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  };
  // channel:'chrome' = votre Chrome installé (plus robuste vs DataDome). Fallback : Chromium fourni.
  try {
    const ctx = await chromium.launchPersistentContext(userDataDir, { ...opts, channel: "chrome" });
    return ctx;
  } catch {
    return await chromium.launchPersistentContext(userDataDir, opts);
  }
}

/* ---------------- main ---------------- */
async function run() {
  const urls = loadUrls();
  if (!urls.length) { console.error("Aucune URL à surveiller (config.json)."); process.exit(1); }

  let sb = null, userId = null, searchId = null;
  if (!DRY_RUN) {
    sb = await getSupabase();
    userId = await resolveOwnerId(sb);
    searchId = await ensureSearchId(sb, userId);
  }

  const ctx = await launchBrowser();
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  let totalNew = 0;

  for (const url of urls) {
    const site = siteFromUrl(url);
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(7000); // laisse le challenge se résoudre + le contenu charger
      const blocked = await page.evaluate(() => {
        const s = (document.body?.innerText || "").toLowerCase() + " " + document.title.toLowerCase();
        return s.includes("datadome") || s.includes("captcha") || s.includes("un instant") || s.includes("access denied");
      });
      if (blocked || (resp && resp.status() === 403)) {
        console.warn(`[${site}] BLOQUÉ (anti-bot). En headless ? Essayez HEADLESS=false dans .env, ou installez Google Chrome. URL: ${url}`);
        continue;
      }
      const listings = await page.evaluate(extractListingsInPage);
      console.log(`[${site}] ${listings.length} annonce(s) détectée(s).`);
      if (!listings.length) continue;

      if (DRY_RUN) {
        listings.slice(0, 5).forEach((l) => console.log(`   ${l.price} — ${l.title.slice(0, 60)} — ${l.url}`));
        totalNew += listings.length;
        continue;
      }
      const rows = listings.map((l) => ({
        search_id: searchId, user_id: userId,
        external_id: `${site}-${hash(l.url)}`,
        data: { title: l.title, url: l.url, price: l.price, image: l.image, source: site },
      }));
      const { data: inserted, error } = await sb.from("listings")
        .upsert(rows, { onConflict: "search_id,external_id", ignoreDuplicates: true }).select("id");
      if (error) { console.warn(`[${site}] insert: ${error.message}`); continue; }
      const n = (inserted || []).length;
      totalNew += n;
      if (n) console.log(`[${site}] +${n} nouvelle(s) enregistrée(s).`);
    } catch (e) {
      console.warn(`[${site}] erreur: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await ctx.close();
  console.log(DRY_RUN ? `\n[dry-run] ${totalNew} annonce(s) détectée(s) au total.`
    : `\nTerminé. ${totalNew} nouvelle(s) annonce(s). Le push partira au prochain passage du worker serveur (≤ 30 min).`);
}

run().catch((e) => { console.error(e); process.exit(1); });

/**
 * ChercheAppart — ingestion des alertes e-mail (Leboncoin / PAP / SeLoger).
 *
 * Solution 100 % gratuite et conforme pour les sites protégés par anti-bot :
 * on n'essaie PAS de les scraper. On lit, par IMAP, les e-mails d'alerte que
 * ces sites envoient eux-mêmes (recherche sauvegardée), on en extrait les
 * annonces, on les stocke dans Supabase et on notifie via le push unifié.
 *
 * Boîte dédiée recommandée (ex. Gmail) que l'utilisateur ne lit pas.
 *
 * Variables d'environnement (secrets) :
 *   IMAP_HOST (défaut imap.gmail.com), IMAP_PORT (993), IMAP_USER, IMAP_PASSWORD
 *   ALERT_OWNER_EMAIL : l'e-mail du compte ChercheAppart qui reçoit ces alertes
 *
 * Les parseurs par site sont volontairement tolérants (extraction par motif
 * d'URL) : ils survivent aux changements de gabarit. À affiner avec un
 * e-mail d'exemple réel de chaque site.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const {
  IMAP_HOST = "imap.gmail.com",
  IMAP_PORT = "993",
  IMAP_USER,
  IMAP_PASSWORD,
  ALERT_OWNER_EMAIL,
} = process.env;

const configured = Boolean(IMAP_USER && IMAP_PASSWORD && ALERT_OWNER_EMAIL);

// Détection du site par expéditeur.
const SITE_SENDERS = [
  { site: "leboncoin", re: /leboncoin\.fr/i },
  { site: "seloger", re: /seloger\.com/i },
  { site: "pap", re: /pap\.fr/i },
];

// Extraction des annonces : motifs d'URL par site (tolérants aux redirections
// de tracking : on décode l'URL puis on cherche l'identifiant de l'annonce).
const SITE_PATTERNS = {
  leboncoin: /leboncoin\.fr(?:[^\s"'<>]*?)\/(?:ad\/[a-z_]+\/)?(\d{9,11})/gi,
  seloger: /seloger\.com(?:[^\s"'<>]*?)\/(\d{8,10})/gi,
  pap: /pap\.fr(?:[^\s"'<>]*?)(?:-r|\/)(\d{6,10})/gi,
};

function safeDecode(s) {
  try { return decodeURIComponent(s.replace(/&amp;/g, "&")); } catch { return s; }
}

// À partir du HTML/texte d'un e-mail, renvoie des annonces {external_id, url, ...}.
function extractListings(site, html, subject) {
  const decoded = safeDecode(html || "");
  const re = SITE_PATTERNS[site];
  if (!re) return [];
  const seen = new Map();
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(decoded)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    // URL réelle : le fragment matché (nettoyé) — le lien de tracking reste cliquable.
    const around = decoded.slice(m.index, m.index + 300);
    const urlMatch = around.match(/https?:\/\/[^\s"'<>]+/);
    const url = urlMatch ? urlMatch[0].replace(/&amp;/g, "&") : `https://www.${site === "leboncoin" ? "leboncoin.fr" : site === "seloger" ? "seloger.com" : "pap.fr"}/`;
    // prix éventuel à proximité
    const priceM = around.match(/(\d[\d\s.]{2,})\s*€/);
    seen.set(id, {
      external_id: `${site}-${id}`,
      title: `Annonce ${site} — ${(subject || "").slice(0, 60)}`.trim(),
      url,
      price: priceM ? priceM[1].replace(/\s/g, " ").trim() + " €" : "",
      surface: null,
      rooms: null,
      location: "",
      image: "",
      source: site,
    });
  }
  return [...seen.values()];
}

async function resolveOwnerId(supabase) {
  // Retrouve l'utilisateur propriétaire des alertes par son e-mail.
  let page = 1;
  for (; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("listUsers: " + error.message);
    const u = data.users.find((x) => (x.email || "").toLowerCase() === ALERT_OWNER_EMAIL.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureEmailSearch(supabase, ownerId) {
  const LABEL = "📧 Alertes e-mail (Leboncoin/PAP/SeLoger)";
  const { data: existing } = await supabase
    .from("searches").select("id").eq("user_id", ownerId).eq("label", LABEL).maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from("searches").insert({ user_id: ownerId, label: LABEL, criteria: { kind: "email" }, active: true })
    .select("id").single();
  if (error) throw new Error("ensureEmailSearch: " + error.message);
  return data.id;
}

/**
 * @param supabase client service-role
 * @param notify   fonction (userId, newItems[]) => Promise pour le push unifié
 */
export async function ingestEmails(supabase, notify) {
  if (!configured) {
    console.log("Ingestion e-mail non configurée (IMAP_* / ALERT_OWNER_EMAIL absents) — ignorée.");
    return { skipped: true };
  }

  const ownerId = await resolveOwnerId(supabase);
  if (!ownerId) {
    console.warn(`Aucun utilisateur ChercheAppart avec l'e-mail ${ALERT_OWNER_EMAIL} — connectez-vous une fois sur le site.`);
    return { skipped: true };
  }
  const searchId = await ensureEmailSearch(supabase, ownerId);

  const client = new ImapFlow({
    host: IMAP_HOST, port: Number(IMAP_PORT), secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD }, logger: false,
  });
  await client.connect();
  let totalNew = 0;
  const collected = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // e-mails non lus uniquement
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids.slice(-100)) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg) continue;
        const parsed = await simpleParser(msg.source);
        const from = (parsed.from?.text || "").toLowerCase();
        const site = SITE_SENDERS.find((s) => s.re.test(from))?.site;
        if (!site) { continue; } // on ne touche pas aux autres e-mails
        const html = parsed.html || parsed.textAsHtml || parsed.text || "";
        const items = extractListings(site, html, parsed.subject || "");
        collected.push(...items);
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  if (!collected.length) {
    console.log("Ingestion e-mail : aucune annonce détectée dans les e-mails non lus.");
    return { new: 0 };
  }

  // dédup global puis insertion (ignore les doublons déjà connus)
  const rows = [...new Map(collected.map((l) => [l.external_id, l])).values()]
    .map((l) => ({ search_id: searchId, user_id: ownerId, external_id: l.external_id, data: l }));

  const { data: inserted, error } = await supabase
    .from("listings").upsert(rows, { onConflict: "search_id,external_id", ignoreDuplicates: true })
    .select("data");
  if (error) { console.warn("Insert e-mail:", error.message); return { new: 0 }; }

  const newItems = (inserted || []).map((x) => x.data);
  totalNew = newItems.length;
  console.log(`Ingestion e-mail : ${collected.length} annonce(s) lues, ${totalNew} nouvelle(s).`);
  if (totalNew && notify) await notify(ownerId, newItems);
  return { new: totalNew };
}

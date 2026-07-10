/**
 * ChercheAppart — ingestion des alertes e-mail (Leboncoin / PAP / SeLoger).
 *
 * Solution 100 % gratuite et conforme pour les sites protégés par anti-bot :
 * on ne les scrape pas. On lit, par IMAP, les e-mails d'alerte que ces sites
 * envoient eux-mêmes (recherche sauvegardée), on en extrait les annonces, on
 * les stocke dans Supabase et on notifie via le push unifié.
 *
 * PAR UTILISATEUR : chaque utilisateur renseigne SA propre boîte d'alertes
 * (table `email_sources`) depuis l'interface. Le worker (clé service) lit la
 * boîte de chacun et rattache les annonces au bon utilisateur.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

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

const SITE_HOME = {
  leboncoin: "https://www.leboncoin.fr/",
  seloger: "https://www.seloger.com/",
  pap: "https://www.pap.fr/",
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
    const around = decoded.slice(m.index, m.index + 300);
    const urlMatch = around.match(/https?:\/\/[^\s"'<>]+/);
    const url = urlMatch ? urlMatch[0].replace(/&amp;/g, "&") : SITE_HOME[site];
    const priceM = around.match(/(\d[\d\s.]{2,})\s*€/);
    seen.set(id, {
      external_id: `${site}-${id}`,
      title: `Annonce ${site} — ${(subject || "").slice(0, 60)}`.trim(),
      url,
      price: priceM ? priceM[1].replace(/\s+/g, " ").trim() + " €" : "",
      surface: null, rooms: null, location: "", image: "", source: site,
    });
  }
  return [...seen.values()];
}

async function ensureEmailSearch(supabase, userId) {
  const LABEL = "📧 Alertes e-mail (Leboncoin/PAP/SeLoger)";
  const { data: existing } = await supabase
    .from("searches").select("id").eq("user_id", userId).eq("label", LABEL).maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from("searches").insert({ user_id: userId, label: LABEL, criteria: { kind: "email" }, active: true })
    .select("id").single();
  if (error) throw new Error("ensureEmailSearch: " + error.message);
  return data.id;
}

// Lit une boîte IMAP et renvoie les annonces extraites des e-mails d'alerte non lus.
async function readMailbox(src) {
  const client = new ImapFlow({
    host: src.imap_host || "imap.gmail.com",
    port: Number(src.imap_port || 993),
    secure: true,
    auth: { user: src.imap_user, pass: src.imap_password },
    logger: false,
  });
  const collected = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of (uids || []).slice(-100)) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg) continue;
        const parsed = await simpleParser(msg.source);
        const from = (parsed.from?.text || "").toLowerCase();
        const site = SITE_SENDERS.find((s) => s.re.test(from))?.site;
        if (!site) continue; // on ignore (et ne marque pas lu) les autres e-mails
        const html = parsed.html || parsed.textAsHtml || parsed.text || "";
        collected.push(...extractListings(site, html, parsed.subject || ""));
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return collected;
}

/**
 * @param supabase client service-role
 * @param notify   fonction (userId, newItems[]) => Promise pour le push unifié
 */
export async function ingestEmails(supabase, notify) {
  const { data: sources, error } = await supabase
    .from("email_sources").select("*").eq("active", true);
  if (error) { console.warn("email_sources:", error.message); return { new: 0 }; }
  if (!sources || !sources.length) {
    console.log("Aucune boîte d'alertes configurée — ingestion e-mail ignorée.");
    return { new: 0 };
  }

  let totalNew = 0;
  for (const src of sources) {
    let collected;
    try {
      collected = await readMailbox(src);
    } catch (e) {
      console.warn(`IMAP ${src.imap_user}: ${e.message}`);
      continue;
    }
    if (!collected.length) continue;

    const searchId = await ensureEmailSearch(supabase, src.user_id);
    const rows = [...new Map(collected.map((l) => [l.external_id, l])).values()]
      .map((l) => ({ search_id: searchId, user_id: src.user_id, external_id: l.external_id, data: l }));

    const { data: inserted, error: insErr } = await supabase
      .from("listings").upsert(rows, { onConflict: "search_id,external_id", ignoreDuplicates: true })
      .select("data");
    if (insErr) { console.warn(`Insert e-mail ${src.imap_user}: ${insErr.message}`); continue; }

    const newItems = (inserted || []).map((x) => x.data);
    if (newItems.length) {
      totalNew += newItems.length;
      console.log(`  boîte ${src.imap_user}: +${newItems.length} nouvelle(s)`);
      if (notify) await notify(src.user_id, newItems);
    }
  }
  console.log(`Ingestion e-mail : ${totalNew} nouvelle(s) annonce(s).`);
  return { new: totalNew };
}

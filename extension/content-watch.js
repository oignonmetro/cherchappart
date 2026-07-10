/* ChercheAppart — content script d'extraction (Leboncoin/SeLoger/PAP).
 *
 * Tourne dans VOTRE navigateur, avec VOS cookies : contrairement à un scraping
 * serveur, ceci est un chargement de page normal — DataDome n'a aucune raison
 * de le bloquer différemment d'une navigation humaine classique.
 *
 * Extraction générique et tolérante (comme pour les e-mails) plutôt que des
 * sélecteurs CSS figés à la structure exacte du site (qui change souvent) :
 * on repère les liens de fiche-annonce (URL contenant un identifiant numérique
 * long) et on récupère le texte/prix/image du plus proche conteneur pertinent.
 */
(() => {
  "use strict";

  const SITE_BY_HOST = {
    "www.leboncoin.fr": "leboncoin",
    "www.seloger.com": "seloger",
    "www.pap.fr": "pap",
  };
  const site = SITE_BY_HOST[location.hostname];
  if (!site) return;

  const ID_RE = /(\d{6,})/;

  function extractGenericListings() {
    const candidates = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const raw = a.getAttribute("href") || "";
      if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;
      let href;
      try { href = new URL(raw, location.href).toString(); } catch { return; }
      if (!href.startsWith(location.origin)) return;
      const idMatch = href.match(ID_RE); // identifiant de fiche-annonce probable
      if (!idMatch) return;
      candidates.push({ a, href, id: idMatch[1] });
    });

    const seen = new Map();
    for (const { a, href, id } of candidates) {
      if (seen.has(id)) continue;

      // Remonte jusqu'à trouver le plus petit ancêtre qui (a) contient un prix
      // et (b) n'englobe qu'UNE SEULE annonce (sinon on a fusionné plusieurs
      // cartes ou capté un lien de nav/pied de page situé dans le même bloc).
      let container = null;
      let node = a;
      for (let i = 0; i < 6 && node; i++) {
        const idsInside = new Set();
        node.querySelectorAll("a[href]").forEach((x) => {
          const m = (x.getAttribute("href") || "").match(ID_RE);
          if (m) idsInside.add(m[1]);
        });
        if (idsInside.size > 1) break; // conteneur trop large : on s'arrête avant
        const t = node.textContent || "";
        if (t.trim().length < 400 && /\d[\d\s]{2,}\s?€/.test(t)) { container = node; break; }
        node = node.parentElement;
      }
      if (!container) continue; // pas de prix trouvé de façon fiable : on ignore (mieux que du bruit)

      const text = (container.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 5) continue;
      const priceMatch = text.match(/(\d[\d\s]{2,})\s?€/);
      const img = container.querySelector("img");

      seen.set(id, {
        id,
        url: href.split("?")[0],
        title: text.slice(0, 90),
        price: priceMatch[1].replace(/\s+/g, " ").trim() + " €",
        image: img ? (img.currentSrc || img.src || "") : "",
      });
    }
    return [...seen.values()];
  }

  function run() {
    let listings = [];
    try {
      listings = extractGenericListings();
    } catch (e) {
      console.warn("ChercheAppart: extraction échouée —", e.message);
      return;
    }
    if (!listings.length) {
      console.log(`ChercheAppart (${site}): aucune annonce détectée sur cette page.`);
      return;
    }
    console.log(`ChercheAppart (${site}): ${listings.length} annonce(s) détectée(s).`);
    try {
      chrome.runtime.sendMessage({ type: "chercheappart:listings", site, listings });
    } catch (e) {
      // Le service worker peut être en veille au moment exact du chargement ; sans gravité.
    }
  }

  // Laisse le temps au contenu dynamique (JS du site) de finir de charger.
  if (document.readyState === "complete") setTimeout(run, 2500);
  else window.addEventListener("load", () => setTimeout(run, 2500));
})();

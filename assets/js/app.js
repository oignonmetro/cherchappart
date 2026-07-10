/* ChercheAppart — logique front (vanilla JS, aucune dépendance) */
(() => {
  "use strict";

  const LS_CRITERIA = "chercheappart.criteria";
  const LS_SEEN = "chercheappart.seen";

  const DEFAULT_MESSAGE =
    "Bonjour,\n\nVotre annonce « {{titre}} » ({{prix}}) à {{ville}} m'intéresse. " +
    "Serait-il possible d'organiser une visite ? Je suis disponible rapidement et mon dossier est complet.\n\n" +
    "Lien de l'annonce : {{lien}}\n\nMerci d'avance,\nCordialement,";

  const DEFAULT_CRITERIA = {
    villes: [],
    transaction: "location",
    typeBien: ["appartement"],
    prixMin: null, prixMax: null,
    surfaceMin: null, surfaceMax: null,
    piecesMin: null, piecesMax: null,
    ownerType: "all",
    sites: ["bienici", "leboncoin"],
    motsExclus: [],
    messageModele: DEFAULT_MESSAGE,
    contactAuto: false
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let criteria = load();
  let villes = [...(criteria.villes || [])];

  /* ---------- Persistance ---------- */
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_CRITERIA) || "null");
      return raw ? { ...DEFAULT_CRITERIA, ...raw } : { ...DEFAULT_CRITERIA };
    } catch { return { ...DEFAULT_CRITERIA }; }
  }
  function persist() { localStorage.setItem(LS_CRITERIA, JSON.stringify(criteria)); }

  function seenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) || "[]")); }
    catch { return new Set(); }
  }
  function saveSeen(set) { localStorage.setItem(LS_SEEN, JSON.stringify([...set])); }

  /* ---------- Onglets ---------- */
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("is-active"));
    $$(".panel").forEach((x) => x.classList.remove("is-active"));
    t.classList.add("is-active");
    $("#panel-" + t.dataset.tab).classList.add("is-active");
    if (t.dataset.tab === "recherches") renderSearchLinks();
    if (t.dataset.tab === "annonces") refreshAnnonces();
  }));

  /* ---------- Formulaire -> état ---------- */
  function readForm() {
    criteria.villes = [...villes];
    criteria.transaction = $("#transaction").value;
    criteria.typeBien = $$(".typeBien:checked").map((c) => c.value);
    criteria.prixMin = num($("#prixMin").value);
    criteria.prixMax = num($("#prixMax").value);
    criteria.surfaceMin = num($("#surfaceMin").value);
    criteria.surfaceMax = num($("#surfaceMax").value);
    criteria.piecesMin = num($("#piecesMin").value);
    criteria.piecesMax = num($("#piecesMax").value);
    criteria.ownerType = $("#ownerType").value;
    criteria.sites = $$(".site:checked").map((c) => c.value);
    criteria.motsExclus = $("#motsExclus").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    criteria.messageModele = $("#messageModele").value;
    criteria.contactAuto = $("#contactAuto").checked;
  }

  function fillForm() {
    $("#transaction").value = criteria.transaction;
    $$(".typeBien").forEach((c) => (c.checked = criteria.typeBien.includes(c.value)));
    $("#prixMin").value = criteria.prixMin ?? "";
    $("#prixMax").value = criteria.prixMax ?? "";
    $("#surfaceMin").value = criteria.surfaceMin ?? "";
    $("#surfaceMax").value = criteria.surfaceMax ?? "";
    $("#piecesMin").value = criteria.piecesMin ?? "";
    $("#piecesMax").value = criteria.piecesMax ?? "";
    $("#ownerType").value = criteria.ownerType;
    $$(".site").forEach((c) => (c.checked = criteria.sites.includes(c.value)));
    $("#motsExclus").value = (criteria.motsExclus || []).join(", ");
    $("#messageModele").value = criteria.messageModele || DEFAULT_MESSAGE;
    $("#contactAuto").checked = !!criteria.contactAuto;
    renderVilles();
    updatePriceLabel();
  }

  function updatePriceLabel() {
    $("#lbl-prix").textContent =
      $("#transaction").value === "vente" ? "Prix (€)" : "Loyer / prix (€)";
  }
  $("#transaction").addEventListener("change", updatePriceLabel);

  /* ---------- Villes (tags) ---------- */
  function renderVilles() {
    const wrap = $("#villes-wrap");
    $$(".tag", wrap).forEach((t) => t.remove());
    const input = $("#ville-input");
    villes.forEach((v, i) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.innerHTML = `${esc(v)} <button type="button" aria-label="retirer">✕</button>`;
      tag.querySelector("button").onclick = () => { villes.splice(i, 1); renderVilles(); };
      wrap.insertBefore(tag, input);
    });
  }
  $("#ville-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v && !villes.includes(v)) { villes.push(v); renderVilles(); }
      e.target.value = "";
    } else if (e.key === "Backspace" && !e.target.value && villes.length) {
      villes.pop(); renderVilles();
    }
  });

  /* ---------- Boutons critères ---------- */
  $("#save-btn").addEventListener("click", () => {
    readForm(); persist();
    const s = $("#save-status"); s.textContent = "✓ Enregistré";
    // Si connecté, on pousse aussi les critères côté serveur (pour la veille en arrière-plan).
    if (window.Cloud && window.Cloud.user) {
      window.Cloud.saveCriteria(criteria)
        .then(() => { s.textContent = "✓ Enregistré (veille serveur à jour)"; })
        .catch((e) => { s.textContent = "Enregistré localement (serveur: " + e.message + ")"; });
    }
    setTimeout(() => (s.textContent = ""), 3000);
  });
  $("#export-btn").addEventListener("click", () => {
    readForm(); persist();
    const blob = new Blob([JSON.stringify(criteria, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "criteria.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#reset-btn").addEventListener("click", () => {
    if (!confirm("Réinitialiser tous les critères ?")) return;
    criteria = { ...DEFAULT_CRITERIA }; villes = []; persist(); fillForm();
  });

  /* ---------- Générateur d'URL de recherche ---------- */
  const range = (min, max) => {
    if (min == null && max == null) return null;
    return `${min ?? "min"}-${max ?? "max"}`;
  };

  const SITE_BUILDERS = {
    // Bien'ici : source de la veille automatique (API accessible).
    bienici(c) {
      const kind = c.transaction === "vente" ? "achat" : "location";
      const bien = c.typeBien.includes("maison") && !c.typeBien.includes("appartement")
        ? "maison" : "appartement";
      const slug = (c.villes[0] || "").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const p = new URLSearchParams();
      if (c.prixMax) p.set("prix-max", c.prixMax);
      if (c.surfaceMin) p.set("surface-min", c.surfaceMin);
      if (c.piecesMin) p.set("pieces-min", c.piecesMin);
      const q = p.toString();
      return `https://www.bienici.com/recherche/${kind}/${slug || "france"}/${bien}` + (q ? "?" + q : "");
    },
    // Leboncoin : paramètres propres et fiables.
    leboncoin(c) {
      const p = new URLSearchParams();
      p.set("category", c.transaction === "vente" ? "9" : "10");
      if (c.villes.length) p.set("locations", c.villes.join(","));
      const price = range(c.prixMin, c.prixMax); if (price) p.set("price", price);
      const sq = range(c.surfaceMin, c.surfaceMax); if (sq) p.set("square", sq);
      const rooms = range(c.piecesMin, c.piecesMax); if (rooms) p.set("rooms", rooms);
      const ret = { maison: "1", appartement: "2" };
      const types = c.typeBien.map((t) => ret[t]).filter(Boolean);
      if (types.length) p.set("real_estate_type", types.join(","));
      if (c.ownerType === "private") p.set("owner_type", "private");
      if (c.ownerType === "pro") p.set("owner_type", "pro");
      p.set("sort", "time"); p.set("order", "desc");
      return "https://www.leboncoin.fr/recherche?" + p.toString();
    },
    // PAP : URL par slug (pas de query fiable). On construit le meilleur chemin possible.
    pap(c) {
      const t = c.transaction === "vente" ? "ventes" : "locations";
      const bien = c.typeBien.includes("maison") && !c.typeBien.includes("appartement")
        ? "maison" : "appartement";
      const slug = (c.villes[0] || "").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let url = `https://www.pap.fr/annonce/${t}-${bien}`;
      if (slug) url += `-${slug}`;
      return url;
    },
    // SeLoger : requiert des codes lieu internes -> recherche large + note.
    seloger(c) {
      const projects = c.transaction === "vente" ? "2" : "1";
      const types = c.typeBien.includes("maison") && !c.typeBien.includes("appartement") ? "2" : "1";
      const p = new URLSearchParams({ projects, types, enterprise: "0", natures: "1,2,4" });
      if (c.prixMax) p.set("price", `NaN/${c.prixMax}`);
      if (c.surfaceMin) p.set("surface", `${c.surfaceMin}/NaN`);
      if (c.piecesMin) p.set("rooms", `${c.piecesMin},${(c.piecesMin || 0) + 1},${(c.piecesMin || 0) + 2}`);
      if (c.villes.length) p.set("q", c.villes.join(" "));
      return "https://www.seloger.com/list.htm?" + p.toString();
    }
  };

  const SITE_NAMES = { bienici: "Bien'ici", leboncoin: "Leboncoin", pap: "PAP", seloger: "SeLoger" };
  const SITE_NOTE = {
    bienici: "Source de la veille automatique : ces annonces sont aussi récupérées seules dans l'onglet Annonces.",
    pap: "Filtres prix/surface à affiner sur place (PAP n'accepte pas de paramètres d'URL fiables).",
    seloger: "SeLoger utilise des codes de lieu internes : la localisation peut nécessiter un ajustement."
  };

  function renderSearchLinks() {
    readForm();
    const box = $("#search-links");
    if (!criteria.sites.length) {
      box.innerHTML = `<p class="empty">Sélectionnez au moins un site dans l'onglet Critères.</p>`;
      return;
    }
    box.innerHTML = criteria.sites.map((s) => {
      const url = SITE_BUILDERS[s](criteria);
      const note = SITE_NOTE[s] ? `<div class="url" style="color:var(--muted)">ℹ️ ${esc(SITE_NOTE[s])}</div>` : "";
      return `<div class="link-card">
        <div>
          <div class="name">${esc(SITE_NAMES[s])}</div>
          <div class="url">${esc(url)}</div>
          ${note}
        </div>
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir ↗</a>
      </div>`;
    }).join("");
  }

  /* ---------- Annonces : recherche EN DIRECT sur Bien'ici, avec VOS critères ----------
     Chaque utilisateur interroge Bien'ici depuis son navigateur avec ses propres
     critères (l'API autorise le CORS). Rien n'est imposé ni partagé entre visiteurs. */
  let ALL = [];
  let searching = false;
  const zoneCache = {};

  async function resolveZones(villes) {
    const ids = [];
    for (const ville of villes) {
      const key = ville.toLowerCase().trim();
      if (!key) continue;
      if (zoneCache[key]) { ids.push(...zoneCache[key]); continue; }
      try {
        const r = await fetch("https://res.bienici.com/suggest.json?q=" + encodeURIComponent(ville));
        if (!r.ok) continue;
        const arr = await r.json();
        let picked = arr.find((x) => ["city", "arrondissement", "department", "postalCode"].includes(x.type)
          && (x.name || "").toLowerCase().startsWith(key.slice(0, 4)));
        picked = picked || arr[0];
        const z = (picked && picked.zoneIds) || [];
        zoneCache[key] = z; ids.push(...z);
      } catch { /* ville non résolue : ignorée */ }
    }
    return [...new Set(ids)];
  }

  function bieniciFilters(c, zoneIds) {
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

  async function bieniciSearch(c) {
    const zones = await resolveZones(c.villes || []);
    const filters = bieniciFilters(c, zones);
    const url = "https://www.bienici.com/realEstateAds.json?filters=" + encodeURIComponent(JSON.stringify(filters));
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const unit = c.transaction === "vente" ? " €" : " €/mois";
    lastTotal = data.total || 0;
    return (data.realEstateAds || []).map((ad) => {
      const ph = ad.photos && ad.photos[0];
      const image = ph ? (ph.url_photo || ph.url || "") : "";
      const price = typeof ad.price === "number"
        ? Math.round(ad.price).toLocaleString("fr-FR").replace(/ /g, " ") + unit : "";
      return {
        id: "bienici-" + ad.id,
        source: "bienici",
        title: ad.title || (ad.description || "").slice(0, 80) || "Annonce Bien'ici",
        url: "https://www.bienici.com/annonce/" + ad.id,
        price,
        surface: ad.surfaceArea ? Math.round(ad.surfaceArea) : null,
        rooms: ad.roomsQuantity || null,
        location: [ad.city, ad.postalCode].filter(Boolean).join(" "),
        image,
      };
    });
  }

  let lastTotal = 0;
  function setSearchStatus(txt) { const el = $("#search-status"); if (el) el.textContent = txt; }

  async function loadListings() {
    if (searching) return;
    searching = true;
    setSearchStatus("Recherche en direct sur Bien'ici…");
    try {
      readForm();
      ALL = await bieniciSearch(criteria);
      const h = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      setSearchStatus(`${ALL.length} affichée(s)${lastTotal ? " sur " + lastTotal.toLocaleString("fr-FR") : ""} · à jour ${h}`);
    } catch (e) {
      ALL = [];
      setSearchStatus("Bien'ici injoignable (" + e.message + "). Réessayez.");
    } finally {
      searching = false;
    }
  }

  async function refreshAnnonces() { await loadListings(); renderListings(); }

  function matches(l, c) {
    if (c.motsExclus?.length) {
      const hay = (l.title + " " + (l.location || "")).toLowerCase();
      if (c.motsExclus.some((m) => hay.includes(m))) return false;
    }
    return true;
  }

  function renderListings() {
    const box = $("#listings");
    const emptyEl = $("#listings-empty");
    const seen = seenSet();
    const q = $("#filter-text").value.trim().toLowerCase();
    const onlyNew = $("#only-new").checked;

    let items = ALL.filter((l) => matches(l, criteria));
    if (q) items = items.filter((l) =>
      (l.title + " " + (l.location || "") + " " + (l.price || "")).toLowerCase().includes(q));
    if (onlyNew) items = items.filter((l) => !seen.has(l.id));

    // compteur de nouvelles
    const newCount = ALL.filter((l) => matches(l, criteria) && !seen.has(l.id)).length;
    const badge = $("#badge-count");
    badge.textContent = newCount; badge.hidden = newCount === 0;

    if (!items.length) {
      box.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = ALL.length
        ? "Aucune annonce ne correspond au filtre."
        : "Aucune annonce. Réglez vos critères (onglet Critères) puis cliquez sur ↻ Rafraîchir.";
      return;
    }
    emptyEl.hidden = true;

    box.innerHTML = items.map((l) => {
      const isNew = !seen.has(l.id);
      const thumb = l.image
        ? `style="background-image:url('${esc(l.image)}')"` : "";
      const meta = [l.surface && `${esc(l.surface)} m²`, l.rooms && `${esc(l.rooms)} p.`, l.location && esc(l.location)]
        .filter(Boolean).join(" · ");
      return `<article class="listing ${isNew ? "is-new" : ""}">
        <span class="src">${esc(l.source || "")}</span>
        ${isNew ? '<span class="new-tag">nouveau</span>' : ""}
        <a class="thumb" ${thumb} href="${esc(l.url)}" target="_blank" rel="noopener"></a>
        <div class="body">
          <div class="price">${esc(l.price || "—")}</div>
          <div class="title">${esc(l.title || "Sans titre")}</div>
          <div class="meta">${meta}</div>
        </div>
        <div class="row">
          <a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">Voir</a>
          <button class="btn primary" data-contact="${esc(l.id)}">Contacter</button>
        </div>
      </article>`;
    }).join("");

    $$("[data-contact]", box).forEach((b) =>
      b.addEventListener("click", () => openContact(items.find((x) => x.id === b.dataset.contact))));

    // contact automatique : ouvre le 1er brouillon non vu
    if (criteria.contactAuto) {
      const firstNew = items.find((l) => isNewAndUncontacted(l, seen));
      if (firstNew) openContact(firstNew);
    }
  }

  function isNewAndUncontacted(l, seen) {
    return !seen.has(l.id) && !(l.__contacted);
  }

  $("#filter-text").addEventListener("input", renderListings);
  $("#only-new").addEventListener("change", renderListings);
  $("#refresh-btn").addEventListener("click", refreshAnnonces);
  $("#mark-seen").addEventListener("click", () => {
    const set = seenSet();
    ALL.forEach((l) => set.add(l.id));
    saveSeen(set);
    renderListings();
  });

  // Vérification automatique : re-recherche périodique tant que l'onglet Annonces est ouvert.
  setInterval(() => {
    if ($("#panel-annonces").classList.contains("is-active") && !document.hidden) refreshAnnonces();
  }, 180000);

  /* ---------- Modal contact ---------- */
  function buildMessage(l) {
    return (criteria.messageModele || DEFAULT_MESSAGE)
      .replaceAll("{{titre}}", l.title || "")
      .replaceAll("{{prix}}", l.price || "")
      .replaceAll("{{ville}}", l.location || "")
      .replaceAll("{{lien}}", l.url || "");
  }

  function openContact(l) {
    if (!l) return;
    l.__contacted = true;
    const msg = buildMessage(l);
    $("#modal-listing").textContent = `${l.title || ""} — ${l.price || ""}`;
    $("#modal-message").value = msg;
    $("#modal-open").href = l.url || "#";
    const subject = encodeURIComponent(`Annonce : ${l.title || ""}`);
    $("#modal-mailto").href = l.contactEmail
      ? `mailto:${l.contactEmail}?subject=${subject}&body=${encodeURIComponent(msg)}`
      : `mailto:?subject=${subject}&body=${encodeURIComponent(msg)}`;
    // marquer comme vu
    const set = seenSet(); set.add(l.id); saveSeen(set);
    $("#contact-modal").hidden = false;
  }
  $("#modal-close").addEventListener("click", () => ($("#contact-modal").hidden = true));
  $("#contact-modal").addEventListener("click", (e) => {
    if (e.target.id === "contact-modal") $("#contact-modal").hidden = true;
  });
  $("#modal-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#modal-message").value);
      $("#modal-copy").textContent = "✓ Copié"; setTimeout(() => ($("#modal-copy").textContent = "📋 Copier le message"), 1500);
    } catch {}
  });

  /* ---------- Compte (Supabase, optionnel) ---------- */
  function setupAccount() {
    const C = window.Cloud;
    if (!C || !C.enabled) return; // config absente -> mode local, carte masquée
    $("#account-card").hidden = false;

    const flash = (t, sel = "#account-msg") => {
      const e = $(sel); if (!e) return;
      e.textContent = t; setTimeout(() => (e.textContent = ""), 4000);
    };
    const render = (user) => {
      $("#account-out").hidden = !!user;
      $("#account-in").hidden = !user;
      if (user) $("#account-user").textContent = user.email || "";
    };

    const renderEmailSource = (src) => {
      $("#email-source-none").hidden = !!src;
      $("#email-source-set").hidden = !src;
      if (src) $("#es-current").textContent = `${src.imap_user} (${src.imap_host})`;
    };

    C.onAuthChange(async (user) => {
      render(user);
      if (!user) return;
      const cloudCrit = await C.loadCriteria();
      if (cloudCrit) {                       // on adopte les critères déjà enregistrés
        criteria = { ...DEFAULT_CRITERIA, ...cloudCrit };
        villes = [...(criteria.villes || [])];
        persist(); fillForm();
      } else {                               // 1re connexion : on pousse les critères locaux
        try { await C.saveCriteria(criteria); } catch { /* ignore */ }
      }
      C.pushStatus().then((on) => { if (on) $("#account-alerts").textContent = "🔔 Alertes activées ✓"; });
      C.loadEmailSource().then(renderEmailSource).catch(() => {});
    });

    $("#account-signin").addEventListener("click", async () => {
      const email = $("#account-email").value.trim();
      if (!email) return flash("Entrez votre e-mail.");
      try { await C.signIn(email); flash("Lien de connexion envoyé ! Vérifiez vos e-mails."); }
      catch (e) { flash("Erreur : " + e.message); }
    });
    $("#account-signout").addEventListener("click", () => C.signOut());
    $("#account-alerts").addEventListener("click", async () => {
      try {
        await C.enablePush();
        $("#account-alerts").textContent = "🔔 Alertes activées ✓";
        flash("Alertes activées ✓", "#account-msg2");
      } catch (e) { flash("Erreur : " + e.message, "#account-msg2"); }
    });

    $("#es-save").addEventListener("click", async () => {
      const imapUser = $("#es-user").value.trim();
      const imapPassword = $("#es-password").value.trim();
      const imapHost = $("#es-host").value.trim();
      try {
        await C.saveEmailSource({ imapUser, imapPassword, imapHost });
        $("#es-password").value = ""; // ne pas garder le mot de passe affiché
        renderEmailSource(await C.loadEmailSource());
        flash("Boîte enregistrée ✓ (lue au prochain passage de la veille)", "#account-msg3");
      } catch (e) { flash("Erreur : " + e.message, "#account-msg3"); }
    });
    $("#es-remove").addEventListener("click", async () => {
      try {
        const src = await C.loadEmailSource();
        if (src) await C.removeEmailSource(src.id);
        renderEmailSource(null);
        flash("Boîte supprimée.", "#account-msg3");
      } catch (e) { flash("Erreur : " + e.message, "#account-msg3"); }
    });

    // Détection de l'extension (annoncée par bridge.js) + handshake de session.
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const msg = event.data;
      if (msg?.source !== "chercheappart-extension") return;
      if (msg.type === "chercheappart:present") {
        $("#ext-status").textContent = "Extension détectée ✓";
        $("#ext-connect").disabled = false;
      }
      if (msg.type === "chercheappart:connected") {
        $("#ext-status").textContent = "Extension connectée ✓";
      }
    });
    $("#ext-connect").addEventListener("click", async () => {
      try { await C.exportSessionToExtension(); }
      catch (e) { $("#ext-status").textContent = "Erreur : " + e.message; }
    });
    $("#ext-copy-url")?.addEventListener("click", async () => {
      const btn = $("#ext-copy-url");
      try {
        await navigator.clipboard.writeText("chrome://extensions");
        btn.textContent = "✓"; setTimeout(() => (btn.textContent = "📋"), 1500);
      } catch { /* navigateur sans API presse-papiers : rien de grave */ }
    });

    C.init().then(render);
  }

  /* ---------- Init ---------- */
  fillForm();
  setupAccount();
})();

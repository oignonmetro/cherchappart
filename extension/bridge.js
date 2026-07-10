/* ChercheAppart — pont entre le site et l'extension (content script, monde isolé).
 *
 * Relaie la session Supabase (envoyée par app.js via window.postMessage, sur
 * clic du bouton "Connecter l'extension") vers le service worker de
 * l'extension, et signale à la page que l'extension est bien installée.
 */
(() => {
  "use strict";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const msg = event.data;
    if (msg?.source !== "chercheappart-site") return;

    if (msg.type === "chercheappart:export-session" && msg.session) {
      chrome.runtime.sendMessage({ type: "chercheappart:session", session: msg.session }, () => {
        window.postMessage({ source: "chercheappart-extension", type: "chercheappart:connected" }, window.location.origin);
      });
    }
  });

  // Signale la présence de l'extension à la page (pour afficher son statut).
  window.postMessage({ source: "chercheappart-extension", type: "chercheappart:present" }, window.location.origin);
})();

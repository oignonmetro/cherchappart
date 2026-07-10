(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);

  async function refreshStatus() {
    chrome.runtime.sendMessage({ type: "chercheappart:get-status" }, (res) => {
      const el = $("#status");
      if (res?.connected) {
        el.textContent = `Connecté (${res.email})`;
        el.className = "ok";
      } else {
        el.textContent = "Non connecté — utilisez le bouton sur le site ChercheAppart.";
        el.className = "ko";
      }
      if (res?.config?.intervalMinutes) $("#interval").value = String(res.config.intervalMinutes);
      renderUrls(res?.config?.watchedUrls || []);
    });
  }

  function renderUrls(urls) {
    const ul = $("#url-list");
    ul.innerHTML = "";
    if (!urls.length) {
      ul.innerHTML = "<li><small>Aucune recherche surveillée pour l'instant.</small></li>";
      return;
    }
    urls.forEach((u, i) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = u.url;
      const btn = document.createElement("button");
      btn.textContent = "Retirer";
      btn.onclick = () => removeUrl(i);
      li.append(span, btn);
      ul.appendChild(li);
    });
  }

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "chercheappart:get-status" }, (res) => resolve(res?.config || { intervalMinutes: 15, watchedUrls: [] }));
    });
  }

  async function setConfig(config) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "chercheappart:set-config", config }, () => resolve());
    });
  }

  async function removeUrl(index) {
    const config = await getConfig();
    config.watchedUrls.splice(index, 1);
    await setConfig(config);
    refreshStatus();
  }

  $("#add-url").addEventListener("click", async () => {
    const input = $("#new-url");
    const url = input.value.trim();
    if (!url) return;
    try { new URL(url); } catch { alert("URL invalide."); return; }
    const config = await getConfig();
    config.watchedUrls = [...(config.watchedUrls || []), { url }];
    await setConfig(config);
    input.value = "";
    refreshStatus();
  });

  $("#save-interval").addEventListener("click", async () => {
    const config = await getConfig();
    config.intervalMinutes = Number($("#interval").value);
    await setConfig(config);
    refreshStatus();
  });

  $("#check-now").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "chercheappart:manual-check" }, () => {
      $("#status").textContent += " — vérification lancée…";
    });
  });

  refreshStatus();
})();

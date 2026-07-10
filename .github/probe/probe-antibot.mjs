/**
 * Probe : un vrai navigateur headless (Playwright) peut-il charger la 1re page
 * des recherches Leboncoin/PAP/SeLoger malgré DataDome, depuis un runner GitHub ?
 *
 * Jetable : sert uniquement à décider si l'approche "navigateur serveur" est
 * viable avant de l'intégrer. N'écrit rien, affiche un diagnostic.
 */
import { chromium } from "playwright";

const URLS = {
  Leboncoin: "https://www.leboncoin.fr/recherche?category=10&locations=Paris&price=min-1200",
  PAP: "https://www.pap.fr/annonce/locations-appartement-paris",
  SeLoger: "https://www.seloger.com/list.htm?projects=1&types=1&places=[{ci:750056}]",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const ctx = await browser.newContext({
  userAgent: UA,
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
  viewport: { width: 1366, height: 900 },
});
// Anti-détection basique : masque navigator.webdriver
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

for (const [name, url] of Object.entries(URLS)) {
  const page = await ctx.newPage();
  let status = "?";
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = resp ? resp.status() : "no-response";
    // Laisse le temps au challenge DataDome de s'exécuter, puis au contenu de charger.
    await page.waitForTimeout(8000);
    const html = await page.content();
    const text = await page.evaluate(() => document.body ? document.body.innerText : "");
    const lower = (html + text).toLowerCase();
    const blocked =
      lower.includes("datadome") ||
      lower.includes("captcha") ||
      lower.includes("verifying you are human") ||
      lower.includes("accès à cette page a été bloqué") ||
      lower.includes("interdit");
    const euros = (text.match(/€/g) || []).length;
    const priceLike = (text.match(/\d[\d\s.]{2,}\s?€/g) || []).length;
    const title = await page.title();
    console.log(`\n=== ${name} ===`);
    console.log(`  HTTP ${status} | titre: "${title.slice(0, 60)}"`);
    console.log(`  taille texte: ${text.length} | €×${euros} | prix-like×${priceLike}`);
    console.log(`  DataDome/CAPTCHA détecté: ${blocked ? "OUI (bloqué)" : "non"}`);
    const samples = text.split("\n").filter((l) => /\d[\d\s.]{2,}\s?€/.test(l)).slice(0, 3);
    samples.forEach((s) => console.log("   ex:", s.trim().slice(0, 80)));
    console.log(`  >>> VERDICT: ${!blocked && priceLike >= 3 ? "ACCESSIBLE ✅" : "BLOQUÉ ❌"}`);
  } catch (e) {
    console.log(`\n=== ${name} ===\n  ERREUR: ${e.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();

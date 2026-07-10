# 🏠 ChercheAppart

Veille automatique d'annonces immobilières (Leboncoin, PAP, SeLoger…) hébergeable
**gratuitement sur GitHub Pages**. Vous définissez vos critères, l'outil génère les
recherches filtrées, suit les nouvelles annonces et prépare vos messages de contact.

👉 **Interface** : une page statique (GitHub Pages)
👉 **Moteur** : un workflow GitHub Actions planifié qui récupère les annonces

---

## Ce que fait l'outil

| Fonction | Fiabilité | Détail |
|---|---|---|
| **Veille automatique (Bien'ici)** | ✅ Fonctionnelle | L'API publique de Bien'ici (agences + particuliers, locations & ventes) répond depuis les runners GitHub → vraies annonces récupérées toutes les 3 h |
| **Générateur d'URL filtrées** | ✅ Très fiable | Vos critères → URL de recherche réelles (Bien'ici, Leboncoin) |
| **Tableau de bord + badge « nouveau »** | ✅ | Annonces stockées dans `data/listings.json` |
| **Contact semi-automatique** | ✅ | Message pré-rédigé + ouverture en un clic (mailto / annonce) |
| **Leboncoin / PAP / SeLoger** | ⚠️ Manuel | Protégés par anti-bots (DataDome) → non scrapables en CI, mais URL filtrées générées pour ouverture manuelle |

> **Source de la veille : Bien'ici.** Testé de bout en bout (50 annonces réelles récupérées et affichées). Leboncoin, PAP et SeLoger bloquent le scraping depuis les serveurs ; ils restent disponibles via le générateur de recherches filtrées.

## Pourquoi cette architecture ?

GitHub Pages est **statique** : la page ne peut ni tourner en fond, ni interroger
Leboncoin/SeLoger directement (blocage **CORS** + anti-bots). La veille « régulière »
est donc assurée par **GitHub Actions**, qui joue le rôle de serveur gratuit :

```
Vos critères (interface)
      │  export
      ▼
data/criteria.json ──►  GitHub Actions (cron toutes les 3h)  ──► scraper/scrape.py
                                                                      │
                              data/listings.json  ◄── commit ─────────┘
                                     │
                                     ▼
                       GitHub Pages (tableau de bord)
```

## Pourquoi pas de contact 100 % automatique ?

Envoyer des messages automatisés sur Leboncoin/SeLoger/PAP **enfreint leurs CGU**
et déclenche leurs protections anti-robot (blocage de compte). ChercheAppart fait
du **contact semi-automatique** : le message est pré-rempli depuis votre modèle et
ouvert en un clic — **vous validez l'envoi**. Conforme, fiable, sans risque de ban.

---

## Installation

1. **Forkez / créez** ce dépôt sur votre compte GitHub.
2. **Activez GitHub Pages** : `Settings ▸ Pages ▸ Source : GitHub Actions`.
3. **Activez les Actions** : `Settings ▸ Actions ▸ General ▸ Workflow permissions ▸
   Read and write permissions` (nécessaire pour que la veille committe les annonces).
4. Ouvrez le site publié, réglez vos critères, cliquez **⬇️ Exporter criteria.json**,
   puis remplacez `data/criteria.json` dans le dépôt (commit).
5. La veille tourne toute seule (ou lancez-la à la main : onglet **Actions ▸ Veille
   des annonces ▸ Run workflow**).

## Développement local

```bash
# Interface : n'importe quel serveur statique
python3 -m http.server 8000        # puis http://localhost:8000

# Scraper
pip install -r scraper/requirements.txt
python scraper/scrape.py --dry-run  # test sans écriture
python scraper/scrape.py            # met à jour data/listings.json
```

## Fiabilité du scraping & solutions de contournement

Les runners GitHub utilisent des IP de datacenter, souvent bloquées par les
anti-bots (DataDome sur Leboncoin). Les adaptateurs **échouent proprement**
(liste vide + log) : le reste de l'outil continue de fonctionner, et l'URL de
recherche filtrée reste toujours disponible.

Pour une récupération robuste, branchez dans les adaptateurs (`scraper/sites/`) :

- un **proxy résidentiel** (variable d'env → `session.proxies`) ;
- ou une **API tierce** de scraping (clé dans les *Secrets* du dépôt) ;
- ou remplacez la source par les **alertes email/RSS natives** des sites.

## Structure

```
index.html                 Interface (onglets Critères / Recherches / Annonces)
assets/css/style.css        Styles (thème clair & sombre)
assets/js/app.js            Logique front : critères, URL, tableau de bord, contact
data/criteria.json          Vos critères (utilisés par la veille)
data/listings.json          Annonces récupérées (mises à jour par Actions)
scraper/scrape.py           Orchestrateur de la veille
scraper/sites/              Adaptateurs par site (base, leboncoin, pap…)
.github/workflows/          Cron de veille + déploiement Pages
```

## Étendre à un nouveau site

Créez `scraper/sites/monsite.py` héritant de `SiteAdapter`
(`search_url` + `fetch`), puis enregistrez-le dans
`scraper/sites/__init__.py` (dict `ADAPTERS`). Ajoutez la case correspondante
dans `SITE_BUILDERS` de `assets/js/app.js` pour l'URL côté interface.

## Avertissement légal

Cet outil est fourni à titre éducatif. Respectez les CGU et le `robots.txt` des
sites, le RGPD et la législation applicable. N'automatisez pas l'envoi de messages
en violation des conditions d'utilisation des plateformes.

## Licence

MIT.

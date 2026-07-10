-- ChercheAppart — schéma Supabase (100 % gratuit, sans carte bancaire)
-- À coller dans Supabase Studio ▸ SQL Editor ▸ Run.
--
-- Modèle par-utilisateur : chacun a SES recherches, SES annonces, SES abonnements
-- push. La sécurité au niveau ligne (RLS) garantit qu'un utilisateur ne voit que
-- ses propres données. Le worker de veille utilise la clé "service role" qui
-- contourne RLS pour lire les recherches de tout le monde et écrire les annonces.

-- ---------- Recherches (les critères de chaque utilisateur) ----------
create table if not exists public.searches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text default 'Ma recherche',
  criteria   jsonb not null,            -- {villes, prixMax, surfaceMin, ...}
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists searches_user_idx on public.searches (user_id);

-- ---------- Annonces trouvées par la veille ----------
create table if not exists public.listings (
  id          bigint generated always as identity primary key,
  search_id   uuid not null references public.searches (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  external_id text not null,            -- id Bien'ici (dédup)
  data        jsonb not null,           -- {title, price, url, surface, rooms, location, image, source}
  seen        boolean not null default false,
  notified    boolean not null default false,
  found_at    timestamptz not null default now(),
  unique (search_id, external_id)       -- pas deux fois la même annonce par recherche
);
create index if not exists listings_user_idx on public.listings (user_id, found_at desc);

-- ---------- Boîtes e-mail d'alertes (Leboncoin/PAP/SeLoger), PAR UTILISATEUR ----------
-- Chaque utilisateur renseigne SA PROPRE boîte dédiée depuis l'interface (jamais
-- une adresse figée côté serveur). Le worker (clé service) lit chaque boîte
-- active et rattache les annonces trouvées au bon utilisateur.
--
-- Sécurité : n'y stockez qu'un "mot de passe d'application" (révocable à tout
-- moment côté Gmail/Outlook), jamais le mot de passe principal du compte.
-- RLS restreint la lecture au propriétaire + à la clé service du worker.
create table if not exists public.email_sources (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  imap_host     text not null default 'imap.gmail.com',
  imap_port     int  not null default 993,
  imap_user     text not null,             -- adresse de la boîte dédiée
  imap_password text not null,             -- mot de passe d'application (pas le mdp principal)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (user_id, imap_user)
);
create index if not exists email_sources_user_idx on public.email_sources (user_id);

-- ---------- Abonnements Web Push (pour les alertes app fermée) ----------
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,            -- {p256dh, auth}
  created_at timestamptz not null default now()
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

-- ---------- Row Level Security ----------
alter table public.searches            enable row level security;
alter table public.listings            enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.email_sources       enable row level security;

-- Chaque utilisateur gère uniquement ses propres lignes.
create policy "own searches"  on public.searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own listings"  on public.listings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own push subs" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own email sources" on public.email_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Note : la clé "service role" (utilisée par le worker GitHub Actions) contourne
-- RLS, ce qui lui permet de lire toutes les recherches et d'insérer les annonces.

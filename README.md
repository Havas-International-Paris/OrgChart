# Organigramme Havas International

Application interne pour visualiser et éditer l'organigramme de Havas International : tableur éditable à gauche, organigramme visuel à droite, sur un seul écran. Gère le multi-reporting (un employé peut avoir plusieurs managers, dont un seul "primaire"), les affectations clients/missions avec %ETP, et la synchronisation en temps réel entre utilisateurs.

**En production** : https://orgchart-dun.vercel.app (dépôt : `Havas-International-Paris/OrgChart` sur GitHub, déployé automatiquement par Vercel à chaque push sur `main`).

## Stack

- React + TypeScript + Vite, Tailwind CSS
- [Supabase](https://supabase.com) (Postgres + Auth + Realtime) — le frontend s'y connecte directement via le SDK JS, sécurisé par des policies Row Level Security. Pas de backend séparé.
- [AG Grid Community](https://www.ag-grid.com/) pour le tableur
- [React Flow](https://reactflow.dev/) + [dagre](https://github.com/dagrejs/dagre) pour l'organigramme
- [Zustand](https://github.com/pmndrs/zustand) pour l'état de sélection partagé entre les deux vues

## Mise en route

### 1. Créer le projet Supabase

1. Créez un projet gratuit sur [supabase.com](https://supabase.com).
2. Dans l'éditeur SQL du projet, exécutez **dans l'ordre** les fichiers de `supabase/migrations/` :
   - `0001_init_schema.sql` — tables (employees, reporting_relationships, clients_missions, assignments)
   - `0002_rls_policies.sql` — policies Row Level Security (accès réservé aux utilisateurs authentifiés)
   - `0003_cycle_check_function.sql` — trigger anti-cycle pour le multi-reporting
   - `0004_enable_realtime.sql` — active la diffusion temps réel sur les 4 tables (indispensable : sans ce fichier, les modifications d'un utilisateur n'apparaissent jamais en direct chez les autres)
   - `0005_job_titles.sql` — catalogue des postes (pré-rempli à partir des postes déjà utilisés par les employés existants)
3. Créez au moins un utilisateur dans **Authentication → Users → Add user** pour pouvoir vous connecter.
4. Récupérez l'URL du projet et la clé **publishable** (ou `anon`) dans **Project Settings → API**.

### 2. Configurer le frontend

```bash
npm install
cp .env.example .env.local
# renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local
npm run dev
```

L'application affiche un message explicite si `.env.local` n'est pas configuré, plutôt qu'un écran blanc.

### 3. Vérifier

- `npm run build` doit passer sans erreur (typecheck + build).
- Se connecter avec le compte créé à l'étape 1.
- Ajouter un employé dans le tableur, vérifier qu'il apparaît dans l'organigramme.
- Ouvrir l'app dans deux onglets pour confirmer que le temps réel fonctionne (une modification dans l'un doit apparaître dans l'autre sans rafraîchir).

## Structure du projet

```
src/
├── lib/            supabaseClient, types générés à la main (database.types.ts)
├── types/          types métier (Employee, ReportingRelationship, Assignment, ClientMission)
├── stores/         selectionStore (Zustand) — sélection et recherche partagées entre tableur et organigramme
├── hooks/          useEmployees, useReportingGraph, useAssignments, useClientsMissions,
│                   useJobTitles, useAuth
│                   (chaque hook gère son propre fetch + abonnement temps réel Supabase)
├── services/       appels Supabase bruts (CRUD), un fichier par table
├── components/
│   ├── layout/     AppShell (mise en page split-pane, en-tête, recherche),
│   │               LeftPanel (onglets Employés / Clients-Missions / Postes)
│   ├── grid/       EmployeeGrid, ClientsMissionsGrid, JobTitlesGrid (AG Grid) + définitions de colonnes
│   ├── chart/      OrgChartView (React Flow), EmployeeNode, layoutEngine (dagre), useVisibleGraph
│   ├── shared/     modales réutilisables (ManagerEditorModal, LinkExistingEmployeeModal,
│   │               AssignmentEditorModal), SearchBar
│   └── auth/       LoginPage, écran de configuration Supabase manquante
supabase/
└── migrations/     schéma SQL, RLS, trigger anti-cycle, activation du temps réel
```

## Points d'architecture à connaître

- **Multi-reporting** : chaque relation de reporting (`reporting_relationships`) a un flag `is_primary`. Une seule relation primaire par employé (contrainte DB), utilisée pour le calcul automatique du layout de l'organigramme (dagre). Les relations secondaires s'affichent en pointillés par-dessus, sans influencer le layout.
- **Anti-cycle** : double protection — vérification côté client avant écriture (`wouldCreateCycle` dans `useReportingGraph`), et trigger Postgres récursif en base (protection contre les races entre deux utilisateurs simultanés).
- **Temps réel** : chaque hook de données ouvre son propre channel Supabase Realtime avec un nom unique (`crypto.randomUUID()`). Un nom de channel fixe et partagé casse silencieusement dès qu'un deuxième composant (ou un double-mount React StrictMode) tente de s'abonner au même nom.
- **Pas de verrouillage optimiste** : si deux personnes modifient le même champ au même moment, la dernière écriture gagne. Acceptable pour un outil interne à faible nombre d'éditeurs simultanés.
- **Coût** : conçu pour rester sur le plan gratuit Supabase (0€/mois, budget max validé : 5€/mois). Deux limites à compenser (voir ci-dessous) :
  - Le projet Supabase gratuit se met en pause après une semaine sans requête.
  - Pas de sauvegarde automatique incluse sur le plan gratuit.

## Déploiement et mise à jour

Le frontend est hébergé sur **Vercel**, connecté au dépôt GitHub `Havas-International-Paris/OrgChart`. Il n'y a **pas d'environnement de staging séparé** : le projet Supabase utilisé pendant le développement sert aussi de base de production (choix assumé pour rester simple — voir les risques ci-dessous).

- **Changements de code** : commit + push sur `main` → Vercel reconstruit et redéploie automatiquement en 1-2 minutes, sans action manuelle. Une Pull Request génère en plus une URL de prévisualisation Vercel distincte, testable avant de fusionner — un filet de sécurité léger même sans staging formel.
- **Changements de base de données** (nouveau fichier dans `supabase/migrations/`) : **toujours manuel**. Il faut l'exécuter à la main dans l'éditeur SQL du projet Supabase, puisque c'est le même projet qui sert la production. Relire toute nouvelle migration avant de l'exécuter ; la sauvegarde hebdomadaire automatique (voir ci-dessous) sert de filet de sécurité en cas d'erreur.

Deux workflows GitHub Actions ([supabase-keep-alive.yml](.github/workflows/supabase-keep-alive.yml), [supabase-backup.yml](.github/workflows/supabase-backup.yml)) tournent chaque lundi pour compenser les limites du plan gratuit Supabase (mise en pause après inactivité, pas de sauvegarde automatique incluse). Ils ont besoin de 3 secrets configurés dans **Settings → Secrets and variables → Actions** du dépôt GitHub : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` — déjà en place. Déclenchement manuel possible depuis l'onglet **Actions** (bouton "Run workflow") pour vérifier qu'ils fonctionnent sans attendre le cron.

**Risque à garder en tête** : sans staging séparé, une migration SQL erronée affecte directement les données réelles. Pas bloquant pour un outil interne à faible volume d'éditeurs, mais à ne pas oublier en cas d'évolution du schéma.

## Limitations connues

- AG Grid Community ne propose pas de lignes "master/detail" extensibles — les affectations clients/missions s'éditent donc via une modale dédiée plutôt qu'une ligne dépliable.
- Pas de rôles granulaires : tout utilisateur authentifié peut tout modifier, y compris supprimer un employé.
- Le poste ("Poste") d'un employé est une liste à choix contraint (catalogue `job_titles`), pas une contrainte de clé étrangère en base — supprimer un poste du catalogue n'affecte pas les employés qui l'utilisent déjà.

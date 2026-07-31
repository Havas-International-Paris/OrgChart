# Cahier des charges — Chat IA intégré à l'app OrgChart

Statut : brouillon, en discussion. Dernière mise à jour : 2026-07-31.

**Décisions clés à date :** LLM = Google Gemini (tier gratuit), pas Anthropic — voir §4 pour le raisonnement. Chat scopé au chart actuellement affiché, pas de changement de chart depuis la conversation — voir §3.

## 1. Objectif

Permettre à un utilisateur connecté d'interroger l'organigramme en langage naturel directement depuis un widget de chat intégré à l'application OrgChart (pas un client externe type Claude Desktop), et à terme (v2+) de le modifier de la même façon.

## 2. Contexte technique actuel

- L'app est 100% frontend (React + Vite) + Supabase direct (Postgres, Auth, Realtime, Storage), sans backend applicatif.
- Aucune notion de rôle/permission granulaire : tout utilisateur authentifié peut tout lire/modifier (voir "Known issues" du CLAUDE.md).
- Ce chantier nécessite donc l'ajout d'une première brique backend, qui n'existe pas aujourd'hui — c'est le changement d'architecture le plus significatif du projet à date.

## 3. Périmètre de la v1

**Inclus :**
- Widget de chat dans l'app, accessible à tout utilisateur authentifié.
- Lecture seule : le chat répond à des questions sur les données de l'org chart actuellement sélectionné, ne modifie jamais rien.
- Historique de conversation éphémère (perdu au rafraîchissement de page) — pas de persistance en base pour la v1.
- Cas d'usage couverts (voir §5 pour le détail des tools) :
  - Structure hiérarchique (managers, subordonnés, chaîne complète)
  - Recherche d'employé (nom, poste, département, business unit)
  - Clients/missions & ETP (qui travaille sur quoi, taux d'allocation)
  - Statistiques globales (effectifs par département, etc.)
- **Scope fixe au chart affiché** : le chat interroge uniquement le `org_chart_id` actuellement sélectionné dans l'app (`currentOrgChartId`, voir `selectionStore.ts`). Pas de changement de chart depuis la conversation — s'il veut interroger un autre chart, l'utilisateur le change via le sélecteur habituel de l'app, ce qui réinitialise/rescope le chat comme le reste de l'UI. Plus simple à raisonner et cohérent avec le fait que le reste de l'app (grille, chart) suit déjà cette règle.

**Explicitement hors scope v1 :**
- Écriture (créer/modifier un employé, une relation, une mission via le chat) — prévu en v2, voir §7.
- Gestion de rôles/permissions différenciées — nécessaire seulement à partir de la v2 écriture, absente aujourd'hui de l'app entière.
- Historique persistant des conversations.
- Un serveur MCP séparé pour des clients externes (Claude Desktop, etc.) — évoqué en amont de ce cahier des charges, mais ce n'est pas l'objectif retenu ; la logique de requêtage pourra éventuellement être réutilisée si ce besoin réapparaît.

## 4. Architecture proposée

```
Navigateur — bouton icône IA (header ou panneau)
        │  clic → ouvre le widget de chat
        ▼
Panneau latéral de chat (React, redimensionnable)
        │  requête utilisateur (texte)
        ▼
Backend serverless (Vercel Function, ex: /api/chat)
        │  appelle l'API Gemini avec tool-use,
        │  la clé API reste côté serveur (jamais exposée au navigateur)
        ▼
Google Gemini API ──── decide quel(s) tool(s) appeler
        │
        ▼
Tools de requêtage (même backend) ──── lisent Supabase,
        │  scopés au org_chart_id actuellement affiché
        │  (tables : employees, reporting_relationships,
        │   assignments, clients_missions, departments, job_titles)
        ▼
Réponse en langage naturel, streamée token par token vers le navigateur
```

**Déclenchement du widget :** un bouton avec une icône IA (dans le header, à côté des autres contrôles globaux comme `UndoRedoButtons`/`FiltersToggle`) ouvre/ferme le panneau de chat au clic. Pas d'ouverture automatique.

**Choix d'hébergement retenu : Vercel Functions.**
Raison : l'app est déjà déployée sur Vercel avec déploiement automatique à chaque push sur `main` ; ajouter une route serverless ne demande ni nouvelle plateforme ni pipeline séparé. Alternative envisagée et écartée pour la v1 : Supabase Edge Functions (runtime Deno différent du reste du code TS de l'app, pipeline de déploiement séparé à maintenir) — à reconsidérer seulement si un besoin fort de centralisation côté Supabase apparaît.

**Choix du LLM retenu : Google Gemini (tier gratuit), pas l'API Anthropic.**
Raison : éviter de consommer le compte Anthropic personnel et payant de l'utilisateur pour un usage partagé par toute l'équipe. Gemini (2.0/2.5 Flash) offre un vrai tier gratuit permanent (avec limites de débit imposées par Google, pas de coût) et un support correct du tool-use, suffisant pour ce périmètre de requêtes factuelles sur les données de l'org chart. Alternatives considérées :
- **Groq** (Llama/Mixtral gratuit) : tier gratuit encore plus généreux, mais function-calling jugé moins fiable que Gemini pour des requêtes précises.
- **OpenAI** : écarté, pas de tier gratuit durable (seulement des crédits d'essai limités dans le temps).
- **Modèle local (Ollama)** : écarté, demanderait un serveur dédié (GPU), incompatible avec Vercel Functions.
- **Anthropic (clé payante de l'utilisateur)** : reste une option de repli si la qualité Gemini s'avère insuffisante en usage réel — voir §8 sur la limite de requêtes qui s'appliquerait alors.

**Authentification :** le backend doit vérifier la session Supabase de l'utilisateur (token déjà géré par l'app) avant d'accepter une requête de chat, pour s'assurer que seul un utilisateur connecté peut l'utiliser et que les tools de requêtage n'exposent que l'org chart auquel il a accès.

**Clé API Gemini :** stockée en variable d'environnement côté Vercel (jamais dans le bundle frontend) — c'est précisément ce que le backend rend possible et qu'une architecture 100% frontend ne permettait pas.

## 5. Tools exposés au LLM (v1, lecture seule)

À affiner en implémentation, mais le périmètre validé couvre :

| Tool | Description | Table(s) Supabase concernées |
|---|---|---|
| `find_employee` | Recherche par nom, poste, département, business unit | `employees`, `job_titles`, `departments` |
| `get_manager_chain` | Chaîne hiérarchique complète d'un employé (managers primaires + fonctionnels) | `reporting_relationships` |
| `get_direct_reports` | Subordonnés directs (et éventuellement toute la sous-équipe) d'un manager | `reporting_relationships` |
| `get_assignments` | Missions/clients et %ETP d'un employé | `assignments`, `clients_missions` |
| `get_department_stats` | Effectifs et répartition par département/BU | `employees`, `departments` |

Tous scopés implicitement au `org_chart_id` actuellement affiché dans l'app (pas de tool de listing/changement de chart, cf. §3 — scope fixe).

## 6. Critères de succès v1

- Un utilisateur peut poser une question en langage naturel (ex. "qui sont les managers de Camille Dupont ?", "combien de personnes travaillent sur le client X ?") et obtenir une réponse correcte et sourcée dans les données réelles de son org chart.
- Aucune clé API ou secret exposé côté navigateur.
- Le widget n'interfère pas avec les fonctionnalités existantes (grille, chart, undo/redo).

## 7. Roadmap au-delà de la v1

- **v2 — Écriture via le chat** : proposer/exécuter des modifications (créer un employé, changer un manager, etc.) depuis le chat. Nécessitera :
  - Une étape de confirmation utilisateur avant toute action destructive/mutante (pas d'exécution silencieuse).
  - Une notion de rôles/permissions à concevoir pour l'app entière, pas seulement pour le chat.
  - Réutilisation des mêmes garde-fous que l'UI existante (détection de cycles, undo/redo — voir CLAUDE.md sur `wouldCreateCycle` et le pattern `restore*`).
- **v3 (optionnel) — Historique persistant** : nouvelle table Supabase, question de rétention/confidentialité à trancher.

## 8. Décisions sur les points restants

- **Limite de requêtes :** pas de limite applicative tant que le LLM utilisé est Gemini (tier gratuit, aucun coût par requête pour l'utilisateur — seules les limites de débit de Google s'appliquent, gérées côté API). Si un jour le chat bascule sur la clé Anthropic payante (repli qualité, voir §4), une limite de **10 requêtes/jour/utilisateur** devra être ajoutée pour contenir le coût.
- **Emplacement du widget :** panneau latéral, au même niveau que les panneaux grille/chart existants — redimensionnable comme eux (même pattern de divider `setPointerCapture` que `AppShell.tsx` utilise déjà entre grille et chart). Ouvert/fermé via le bouton icône IA du §4, pas une fenêtre flottante ni un onglet dans `LeftPanel.tsx`.
- **Streaming token par token :** confirmé pour la v1. Pas de complication technique majeure attendue — l'API Gemini comme l'API Anthropic exposent nativement un mode streaming, et Vercel Functions supporte les réponses en streaming (Server-Sent Events ou `ReadableStream`) sans configuration particulière. Le seul point d'attention en implémentation : le tool-use complique légèrement le streaming (le modèle peut streamer du texte, puis s'arrêter pour appeler un tool, puis reprendre) — à gérer avec une boucle qui alterne entre streaming de texte et exécution de tool, pattern standard des deux SDKs.

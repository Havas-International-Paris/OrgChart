# Brief — Isoler les workspaces des agents de codage

Statut : brouillon pour exécution par Claude Code. Dernière mise à jour : 2026-08-18.

## 1. Contexte

Pendant la session du 18 août 2026, OpenCode a committé et pushé un bundle Phase 2 (backlog item 61 — auth/session hardening) sur `main`. Dans le même working tree, un fichier `src/components/timeEstimation/TimeEstimationGrid.tsx` portait des modifications non-committées en cours par **Claude Code** dans une session parallèle. OpenCode a correctement détecté que le fichier n'était pas de son ressort et l'a laissé non-stagé, mais l'incident a failli produire un conflit silencieux. La cause racine : **deux agents de codage partagent le même répertoire de travail**, donc modifient les mêmes fichiers en parallèle.

Ce brief décrit le setup à mettre en place pour que chaque agent (Claude Code, OpenCode, et tout futur harness) travaille dans son propre espace, sans intervention manuelle à chaque session.

## 2. Objectif

Un worktree git par agent, idéalement **hors OneDrive**, avec attribution git séparée par worktree. Les agents peuvent tourner en parallèle sans collision filesystem ; les merges entre branches restent des opérations explicites (visibles au `git merge`) plutôt que silencieuses (écrasement en direct dans le working tree).

## 3. Constats et contraintes

### 3.1 OneDrive

Le repo vit actuellement dans `~/Library/CloudStorage/OneDrive-Havas/Documents/Claude/Orgchart`. La mémoire `feedback_git_onedrive_mmap` documente déjà des timeouts `git push` causés par le mmap OneDrive. Mettre des worktrees dans OneDrive ne ferait qu'empirer — préférer un emplacement hors cloud-sync.

Emplacement proposé : `~/dev/Orgchart` (repo principal + worktrees en sous-répertoires).

### 3.2 Mémoire Claude Code par chemin de projet

Claude Code keyed sa mémoire par hash du chemin absolu du projet. Le répertoire actuel `~/.claude/projects/-Users-NICOLAS-DEVULPIAN-Library-CloudStorage-OneDrive-Havas-Documents-Claude-Orgchart/` contient :
- `memory/` — backlog, reflections, feedback, references (4 ans de capitalisation)
- `MEMORY.md` — index
- `*.jsonl` — historique des sessions

Déplacer le repo change le hash → Claude perd l'accès à toute sa mémoire. Il faut soit copier le répertoire de mémoire vers le nouveau hash, soit symlinker. Voir §5.4.

### 3.3 Base Supabase unique partagée

L'item 59 (dev/staging Supabase séparé) a été **explicitement décliné** par l'utilisateur ("C'est un petit projet sans enjeux importants"). Toute migration appliquée par un agent touche le même Supabase de prod que l'autre voit. **Pas de migrations en parallèle** — coordonner explicitement quand l'un doit appliquer une migration.

### 3.4 Backlog item 64

L'item 64 ("Create separate GitHub profiles/accounts per coding-agent harness committing to this repo") est l'arrière-plan de ce brief. Le brief présent couvre la partie **workspace isolation** ; l'attribution GitHub (un compte par harness) reste un chantier séparé à faire en plus — voir §7.

### 3.5 Configuration des harnesses

- **Claude Code** lit `.claude/` à la racine du projet et `~/.claude/` globalement. La mémoire projet vit dans `~/.claude/projects/<hash>/`.
- **OpenCode** lit `opencode.json`/`opencode.jsonc`, `.opencode/` à la racine, `~/.config/opencode/` globalement (voir skill `customize-opencode`).

Ces configs restent valables dans chaque worktree — elles sont relatives au répertoire de travail, pas au `.git` partagé.

## 4. Architecture proposée

```
~/dev/Orgchart              # repo principal (worktree "main")
  .git/                     # le vrai .git, partagé par tous les worktrees
  .claude/                  # configs Claude Code
  .opencode/                # configs OpenCode (à créer si pas déjà là)
  CLAUDE.md
  ...                       # code source, branche main

~/dev/Orgchart-claude       # worktree pour Claude Code (branche claude/main)
~/dev/Orgchart-opencode     # worktree pour OpenCode (branche opencode/main)
```

Chaque worktree est un checkout complet et indépendant : `npm install`, `npm run dev`, modifications, commits — tout se passe dans le worktree de l'agent sans toucher ni le repo principal ni l'autre worktree.

## 5. Plan d'exécution

### 5.1 Déplacer le repo hors OneDrive

```bash
# Cible : ~/dev/Orgchart
mkdir -p ~/dev
cp -R " ~/Library/CloudStorage/OneDrive-Havas/Documents/Claude/Orgchart" ~/dev/Orgchart
# Vérifier que .git est bien copié (rsync -a plus sûr que cp -R pour les fichiers cachés)
ls -la ~/dev/Orgchart/.git
```

Une fois vérifié que le nouveau ~/dev/Orgchart fonctionne (build, dev server, git push depuis ce chemin), supprimer l'original dans OneDrive. **Ne pas le faire avant validation complète** — garder l'original comme backup jusqu'à ce que tout tourne depuis le nouvel emplacement.

Mettre à jour `.gitignore` au besoin si le nouveau chemin change des patterns (probablement non).

### 5.2 Créer les worktrees

Depuis `~/dev/Orgchart` :

```bash
git worktree add -b claude/main ../Orgchart-claude main
git worktree add -b opencode/main ../Orgchart-opencode main
```

Vérifier :

```bash
git worktree list
# /Users/<user>/dev/Orgchart        (main)
# /Users/<user>/dev/Orgchart-claude (claude/main)
# /Users/<user>/dev/Orgchart-opencode (opencode/main)
```

### 5.3 Installer les dépendances dans chaque worktree

Chaque worktree a son propre `node_modules` :

```bash
cd ~/dev/Orgchart-claude && npm install
cd ~/dev/Orgchart-opencode && npm install
```

Idem pour `.env.local` — copier depuis le repo principal :

```bash
cp ~/dev/Orgchart/.env.local ~/dev/Orgchart-claude/.env.local
cp ~/dev/Orgchart/.env.local ~/dev/Orgchart-opencode/.env.local
# Idem .env.test.local si présent
```

### 5.4 Migrer la mémoire Claude Code

Le hash du chemin `~/dev/Orgchart` produira un répertoire `~/.claude/projects/-Users-<user>-dev-Orgchart/`. Pour conserver la mémoire :

```bash
# Calculer le nouveau chemin (Claude Code le créera tout seul au premier lancement,
# mais on peut le pré-créer en copiant l'ancien)
cp -R ~/.claude/projects/-Users-NICOLAS-DEVULPIAN-Library-CloudStorage-OneDrive-Havas-Documents-Claude-Orgchart \
      ~/.claude/projects/-Users-NICOLAS-DEVULPIAN-dev-Orgchart
```

Alternative robuste aux futurs déménagements : un symlink. Moins propre (Claude peut un jour faire un `realpath` et refuser) mais évite de refaire l'opération.

```bash
ln -s ~/.claude/projects/-Users-NICOLAS-DEVULPIAN-Library-CloudStorage-OneDrive-Havas-Documents-Claude-Orgchart \
       ~/.claude/projects/-Users-NICOLAS-DEVULPIAN-dev-Orgchart
```

**Préférer le `cp -R`** — le symlink peut casser si Claude fait un `realpath` à l'avenir. Après copie, vérifier en lançant Claude dans `~/dev/Orgchart` que la mémoire est bien chargée (`/memory` ou invocation d'une commande qui dépend de la mémoire backlog).

### 5.5 Configurer l'attribution git par worktree

Configuration locale au worktree (pas globale — chaque worktree est indépendant) :

```bash
cd ~/dev/Orgchart-claude
git config user.name "Claude Code (Havas OrgChart)"
git config user.email "claude-code@havas.local"

cd ~/dev/Orgchart-opencode
git config user.name "OpenCode (Havas OrgChart)"
git config user.email "opencode@havas.local"
```

Le repo principal `~/dev/Orgchart` garde l'identité git de l'utilisateur humain — c'est lui qui merge et pousse vers `origin/main` au final, en revoyant le travail des deux agents.

### 5.6 Mettre à jour CLAUDE.md

Ajouter une section "Workspace convention" à `CLAUDE.md` documentant :

- Le repo principal vit à `~/dev/Orgchart` (branche `main`)
- Claude Code travaille dans `~/dev/Orgchart-claude` (branche `claude/main`)
- OpenCode travaille dans `~/dev/Orgchart-opencode` (branche `opencode/main`)
- **Règle absolue** : un agent ne committe jamais dans le worktree d'un autre agent. Quand le travail est fini sur une branche d'agent, il merge dans `main` depuis `~/dev/Orgchart` et pousse
- Pour démarrer une nouvelle session : `cd` dans le worktree de l'agent, `git pull` pour récupérer les derniers commits de `main`, créer une sous-branche si besoin
- Pas de migrations Supabase en parallèle avec un autre agent — coordonner explicitement

### 5.7 Script d'init idempotent

Préparer un script `scripts/setup-agent-worktrees.sh` à la racine du repo qui :
- Vérifie qu'on est dans le repo principal (présence de `.git/`)
- Crée les deux worktrees si pas déjà présents (idempotent : `git worktree list` puis ajouter si manquant)
- Copie `.env.local` et `.env.test.local` si manquants dans chaque worktree
- Lance `npm install` dans chaque worktree
- Configure les `user.email`/`user.name` locaux par worktree
- Affiche un récap à la fin

Le script doit être idempotent : le rejouer ne casse rien, ne fait que combler ce qui manque.

## 6. Workflow opérationnel

### 6.1 Démarrer une session agent

```bash
cd ~/dev/Orgchart-claude   # ou opencode
git checkout main && git pull origin main
git checkout -b feature/<sujet>   # sous-branche si le travail est isolable
```

### 6.2 Terminer une session agent

```bash
# dans le worktree de l'agent
git add -A && git commit -m "..."
# pusher la branche de l'agent vers origin (pas main)
git push origin HEAD
```

Puis depuis le repo principal, merger :

```bash
cd ~/dev/Orgchart
git fetch
git merge claude/main   # ou opencode/main, ou feature/<sujet>
# résoudre les conflits explicites si l'autre agent a touché les mêmes fichiers
git push origin main
```

### 6.3 Si un conflit survient au merge

C'est précisément le bénéfice : il est **explicite** (visible dans `git status` pendant le merge), pas silencieux (écrasement en direct dans le working tree). Le résoudre manuellement, ou faire un rebase de la branche agent sur le `main` à jour.

### 6.4 Sujets qui se chevauchent

Si deux agents travaillent sur le même fichier en parallèle, il y aura un conflit au merge. C'est acceptable — c'est le signe qu'il fallait les sérialiser. Coordination par la conversation avec l'utilisateur entre les deux sessions.

## 7. Ce qui reste hors scope de ce brief

### 7.1 Comptes GitHub séparés (item 64 complet)

L'attribution `user.email` par worktree règle l'affichage local des commits. Pour que les commits apparaissent comme de vrais comptes GitHub distincts sur GitHub (avatar, lien profil, stats contribution), il faut **un compte GitHub par harness** et configurer chaque worktree avec les credentials de son compte (HTTPS token ou SSH key dédiée). Chantier séparé, à faire après que le setup worktrees tourne.

### 7.2 Environnement Supabase séparé (item 59)

Décliné par l'utilisateur. Ne pas re-proposer sans une demande explicite. La coordination sur les migrations reste manuelle.

### 7.3 Dev server partagé

Chaque worktree peut lancer son propre `npm run dev` sur un port Vite différent (5173, 5174, ...). Vite détecte automatiquement un port libre. Pas de config supplémentaire à prévoir, mais attention au cookie de session : si le même login est fait depuis `localhost:5173` et `localhost:5174`, ce sont des origines différentes → deux sessions séparées. C'est acceptable et même utile pour tester deux rôles en parallèle.

## 8. Critères de succès

- [ ] `git worktree list` depuis `~/dev/Orgchart` montre 3 entrées (principal + 2 agents)
- [ ] `cd ~/dev/Orgchart-claude && npm run build` passe (indépendant du repo principal)
- [ ] `cd ~/dev/Orgchart-opencode && npm run build` passe
- [ ] Claude Code lancé dans `~/dev/Orgchart-claude` retrouve sa mémoire (`/memory` ou test live)
- [ ] OpenCode lancé dans `~/dev/Orgchart-opencode` retrouve sa config
- [ ] Un commit fait dans `~/dev/Orgchart-claude` apparaît dans `git log` de `~/dev/Orgchart` après un `git fetch` (partage du même `.git`)
- [ ] L'auteur d'un commit dans `~/dev/Orgchart-claude` est "Claude Code (Havas OrgChart)" et pas l'identité humaine
- [ ] CLAUDE.md documente la convention workspace

## 9. Risques résiduels

- **Conflit logique au merge** : si deux agents touchent le même fichier, le merge produit un conflit. Acceptable — explicite > silencieux.
- **Migrations Supabase en parallèle** : aucune protection, coordination manuelle. À documenter dans CLAUDE.md.
- **Push concurrent sur `origin/main`** : si deux agents pushent depuis leur worktree directement sur `main` (au lieu de leur branche dédiée), ils peuvent se faire concurrence. La convention "merge depuis le repo principal" l'évite.
- **Oubli de `git pull` avant de commencer une session agent** : le worktree peut être en retard sur `main`. À automatiser dans un script de démarrage de session, ou via un hook `pre-commit`.
- **Symlink mémoire** : si on choisit le symlink plutôt que le `cp -R`, un futur changement de convention côté Claude Code (utilisation de `realpath`) peut casser l'accès. Préférer `cp -R`.

## 10. Notes pour l'exécution par Claude Code

- **Ne pas supprimer le repo dans OneDrive** tant que le nouveau `~/dev/Orgchart` n'est pas validé bout-en-bout (build, dev server, git push depuis ce chemin, mémoire chargée). Le garder comme backup jusqu'à confirmation totale.
- **Exécuter §5.1 à 5.5 dans l'ordre** — 5.4 (mémoire) avant 5.6 (CLAUDE.md update) pour pouvoir vérifier que la mémoire est bien accessible depuis le nouveau chemin avant de finaliser la doc.
- **Le script `scripts/setup-agent-worktrees.sh` (§5.7) doit être idempotent** — on doit pouvoir le relancer sans casser un setup existant. Vérifier avec `git worktree list` avant de tenter `git worktree add`, vérifier la présence de `.env.local` avant de copier, etc.
- **Informer l'utilisateur avant chaque `rm`** — ne supprimer le repo dans OneDrive qu'après feu vert explicite de l'utilisateur, une fois tous les critères de §8 validés.

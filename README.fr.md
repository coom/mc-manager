#### AVERTISSEMENT :
![AI Assisted](https://img.shields.io/badge/AI%20Assisted-Project-00ADD8?style=for-the-badge&logo=dependabot&logoColor=white)

# MC Manager

[English](README.md) · **Français**

Interface web de suivi et de gestion d'un serveur Minecraft Java hébergé dans Docker avec [`itzg/minecraft-server`](https://github.com/itzg/docker-minecraft-server), les sauvegardes étant assurées par [`itzg/mc-backup`](https://github.com/itzg/docker-mc-backup) (méthode tar). Démarrer, arrêter et redémarrer le serveur, suivre les logs en direct, envoyer des commandes RCON, surveiller joueurs et santé du serveur, lister, télécharger, supprimer ou déclencher des backups. Multi-utilisateurs avec rôles (`admin` / `viewer`), MFA, journal d'audit. L'interface est disponible en **français et en anglais**.

## Fonctionnalités (lot 1)

- Authentification multi-comptes : assistant de création du premier admin, connexion, MFA TOTP avec codes de secours, appareils de confiance, politique de mot de passe, gestion des utilisateurs
- Contrôle du serveur : état en direct (`unavailable`, `stopped`, `starting`, `ready`, `unhealthy`, `stopping`), uptime, start / stop / restart
- Console : logs du conteneur en direct (pause, filtres texte et niveau) et commandes RCON avec historique
- Dashboard : joueurs en ligne, courbe de fréquentation (24 h / 7 j / 30 j), CPU, RAM, MSPT / TPS, taille du monde, espace disque restant
- Backups : liste, téléchargement, suppression, déclenchement manuel avec sortie en direct
- Journal d'audit de toutes les actions d'admin (commandes RCON, backups, contrôle du serveur, utilisateurs)
- Thèmes sombre et clair, français et anglais

## Captures d'écran

_À venir._

## Prérequis

- Un hôte Docker (Linux recommandé) avec Docker Compose v2
- Un conteneur Minecraft basé sur `itzg/minecraft-server` avec RCON activé, en version 1.20.3 ou plus pour `tick query` (MSPT ; en dessous le MSPT est simplement absent ; sur Paper, `tps` est utilisé en complément)
- Un conteneur `itzg/mc-backup` avec `BACKUP_METHOD: tar`
- MC Manager tourne sur le **même hôte Docker** que le serveur Minecraft et partage son réseau Docker

Une stack complète de référence est fournie dans [`docker-compose.example.yml`](docker-compose.example.yml).

> Statut : les fichiers de déploiement ont été validés par analyse seulement (`docker compose config`). Un test de bout en bout sur un vrai hôte Docker reste à faire.

## Déploiement

1. (Optionnel) Démarrer la stack Minecraft de référence, ou utiliser la vôtre :

   ```bash
   docker compose -f docker-compose.example.yml up -d
   ```

   Changez d'abord les deux mots de passe RCON `change-me`. La stack crée les volumes `mc-data` et `mc-backups` et le réseau `mc-network`.

2. Configurer MC Manager :

   ```bash
   cp .env.example .env
   ```

   Éditer `.env` :
   - `JWT_SECRET` et `ENCRYPTION_KEY` : obligatoires, 32 caractères minimum et **différents** l'un de l'autre (`openssl rand -hex 32` deux fois).
   - `FRONTEND_URL` : l'origine exacte utilisée par votre navigateur (CORS), par exemple `http://localhost:3000` ou `https://mc.example.com`. La valeur par défaut de `.env.example` (`http://localhost:5173`) ne convient qu'au développement local.
   - `MC_DATA_VOLUME`, `MC_BACKUPS_VOLUME`, `MC_NETWORK` : noms des volumes et du réseau existants de votre stack Minecraft.
   - `DOCKER_GID` : identifiant du groupe du socket Docker sur l'hôte, `stat -c %g /var/run/docker.sock` (le conteneur tourne avec l'utilisateur non privilégié `node` et reçoit ce groupe via `group_add`).

3. Construire et démarrer :

   ```bash
   docker compose up -d --build
   ```

4. Ouvrir `http://localhost:3000` (ou `FRONTEND_PORT`) et créer le premier compte admin.

### Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `JWT_SECRET` | obligatoire | Signe les sessions, 32 caractères minimum |
| `ENCRYPTION_KEY` | obligatoire | Chiffre les secrets stockés (TOTP), 32 caractères minimum, différente de `JWT_SECRET` |
| `DATABASE_URL` | fixée par le compose | Fichier SQLite, persisté dans le volume `backend-data` |
| `FRONTEND_URL` | `http://localhost:3000` dans le compose | Origine CORS autorisée |
| `FRONTEND_PORT` | `3000` | Port publié de l'interface web |
| `MC_CONTAINER` | `mc` | Nom du conteneur Minecraft |
| `MC_BACKUP_CONTAINER` | `mc-backup` | Nom du conteneur mc-backup |
| `MC_DATA_DIR` | `/mc/data` | Point de montage des données Minecraft (lecture seule) |
| `MC_BACKUPS_DIR` | `/mc/backups` | Point de montage des backups |
| `MC_RCON_HOST` | `MC_CONTAINER` | Hôte RCON |
| `MC_RCON_PORT` | `25575` | Port RCON |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Chemin du socket Docker dans le conteneur backend |
| `MC_DATA_VOLUME` / `MC_BACKUPS_VOLUME` | obligatoires (compose) | Noms des volumes Docker de la stack Minecraft |
| `MC_NETWORK` | `mc-network` | Réseau Docker partagé avec Minecraft |
| `DOCKER_GID` | `999` | Identifiant du groupe du socket Docker sur l'hôte |

Le mot de passe RCON n'est **jamais** configuré ici : le backend le lit dans `server.properties` sur le volume de données monté.

### Volumes et réseau

`docker-compose.yml` déclare `mc-data` et `mc-backups` comme volumes **externes** dont les noms réels viennent de `MC_DATA_VOLUME` et `MC_BACKUPS_VOLUME` ; ils doivent déjà exister (la stack de référence les crée avec ces noms exacts). Les données Minecraft sont montées en lecture seule sur `/mc/data`, les backups en lecture-écriture sur `/mc/backups`. Si vos données sont dans un dossier de l'hôte plutôt que dans un volume nommé, remplacez les entrées `mc-data:/mc/data:ro` et `mc-backups:/mc/backups` par vos chemins (et supprimez les deux déclarations de volumes de premier niveau). Le backend rejoint le réseau externe `MC_NETWORK` pour atteindre RCON.

### Avertissement sur le socket Docker

Le backend monte `/var/run/docker.sock`. **L'accès au socket Docker équivaut à un accès root sur l'hôte.** Quiconque compromet le backend peut prendre le contrôle de la machine. N'exposez MC Manager que derrière son authentification, de préférence derrière un reverse proxy HTTPS, utilisez des secrets robustes et activez la MFA pour les comptes admin. Ne publiez pas le port 3000 sur Internet sans ces protections.

## Rôles

| Rôle | Droits |
|---|---|
| `viewer` | Lecture seule : dashboard, logs de la console (pas de champ de commande), liste des backups, audit |
| `admin` | Tout : start / stop / restart, commandes RCON, backup manuel, téléchargement et suppression de backups, gestion des utilisateurs |

Toute action d'admin est écrite dans le journal d'audit.

## Développement

Prérequis : Node.js 20+ (22 en CI et dans Docker), pnpm 9.

```bash
pnpm install
cp .env.example .env                  # renseigner JWT_SECRET et ENCRYPTION_KEY
pnpm db:generate                      # génère le client Prisma (gitignoré), obligatoire avant typecheck/build
pnpm --filter @mc/common run build    # backend et frontend importent @mc/common depuis son dist/
pnpm dev                              # backend :3001 + frontend :5173 (Vite proxifie /api et /ws)

pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Les tests n'ont besoin ni de Docker ni d'un serveur RCON (des fakes sont injectés). En développement sans conteneur Minecraft, l'état du serveur est `unavailable`.

i18n : écrire un fragment dans `packages/frontend/scripts/i18n-fragments/*.json`, puis le fusionner dans les deux locales avec `node packages/frontend/scripts/merge-i18n.mjs` (échoue si les clés divergent de `en.json`).

## Confidentialité

Le dashboard affiche des avatars de joueurs chargés depuis le service tiers [mc-heads.net](https://mc-heads.net) : le navigateur de chaque utilisateur lui transmet les noms des joueurs en ligne. Les polices de l'interface (Outfit, JetBrains Mono) sont aussi chargées depuis Google Fonts (`fonts.googleapis.com`), ce qui expose l'adresse IP du visiteur à Google. Il n'y a aucun autre appel externe.

## Feuille de route (lot 2)

- Statistiques par joueur
- Journal d'événements de jeu
- Whitelist, ops, bans et kick
- Restauration d'un backup
- Éditeur de `server.properties`

Hors périmètre : modification de la planification des backups, modification des variables d'environnement du conteneur, gestion de plusieurs serveurs.

## Licence

MIT

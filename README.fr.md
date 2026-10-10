#### AVERTISSEMENT :
![AI Assisted](https://img.shields.io/badge/AI%20Assisted-Project-00ADD8?style=for-the-badge&logo=dependabot&logoColor=white)

# MC Manager

[English](README.md) · **Français**

Interface web de suivi et de gestion d'un serveur Minecraft Java hébergé dans Docker avec [`itzg/minecraft-server`](https://github.com/itzg/docker-minecraft-server), les sauvegardes étant assurées par [`itzg/mc-backup`](https://github.com/itzg/docker-mc-backup) (méthode tar). Démarrer, arrêter et redémarrer le serveur, suivre les logs en direct, envoyer des commandes RCON, surveiller joueurs et santé du serveur, lister, télécharger, supprimer ou déclencher des backups. Multi-utilisateurs avec rôles (`admin` / `viewer`), MFA, journal d'audit. L'interface est disponible en **français et en anglais**.

## Fonctionnalités (lot 1)

- Authentification multi-comptes : assistant de création du premier admin, connexion, MFA TOTP avec codes de secours, appareils de confiance, politique de mot de passe, gestion des utilisateurs
- Contrôle du serveur : état en direct (`unavailable`, `stopped`, `starting`, `ready`, `unhealthy`, `stopping`), uptime, start / stop / restart
- Console : logs du conteneur en direct (pause, filtres texte et niveau) et commandes RCON avec historique et complétion par Tab (commandes vanilla, joueurs en ligne, objets, blocs, entités, effets, enchantements ; `node packages/frontend/scripts/gen-mc-registry.mjs <version>` régénère la liste des identifiants pour une autre version de Minecraft)
- Dashboard : joueurs en ligne, courbe de fréquentation (24 h / 7 j / 30 j), CPU, RAM, MSPT / TPS, taille du monde, espace disque restant
- Backups : liste, téléchargement, suppression, déclenchement manuel avec sortie en direct, **restauration** (sauvegarde de sécurité, arrêt du serveur, remplacement des données de l'archive, redémarrage, progression en direct). Un téléchargement demande au backend un lien à usage unique valable 60 secondes (`POST /api/backups/:name/link`, admin, audité) que le navigateur suit ensuite, l'archive est donc écrite directement sur le disque
- Journal d'audit de toutes les actions d'admin (commandes RCON, backups, contrôle du serveur, utilisateurs)
- Joueurs : joueurs en ligne et connus, fiches avec statistiques vanilla (temps de jeu, morts, kills, distance…), actions kick / ban / ban IP / op / deop, whitelist, opérateurs et bans gérés depuis l'interface
- Journal de connexions (admin) : connexions Minecraft avec IP, pays et durée, refus de connexion, connexions à MC Manager réussies ou échouées ; rétention configurable (90 jours par défaut)
- Configuration : éditeur de server.properties (formulaire des clés courantes et fichier brut) ; les clés imposées par les variables du conteneur itzg sont affichées verrouillées ; redémarrage proposé après enregistrement
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
| `MC_DATA_DIR` | `/mc/data` | Point de montage des données Minecraft (lecture-écriture) |
| `MC_BACKUPS_DIR` | `/mc/backups` | Point de montage des backups |
| `MC_RCON_HOST` | `MC_CONTAINER` | Hôte RCON |
| `MC_RCON_PORT` | `25575` | Port RCON |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Chemin du socket Docker. Ne sert que si le backend tourne hors Docker (`pnpm dev`) : dans le conteneur le socket est toujours monté sur `/var/run/docker.sock` et le compose ne transmet pas cette variable |
| `MC_DATA_VOLUME` / `MC_BACKUPS_VOLUME` | obligatoires (compose) | Noms des volumes Docker de la stack Minecraft |
| `MC_NETWORK` | `mc-network` | Réseau Docker partagé avec Minecraft |
| `DOCKER_GID` | `999` | Identifiant du groupe du socket Docker sur l'hôte |

Le mot de passe RCON n'est **jamais** configuré ici : le backend le lit dans `server.properties` sur le volume de données monté.

### Volumes et réseau

`docker-compose.yml` déclare `mc-data` et `mc-backups` comme volumes **externes** dont les noms réels viennent de `MC_DATA_VOLUME` et `MC_BACKUPS_VOLUME` ; ils doivent déjà exister (la stack de référence les crée avec ces noms exacts). Les données Minecraft sont montées en lecture-écriture sur `/mc/data` (nécessaire à la restauration et à l'éditeur de `server.properties`), les backups en lecture-écriture sur `/mc/backups`. Si vos données sont dans un dossier de l'hôte plutôt que dans un volume nommé, remplacez les entrées `mc-data:/mc/data` et `mc-backups:/mc/backups` par vos chemins (et supprimez les deux déclarations de volumes de premier niveau). Le backend rejoint le réseau externe `MC_NETWORK` pour atteindre RCON.

### Propriétaire des volumes

Le backend tourne avec l'utilisateur `node` (UID 1000). Il doit pouvoir supprimer les archives de `mc-backups` et écrire dans le volume de données (`/data` du conteneur Minecraft) pour la restauration et l'éditeur de `server.properties`. `itzg/mc-backup` tourne en root par défaut, ce qui laisse un dossier et des archives appartenant à root que le backend ne peut pas supprimer (EACCES). La stack de référence lance donc `mc-backup` avec `user: "1000:1000"` ; faites de même dans votre stack. Pour corriger un volume existant : `docker run --rm -v mc-backups:/b alpine chown -R 1000:1000 /b` (ou `chown -R 1000:1000` sur le chemin de l'hôte). Faites de même pour le dossier de données si le backend ne peut pas y écrire : `chown -R 1000:1000 <dossier de données>`, contenu compris. Les échecs d'écriture sont signalés explicitement dans l'interface (`EACCES`, `EROFS`, `ENOSPC`).

### Mise à jour depuis le lot 2a

Trois changements sont à faire sur l'hôte :

- Retirer `:ro` du montage `/mc/data` dans `docker-compose.yml`. Le fichier du dépôt est déjà à jour, mais si vous l'avez adapté à des chemins de l'hôte, il faut le faire à la main.
- Vérifier que le dossier de données et son contenu appartiennent à l'UID 1000 : `chown -R 1000:1000 <dossier de données>`.
- Décider de `OVERRIDE_SERVER_PROPERTIES` dans la stack Minecraft (voir « Configuration du serveur »).

### Avertissement sur le socket Docker

Le backend monte `/var/run/docker.sock`. **L'accès au socket Docker équivaut à un accès root sur l'hôte.** Quiconque compromet le backend peut prendre le contrôle de la machine. N'exposez MC Manager que derrière son authentification, de préférence derrière un reverse proxy HTTPS, utilisez des secrets robustes et activez la MFA pour les comptes admin. Ne publiez pas le port 3000 sur Internet sans ces protections. Depuis le lot 2b, le backend écrit aussi dans les données du serveur (restauration, `server.properties`) : l'authentification et la MFA des comptes admin n'en sont que plus importantes.

## Restauration

Un admin restaure un backup depuis la page Backups. L'opération se déroule en six étapes, avec progression en direct :

1. vérification : l'archive est validée entrée par entrée avant toute écriture ;
2. sécurité : un nouveau backup est d'abord réalisé, pour pouvoir revenir à l'état actuel ;
3. arrêt : le serveur est arrêté (l'opération attend qu'il soit réellement arrêté) ;
4. remplacement : les données à remplacer sont supprimées ;
5. extraction : l'archive est extraite dans le dossier de données ;
6. démarrage : le serveur est redémarré.

Seules les archives gzip (`.tgz`, `.tar.gz`) sont acceptées. Les entrées de premier niveau de l'archive (dossiers de monde, `plugins`, fichiers) remplacent leurs équivalents dans le dossier de données, SAUF les chemins qui correspondent aux exclusions de `mc-backup`, jamais présents dans les archives et donc conservés : par défaut `*.jar`, `cache`, `logs` et `*.tmp` (les jars de plugins et de mods restent en place) ; si le conteneur `mc-backup` définit `EXCLUDES`, c'est cette liste qui s'applique (un `EXCLUDES=` vide signifie aucune exclusion). Tout ce que l'archive ne contient pas au premier niveau est conservé.

Avant toute écriture, le backend vérifie qu'il peut écrire dans le dossier de données et que le volume dispose d'au moins autant d'espace libre que l'archive décompressée (refus avec un message explicite sinon). L'archive est ouverte une seule fois à la vérification : le nettoyage que `mc-backup` effectue après la sauvegarde de sécurité ne peut pas la faire disparaître en cours de restauration.

Si le serveur est déjà arrêté, aucune sauvegarde de sécurité n'est possible : une confirmation explicite (« sans sauvegarde de sécurité ») est exigée. Si l'opération échoue avant toute suppression (sauvegarde de sécurité, arrêt, vérifications), elle est signalée `aborted:`, les données sont intactes et le serveur est relancé s'il avait été arrêté et que « Redémarrer le serveur ensuite » était coché. Si elle échoue en cours de route (`partial restore:`), l'interface indique le nom de la sauvegarde de sécurité pour pouvoir la restaurer.

**Restaurations interrompues.** Pendant le remplacement des données, le backend garde un fichier marqueur `.mc-manager-restore.json` dans le dossier de données (archive, sauvegarde de sécurité, heure de début, étape) ; il est supprimé dès que l'extraction a réussi. Si le backend s'arrête ou plante entre les deux, le marqueur reste : au démarrage suivant, le backend journalise une erreur et la page Backups affiche un avertissement persistant avec l'archive et la sauvegarde de sécurité. Les données sont peut-être à moitié restaurées : restaurez la sauvegarde de sécurité (« Restaurer celle-ci »), ou, une fois la situation traitée à la main, cliquez sur « Masquer » (admin, audité) pour retirer le marqueur. Une seule opération à la fois touche aux données (backup manuel, restauration, modification de `server.properties`) : une autre demande reçoit un 409.

## Configuration du serveur

La page Configuration édite `server.properties`, par un formulaire des clés courantes ou en fichier brut. L'enregistrement est atomique et l'interface propose ensuite de redémarrer le serveur.

- Les clés gouvernées par une variable d'environnement du conteneur itzg sont affichées verrouillées et ne peuvent pas être modifiées ici : le conteneur les réécrit à chaque démarrage. Avec `OVERRIDE_SERVER_PROPERTIES=false` dans la stack Minecraft, c'est au contraire le fichier qui fait foi, ce qui libère ces clés.
- Les clés RCON (`enable-rcon`, `rcon.port`, `rcon.password`) sont toujours verrouillées et le mot de passe RCON n'est jamais affiché.
- Les changements ne prennent effet qu'après un redémarrage.

## Rôles

| Rôle | Droits |
|---|---|
| `viewer` | Lecture seule : dashboard, logs de la console (pas de champ de commande), liste des backups, audit, joueurs, fiches sans IP, whitelist, ops et bans en lecture seule |
| `admin` | Tout : start / stop / restart, commandes RCON, backup manuel, téléchargement et suppression de backups, gestion des utilisateurs, actions sur les joueurs, whitelist, journal de connexions |

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

Le dashboard, la page Joueurs et les fiches joueur affichent des avatars de joueurs chargés depuis le service tiers [mc-heads.net](https://mc-heads.net) : le navigateur de chaque utilisateur lui transmet les noms des joueurs en ligne. Les polices de l'interface (Outfit, JetBrains Mono) sont aussi chargées depuis Google Fonts (`fonts.googleapis.com`), ce qui expose l'adresse IP du visiteur à Google. Il n'y a aucun autre appel externe.

La géolocalisation des IP utilise la base `geoip-lite` embarquée dans l'image (celle livrée avec geoip-lite 2.0.2, sans mise à jour automatique) : aucun appel externe, pays uniquement. Les IP ne sont visibles que des admins, et le journal est purgé selon la rétention configurée.

## Feuille de route

Les lots 2a (joueurs, journaux) et 2b (restauration, éditeur de `server.properties`) sont livrés.

Hors périmètre : modification de la planification des backups, modification des variables d'environnement du conteneur, gestion de plusieurs serveurs.

## Licence

MIT

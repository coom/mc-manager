# MC Manager — Lot 2b « Données du serveur » : conception

**Date :** 2026-10-10
**Statut :** validé et implémenté (voir le plan 2026-10-10-mc-manager-lot2b-donnees.md)
**Dépend de :** lot 1 (socle) et lot 2a (joueurs), tous deux fusionnés dans `master`

## 1. Objectif

Deux fonctions qui écrivent dans le volume de données du serveur Minecraft :

1. **Restauration d'un backup** depuis la page Sauvegardes : arrêt du serveur, remplacement des données par le contenu de l'archive, redémarrage, avec une sauvegarde de sécurité préalable et une progression en direct.
2. **Éditeur de `server.properties`** : formulaire des clés courantes et mode texte brut, en tenant compte des clés imposées par l'environnement du conteneur itzg.

### Décisions de cadrage

| Sujet | Décision |
|---|---|
| Mécanisme d'écriture | **Approche B** : le backend monte `/data` en lecture-écriture et écrit lui-même (bibliothèque `tar` de npm, flux gzip natif). L'approche par conteneur utilitaire éphémère a été présentée et écartée par l'utilisateur. |
| Invariant du lot 1 « jamais d'écriture dans `/data` » | Remplacé par : les seules écritures dans `/data` sont la restauration et `server.properties`, toutes deux admin, auditées, sérialisées par un verrou global. |
| Sauvegarde de sécurité | Toujours, bloquante : `backup now` via `mc-backup` avant toute restauration ; échec = restauration annulée. Serveur déjà arrêté (pas de RCON pour figer le monde) : confirmation explicite « sans filet » requise. |
| Sémantique de restauration | Chaque entrée de premier niveau présente dans l'archive remplace son homologue actuel ; ce que l'archive ne contient pas (jars, `logs`, `cache`, exclusions de `mc-backup`) reste en place. |
| Formats d'archive | `.tgz` et `.tar.gz` (gzip) seulement, comme le filtre du lot 1. zstd, bzip2, xz refusés. |
| Éditeur | Formulaire des clés courantes + onglet brut. Clés gouvernées par les variables d'environnement itzg affichées verrouillées ; clés RCON toujours en lecture seule. |
| Redémarrage | Proposé après enregistrement de `server.properties` (bandeau + bouton) ; automatique après restauration sauf case décochée. |
| Hors périmètre | Restauration partielle, autres compressions, édition d'autres fichiers, modification du compose depuis l'interface. |

### Hypothèses

- Le backend tourne sous l'UID 1000 (`node`), comme le serveur itzg par défaut : les fichiers écrits appartiennent au bon utilisateur. Un `/data` appartenant à root fait échouer l'écriture avec un message explicite.
- Les archives viennent de `mc-backup` en méthode tar : chemins relatifs (`./world/...`), sans liens symboliques sortants.
- Un seul serveur Minecraft, comme aux lots précédents.

## 2. Montage, verrou et invariants

- `docker-compose.yml` : `mc-data:/mc/data` sans `:ro`. README (fr, en) et CLAUDE.md mis à jour : section « Propriétaire des volumes » étendue à `/data` (commande `chown -R 1000:1000` sur les dossiers `world*` et `server.properties` si nécessaire), invariant réécrit.
- **Verrou global** `DataLock` (`packages/backend/src/data/data-lock.ts`) : `acquire(op: 'backup' | 'restore' | 'properties'): () => void` ; `AppError(409, 'Another operation is running: <op>')` si pris. `BackupService.runNow()` (lot 1) passe par ce verrou ; la restauration et l'écriture de `server.properties` aussi. Libéré en `finally`, jamais persistant.
- **Dépendance** : `tar` (npm, `^7`) dans `@mc/backend`. Lecture de la table des matières (`tar.list`) et extraction (`tar.extract`) avec un filtre de chemins.

## 3. Restauration

### 3.1 Service `RestoreService`

`packages/backend/src/backups/restore-service.ts`, construit avec `prisma`, `dataDir`, `BackupService` (pour `resolve(name)` et `runNow()`), `DockerService` (`getStatus`, `stopServer`, `startServer`, événement `status`), `DataLock`. Étend `EventEmitter` : événements `progress` `{ step, line }` et `done` `{ ok, message, safetyBackup?: string }`, diffusés en WebSocket `restore.progress` et `restore.done`.

`restore(name: string, opts: { startAfter: boolean; confirmNoSafetyBackup: boolean }, actor: { id, username }): Promise<void>` — la route répond 202 une fois les vérifications passées et le verrou pris ; la suite tourne en arrière-plan.

### 3.2 Étapes

| Étape (`step`) | Action | Échec |
|---|---|---|
| `check` | `backups.resolve(name)` ; extension gzip ; conteneurs Minecraft et `mc-backup` présents (`hasServerContainer`, `hasBackupContainer`) ; verrou pris ; `tar.list` pour valider chaque entrée (voir 3.3) et collecter les entrées de premier niveau. | 404/400/503/409 avant le 202 ; rien n'est touché. |
| `safety` | Si `getStatus()` ∈ {`ready`, `unhealthy`} : `backups.runNow()` (sortie relayée en `progress`), attente du code 0. Sinon, si `confirmNoSafetyBackup` est faux : 409 `Server is stopped: no safety backup possible, confirm to proceed` (avant le 202). | Code ≠ 0 → `done { ok: false }`, rien n'est touché. |
| `stop` | Si le serveur n'est pas `stopped` : `stopServer()` puis attente de l'événement `status === 'stopped'` (90 s max). | Délai dépassé → `done { ok: false }`, le serveur reste dans son état réel, rien n'est touché. |
| `replace` | Pour chaque entrée de premier niveau de l'archive : `rm -rf` de l'homologue dans `dataDir` (fichier ou dossier). | Erreur → `done { ok: false, message: 'partial' }`. |
| `extract` | `tar.extract({ cwd: dataDir, filter, strict: true, preservePaths: false })` avec le filtre de 3.3 ; une ligne `progress` toutes les 200 entrées et à chaque dossier de premier niveau. | Erreur → `done { ok: false }` avec `safetyBackup` = nom de l'archive de l'étape `safety` (si faite) et un message disant que l'état est partiel. Pas de redémarrage. |
| `start` | Si `startAfter` : `startServer()`. | Erreur → `done { ok: false }` après une restauration réussie : le message le précise. |
| `done` | `done { ok: true, safetyBackup }`. | |

Audit : `backup.restore` avec détail `name` écrit avant l'étape `stop` ; `backup.restore` avec `exit ok` ou `failed: <message>` à la fin (même convention que `backup.run`).

### 3.3 Filtre d'entrées d'archive

Fonction pure `validateEntry(path: string, type: string, linkpath?: string): string | null` (`packages/backend/src/backups/archive-filter.ts`) :

- chemin normalisé sans `./` initial ; refus si vide, absolu, contenant `..` comme segment, ou contenant `\0` ;
- types acceptés : fichier, dossier ; liens symboliques et durs refusés ; périphériques refusés ;
- entrées hors limite : plus de 200 000 entrées ou plus de 20 Go décompressés (cumul des `size`) → refus en `check`.

Les entrées de premier niveau sont le premier segment de chaque chemin (`world`, `world_nether`, `server.properties`, `whitelist.json`, …).

### 3.4 Routes

| Route | Rôle | Description |
|---|---|---|
| `POST /api/backups/:name/restore` `{ startAfter?: boolean (défaut true), confirmNoSafetyBackup?: boolean (défaut false) }` | admin | 202 `{ accepted: true }` après `check` (et le refus 409 sans filet) ; progression en WebSocket. |
| `GET /api/backups/restore/status` | tous | `{ running: boolean, step: string | null }` pour l'état initial de la page. |

`POST /api/backups/run` (lot 1) et `DELETE /api/backups/:name` répondent 409 pendant une restauration (verrou) ; la suppression de l'archive en cours de restauration est donc impossible.

### 3.5 Messages WebSocket (ajoutés à `@mc/common`)

- `restore.progress` `{ step: 'check' | 'safety' | 'stop' | 'replace' | 'extract' | 'start', line: string }`
- `restore.done` `{ ok: boolean, message: string, safetyBackup: string | null }`

### 3.6 Interface

Page Sauvegardes : bouton « Restaurer » par ligne (admin), désactivé si une opération est en cours (`running` de la liste, ou restauration en cours). Dialogue : nom et date de l'archive, texte expliquant la sauvegarde de sécurité et l'arrêt du serveur, case « Redémarrer le serveur ensuite » cochée, bouton de confirmation destructif. Si le serveur est arrêté, le dialogue affiche l'avertissement « sans filet » et exige une seconde case cochée avant d'envoyer `confirmNoSafetyBackup: true`. Le panneau de sortie du lot 1 (`BackupRunPanel`) affiche les lignes `restore.progress` avec l'étape en préfixe, puis le résultat ; en cas d'échec partiel, le nom de la sauvegarde de sécurité est affiché avec un bouton « Restaurer celle-ci ».

## 4. Éditeur de `server.properties`

### 4.1 Lecture

`GET /api/server/properties` (admin) → `{ raw: string, values: Record<string, string>, locked: Record<string, string>, exists: boolean, restartRequired: boolean }` :

- `raw` : contenu du fichier ; `values` : parseur du lot 1 ;
- `locked` : clé → nom de la variable itzg qui la gouverne, calculé à partir de `Config.Env` du conteneur Minecraft (via `inspect`) et de la table 4.3, sauf si `OVERRIDE_SERVER_PROPERTIES=false` y figure (alors seules les clés RCON sont verrouillées) ;
- clés toujours verrouillées : `enable-rcon`, `rcon.port`, `rcon.password` (valeur de `rcon.password` jamais renvoyée : `values` la remplace par `********`, `raw` aussi) ;
- `exists: false` si le fichier manque (serveur jamais démarré) ; `restartRequired` : vrai si le serveur tourne et qu'un enregistrement a eu lieu depuis le dernier démarrage (horodatage en mémoire comparé à `startedAt`).

### 4.2 Écriture

`PUT /api/server/properties` (admin), corps `{ values: Record<string, string> }` **ou** `{ raw: string }` :

- `values` : fusion dans le fichier existant par `updateServerProperties(text, values)` (`utils/server-properties.ts`, nouveau) qui remplace la valeur des clés présentes en conservant commentaires, ordre et lignes inconnues, et ajoute en fin les clés absentes ; valeurs échappées (`\`, `:`, `=`, `#`, `!`, retours à la ligne refusés) ;
- `raw` : remplacement intégral après validation ligne à ligne (commentaires, vides, ou `clé=valeur`/`clé:valeur`) ;
- validation : clés `^[a-z0-9._-]+$`, valeur sur une ligne, taille totale ≤ 64 Ko, clé verrouillée présente dans la requête avec une valeur différente → 409 `Key <k> is managed by <VAR>` ; en mode `raw`, les clés verrouillées doivent garder leur valeur actuelle (sinon 409) ;
- écriture atomique : fichier temporaire dans `dataDir` puis `rename` ; sous `DataLock('properties')` ;
- audit `server.properties` avec la liste des clés changées (mode brut : `raw` + nombre de lignes) ;
- réponse : même forme que `GET`, avec `restartRequired` vrai si le serveur tourne.

### 4.3 Table des variables itzg

| Clé | Variable |
|---|---|
| `motd` | `MOTD` |
| `difficulty` | `DIFFICULTY` |
| `max-players` | `MAX_PLAYERS` |
| `view-distance` | `VIEW_DISTANCE` |
| `simulation-distance` | `SIMULATION_DISTANCE` |
| `white-list` | `ENABLE_WHITELIST` |
| `enforce-whitelist` | `ENFORCE_WHITELIST` |
| `online-mode` | `ONLINE_MODE` |
| `pvp` | `PVP` |
| `gamemode` | `MODE` |
| `force-gamemode` | `FORCE_GAMEMODE` |
| `hardcore` | `HARDCORE` |
| `level-name` | `LEVEL` |
| `level-seed` | `SEED` |
| `level-type` | `LEVEL_TYPE` |
| `spawn-protection` | `SPAWN_PROTECTION` |
| `allow-flight` | `ALLOW_FLIGHT` |
| `allow-nether` | `ALLOW_NETHER` |
| `enable-command-block` | `ENABLE_COMMAND_BLOCK` |
| `spawn-monsters` | `SPAWN_MONSTERS` |
| `spawn-animals` | `SPAWN_ANIMALS` |
| `spawn-npcs` | `SPAWN_NPCS` |
| `generate-structures` | `GENERATE_STRUCTURES` |
| `max-world-size` | `MAX_WORLD_SIZE` |
| `max-tick-time` | `MAX_TICK_TIME` |
| `server-port` | `SERVER_PORT` |
| `player-idle-timeout` | `PLAYER_IDLE_TIMEOUT` |
| `op-permission-level` | `OP_PERMISSION_LEVEL` |
| `resource-pack` | `RESOURCE_PACK` |
| `resource-pack-sha1` | `RESOURCE_PACK_SHA1` |
| `enable-query` | `ENABLE_QUERY` |
| `enable-status` | `ENABLE_STATUS` |
| `hide-online-players` | `HIDE_ONLINE_PLAYERS` |
| `entity-broadcast-range-percentage` | `ENTITY_BROADCAST_RANGE_PERCENTAGE` |
| `network-compression-threshold` | `NETWORK_COMPRESSION_THRESHOLD` |
| `sync-chunk-writes` | `SYNC_CHUNK_WRITES` |

La table vit dans `packages/backend/src/server-properties/itzg-env.ts` avec un test de cohérence (chaque variable en majuscules, chaque clé en minuscules).

### 4.4 Interface

Page « Configuration » (`/config`, admin, entrée de menu dans la section Serveur, redirection des viewers vers le dashboard comme pour Journal). Deux onglets :

- **Formulaire** : champs typés pour les clés courantes (texte : `motd`, `level-name`, `level-seed`, `resource-pack` ; nombres bornés : `max-players` 1-1000, `view-distance` 3-32, `simulation-distance` 3-32, `spawn-protection` 0-100, `player-idle-timeout` 0-1440, `max-tick-time`, `op-permission-level` 1-4 ; booléens : `pvp`, `white-list`, `enforce-whitelist`, `online-mode`, `hardcore`, `allow-flight`, `allow-nether`, `enable-command-block`, `spawn-monsters`, `spawn-animals`, `spawn-npcs`, `force-gamemode` ; choix : `difficulty` (peaceful/easy/normal/hard), `gamemode` (survival/creative/adventure/spectator), `level-type`). Une clé verrouillée est grisée avec l'infobulle « définie par la variable X du conteneur ». Les clés absentes du fichier sont proposées vides. Bouton Enregistrer actif seulement si quelque chose a changé.
- **Brut** : zone de texte monospace avec le fichier complet (mot de passe RCON masqué), aperçu des lignes modifiées avant l'enregistrement, mêmes règles de verrouillage.

Après un enregistrement avec `restartRequired`, bandeau persistant « Redémarrage nécessaire pour appliquer » avec le bouton « Redémarrer maintenant » (route `restart` du lot 1, `ConfirmDialog`). Fichier absent : page en lecture seule avec le message correspondant.

## 5. Erreurs et sécurité

- Verrou pris : 409 « opération en cours » pour `run`, `restore`, suppression d'archive et écriture de `server.properties` ; l'interface désactive les boutons concernés.
- `EACCES`/`EPERM` à l'écriture : 500 avec le chemin et la commande `chown -R 1000:1000 <dataDir>` (même convention que la suppression de backup du lot 1).
- Archive non gzip : 400 ; entrée invalide : 400 en `check`, avant toute écriture.
- Arrêt du serveur non abouti sous 90 s : restauration annulée, état réel affiché.
- Toutes les routes d'écriture et de lecture de `server.properties` en `rbac('admin')` ; audit avant chaque écriture.
- Aucune écriture hors `dataDir` (filtre d'archive, chemin de `server.properties` fixe) ; `rcon.password` jamais exposé ni modifiable ; verrou global ; aucune modification du compose depuis l'interface.
- Le dashboard, les pages Joueurs et la fiche continuent de charger les avatars depuis mc-heads.net (inchangé).

## 6. Tests

- `archive-filter` : chemins `..`, absolus, `./x`, liens symboliques et durs, périphériques, compteurs de taille et d'entrées.
- Extraction réelle dans un dossier temporaire : archive de test créée avec `tar.create` (dossiers `world`, `world_nether`, fichier `server.properties`), dossier `world` existant avec un fichier en plus (supprimé après restauration), `plugins/x.jar` et `logs/` conservés, archive avec `..` refusée sans rien écrire, archive non gzip refusée.
- `RestoreService` avec fakes Docker et RCON : chemin nominal (ordre des étapes, événements, audit, redémarrage), `startAfter: false`, sauvegarde de sécurité échouée (rien touché), serveur arrêté sans confirmation (409) et avec confirmation, arrêt non abouti (annulation), échec d'extraction (pas de redémarrage, `safetyBackup` dans `done`), verrou 409 pendant une restauration et pendant un `backup now`.
- `server-properties` : `updateServerProperties` (ordre, commentaires, clés ajoutées, échappements), validation du mode brut, table itzg, calcul des clés verrouillées (avec et sans `OVERRIDE_SERVER_PROPERTIES=false`), masquage du mot de passe RCON.
- Routes : RBAC, 409 clé verrouillée, 409 verrou, audit, écriture atomique (fichier temporaire absent après succès), `EACCES` explicite.
- Frontend : dialogue de restauration (cases, confirmation sans filet quand `stopped`), panneau de progression, page Configuration (champs verrouillés grisés, Enregistrer désactivé sans changement, bandeau de redémarrage), redirection des viewers.

## 7. Documentation

README (fr, en) : section « Restauration » (déroulement, sauvegarde de sécurité, formats, état partiel), section « Configuration du serveur » (clés verrouillées par l'environnement, `OVERRIDE_SERVER_PROPERTIES=false` pour rendre le fichier maître, redémarrage), section « Propriétaire des volumes » étendue à `/data`, invariant de sécurité réécrit, feuille de route mise à jour (lot 2b livré). CLAUDE.md : `RestoreService`, `DataLock`, `archive-filter`, routes et messages WebSocket, nouvel invariant d'écriture, dépendance `tar`.

**Modifications à faire sur l'hôte à la livraison** (à rappeler explicitement à l'utilisateur) : retirer `:ro` du montage `/mc/data` dans `docker-compose.yml` (déjà adapté aux chemins de l'hôte), vérifier que `/opt/minecraft/data` et son contenu appartiennent à l'UID 1000, décider de `OVERRIDE_SERVER_PROPERTIES` dans la stack Minecraft.

## 8. Écarts d'implémentation

- L'entrée racine `./` d'une archive est exemptée du filtre d'entrées.
- La tentative de restauration est auditée avant la sauvegarde de sécurité (et toujours avant l'arrêt du serveur).
- `done` est émis après la libération du verrou.
- Dans le store frontend, `startBackupOutput` et `startRestoreOutput` effacent chacune l'état de l'autre.
- `BackupRunPanel` localise le préfixe d'étape.

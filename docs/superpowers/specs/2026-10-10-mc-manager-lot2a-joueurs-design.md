# MC Manager — Lot 2a « Joueurs » : conception

**Date :** 2026-10-10
**Statut :** validé et implémenté (voir le plan 2026-10-10-mc-manager-lot2a-joueurs.md)
**Dépend de :** lot 1 (`2026-10-10-mc-manager-lot1-design.md`), fusionné dans `master`

## 1. Objectif

Donner à MC Manager une vue complète des joueurs du serveur Minecraft et des accès à MC Manager lui-même :

1. **Journal de connexions Minecraft** : date, heure, pseudo, IP, pays, durée de session, et refus de connexion (non whitelisté, banni, serveur plein).
2. **Journal de connexions MC Manager** : chaque tentative de login web, réussie ou échouée, avec IP et pays.
3. **Gestion des joueurs** : joueurs en ligne avec actions kick, ban, ban IP, op/deop ; whitelist, ops et bans gérés depuis l'interface.
4. **Fiches joueurs** : identité, statut, historique de sessions et statistiques vanilla.

Le lot 2b (restauration d'un backup, éditeur de `server.properties`) fait l'objet d'une spec séparée : il impose d'écrire dans `/data`, ce que ce lot n'exige pas.

### Décisions de cadrage

| Sujet | Décision |
|---|---|
| Source des événements | Logs du serveur vanilla (flux déjà parsé par le lot 1) + réconciliation par le `list` RCON du collecteur. Aucun plugin ni mod. |
| Géolocalisation | `geoip-lite` hors ligne, pays ISO seulement, module `utils/geo.ts` repris de ts6-manager tel quel. Pas de ville, pas d'appel externe. |
| Fiches joueurs | Journal + statistiques vanilla lues dans `<level-name>/stats/<uuid>.json` (lecture seule). |
| Visibilité des IP | Journaux et historiques IP réservés aux admins. Les viewers voient joueurs, fiches sans IP, whitelist, ops et bans, sans action. |
| Durée des bans | Permanents : vanilla ne permet pas de durée par RCON. Levée par `pardon`. |
| Hors périmètre | Restauration, `server.properties`, notifications Discord, chat en jeu, bannissement d'IP sur la page de login de MC Manager. |

### Hypothèses

- Serveur vanilla ou Paper, `online-mode=true` : les UUID sont stables et les lignes de log ont la forme vanilla.
- Le volume `/data` reste monté en lecture seule dans le backend.
- Un seul serveur Minecraft, comme au lot 1.

## 2. Modèle de données

Trois tables Prisma ajoutées à `packages/backend/prisma/schema.prisma`.

```prisma
model PlayerSession {
  id        Int       @id @default(autoincrement())
  uuid      String?   // null si inconnu (ni ligne UUID ni usercache)
  name      String
  ip        String?   // null pour une session réconciliée
  country   String?   // ISO 3166-1 alpha-2, null si LAN/inconnue/sans IP
  source    String    // 'log' | 'reconciled'
  joinedAt  DateTime
  leftAt    DateTime? // null = en cours

  @@index([joinedAt])
  @@index([uuid, joinedAt])
  @@index([name])
}

model PlayerLoginFailure {
  id        Int      @id @default(autoincrement())
  name      String
  ip        String?
  country   String?
  reason    String   // 'not_whitelisted' | 'banned' | 'full' | 'other'
  message   String   // texte brut du serveur après « : »
  createdAt DateTime @default(now())

  @@index([createdAt])
}

model WebLogin {
  id        Int      @id @default(autoincrement())
  username  String   // tel que saisi
  userId    Int?
  ip        String
  country   String?
  success   Boolean
  reason    String?  // 'bad_password' | 'disabled' | 'mfa_failed' | 'unknown_user' | 'trusted_device'
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([username, createdAt])
}
```

`AppSetting` reçoit la clé `journal.retentionDays` (défaut `90`, `0` = illimité).

Règles :

- La clé d'une fiche joueur est l'UUID. Un changement de pseudo apparaît comme un nouveau nom sur la même fiche. Les sessions sans UUID sont rattachées par nom.
- La durée d'une session est calculée à l'affichage (`leftAt - joinedAt`), jamais stockée.
- Les trois tables sont purgées quotidiennement au-delà de la rétention.

## 3. Collecte du journal Minecraft

### 3.1 Service `PlayerJournal`

`packages/backend/src/players/player-journal.ts`. S'abonne aux lignes du `LogStreamer` (événement `line`) et aux changements d'état de `DockerService`. Expose `online(): OnlinePlayer[]` (sessions ouvertes en mémoire) et émet :

- `session` `{ kind: 'join' | 'leave', session }` → diffusé en WebSocket `player.session`.

### 3.2 Lignes reconnues

Parseur pur `packages/backend/src/players/parse-player-line.ts`, fonction `parsePlayerLine(message: string): PlayerEvent | null`, appliquée au champ `message` de `LogLine` (le niveau et le thread sont déjà extraits par le lot 1).

| Forme vanilla (champ `message`) | Événement |
|---|---|
| `UUID of player <nom> is <uuid>` | `{ type: 'uuid', name, uuid }` |
| `<nom>[/<ip>:<port>] logged in with entity id <n> at (...)` | `{ type: 'join', name, ip }` |
| `<nom> left the game` | `{ type: 'leave', name }` |
| `<nom> lost connection: <raison>` | `{ type: 'leave', name }` (repli, ignoré si la session est déjà fermée) |
| `Disconnecting <nom> (/<ip>:<port>): <message>` | `{ type: 'refused', name, ip, message }` |
| `Disconnecting com.mojang.authlib.GameProfile@…[name=<nom>,id=…] (/<ip>:<port>): <message>` | idem (format des versions antérieures) |

Nom de joueur : `^[A-Za-z0-9_]{3,16}$`. IP : IPv4, IPv6 nue ou entre crochets, suffixe `:port` retiré, préfixe `::ffff:` retiré (fonction `normalizeIp` de `utils/geo.ts`). Toute autre ligne renvoie `null` sans journalisation.

Classification des refus (`reason`) par recherche dans `message`, insensible à la casse : `white-list` → `not_whitelisted`, `banned` → `banned`, `full` → `full`, sinon `other`.

### 3.3 Cycle de vie d'une session

- `uuid` : mémorisé par nom à la réception de la ligne `UUID of player`, consommé à la ligne `logged in`. À défaut, recherche dans `usercache.json` ; à défaut, `null`.
- `join` : ferme d'abord une éventuelle session ouverte du même nom (`leftAt = maintenant`), puis crée `PlayerSession { source: 'log', ip, country: lookupCountry(ip).country, joinedAt: maintenant }`. L'horodatage est celui du backend, pas celui de la ligne (le log ne porte que l'heure, sans date).
- `leave` : ferme la session ouverte du même nom. Sans session ouverte : ignoré.
- `refused` : crée `PlayerLoginFailure`.

### 3.4 Réconciliation par RCON

À chaque tick du `MetricsCollector` qui obtient un `list` (serveur `ready`), le collecteur transmet la liste des noms en ligne à `PlayerJournal.reconcile(names)` :

- nom en ligne sans session ouverte → création d'une session `{ source: 'reconciled', ip: null, country: null }` ;
- session ouverte dont le nom est absent → fermeture.

Cas couverts : lignes de log perdues entre deux ouvertures du flux (ruling R7 du lot 1), redémarrage du backend pendant une partie.

### 3.5 Fermetures forcées

- Passage de l'état serveur à `stopped`, `stopping` ou `unavailable` : toutes les sessions ouvertes sont fermées.
- Démarrage du backend : toute `PlayerSession` avec `leftAt = null` en base est fermée avec `leftAt = max(joinedAt, dernier MetricSample.ts)` et `source` inchangée.

### 3.6 Rétention

Tâche quotidienne (même mécanisme que l'agrégation horaire du lot 1) : suppression des lignes des trois tables plus anciennes que `journal.retentionDays` jours, sauf si `0`.

## 4. Journal des connexions MC Manager

Helper `recordWebLogin(prisma, { username, userId, ip, success, reason })` dans `packages/backend/src/auth/web-login-journal.ts`, appelé en « fire and forget » (promesse non attendue, erreur journalisée en `warn`). Il ne doit jamais retarder ni faire échouer une réponse d'authentification.

Points d'appel dans `auth.routes.ts` :

| Route | Succès | Échecs enregistrés |
|---|---|---|
| `POST /auth/login` | mot de passe accepté (même si la MFA suit) | `unknown_user`, `bad_password`, `disabled` |
| `POST /auth/login/mfa` | code accepté | `mfa_failed` |
| `POST /auth/trusted/session` | session ouverte par cookie, `reason: 'trusted_device'` | aucun (cookie invalide = pas une tentative) |

L'IP est `req.ip` (`trust proxy` est déjà activé ; nginx transmet `X-Forwarded-For`). Le pays est résolu par `lookupCountry`.

## 5. Gestion des joueurs

### 5.1 Service `PlayerAdmin`

`packages/backend/src/players/player-admin.ts`, construit avec `RconService` et le chemin de `/data`. Toute action : validation des arguments, audit (`player.kick`, `player.ban`, `player.ban_ip`, `player.pardon`, `player.pardon_ip`, `player.op`, `player.deop`, `whitelist.add`, `whitelist.remove`, `whitelist.toggle`) écrit avant l'envoi RCON, envoi, interprétation de la réponse.

| Méthode | Commande RCON | Succès attendu | Erreurs interprétées |
|---|---|---|---|
| `kick(name, reason?)` | `kick <name> [reason]` | `Kicked <name>` | `No player was found` → 404 |
| `ban(name, reason?)` | `ban <name> [reason]` | `Banned <name>` | `Nothing changed. The player is already banned` → 409 ; `That player does not exist` → 404 |
| `banIp(ip, reason?)` | `ban-ip <ip> [reason]` | `Banned IP` | `Nothing changed` → 409 ; `Invalid IP address` → 400 |
| `pardon(name)` | `pardon <name>` | `Unbanned <name>` | `Nothing changed. The player isn't banned` → 409 |
| `pardonIp(ip)` | `pardon-ip <ip>` | `Unbanned IP` | `Nothing changed` → 409 |
| `op(name)` / `deop(name)` | `op <name>` / `deop <name>` | `Made <name> a server operator` / `Made <name> no longer a server operator` | `Nothing changed` → 409 |
| `whitelistAdd(name)` | `whitelist add <name>` puis `whitelist reload` | `Added <name> to the whitelist` | `Player is already whitelisted` → 409 ; `That player does not exist` → 404 |
| `whitelistRemove(name)` | `whitelist remove <name>` puis `whitelist reload` | `Removed <name> from the whitelist` | `Player is not whitelisted` → 409 |
| `whitelistEnabled(on)` | `whitelist on` / `whitelist off` | `Turned on the whitelist` / `Turned off the whitelist` | `Whitelist is already turned on/off` → 409 |

Toute réponse non reconnue → 502 avec le texte brut du serveur dans `details`. RCON indisponible → 503 (comportement du lot 1).

Validation : `name` `^[A-Za-z0-9_]{3,16}$`, `ip` IPv4 ou IPv6 valide (`net.isIP`), `reason` 1 à 100 caractères, sans `\r` ni `\n`. Rien d'autre n'atteint la ligne de commande.

### 5.2 Lecture des listes

`packages/backend/src/players/data-files.ts`, lecture seule dans `/data`, relue à chaque requête :

| Fichier | Contenu utilisé |
|---|---|
| `whitelist.json` | `[{ uuid, name }]` |
| `ops.json` | `[{ uuid, name, level, bypassesPlayerLimit }]` |
| `banned-players.json` | `[{ uuid, name, created, source, expires, reason }]` |
| `banned-ips.json` | `[{ ip, created, source, expires, reason }]` |
| `usercache.json` | `[{ name, uuid, expiresOn }]` |
| `server.properties` | `white-list` (`true`/`false`) |

Fichier absent (serveur jamais démarré, liste vide) → tableau vide. JSON invalide → tableau vide et `warn` dans les logs du backend. Après chaque action de 5.1, le backend diffuse `player.lists.changed`.

### 5.3 Fiches joueurs

`GET /api/players/:uuid` agrège :

- **Identité** : nom actuel (dernière session ou `usercache`), noms précédents vus dans les sessions, UUID.
- **Statut** : en ligne (session ouverte), op, whitelisté, banni (listes 5.2).
- **Journal** : dernière connexion, nombre de sessions, temps de jeu observé (somme des durées), 30 dernières sessions. Les champs `ip` et `country` des sessions ne sont renvoyés qu'aux admins (`req.user.role`).
- **Stats vanilla** : `<level-name>/stats/<uuid>.json` (le `level-name` est déjà relu par le lot 1), parsé par `parseVanillaStats(json)` :

| Champ | Clé(s) | Unité |
|---|---|---|
| `playTimeSeconds` | `minecraft:custom.minecraft:play_time`, sinon `minecraft:play_one_minute` | ticks ÷ 20 |
| `deaths` | `minecraft:custom.minecraft:deaths` | |
| `playerKills` | `minecraft:custom.minecraft:player_kills` | |
| `mobKills` | `minecraft:custom.minecraft:mob_kills` | |
| `distanceMeters` | somme de `minecraft:custom.minecraft:*_one_cm` | cm ÷ 100 |
| `jumps` | `minecraft:custom.minecraft:jump` | |
| `damageTaken` | `minecraft:custom.minecraft:damage_taken` | dixièmes de cœur ÷ 10 |
| `blocksMined` | somme de `minecraft:mined.*` | |
| `itemsCrafted` | somme de `minecraft:crafted.*` | |

Clé absente → `null` (affiché « inconnu »). Fichier absent → `stats: null`.

### 5.4 Routes

Toutes sous `authMiddleware`. `A` = `rbac('admin')`.

| Route | Rôle | Description |
|---|---|---|
| `GET /api/players?online=1&q=&page=&limit=` | tous | Joueurs en ligne (sessions ouvertes) ou connus (distinct par UUID/nom), triés par dernière connexion. Sans IP pour les viewers. |
| `GET /api/players/:uuid` | tous | Fiche (5.3). |
| `POST /api/players/:name/kick` `{ reason? }` | A | |
| `POST /api/players/:name/ban` `{ reason? }` | A | |
| `POST /api/players/:name/pardon` | A | |
| `POST /api/players/:name/op` / `deop` | A | |
| `POST /api/bans/ip` `{ ip, reason? }` | A | |
| `DELETE /api/bans/ip/:ip` | A | |
| `GET /api/lists` | tous | `{ whitelist, ops, bannedPlayers, bannedIps, whitelistEnabled }` |
| `POST /api/whitelist/:name` / `DELETE /api/whitelist/:name` | A | |
| `PUT /api/whitelist/enabled` `{ enabled }` | A | |
| `GET /api/journal/players?q=&from=&to=&page=&limit=` | A | Sessions, plus récentes d'abord. |
| `GET /api/journal/failures?q=&from=&to=&page=&limit=` | A | Refus. |
| `GET /api/journal/web?q=&from=&to=&page=&limit=` | A | Connexions MC Manager. |
| `GET /api/journal/retention` / `PUT` `{ days }` | A | `days` entier 0 à 3650. |

Pagination : `page` ≥ 1, `limit` 1 à 100 (défaut 50), réponse `{ items, total, page, limit }`.

### 5.5 Messages WebSocket ajoutés à `@mc/common`

- `player.session` `{ kind: 'join' | 'leave', name, uuid, joinedAt, leftAt?, country? }` (sans IP, tous les clients authentifiés).
- `player.lists.changed` `{}`.

## 6. Interface

### 6.1 Navigation

- « Joueurs » (`/players`, tous les rôles) et « Journal » (`/journal`, admin) ajoutés au menu.
- La carte des joueurs en ligne du dashboard rend chaque joueur cliquable vers sa fiche.

### 6.2 Page Joueurs, quatre onglets

- **En ligne** : avatar, nom, « connecté depuis », pays (drapeau + nom au survol, chip « LAN », rien pour une session réconciliée). Admin : menu d'actions kick, ban, ban IP, op ou deop. Kick et ban ouvrent un dialogue de confirmation avec champ raison optionnel. Ban IP est désactivé si la session n'a pas d'IP.
- **Tous** : joueurs connus, recherche par nom, tri par dernière connexion, badges op / whitelist / banni, clic vers la fiche.
- **Whitelist et ops** : interrupteur « whitelist activée », champ d'ajout par nom, liste avec retrait ; liste des ops avec deop. Lecture seule pour les viewers.
- **Bans** : joueurs et IP bannis avec raison, date, source ; bouton « lever » (admin).

### 6.3 Fiche joueur (`/players/:uuid`)

En-tête (avatar, nom, anciens noms, statut, badges), tuiles de stats vanilla, courbe des sessions sur 30 jours (minutes par jour, `recharts` comme le dashboard), tableau des 30 dernières sessions (date, durée, et pour les admins IP et pays). Si `stats` est `null` : message « pas encore de statistiques ».

### 6.4 Page Journal (admin), trois onglets

Connexions Minecraft, refus, connexions MC Manager. Colonnes : date et heure, nom, IP, drapeau et pays, puis durée (Minecraft), raison (refus), badge succès/échec et raison (web). Filtres nom et période, pagination serveur. La rétention se règle dans Paramètres (champ « rétention du journal (jours) »).

### 6.5 Temps réel et i18n

- `player.session` met à jour l'onglet En ligne et la carte du dashboard ; `player.lists.changed` invalide la query `lists` ; aucun `refetchInterval`.
- Drapeau rendu côté client depuis le code ISO (indicateurs régionaux), nom du pays via `Intl.DisplayNames` dans la langue de l'interface.
- Toutes les chaînes passent par les fragments i18n et `merge-i18n.mjs` (fr et en).

## 7. Erreurs et sécurité

- RCON indisponible : actions en 503 ; l'interface désactive les boutons avec l'infobulle « serveur injoignable ».
- Fichiers JSON absents ou illisibles : listes vides, `warn` côté backend, jamais de page cassée.
- Ligne de log non reconnue : ignorée. Échec de géolocalisation : entrée sans pays.
- Écriture du journal web en échec : `warn`, authentification inchangée.
- Toutes les routes d'action et de journal en `rbac('admin')`. Les viewers ne reçoivent jamais d'IP, ni par les routes ni par le WebSocket.
- Aucune nouvelle écriture dans `/data` ; le montage reste `:ro`.
- `geoip-lite` embarque sa base : aucun appel réseau. Le README mentionne la base embarquée et sa date.
- Les invariants du lot 1 (secrets, `typ` JWT, RBAC, noms de fichiers, socket Docker) sont inchangés.

## 8. Tests

- `parsePlayerLine` : connexion IPv4, IPv6 nue et entre crochets, nom avec underscore, sortie, `lost connection`, refus aux deux formats et aux quatre raisons, lignes de chat ou de commande qui ressemblent à une connexion (`<Pseudo> left the game` dans le chat doit être ignoré : le message de chat est encadré de `<>`).
- `normalizeIp` et `lookupCountry` : IPv4 publique → ISO, privée → `isPrivate`, `::ffff:` et port retirés.
- `PlayerJournal` : cycle join/leave, double join sans leave, leave orphelin, réconciliation (ajout et fermeture), fermeture à `stopped`, fermeture des sessions orphelines au démarrage, purge de rétention.
- `recordWebLogin` : succès, chaque raison d'échec, erreur Prisma non propagée.
- `PlayerAdmin` : chaque commande avec un `RconLike` factice renvoyant les réponses connues et inconnues, validation des noms, IP et raisons, audit écrit avant l'envoi.
- `data-files` : lecture des cinq fichiers, fichier absent, JSON invalide, `white-list` absent de `server.properties`.
- `parseVanillaStats` : fichier 1.17+, fichier avec `play_one_minute`, clés absentes.
- Routes : RBAC (viewer → 403 sur les actions et le journal, fiche sans IP), pagination, 503 sans RCON.
- Frontend : onglet En ligne (actions visibles seulement pour un admin, mise à jour sur `player.session`), onglet Bans (lever), fiche (stats `null`), page Journal (filtres), rendu du drapeau.

## 9. Documentation

README (fr, en) : section « Joueurs et journal » (fonctions, rôles, rétention, confidentialité des IP et base `geoip-lite`), mise à jour de la feuille de route (2a livré, 2b à venir). CLAUDE.md : services `PlayerJournal`, `PlayerAdmin`, `data-files`, messages WebSocket ajoutés, règle « ne jamais écrire dans `/data` ».

## 10. Écarts d'implémentation

1. Le flux de logs Docker est ouvert avec `timestamps: true` ; `LogStreamer` retire le préfixe et passe la date à `PlayerJournal.handleLine(line, at)`, qui ignore les lignes antérieures à son démarrage. Le rejeu des 500 lignes d'historique ne crée donc aucune session fantôme (l'horodatage de la section 3.3 reste l'horloge du backend).
2. Le ban IP d'un joueur en ligne passe par `POST /api/players/:name/ban-ip`, qui lit l'IP côté serveur (`journal.currentIp`) puisque le navigateur ne la reçoit jamais ; `POST /api/bans/ip` reste disponible pour bannir une adresse arbitraire.
3. Les méthodes de `PlayerAdmin` sont asynchrones ; une fenêtre de grâce de réconciliation de 30 s protège les deux sens.

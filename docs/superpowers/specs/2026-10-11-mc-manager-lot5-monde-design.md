# MC Manager, lot 5 : réglages du monde en direct

Date : 2026-10-11. Fait suite au lot 4 (catalogue Modrinth et dépôt de jars). Stack inchangée : backend Express + Prisma, frontend React, types partagés dans `@mc/common`.

## 1. Objectif

Deux demandes issues de l'usage de la page Configuration :

1. Les clés de `server.properties` gouvernées par une variable d'environnement du conteneur itzg (`MOTD`, `DIFFICULTY`, `MAX_PLAYERS`, ...) sont cadenassées sans que l'interface dise comment les libérer. Le mécanisme existe déjà côté backend (`lockedKeys` lève tous les cadenas sauf RCON quand `OVERRIDE_SERVER_PROPERTIES=false` figure dans `Config.Env`) et le README le documente, mais l'utilisateur ne le voit pas depuis la page.
2. Certains réglages doivent pouvoir être ajustés **à chaud**, sans redémarrage : heure du monde, météo, taux de tick, difficulté, mode de jeu par défaut, gamerules usuelles. Ils ne vivent pas dans `server.properties` mais dans le monde (`level.dat`) et se changent par commande RCON.

### Décisions de cadrage

- **Cadenas** : MC Manager ne force jamais l'écriture d'une clé gouvernée par l'environnement (la valeur serait réécrite au démarrage suivant). On rend l'explication visible dans l'interface ; la libération se fait dans la stack Minecraft par `OVERRIDE_SERVER_PROPERTIES=false`. Aucun changement de `lockedKeys`.
- **Réglages live** : nouvelle page « Monde » (`/world`), réservée aux admins, distincte de Configuration parce que la sémantique est différente (appliqué immédiatement et stocké dans le monde, contre fichier et redémarrage requis).
- **Service typé** plutôt que relais de commandes brutes : le backend valide chaque valeur contre une liste fermée, construit la commande, interprète la réponse et audite une ligne lisible. Le navigateur ne manipule jamais de texte de commande.
- **Lecture à la demande** : l'état du monde est lu par `GET /api/world` à l'ouverture de la page, après chaque action et toutes les 30 s tant que la page est affichée. Le `MetricsCollector` n'est pas modifié.
- Aucune confirmation modale : chaque action est réversible d'un clic et auditée.

### Hypothèses

- Serveur Java vanilla, Paper, Fabric ou Forge : les messages RCON sont ceux de la traduction `en_us` de Minecraft. Les parseurs sont tolérants (regex sur les mots-clés, couleurs `§` retirées) et renvoient `null` plutôt qu'une erreur quand une réponse n'est pas reconnue.
- `/tick` existe depuis Minecraft 1.20.3. Avant, le serveur répond « Unknown or incomplete command » : la carte Tick est affichée désactivée.
- La météo n'a pas de commande de lecture en vanilla : la carte propose les actions sans indicateur d'état courant.
- La persistance du taux de tick entre deux redémarrages n'est pas garantie par la documentation ; l'interface ne promet rien à ce sujet.

## 2. Catalogue partagé (`@mc/common`, `src/world.ts`)

Source unique pour la validation backend et les contrôles frontend.

```ts
export const TIME_PRESETS = ['day', 'noon', 'night', 'midnight'] as const;
export const WEATHER_KINDS = ['clear', 'rain', 'thunder'] as const;
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
export const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
export const TICK_RATE = { min: 1, max: 10000, default: 20 } as const;
export const TICK_SPRINT_MAX = 72000; // une heure de jeu

export type GameruleGroup = 'world' | 'players' | 'spawning' | 'misc';
export interface GameruleDef { name: string; type: 'bool' | 'int'; group: GameruleGroup; min?: number; max?: number }
export const GAMERULES: readonly GameruleDef[] = [
  // world
  { name: 'doDaylightCycle', type: 'bool', group: 'world' },
  { name: 'doWeatherCycle', type: 'bool', group: 'world' },
  { name: 'randomTickSpeed', type: 'int', group: 'world', min: 0, max: 4096 },
  { name: 'doFireTick', type: 'bool', group: 'world' },
  { name: 'mobGriefing', type: 'bool', group: 'world' },
  { name: 'doTileDrops', type: 'bool', group: 'world' },
  { name: 'doEntityDrops', type: 'bool', group: 'world' },
  { name: 'doMobLoot', type: 'bool', group: 'world' },
  // players
  { name: 'keepInventory', type: 'bool', group: 'players' },
  { name: 'naturalRegeneration', type: 'bool', group: 'players' },
  { name: 'doImmediateRespawn', type: 'bool', group: 'players' },
  { name: 'playersSleepingPercentage', type: 'int', group: 'players', min: 0, max: 100 },
  { name: 'spawnRadius', type: 'int', group: 'players', min: 0, max: 128 },
  { name: 'fallDamage', type: 'bool', group: 'players' },
  { name: 'drowningDamage', type: 'bool', group: 'players' },
  { name: 'fireDamage', type: 'bool', group: 'players' },
  { name: 'freezeDamage', type: 'bool', group: 'players' },
  // spawning
  { name: 'doMobSpawning', type: 'bool', group: 'spawning' },
  { name: 'doInsomnia', type: 'bool', group: 'spawning' },
  { name: 'doPatrolSpawning', type: 'bool', group: 'spawning' },
  { name: 'doTraderSpawning', type: 'bool', group: 'spawning' },
  { name: 'doWardenSpawning', type: 'bool', group: 'spawning' },
  { name: 'disableRaids', type: 'bool', group: 'spawning' },
  { name: 'maxEntityCramming', type: 'int', group: 'spawning', min: 0, max: 100 },
  // misc
  { name: 'announceAdvancements', type: 'bool', group: 'misc' },
  { name: 'showDeathMessages', type: 'bool', group: 'misc' },
  { name: 'commandBlockOutput', type: 'bool', group: 'misc' },
  { name: 'sendCommandFeedback', type: 'bool', group: 'misc' },
];

export interface WorldState {
  time: { daytime: number | null; day: number | null };          // daytime 0..23999
  tick: { supported: boolean; targetRate: number | null; frozen: boolean; sprinting: boolean };
  difficulty: Difficulty | null;
  defaultGamemode: Gamemode | null;                              // lu dans server.properties
  gamerules: Record<string, boolean | number | null>;            // une clé par entrée de GAMERULES
  resetOnRestart: { difficulty?: string; gamemode?: string };    // variable itzg qui réécrira la clé
}
export type WorldTickUpdate = { rate: number } | { frozen: boolean } | { sprint: number };
```

`pvp` n'est pas une gamerule mais une propriété fichier : elle reste sur Configuration.

## 3. Backend

### 3.1 Parseurs (`src/world/parsers.ts`)

Tous appliquent `stripColors` et renvoient `null` si la réponse n'est pas reconnue.

| Fonction | Commande | Réponse attendue | Résultat |
|---|---|---|---|
| `parseTimeQuery` | `time query daytime` / `time query day` | `The time is 6000` | `6000` |
| `parseGamerule` | `gamerule <name>` / `gamerule <name> <v>` | `Gamerule keepInventory is currently set to: false` ou `is now set to: true` | `false` / `true` / entier |
| `parseDifficulty` | `difficulty` | `The difficulty is Normal` | `'normal'` |
| `parseTickStatus` | `tick query` | `Target tick rate: 20.0 per second.` précédé ou suivi d'une ligne d'état contenant `frozen` ou `sprinting` | `{ targetRate, frozen, sprinting }` |
| `isUnknownCommand` | toute | `Unknown or incomplete command` / `Unknown command` | booléen |

`parseTickStatus` réutilise la regex de `parseTickQuery` (`rcon/parsers.ts`) pour le taux ; `parseTickQuery` n'est pas modifié.

### 3.2 Service (`src/world/world-service.ts`)

```ts
interface WorldDeps { rcon: { send(cmd: string): Promise<string> }; docker: DockerService; properties: PropertiesService }
```

- `read(): Promise<WorldState>` : envoie séquentiellement (file RCON existante) `time query daytime`, `time query day`, `tick query`, `difficulty`, puis `gamerule <name>` pour chaque entrée de `GAMERULES`. Une réponse non reconnue donne `null` pour le champ concerné, jamais une erreur. `tick.supported = false` si `isUnknownCommand`. `defaultGamemode` vient de `properties.read().values.gamemode` (le serveur vanilla réécrit cette clé à chaque `/defaultgamemode`), normalisé en minuscules, `null` si absent ou hors catalogue. `resetOnRestart` : `lockedKeys(env)` de `docker.inspectServer()` ; présent pour `difficulty` ou `gamemode` quand la clé y figure avec une variable autre que `rcon`.
- Setters, chacun validant l'entrée puis envoyant **une** commande :
  - `setTime(preset)` → `time set <preset>`
  - `setWeather(kind)` → `weather <kind>`
  - `setDifficulty(d)` → `difficulty <d>`
  - `setDefaultGamemode(g)` → `defaultgamemode <g>`
  - `setTick(update)` → `tick rate <n>` (entier ou décimal 1..10000), `tick freeze` / `tick unfreeze`, `tick sprint <n>` (entier 1..72000)
  - `setGamerule(name, value)` → `gamerule <name> <value>` ; `name` doit exister dans `GAMERULES`, `value` du bon type et dans les bornes
- Interprétation de la réponse d'un setter : `isUnknownCommand` → `AppError(501, 'Command not supported by this server', 'unsupported')` ; réponse contenant `Incorrect argument`, `Expected`, `Unknown` ou vide → `AppError(502, 'Unexpected server response: …')` ; sinon succès (le serveur vanilla répond par une phrase de confirmation dont le libellé varie, on ne la parse pas). Les réponses « already set » de `difficulty` sont un succès.
- RCON indisponible : `rcon.send` lève déjà l'erreur 503 existante, elle est propagée telle quelle.
- Après un setter réussi, la route rappelle `read()` et renvoie l'état complet.

### 3.3 Routes (`src/routes/world.routes.ts`, montées sur `/api/world`)

Toutes sous `requireRole('admin')`.

| Route | Corps | Audit (avant envoi) |
|---|---|---|
| `GET /` | | aucun |
| `PUT /time` | `{ preset }` | `world.time`, détail `day` |
| `PUT /weather` | `{ kind }` | `world.weather`, détail `rain` |
| `PUT /difficulty` | `{ difficulty }` | `world.difficulty`, détail `hard` |
| `PUT /gamemode` | `{ gamemode }` | `world.gamemode`, détail `creative` |
| `PUT /tick` | `WorldTickUpdate` (un seul champ) | `world.tick`, détail `rate=40`, `frozen=true`, `sprint=1200` |
| `PUT /gamerules/:name` | `{ value: boolean \| number }` | `world.gamerule`, détail `keepInventory=true` |

Réponse des `PUT` : `WorldState` après relecture. Codes : 400 valeur hors catalogue ou hors bornes, 403 viewer, 501 commande inconnue, 502 réponse inattendue, 503 RCON indisponible. Comme pour `rcon.command`, l'audit est écrit avant l'envoi : une commande en échec laisse une trace.

### 3.4 Branchement

`index.ts` construit `WorldService` après `RconService` et `PropertiesService` et l'expose en `app.locals.world`. Aucune écriture dans `/data`, aucun nouveau message WebSocket, aucune table Prisma. `AuditAction` (`@mc/common`) gagne les six actions `world.*`.

## 4. Frontend

### 4.1 Navigation et page

- `Sidebar.tsx` : entrée `/world` (icône `Globe`, `nav.world`, `adminOnly`) après Configuration dans la section « Serveur ». Route dans `App.tsx`.
- `pages/World.tsx` : viewers redirigés vers `/dashboard`. Query `['world']` (`worldApi.get`) activée seulement si `info.status` du store serveur est `ready` ou `unhealthy`, `refetchInterval` 30 s (donnée non poussée par WebSocket). Sinon `EmptyState` « Le serveur doit être démarré pour ajuster le monde ». Chaque mutation place l'état renvoyé dans le cache (`setQueryData`) et affiche un toast court ; erreur → toast avec le message backend, 501 traduit « Commande non prise en charge par cette version de Minecraft ».
- `api/world.api.ts` : `get`, `setTime`, `setWeather`, `setDifficulty`, `setGamemode`, `setTick`, `setGamerule`.

### 4.2 Cartes (`components/world/`), grille deux colonnes

- **`TimeWeatherCard`** : horloge du monde (`daytime` converti en `HH:MM`, l'heure 0 du jeu correspond à 06:00) et numéro du jour ; boutons Jour / Midi / Nuit / Minuit ; interrupteur « Figer le cycle jour-nuit » (inverse de `doDaylightCycle`) ; boutons Clair / Pluie / Orage ; interrupteur « Figer la météo » (inverse de `doWeatherCycle`). Pas de bouton combiné « forcer le jour » : Jour puis gel.
- **`TickCard`** : taux cible, champ numérique 1..10000 avec Appliquer et bouton « Normal (20) », interrupteur Geler, champ « Sprinter N secondes » (×20 ticks, max 3600 s) avec bouton. `supported = false` → texte « nécessite Minecraft 1.20.3 ou plus » et contrôles désactivés.
- **`RulesCard`** : sélecteurs Difficulté et Mode de jeu par défaut appliqués au changement ; sous-texte ambre « Réinitialisé au redémarrage par `DIFFICULTY` dans l'environnement du conteneur » quand `resetOnRestart` le signale.
- **`GamerulesCard`** : quatre groupes ; bool = interrupteur appliqué immédiatement ; int = champ borné avec Appliquer. Valeur `null` = « inconnu », contrôle actif quand même.

Pendant une mutation, le contrôle concerné est désactivé ; les autres restent utilisables.

### 4.3 Cadenas sur Configuration

- `PropertiesForm` : le titre de survol d'une clé gouvernée devient « Gérée par `MOTD` dans l'environnement du conteneur. Définissez `OVERRIDE_SERVER_PROPERTIES=false` dans la stack Minecraft pour rendre le fichier maître. » (`config.lockedBy` enrichi).
- Une ligne d'information (icône cadenas, style neutre) s'affiche en tête du formulaire dès qu'au moins une clé non RCON est cadenassée, avec le même texte générique.
- Aucun changement de `docker-compose.example.yml` ni du README sur ce point (déjà documenté).

### 4.4 i18n et audit

Fragment `scripts/i18n-fragments/world.json` (fr, en) fusionné par `merge-i18n.mjs` : `nav.world`, `world.*` (titres de cartes, libellés des presets, gamerules par nom avec une description courte, erreurs), `config.lockedBy` et `config.lockedHint`, `audit.actions.world`. La page Audit ajoute `world` à sa liste de préfixes filtrables.

## 5. Sécurité

- Toutes les routes `/api/world` sont `rbac('admin')` et auditées avant envoi.
- Aucune commande libre : chaque valeur est contrainte à une liste fermée ou à un intervalle entier ; le nom de gamerule doit appartenir au catalogue (pas d'injection de texte dans la commande).
- Rien n'est écrit dans `/data` par ce lot ; les changements sont persistés par le serveur Minecraft lui-même dans le monde (et `difficulty`, `gamemode` dans `server.properties` par le serveur vanilla).
- Aucun appel sortant, aucun nouveau message WebSocket.

## 6. Tests

- `world/parsers.test.ts` : chaînes réelles avec et sans couleurs, `tick query` normal, gelé, en sprint, taux décimal, réponses « Unknown or incomplete command », réponses vides.
- `world/world-service.test.ts` avec un faux RCON à réponses scriptées par commande : `read()` complet, champ `null` sur réponse inconnue, `tick.supported = false`, chaque setter (commande émise exacte), bornes et catalogue (400), 501 et 502, `defaultGamemode` lu dans un `PropertiesService` sur dossier temporaire, `resetOnRestart` avec un faux Docker dont l'env contient `DIFFICULTY=hard` puis avec `OVERRIDE_SERVER_PROPERTIES=false`.
- `routes/world.routes.test.ts` : 403 viewer, 400 corps invalide, ligne d'audit écrite avant l'envoi (y compris quand le setter échoue), état renvoyé après action.
- Frontend : `World.test.tsx` (redirection viewer, état vide serveur arrêté, rendu des quatre cartes à partir d'un état mocké, mutation remplaçant le cache, carte Tick désactivée si non prise en charge) ; `PropertiesForm.test.tsx` sur le nouveau texte du cadenas et la ligne d'information.
- Vérification manuelle sur le serveur réel en fin de lot : sortie exacte de `tick query` gelé et en sprint, `gamerule` sur Paper, puis ajout de `OVERRIDE_SERVER_PROPERTIES=false` à la stack pour constater la levée des cadenas.

## 7. Documentation

- README : section « World » (page admin, RCON, rien d'écrit dans `/data`, persistance dans le monde, réinitialisation de difficulté et mode de jeu par l'environnement au redémarrage, `/tick` dès 1.20.3) ; la section « Server configuration » renvoie à la ligne d'information du formulaire.
- `CLAUDE.md` : ligne « Monde (lot 5) » dans l'architecture backend et frontend, actions d'audit `world.*`.

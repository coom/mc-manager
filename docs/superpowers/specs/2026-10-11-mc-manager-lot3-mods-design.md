# MC Manager, lot 3 : gestion des mods depuis la WebUI

Date : 2026-10-11
Statut : validé en conversation, à implémenter

## 1. Objectif

Le serveur passe de Vanilla à Fabric avec des mods installés par l'image itzg via
`MODRINTH_PROJECTS` (fabric-api, lithium, ferrite-core, krypton, c2me-fabric, spark,
chunky, bluemap). Le partenaire veut voir la liste des mods et activer ou désactiver
chacun depuis la WebUI, en admin, audité, comme le reste de l'application.

### Décisions de cadrage

- **Fabric, dossier `mods/`.** Le message initial parlait de Paper, mais l'environnement
  donné est `TYPE: FABRIC` et quatre des mods cités n'existent qu'en Fabric. Le code
  reste correct pour un serveur à plugins (`plugins/`, loader `paper`) : le type est lu
  dans `Config.Env` du conteneur, jamais codé en dur.
- **MC Manager pilote la liste Modrinth** via le fichier de liste natif de l'image
  (`MODRINTH_PROJECTS=@/data/mc-manager/modrinth-projects.txt`). Désactiver un mod,
  c'est commenter sa ligne. Renommer les jars ne marche pas pour les mods Modrinth :
  l'image retélécharge au démarrage tout fichier listé qui manque et supprime ce qui
  n'est plus listé (`mc-image-helper`, `Manifests.cleanup`).
- **Ajout et retrait par slug Modrinth**, validés par un appel à `api.modrinth.com`.
  Pas de recherche intégrée, pas d'upload de jar.
- **Les jars déposés à la main** (absents du manifeste Modrinth) sont gérés par
  renommage `.jar` ⇄ `.jar.disabled`.
- **Aucun redémarrage automatique.** Fabric ne charge rien à chaud : la page affiche
  « redémarrage requis » avec le bouton existant.

### Hypothèses

- Image `itzg/minecraft-server` avec `mc-image-helper` récent : fichier de liste `@`,
  manifeste `/data/.modrinth-manifest.json` (`files` relatifs à `/data`, `projects`).
- Le volume de données est monté en lecture-écriture (lot 2b).
- `TYPE` du conteneur parmi : `FABRIC`, `QUILT`, `FORGE`, `NEOFORGE` (dossier `mods/`)
  ou `PAPER`, `SPIGOT`, `BUKKIT`, `PURPUR`, `FOLIA` (dossier `plugins/`). Tout autre
  type (vanilla ou inconnu) rend la page en lecture seule avec un message.

## 2. Modèle

### 2.1 Fichier de liste

Chemin : `<dataDir>/mc-manager/modrinth-projects.txt`, créé avec le dossier au premier
import ou ajout. Format itzg : une entrée par ligne, lignes vides et lignes commençant
par `#` ignorées par l'image.

Convention MC Manager : une entrée désactivée est stockée `# <entrée>` (dièse, espace,
entrée). Tout autre commentaire (`## note`, `# texte avec espaces`) est conservé tel quel
et affiché comme « ligne non gérée ». L'entrée exacte est toujours préservée
(`c2me-fabric:alpha+`, `pl3xmap?`, `fabric:sodium:beta`) : on ne fait que préfixer ou
déprefixer.

Grammaire d'une entrée valide (regex, insensible à la casse pour le préfixe) :

```
^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$
```

Pas d'espace, de `#` ni de retour ligne. Une entrée non conforme présente dans le
fichier devient une « ligne en erreur » : affichée en lecture seule, jamais réécrite.
Les autres lignes restent gérables.

Écriture atomique (fichier temporaire puis `rename`), même mécanisme que
`properties-service.ts`. Chaque opération relit le fichier avant d'écrire.

### 2.2 Manifeste itzg

`<dataDir>/.modrinth-manifest.json`, écrit par `mc-image-helper` au démarrage :

```json
{ "files": ["mods/lithium-fabric-0.14.0.jar", "..."], "projects": ["fabric-api", "lithium", "..."] }
```

Lecture tolérante : absent ou invalide → `null`. Il sert à deux choses : savoir quels
jars sont gérés par Modrinth (`files`) et quelles entrées sont réellement installées
(`projects`).

### 2.3 Source de la liste

`source` est déduit de `MODRINTH_PROJECTS` dans `Config.Env` du conteneur :

| `source`  | Condition | Conséquence dans l'interface |
|-----------|-----------|------------------------------|
| `file`    | la valeur vaut exactement `@/data/mc-manager/modrinth-projects.txt` | fonctionnement nominal |
| `inline`  | valeur non vide, sans `@` | carte d'amorçage : « Importer N mods » puis ligne de compose à copier ; bandeau permanent « vos changements ne seront pas appliqués tant que le compose n'est pas modifié » |
| `other`   | valeur `@` vers un autre fichier | bandeau : MC Manager ne gère pas ce fichier, ligne de compose à copier |
| `none`    | variable absente ou vide, ou conteneur introuvable | bandeau : ligne de compose à copier |

Dans tous les cas le fichier de MC Manager reste éditable si le type de serveur est
supporté ; seul `file` garantit l'application au redémarrage.

### 2.4 États

Mod Modrinth (`ModrinthMod`) :

- `entry` : texte exact de l'entrée (identifiant de la ligne pour les routes).
- `slug` : partie projet de l'entrée (sans préfixe, version ni `?`).
- `enabled` : ligne active ou commentée.
- `installed` : `manifest.projects` contient `entry`.
- `title`, `iconUrl`, `projectId` : depuis la table `ModrinthProject`, `null` si pas
  encore résolu.

Mod manuel (`ManualMod`) :

- `file` : nom de fichier sans suffixe `.disabled` (identifiant pour les routes).
- `enabled` : le fichier présent est `<file>` (et non `<file>.disabled`).
- `size`, `mtime`.

Critères : fichiers réguliers de `<dataDir>/<modsDir>/` nommés `*.jar` ou
`*.jar.disabled`, dont le chemin `<modsDir>/<file>` n'est pas dans `manifest.files`.
Si les deux formes existent pour un même nom, l'état est `enabled` et le doublon est
signalé (`conflict: true`), aucune action possible dessus.

`restartRequired` est vrai si l'une des conditions tient :

- l'ensemble des entrées Modrinth actives diffère de `manifest.projects` (manifeste
  absent inclus, dès qu'il y a au moins une entrée active) ;
- un renommage manuel a eu lieu depuis le démarrage du conteneur : horodatage de la
  dernière écriture gardé en mémoire par le service et comparé à `State.StartedAt`,
  même mécanisme que `PropertiesService` (un redémarrage du backend remet ce drapeau
  à zéro). Le `mtime` du dossier ne convient pas : l'image elle-même y écrit après
  `StartedAt` au moment du téléchargement des mods ;
- quand le serveur est arrêté, la seule première condition compte.

### 2.5 Cache des métadonnées Modrinth

Table Prisma :

```prisma
model ModrinthProject {
  slug      String   @id
  projectId String
  title     String
  iconUrl   String?
  fetchedAt DateTime
}
```

Alimentée à l'ajout d'un mod (appel obligatoire) et, pour les entrées importées ou
écrites à la main, par une résolution en arrière-plan déclenchée par `GET /api/mods`
quand une entrée n'a pas de ligne en cache : un seul passage à la fois, au plus une
tentative par slug et par heure (mémoire), échecs silencieux (journalisés). Aucun
appel sortant tant que toutes les entrées sont en cache.

## 3. Backend

Nouveau dossier `packages/backend/src/mods/`.

### 3.1 `server-type.ts`

`modsDirFor(env: string[]): { loader: string; dir: 'mods' | 'plugins' } | null` d'après
`TYPE` (défaut `VANILLA` → `null`). Loader Modrinth : `fabric`, `quilt`, `forge`,
`neoforge`, `paper`, `spigot`, `bukkit`, `purpur`, `folia`. `modrinthSource(env)` renvoie
`source` (2.3).

### 3.2 `listing-file.ts`

- `parseListing(text): ListingLine[]` avec `kind: 'entry' | 'disabled' | 'comment' | 'blank' | 'invalid'`, `entry?`, `raw`.
- `serializeListing(lines): string` (reproduit `raw` pour `comment`, `blank`, `invalid`).
- `isValidEntry(s)`, `slugOf(entry)`.
- `readListing(path)` (absent → `[]`), `writeListing(path, lines)` atomique, création du
  dossier parent.

### 3.3 `manifest.ts`

`readManifest(dataDir): Promise<{ files: string[]; projects: string[] } | null>`.

### 3.4 `modrinth-client.ts`

Interface `ModrinthLike { getProject(slug): Promise<ModrinthProjectInfo | null> }`.
Implémentation réelle : `fetch('https://api.modrinth.com/v2/project/<slug>')`,
en-tête `User-Agent: mc-manager/<version> (github.com/coom/mc-manager)`, timeout 10 s
(`AbortSignal.timeout`). Renvoie `{ id, slug, title, iconUrl, projectType, loaders }` ;
404 → `null` ; autre statut ou erreur réseau → lève `ModrinthUnavailable`.
`fake-modrinth.ts` pour les tests.

### 3.5 `mods-service.ts`

Dépendances : `dataDir`, `DockerService` (pour `inspectServer().env` et `startedAt`),
`ModrinthLike`, Prisma, `DataLock`, fonction de broadcast.

- `view(): Promise<ModsView>` : agrège type de serveur, source, liste, manifeste,
  dossier et cache ; déclenche la résolution en arrière-plan.
- `importFromEnv()` : refuse (409) si le fichier existe déjà ou si `source !== 'inline'` ;
  écrit une ligne par entrée (entrées non conformes → ligne `invalid` conservée).
- `add(entry)` : validation grammaire (400), doublon par `slug` (409), appel Modrinth
  (404 inconnu, 502 injoignable), `projectType` ≠ `mod` (422 `wrong_type` : l'API
  Modrinth classe mods, plugins et datapacks sous `project_type: "mod"` et les distingue
  par `loaders` ; `modpack`, `resourcepack`, `shader` sont refusés), loader attendu
  (préfixe de l'entrée s'il y en a un, sinon celui du serveur) absent de `loaders`
  (422 `loader_mismatch`), puis écriture et cache.
- `setEnabled(entry, enabled)` : ligne introuvable → 404 ; déjà dans l'état → 200 sans
  écrire.
- `remove(entry)` : supprime la ligne (404 si absente).
- `setFileEnabled(file, enabled)` : `file` doit être un nom simple (`^[^/\\]+\.jar$`,
  pas `..`) ET présent dans le listing réel du dossier, sinon 404 ; conflit (2.4) → 409 ;
  `fs.rename` dans le dossier.

Toute écriture prend `DataLock.acquire('mods')` (409 si une restauration, un backup
manuel ou `server.properties` est en cours) et diffuse `mods.changed` après succès.
Seules écritures ajoutées dans `/data` : le fichier de liste sous `mc-manager/` et des
renommages à l'intérieur de `mods/`. Jamais de suppression de jar : les mods Modrinth
retirés sont supprimés par l'image au redémarrage.

### 3.6 Routes (`routes/mods.routes.ts`)

| Méthode et chemin | Rôle | Audit |
|-------------------|------|-------|
| `GET /api/mods` | tout utilisateur authentifié, renvoie `ModsView` | non |
| `POST /api/mods/import` | admin | `mods.import` (`N entries`) |
| `POST /api/mods/modrinth` `{ entry }` | admin | `mods.add` (`entry`) |
| `PATCH /api/mods/modrinth/:entry` `{ enabled }` | admin | `mods.toggle` (`entry enabled|disabled`) |
| `DELETE /api/mods/modrinth/:entry` | admin | `mods.remove` (`entry`) |
| `PATCH /api/mods/files/:file` `{ enabled }` | admin | `mods.file.toggle` (`file enabled|disabled`) |

`:entry` et `:file` sont encodés par le client (`encodeURIComponent`) ; le serveur
revalide la grammaire avant toute recherche. Type de serveur non supporté → 409 sur
toutes les écritures.

Réponses d'erreur : `{ error, code }` avec `code` parmi `invalid_entry`, `duplicate`,
`unknown_project`, `wrong_type`, `loader_mismatch`, `modrinth_unavailable`,
`unsupported_server`, `busy`, `conflict`, `not_found`.

### 3.7 `@mc/common`

Types `ModsView`, `ModrinthMod`, `ManualMod`, `ModsSource`, DTO des routes, action
d'audit (`mods.import`, `mods.add`, `mods.toggle`, `mods.remove`, `mods.file.toggle`),
message WebSocket `{ type: 'mods.changed' }`.

```ts
interface ModsView {
  server: { loader: string; dir: 'mods' | 'plugins' } | null;
  source: 'file' | 'inline' | 'other' | 'none';
  inlineEntries: string[];        // pour la carte d'amorçage (source inline)
  listingExists: boolean;
  composeLine: string;             // MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"
  restartRequired: boolean;
  modrinth: ModrinthMod[];
  unmanagedLines: { raw: string; invalid: boolean }[];
  manual: ManualMod[];
}
```

### 3.8 Démarrage (`index.ts`)

`ModsService` construit après `BackupService`, exposé en `app.locals.mods`. Pas de
tâche périodique.

## 4. Frontend

- Route `/mods`, page `pages/Mods.tsx`, entrée « Mods » dans la sidebar entre Joueurs
  et Configuration, visible par tous ; actions rendues seulement pour `admin`.
- `RestartBanner` déplacé de `components/config/` vers `components/shared/` et réutilisé
  (il invalide déjà `server` ; ajouter l'invalidation de `mods` et `config`).
- En tête : bandeau selon `source` (2.3) avec la ligne de compose dans un bloc copiable ;
  carte d'amorçage avec bouton « Importer N mods » si `inline` et `!listingExists` ;
  message « type de serveur non supporté » si `server === null`.
- Groupe « Modrinth » : champ d'ajout (slug ou entrée complète, Entrée pour valider,
  erreurs du backend traduites par `code`), puis une ligne par mod : icône (`iconUrl`
  ou placeholder), `title` ou `slug`, `entry` en petit, badge « installé » ou
  « en attente », `Switch` activer/désactiver, bouton supprimer avec `ConfirmDialog`.
  Lignes non gérées et en erreur listées sous le groupe, en lecture seule.
- Groupe « Manuels » : `file`, taille formatée, `Switch` ; vide → phrase explicative ;
  conflit → badge et switch désactivé.
- Données : `useQuery(['mods'])` sans `refetchInterval` ; `use-websocket.ts` invalide
  `mods` sur `mods.changed` et à chaque reconnexion. Mutations avec invalidation et
  toasts, comme les autres pages. API dans `api/mods.api.ts`.
- i18n : fragment `scripts/i18n-fragments/mods.json`, puis `merge-i18n.mjs`.

## 5. Erreurs et sécurité

- Fichier de liste absent : groupe Modrinth vide, carte d'amorçage ou champ d'ajout.
- Manifeste absent : tous les mods Modrinth « en attente », `restartRequired` vrai s'il
  y a une entrée active.
- Dossier `mods/` absent : groupe manuel vide, aucune erreur ; un renommage y répond 404.
- Conteneur introuvable : `server` déduit impossible → page en lecture seule avec
  message, `source: 'none'`.
- RBAC : lecture pour tous les authentifiés, écritures `rbac('admin')`, audit avant la
  réponse.
- Traversée de chemin : `:file` nom simple + présence dans le listing réel ; `:entry`
  validé par la grammaire (aucun caractère de chemin possible).
- Appels sortants : uniquement `api.modrinth.com` depuis le backend (ajout, résolution en
  arrière-plan) ; le navigateur charge les icônes depuis `cdn.modrinth.com`. À
  documenter dans la section Privacy du README.
- Aucune variable d'environnement du conteneur n'est modifiée (hors périmètre depuis le
  lot 1) : le partenaire édite son compose, la WebUI lui donne la ligne.

## 6. Tests

Backend (vitest, dossier temporaire, fakes) :

- `listing-file` : parse/sérialise, préservation des commentaires, lignes vides et
  lignes en erreur, validation de la grammaire.
- `manifest` : absent, invalide, valide.
- `server-type` : table `TYPE` → loader/dossier, calcul de `source`.
- `mods-service` : import (409 si fichier présent ou source non inline), ajout (chaque
  code d'erreur avec `FakeModrinth`), toggle, remove, renommage manuel (404 hors
  listing, 409 conflit), `restartRequired` dans les trois cas, verrou `DataLock` (409),
  broadcast `mods.changed`.
- `mods.routes` : RBAC (viewer 403 sur les écritures), audit écrit, codes d'erreur.

Frontend : page avec `source` `file`/`inline`/`none`, serveur non supporté, toggles et
ajout (succès et erreur traduite), admin vs viewer.

## 7. Documentation

- README : section « Mods » (ligne de compose, amorçage, mods manuels, redémarrage) et
  ajout à « Privacy » (`api.modrinth.com`, `cdn.modrinth.com`).
- CLAUDE.md : paragraphe lot 3 dans l'architecture backend et frontend, invariants
  (écritures limitées à `mc-manager/` et renommages dans `mods/`).
- `docker-compose.example.yml` : exemple `TYPE: FABRIC` avec
  `MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"` commenté.

## 8. Écarts d'implémentation

- **Manifeste en mode fichier (constaté au premier déploiement Fabric)** : `projects` du manifeste
  ne contient que la valeur brute de `--projects`, donc `@/data/mc-manager/modrinth-projects.txt`,
  jamais les entrées développées (`ModrinthCommand.call()` passe le champ `projects` non développé
  au builder). Les sections 2.2 et 2.4 supposaient le contraire. Implémentation retenue :
  - `manifest.ts` lit aussi `timestamp` (secondes epoch ou ISO, repli sur le mtime du fichier) ;
  - si `projects` contient une référence `@`, la liste est « appliquée » quand `timestamp` ≥ mtime du
    fichier de liste : les entrées actives sont alors installées, `restartRequired` est faux, et les
    slugs actifs sont mémorisés dans `AppSetting` `mods.appliedSlugs` ; sinon `restartRequired` est
    vrai et l'état installé affiché est celui mémorisé au dernier démarrage appliqué ;
  - en mode inline, `projects` contient les entrées et la comparaison par slug de la section 2.4
    reste en vigueur.
- `restartRequired` des jars manuels : horodatage en mémoire (section 2.4, déjà corrigée).
- `wrong_type` : voir section 3.5.
- Le badge d'un mod a trois états : « en attente » si l'état voulu diffère de l'état installé,
  « installé », ou « non installé » (désactivé et absent).

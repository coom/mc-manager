# MC Manager, lot 4 : catalogue Modrinth et dépôt de jars

Date : 2026-10-11
Statut : validé en conversation, à implémenter

## 1. Objectif

Le lot 3 gère les mods d'un serveur moddé (liste Modrinth pilotée par un fichier, jars manuels
renommés). Le partenaire veut maintenant **importer** des mods depuis la WebUI :

- chercher dans le catalogue Modrinth et ajouter un mod en un clic, sans connaître son slug ;
- déposer un fichier `.jar` depuis le navigateur pour les mods absents de Modrinth ou les builds
  maison, et pouvoir le supprimer ensuite.

### Décisions de cadrage

- **Le catalogue n'installe rien lui-même.** Ajouter depuis le catalogue = ajouter l'entrée au
  fichier de liste, exactement comme le champ de saisie du lot 3 ; l'image itzg télécharge au
  redémarrage. Télécharger nous-mêmes créerait un doublon avec le téléchargement de l'image
  (Fabric refuse deux jars du même mod) ou un jar « manuel » privé des mises à jour.
- **Le backend relaie la recherche** (`api.modrinth.com/v2/search`) : le navigateur ne parle
  jamais à Modrinth, conformément à la section Privacy du README.
- **Upload en flux brut** (`POST` avec le fichier en corps), streamé vers un fichier temporaire,
  sans `multer` ; une seule dépendance ajoutée, `yauzl`, pour lire les descripteurs du jar.
- **Vérification stricte** : archive zip valide ET descripteur du loader du serveur, dont on lit
  identifiant, nom et version. Tout le reste est refusé.
- **Suppression autorisée pour les jars manuels seulement**, définitive, avec confirmation.
  Les jars gérés par Modrinth restent intouchables.
- **nginx** : limite de corps portée à 100 Mo sur la route d'upload uniquement.

### Hypothèses

- Serveur de type supporté (section 1 de la spec du lot 3) ; vanilla = tout refusé en 409.
- Version Minecraft connue par `metrics.latest().version` (ligne « Starting minecraft server
  version » des logs) ou par `VERSION` du conteneur si numérique ; sinon la recherche filtre sur
  le loader seul et l'interface le dit.

## 2. Catalogue

### 2.1 Client Modrinth

`ModrinthLike` gagne :

```ts
search(q: string, opts: { loader: string; gameVersion: string | null; limit: number }): Promise<ModrinthSearchHit[]>
interface ModrinthSearchHit { slug: string; projectId: string; title: string; description: string | null; iconUrl: string | null; author: string | null; downloads: number; follows: number; latestVersion: string | null }
```

Appel `GET /v2/search?query=<q>&limit=<n>&index=relevance&facets=<json>` avec les facettes
`[["project_type:mod"],["categories:<loader>"]]` plus `["versions:<gameVersion>"]` quand connue.
Champs lus : `slug`, `project_id`, `title`, `description`, `icon_url`, `author`, `downloads`,
`follows`, `latest_version`. Même `User-Agent`, même timeout, mêmes erreurs
(`ModrinthUnavailable`). `FakeModrinth` enregistre les requêtes et renvoie une liste préparée.

### 2.2 Service

`ModsService.search(q)` :

- `q` nettoyé (`trim`, 100 caractères max) ; moins de 2 caractères → 400 `invalid_query`.
- Serveur non supporté → 409 `unsupported_server`.
- Version : `deps.gameVersion()` (fonction injectée, `metrics.latest().version` dans `index.ts`),
  sinon `VERSION` de `Config.Env` si elle correspond à `^\d+\.\d+(\.\d+)?$`, sinon `null`.
- Cache mémoire `(q, loader, version) → { at, hits }`, 60 s, 50 entrées (éviction de la plus
  ancienne).
- `alreadyListed` = slug présent dans le fichier de liste (actif ou désactivé), calculé à chaque
  appel, hors cache.
- Réponse `ModsSearchResult { gameVersion: string | null; loader: string; hits: (ModrinthSearchHit & { alreadyListed: boolean })[] }`.

### 2.3 Route

`GET /api/mods/search?q=…` : tout utilisateur authentifié, pas d'audit, 20 résultats.

### 2.4 Ajout

Inchangé : `POST /api/mods/modrinth { entry: slug }`. L'appel `getProject` fait à l'ajout
alimente déjà le cache `ModrinthProject` (titre, résumé, icône) : aucun champ supplémentaire
dans le corps, aucune route nouvelle.

### 2.5 Interface

- Le champ de la carte « Mods Modrinth » devient un champ unique : saisie → recherche après
  300 ms d'inactivité, à partir de 2 caractères ; Entrée sur une entrée valide (`lithium`,
  `lithium:0.14.0`) = ajout direct comme avant.
- Panneau de résultats sous le champ : ligne de filtre (« Fabric · 1.21.1 » ou « Fabric ·
  version inconnue, compatibilité non vérifiée »), puis une ligne par résultat : icône, titre,
  auteur, résumé tronqué, téléchargements formatés, bouton « Ajouter » ou « Déjà dans la
  liste » (désactivé). Chargement, aucun résultat et erreur (`modrinth_unavailable`) sont
  affichés dans le panneau. Échap, clic hors du panneau ou ajout réussi le ferment.
- Viewer : pas de champ, donc pas de recherche.

## 3. Dépôt de jars

### 3.1 Route `POST /api/mods/upload`

`rbac('admin')`, audit `mods.upload` (`<nom> <octets>`), paramètres de requête `name` et
`replace` (`1`). Ordre des vérifications, avant de lire le corps :

1. serveur supporté (409 `unsupported_server`) ;
2. `name` : `^[A-Za-z0-9._+ ()\[\]-]{1,96}\.jar$`, sans `..`, `path.basename(name) === name`
   (400 `invalid_name`) ;
3. `Content-Length` présent, entier, 1 ≤ n ≤ 100 Mo (411 si absent, 413 `too_large`).

Le corps est streamé dans `<dataDir>/mc-manager/tmp/<uuid>.part` (dossier créé au besoin) avec un
compteur : au-delà de 100 Mo ou si la connexion se coupe, le `.part` est supprimé et la réponse
est 413 ou 400 `upload_aborted`. Le verrou n'est pas pris pendant la réception.

### 3.2 Inspecteur `mods/jar-inspector.ts`

`inspectJar(path, dir: 'mods' | 'plugins'): Promise<JarInfo>` avec

```ts
interface JarInfo { loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'paper' | null; meta: { id: string | null; name: string | null; version: string | null } | null }
```

- `yauzl.open` en mode `lazyEntries`, lecture entrée par entrée sans extraction sur disque ;
  archive invalide → `JarError('not_a_jar')`.
- Descripteurs reconnus (le premier trouvé donne le loader) : `fabric.mod.json` → fabric,
  `quilt.mod.json` → quilt, `META-INF/neoforge.mods.toml` → neoforge, `META-INF/mods.toml` →
  forge, `paper-plugin.yml` ou `plugin.yml` → paper. Aucun → `loader: null`.
- Extraction des métadonnées : JSON pour Fabric (`id`, `name`, `version`) et Quilt
  (`quilt_loader.id`, `metadata.name`, `quilt_loader.version`) ; pour TOML et YAML, expressions
  régulières sur les clés de premier niveau `modId`/`displayName`/`version` et
  `name`/`version` (YAML : `name` sert d'identifiant). Échec → `meta: null`, pas d'erreur.
- Lecture limitée à 1 Mo par descripteur.

Compatibilité : `dir === 'mods'` accepte `fabric` et `quilt` quand le serveur est Fabric ou
Quilt, `forge`/`neoforge` quand il est Forge ou NeoForge (le loader du serveur fait foi, un mod
Fabric sur NeoForge est refusé même si Sinytra le permettrait) ; `dir === 'plugins'` accepte
`paper`. Sinon 422 `wrong_loader`, `details` = loader détecté ou `none`.

### 3.3 Dépôt (`ModsService.upload`)

Sous `DataLock('mods')` après l'inspection :

- `mods/<nom>` ou `mods/<nom>.disabled` existe et `replace` absent → 409 `exists` ;
- `<dir>/<nom>` est dans `files` du manifeste → 409 `managed` (jamais remplaçable) ;
- l'`id` lu est celui d'un autre jar manuel (nom différent) → 409 `duplicate_mod`,
  `details` = nom du fichier en conflit ;
- sinon `rename(tmp, mods/<nom>)` ; avec `replace`, la forme `.disabled` éventuelle est supprimée
  d'abord pour ne pas laisser un doublon ; `lastFileWriteAt = now` ; broadcast `mods.changed` ;
  réponse = `ModsView`.

Toute erreur après la réception supprime le `.part`. Au démarrage (`ModsService.start()` appelé
depuis `index.ts`), les `.part` de `mc-manager/tmp/` sont supprimés.

### 3.4 Suppression `DELETE /api/mods/files/:file`

Admin, audit `mods.file.delete`, verrou. `file` validé comme dans `setFileEnabled`, présent dans
le listing manuel (404 sinon). Les deux formes sont supprimées si présentes (un conflit est ainsi
résolu). `lastFileWriteAt = now`, broadcast, réponse = `ModsView`.

### 3.5 Métadonnées des jars manuels

`ManualMod.meta: { id, name, version } | null`, rempli par l'inspecteur dans `listManual` avec un
cache mémoire `chemin → { size, mtimeMs, meta }` invalidé quand taille ou mtime changent. Un jar
illisible donne `meta: null` sans faire échouer la vue.

### 3.6 Interface

- Zone de dépôt en tête de la carte « Jars manuels » (admin) : cadre pointillé, clic ou
  glisser-déposer, `accept=".jar"`, plusieurs fichiers envoyés l'un après l'autre.
- Ligne provisoire pendant l'envoi : nom, barre de progression (`onUploadProgress`), bouton
  Annuler (`AbortController`), timeout axios désactivé pour cette requête.
- Succès : vue remplacée, toast « Mod déposé », bandeau « redémarrage requis ». Erreur : toast
  traduit par code ; pour `exists` et `duplicate_mod` sur le même nom, un bouton « Remplacer »
  dans le toast relance avec `replace=1` après `ConfirmDialog`.
- Lignes manuelles : `meta.name` en titre et `meta.version` à côté quand connus, nom de fichier
  en mono dessous ; sinon nom de fichier seul. Corbeille après le `Switch`, `ConfirmDialog`
  « Supprimer définitivement <fichier> ? » (texte spécifique en cas de conflit).

### 3.7 nginx

Dans `Dockerfile.frontend`, avant `location /api` :

```nginx
location = /api/mods/upload {
    client_max_body_size 100m;
    proxy_request_buffering off;
    proxy_read_timeout 10m;
    proxy_send_timeout 10m;
    # mêmes directives proxy_pass / headers que le bloc /api
}
```

## 4. Types communs

```ts
ModrinthSearchHit, ModsSearchResult (section 2) ;
ManualMod.meta ;
ModsErrorCode += 'invalid_query' | 'invalid_name' | 'too_large' | 'upload_aborted' | 'not_a_jar' | 'wrong_loader' | 'exists' | 'managed' | 'duplicate_mod' ;
AuditAction += 'mods.upload' | 'mods.file.delete'.
```

## 5. Sécurité

- Écritures dans `/data` : fichier de liste, renommages dans `mods/`, dépôt d'un jar vérifié dans
  `mods/` via `mc-manager/tmp/`, suppression d'un jar manuel. Rien d'autre. Jamais de suppression
  d'un jar géré par Modrinth, jamais d'extraction du contenu d'un jar sur le disque.
- Nom de fichier validé par la route et par le service ; le chemin de destination ne dérive
  jamais du contenu de l'archive.
- 100 Mo appliqués par nginx puis par le backend ; `.part` toujours nettoyé.
- Recherche : 20 résultats, requête ≤ 100 caractères, cache 60 s ; seuls le texte, le loader et
  la version Minecraft partent chez Modrinth.
- RBAC : recherche pour tous les authentifiés, upload et suppression admin, audités.

## 6. Tests

- `jar-inspector` : jars construits dans le test par un petit écrivain zip maison (entrées
  « stored », en-têtes locaux, répertoire central, fin de répertoire ; une cinquantaine de lignes,
  dans un utilitaire de test) pour Fabric, Quilt, NeoForge, Forge, Paper, sans descripteur,
  corrompu, descripteur trop gros.
- Client Modrinth : `search` (URL et facettes, mapping, erreurs).
- Service : `search` (cache, `alreadyListed`, version inconnue), `upload` (succès, `.part`
  nettoyé, `exists`, `replace`, `managed`, `duplicate_mod`, `wrong_loader`, `not_a_jar`, verrou
  occupé), `deleteFile` (manuel, géré → 404, conflit), `start()` purge les `.part`, `listManual`
  avec `meta` et cache.
- Routes : upload par `supertest` (succès, `Content-Length` absent, trop gros, nom invalide,
  viewer 403, audit), search (400 sous 2 caractères, viewer 200), delete (audit).
- Frontend : recherche (debounce, résultats, « Déjà dans la liste », ajout, erreur), dépôt
  (progression, succès, `wrong_loader`, `exists` puis « Remplacer »), suppression, viewer.

## 7. Documentation

README (section Mods : catalogue, dépôt, suppression, 100 Mo, descripteurs reconnus ; Privacy :
recherche relayée), CLAUDE.md (architecture, invariants), `Dockerfile.frontend` commenté.

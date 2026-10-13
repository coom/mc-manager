# MC Manager : planification des sauvegardes depuis l'interface

Date : 2026-10-13. Fait suite à la page Carte et au menu adaptatif. Stack inchangée : backend Express + Prisma, frontend React, types partagés dans `@mc/common`.

## 1. Objectif

L'intervalle entre deux sauvegardes (`BACKUP_INTERVAL`, aujourd'hui `6h` chez l'utilisateur) et la rétention (`PRUNE_BACKUPS_DAYS`, `7`) sont écrits dans le bloc `environment:` du service `mc-backup` de la stack Minecraft. Les changer impose aujourd'hui d'éditer le compose sur l'hôte et de recréer le conteneur. L'objectif est de les régler depuis la page Sauvegardes.

### Décisions de cadrage

- **Fichier lu par mc-backup, sur le modèle des mods** : MC Manager écrit les deux valeurs dans un fichier ; le compose de mc-backup est modifié **une seule fois** pour que son point d'entrée lise ce fichier avant de lancer la boucle de l'image. Appliquer un changement = écrire le fichier puis **redémarrer** mc-backup. MC Manager ne crée ni ne supprime aucun conteneur, et mc-backup garde sa propre planification (il continue de sauvegarder quand MC Manager est arrêté).
- Écartés : recréation du conteneur par l'API Docker (recréation fidèle délicate, retour silencieux aux valeurs du compose après `docker compose pull && up -d`), planification par MC Manager (plus de sauvegarde automatique quand la WebApp est arrêtée), `env_file:` de compose (lu sur l'hôte à la création du conteneur, donc `docker compose up` à chaque changement).
- **Emplacement** : volume des backups, `.mc-manager/backup-settings.conf`. Il n'entre pas dans les archives (une restauration ne ramène pas d'anciens réglages), le conteneur Minecraft ne le monte pas, et le nettoyage de mc-backup ne touche que les `*.tgz` du premier niveau.
- **Bornes** : intervalle libre, nombre entier et unité `m`, `h` ou `d`, entre 30 minutes et 7 jours ; rétention entière de 1 à 365 jours (0, « ne jamais supprimer », est refusé).
- Hors périmètre : `PRUNE_BACKUPS_COUNT`, `INITIAL_DELAY`, `PAUSE_IF_NO_PLAYERS`, `CRON_SCHEDULE`, heure exacte de la prochaine sauvegarde.

### Faits vérifiés dans l'image (`itzg/docker-mc-backup`, branche `master`, 2026-10-13)

- Image Alpine avec `bash`, `coreutils` (GNU `sleep` accepte `30m`, `6h`, `7d`) et `flock` (busybox). `ENTRYPOINT ["/usr/bin/backup"]`, `CMD ["loop"]`.
- `/usr/bin/backup loop` lance `/opt/backup-loop.sh` (via `entrypoint-demoter --match /backups`) ; `backup now` lance le même script avec `ONE_SHOT=true`.
- Les variables sont lues une seule fois au démarrage du script. Après `INITIAL_DELAY` (`2m` par défaut, sauté en one-shot), la boucle sauvegarde (sauf premier passage si `BACKUP_ON_STARTUP=false`), nettoie, puis `sleep ${BACKUP_INTERVAL}`. Une valeur numérique `<= 0` fait sortir le script après un passage (le conteneur redémarrerait en boucle) ; `(( BACKUP_INTERVAL <= 0 ))` évalue la valeur en arithmétique bash, d'où l'interdiction absolue de laisser passer un texte libre.
- Le nettoyage s'exécute après chaque passage, y compris `backup now` : `find $DEST_DIR -maxdepth 1 -name '*.tgz' -mmin +N*1440 -delete`. Un `docker exec` hérite de `Config.Env` du conteneur, pas de l'environnement du processus 1 : sans précaution, une sauvegarde manuelle nettoierait avec la valeur du compose.
- Pendant chaque sauvegarde (boucle ou `backup now`), le script tient `flock` sur `$DEST_DIR/.mc-backup-lock` (`DEST_DIR=/backups` par défaut), sauf `SKIP_LOCKING=true` ou dossier non inscriptible. Il passe le serveur en `save-off` et ne remet `save-on` que par un `trap EXIT`, qu'un `SIGKILL` n'exécute pas : redémarrer mc-backup pendant une sauvegarde laisserait une archive tronquée et le monde sans sauvegarde automatique jusqu'au passage suivant.

## 2. Contrat avec mc-backup

### Fichier

- Côté backend : `<MC_BACKUPS_DIR>/.mc-manager/backup-settings.conf`. Côté mc-backup : `/backups/.mc-manager/backup-settings.conf`.
- Contenu écrit par MC Manager (LF, ligne finale terminée) :

```
BACKUP_INTERVAL=6h
PRUNE_BACKUPS_DAYS=7
```

- Écriture atomique : `mkdir -p .mc-manager`, fichier temporaire dans le même dossier, `rename`. Jamais d'autre clé.

### Point d'entrée à ajouter au compose (une fois)

```yaml
  mc-backup:
    image: itzg/mc-backup:latest
    entrypoint:
      - /bin/bash
      - -c
      - |
        f=/backups/.mc-manager/backup-settings.conf
        if [ -r "$$f" ]; then
          while IFS='=' read -r k v; do
            case "$$k" in
              BACKUP_INTERVAL) [[ "$$v" =~ ^[1-9][0-9]*[mhd]$$ ]] && export BACKUP_INTERVAL="$$v" ;;
              PRUNE_BACKUPS_DAYS) [[ "$$v" =~ ^[1-9][0-9]*$$ ]] && export PRUNE_BACKUPS_DAYS="$$v" ;;
            esac
          done < "$$f"
        fi
        exec /usr/bin/backup loop
    environment:
      BACKUP_INTERVAL: "6h"      # valeurs de repli tant que le fichier n'existe pas
      PRUNE_BACKUPS_DAYS: "7"
```

`$$` est l'échappement de compose. Le script ne fait jamais `source` du fichier : il n'exporte que les deux clés, et seulement si la valeur passe la regex. Une clé absente ou invalide garde la valeur de `environment:`.

### Règles de lecture (identiques dans le backend)

`parseSettingsFile` reproduit exactement le script : découpage sur `\n`, dernier segment non terminé ignoré (comme `read`), clé = texte avant le premier `=`, valeur = reste, aucun rognage d'espace ni de `\r`, mêmes regex, dernière occurrence gagnante. La valeur affichée est donc celle que mc-backup applique.

### Détection du mode géré

`isManaged(entrypoint, cmd)` : `Config.Entrypoint` et `Config.Cmd` du conteneur mc-backup (tableau ou chaîne, éventuellement `null`), concaténés, contiennent `.mc-manager/backup-settings.conf`. Sinon, le fichier est ignoré (le conteneur ne le lit pas), la carte est en lecture seule et propose l'extrait ci-dessus. Si `CRON_SCHEDULE` figure dans `Config.Env`, l'intervalle n'a pas d'effet (mode cron de l'image) : la carte l'indique et la modification est refusée (409 `not_managed`).

### Valeurs effectives

Pour chaque clé : fichier (si géré, présent et valide) → `Config.Env` (`BACKUP_INTERVAL`, à défaut `INTERVAL_SEC`, nom déprécié que l'image lit encore ; `PRUNE_BACKUPS_DAYS`) → défaut de l'image (`24h`, `7`). La source est renvoyée (`file`, `compose`, `default`). Les valeurs sont renvoyées brutes (chaînes) : une valeur du compose peut être `21600` (secondes, accepté par `sleep`) ou hors bornes.

### En attente d'application

`pendingRestart` = géré, fichier présent et `mtime` du fichier > `State.StartedAt` de mc-backup (même hôte, même horloge). Cas typique : écriture réussie mais redémarrage en échec ; le prochain démarrage de mc-backup appliquera le fichier.

## 3. `@mc/common` (`types/backups.ts`)

```ts
export const BACKUP_INTERVAL_MIN_MINUTES = 30;
export const BACKUP_INTERVAL_MAX_MINUTES = 7 * 24 * 60;
export const PRUNE_DAYS_MIN = 1;
export const PRUNE_DAYS_MAX = 365;
export const BACKUP_INTERVAL_UNITS = ['m', 'h', 'd'] as const;
export const BACKUP_SETTINGS_FILE_IN_CONTAINER = '/backups/.mc-manager/backup-settings.conf';
/** Bloc `entrypoint:` de la section 2 (de `entrypoint:` à `exec /usr/bin/backup loop`, indenté de 4 espaces
 *  pour être collé sous le service), affiché et copié par le frontend. */
export const BACKUP_SETTINGS_COMPOSE_SNIPPET: string;

export type BackupSettingSource = 'file' | 'compose' | 'default';
export interface BackupSettings {
  containerFound: boolean;
  running: boolean;
  managed: boolean;
  /** Non nul : planification cron de l'image, l'intervalle ne s'applique pas. */
  cronSchedule: string | null;
  interval: { value: string; source: BackupSettingSource } | null;   // null si conteneur introuvable
  pruneDays: { value: string; source: BackupSettingSource } | null;
  pendingRestart: boolean;
  initialDelay: string;       // INITIAL_DELAY du conteneur ou '2m'
  backupOnStartup: boolean;   // BACKUP_ON_STARTUP du conteneur, vrai par défaut
}
export interface BackupSettingsUpdate { interval: string; pruneDays: number }
export type BackupSettingsErrorCode = 'invalid' | 'not_managed' | 'busy' | 'container_missing' | 'restart_failed';

/** `30m`, `6h`, `7d`, ou nombre nu en secondes (comme `sleep`) → minutes ; null sinon. */
export function intervalToMinutes(value: string): number | null;
```

`AuditAction` reçoit `'backup.settings'`.

## 4. Backend

### `backups/backup-settings.ts` (fonctions pures)

- `SETTINGS_RELATIVE = '.mc-manager/backup-settings.conf'`.
- `isManaged(entrypoint, cmd)`, `parseSettingsFile(text)`, `serializeSettings({ interval, pruneDays })`.
- `validateUpdate(body)` : `interval` chaîne conforme à `^[1-9][0-9]*[mhd]$` et `intervalToMinutes` dans les bornes ; `pruneDays` entier dans les bornes ; aucune autre propriété exigée. Échec : `AppError(400, …, undefined, 'invalid')`.
- `effectiveSettings(file, env)` : priorité et sources de la section 2.

### `backups/backup-settings-service.ts`

`BackupSettingsService(dir, docker: DockerService, lock: DataLock)` :

- `read(): Promise<BackupSettings>` : `docker.inspectBackup()` (absent → `containerFound: false`, reste neutre), lecture du fichier si géré (absent = aucune valeur de fichier ; autre erreur de lecture = avertissement journalisé, même traitement), `stat` pour `pendingRestart`.
- `apply(update, audit)` :
  1. `validateUpdate` → 400 `invalid`.
  2. Inspection : introuvable → 503 `container_missing` ; non géré ou `CRON_SCHEDULE` → 409 `not_managed`.
  3. Valeurs du fichier identiques et rien en attente → renvoie `read()` sans écrire, redémarrer ni auditer.
  4. `lock.acquire('backup-settings')` → 409 `busy` (sauvegarde manuelle, restauration, `server.properties` ou mods en cours).
  5. Sauvegarde de la boucle en cours : si `SKIP_LOCKING` n'est pas vrai et que `<dir>/.mc-backup-lock` existe, exec `flock -n <DEST_DIR>/.mc-backup-lock true` (`DEST_DIR` lu dans `Config.Env`, `/backups` par défaut). Code 1 → 409 `busy`. Autre code ou exception → avertissement journalisé, on continue. Fichier absent → aucune sauvegarde verrouillée n'a jamais tourné, on continue sans exec (l'exec créerait sinon le fichier avec le propriétaire de l'exec, peut-être root, et la boucle ne pourrait plus l'ouvrir).
  6. Écriture atomique du fichier.
  7. `docker.restartBackup()` (`t: 10` ; le processus 1 bash ignore `SIGTERM`, l'arrêt prend donc jusqu'à 10 s). Échec → audit `interval=… pruneDays=… (restart failed)`, 502 `restart_failed`.
  8. Audit `backup.settings` `interval=6h pruneDays=7`, libération du verrou (`finally`), renvoi de `read()`.
- `pruneDaysForExec(): Promise<number | null>` : valeur du fichier si géré et valide, sinon `null` (l'environnement du conteneur suffit). Toute erreur → `null`.

### Modifications ailleurs

- `docker/docker-like.ts` : `Config.Entrypoint?: string[] | string | null`, `Config.Cmd?: string[] | string | null`, `exec` accepte `Env?: string[]`. `fake-docker.ts` : `exec` enregistre `Env`, code de sortie configurable par commande (pour distinguer `flock` et `backup now`), fixture d'inspection avec `Entrypoint`/`Cmd`.
- `docker/docker-service.ts` : `inspectBackup()` → `{ env, entrypoint, cmd, startedAt, running } | null` (`backupEnv()` s'appuie dessus), `restartBackup()` (503 `container_missing` si introuvable), `execBackup(cmd, env?)`.
- `data/data-lock.ts` : `DataOp` reçoit `'backup-settings'` ; commentaire élargi (le verrou couvre aussi le redémarrage de mc-backup).
- `backups/backup-service.ts` : dépendance facultative `pruneDays: () => Promise<number | null>` ; `runNow()` passe `Env: ['PRUNE_BACKUPS_DAYS=N']` quand elle renvoie un nombre. Couvre la sauvegarde de sécurité de la restauration (`runNow({ lockHeld: true })`).
- `routes/backups.routes.ts` : `GET /settings` (tous rôles, comme la liste) ; `PUT /settings` (`requireRole('admin')`, corps `BackupSettingsUpdate`, l'audit passe en rappel au service).
- `index.ts` : création du service après `BackupService`, branché sur `pruneDays`, exposé en `app.locals.backupSettings` (déclaration de type de `app.locals` mise à jour).
- Pas de message WebSocket.

## 5. Frontend

- `api/backups.api.ts` : `settings()`, `updateSettings(body)`.
- `components/backups/BackupScheduleCard.tsx`, sur la page Sauvegardes entre l'en-tête (et le bandeau de restauration interrompue) et le panneau de sortie. Query `['backups', 'settings']`, sans `refetchInterval` (déjà invalidée à chaque reconnexion par le préfixe `backups`).
  - Lecture (tous rôles) : « Sauvegarde automatique toutes les 6 heures · conservées 7 jours », mention « (compose) » ou « (défaut de l'image) » si la source n'est pas le fichier ; valeur non reconnue affichée telle quelle. Conteneur introuvable, mc-backup arrêté et mode cron ont chacun leur message.
  - Admin, géré : bouton « Modifier » → formulaire dans la carte : nombre + unité (minutes, heures, jours) pour l'intervalle, nombre de jours pour la rétention. Préremplissage depuis la valeur actuelle (`intervalToMinutes`, convertie dans la plus grande unité exacte). Validation par les bornes de `@mc/common`, message sous le champ fautif, bouton « Appliquer » désactivé tant que c'est invalide ou inchangé.
  - « Appliquer » ouvre un `ConfirmDialog` : mc-backup va redémarrer ; prochaine sauvegarde dans `initialDelay` puis toutes les N (ou, si `backupOnStartup` est faux, dans `initialDelay` + l'intervalle). Le succès remplace le cache par l'état renvoyé et ferme le formulaire.
  - Désactivé pendant une sauvegarde ou une restauration (même `busy` que « Sauvegarder maintenant »), le backend revérifie.
  - `pendingRestart` : bandeau ambre « Réglages enregistrés mais pas encore appliqués », bouton « Réessayer » (admin) qui renvoie les valeurs du fichier.
  - Admin, non géré : bandeau sur le modèle de `SourceBanner` (mods) avec explication, extrait `BACKUP_SETTINGS_COMPOSE_SNIPPET` dans un `<pre>` défilant et bouton copier. Les viewers ne voient que les valeurs.
  - Erreurs traduites par `code` (`components/backups/backup-settings-errors.ts`, sur le modèle de `mods-errors.ts`).
  - Responsive : `flex-wrap`, champs `w-full sm:w-*`.
- i18n : fragment `scripts/i18n-fragments/backup-settings.json` (carte, formulaire, confirmation, erreurs, libellé de l'action d'audit `backup.settings`), puis `merge-i18n.mjs`.

## 6. Sécurité

- Le script du compose n'exécute jamais le contenu du fichier : deux clés, regex strictes, `export` d'une valeur déjà validée.
- Le backend n'écrit que des valeurs validées (`validateUpdate`), jamais de texte fourni tel quel.
- Le fichier vit dans le volume des backups, que le conteneur Minecraft (et ses mods ou plugins) ne monte pas.
- Écriture et redémarrage : admin uniquement, audités (`backup.settings`), sous `DataLock`.
- Seule action Docker ajoutée : `restart` de mc-backup. Aucun conteneur créé ou supprimé.
- Nouvelle écriture hors `/data` : `.mc-manager/backup-settings.conf` (et son fichier temporaire) dans le volume des backups. À ajouter aux invariants de `CLAUDE.md`.

## 7. Tests

Backend (vitest, fakes, dossiers temporaires) :

- `backup-settings.test.ts` : analyse du fichier (clés inconnues, valeur invalide, une seule clé, `\r` rejeté, dernière ligne non terminée ignorée, doublon) ; `isManaged` (tableau, chaîne, `null`, chemin absent) ; priorité fichier > compose > défaut, `INTERVAL_SEC` ; bornes (`29m` refusé, `30m`, `7d` acceptés, `8d`, `0h`, `6` refusés ; rétention `0`, `366`, `1.5` refusées) ; l'extrait de compose contient le chemin et les deux regex de `parseSettingsFile`.
- `backup-settings-service.test.ts` : écriture atomique puis `restart:10` et audit ; valeurs identiques → aucune action ; `flock` qui renvoie 1 → 409 `busy`, fichier inchangé, pas de redémarrage ; `flock` en échec (127) → on continue ; fichier de verrou absent → pas d'exec ; `SKIP_LOCKING=true` → pas d'exec ; `DataLock` pris → 409 ; non géré, `CRON_SCHEDULE` → 409 `not_managed` ; conteneur absent → 503 ; redémarrage en échec → 502 `restart_failed` et `pendingRestart` vrai ; verrou toujours libéré.
- `backup-service.test.ts` : `runNow()` passe `PRUNE_BACKUPS_DAYS` dans l'exec quand `pruneDays()` renvoie un nombre, rien sinon.
- Routes : `GET /api/backups/settings` 200 pour un viewer, `PUT` 403 pour un viewer, 400 sur corps invalide, audit écrit.

Frontend : `BackupScheduleCard` (admin géré : formulaire, validation, confirmation, appel et mise à jour ; viewer : lecture seule ; non géré : extrait visible pour l'admin seulement ; `pendingRestart` ; conteneur absent ; erreur traduite par code).

## 8. Documentation

- `docker-compose.example.yml` : point d'entrée de la section 2 sur `mc-backup`, valeurs actuelles gardées en repli.
- README : section « Planification des sauvegardes » (modification du compose, redémarrage de mc-backup à chaque application, sauvegarde environ `INITIAL_DELAY` après, cas `CRON_SCHEDULE`).
- `CLAUDE.md` : architecture backend (service, fichier, détection, `flock`, Env de `backup now`), frontend (carte), invariants de sécurité (section 6).

## 9. À vérifier en conditions réelles

- Le point d'entrée sur le vrai mc-backup : démarrage normal, valeurs prises en compte (`docker exec mc-backup cat /proc/1/environ | tr '\0' '\n' | grep -E 'BACKUP_INTERVAL|PRUNE'`, ou la ligne « sleeping 6h... » des logs).
- `flock -n` pendant une vraie sauvegarde (code 1 attendu) et hors sauvegarde (code 0).
- La sauvegarde lancée environ 2 minutes après l'application, puis l'intervalle respecté.
- Une sauvegarde manuelle qui nettoie avec la rétention du fichier.

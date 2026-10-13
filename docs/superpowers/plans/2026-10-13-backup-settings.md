# Planification des sauvegardes depuis l'interface — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Régler depuis la page Sauvegardes l'intervalle (`BACKUP_INTERVAL`) et la rétention (`PRUNE_BACKUPS_DAYS`) du conteneur `itzg/mc-backup`, en écrivant un fichier que son point d'entrée lit à chaque démarrage, puis en le redémarrant.

**Architecture:** MC Manager écrit `<MC_BACKUPS_DIR>/.mc-manager/backup-settings.conf` (deux lignes `CLÉ=valeur` validées), sous `DataLock`, puis redémarre mc-backup. Le compose de mc-backup reçoit une fois un `entrypoint` bash qui lit ce fichier sans l'exécuter et exporte les deux variables avant `exec /usr/bin/backup loop`. Le backend relit le fichier avec les mêmes règles que ce script, détecte le mode « géré » à partir de `Config.Entrypoint`/`Config.Cmd`, refuse de redémarrer pendant une sauvegarde (`flock -n` sur `.mc-backup-lock`) et passe la rétention dans l'environnement des `backup now`.

**Tech Stack:** Node 22, TypeScript 5.9, Express, dockerode (via `DockerLike`), vitest + supertest ; React 18, TanStack Query, shadcn/ui, i18next ; pnpm 9 monorepo (`@mc/common`, `@mc/backend`, `@mc/frontend`).

**Spec:** `docs/superpowers/specs/2026-10-13-mc-manager-backup-settings-design.md`

## Global Constraints

- Travail sur la branche `feat/backup-settings` (déjà créée, contient la spec). Ne pas pousser.
- Avant tout typecheck ou test : `pnpm db:generate` une fois, puis `pnpm --filter @mc/common run build` **après chaque modification de `@mc/common`** (backend et frontend importent son `dist/`).
- Commentaires de code en français, identifiants et messages d'erreur d'API en anglais (comme le reste du dépôt).
- Ne jamais éditer `fr.json` / `en.json` à la main : fragment dans `packages/frontend/scripts/i18n-fragments/`, puis `node packages/frontend/scripts/merge-i18n.mjs`.
- Fichier côté backend : `<MC_BACKUPS_DIR>/.mc-manager/backup-settings.conf` ; côté conteneur : `/backups/.mc-manager/backup-settings.conf`.
- Regex du fichier (backend ET script du compose) : intervalle `^[1-9][0-9]*[mhd]$`, rétention `^[1-9][0-9]*$`.
- Bornes d'écriture : intervalle de 30 minutes à 7 jours (10 080 minutes), unités `m`, `h`, `d` ; rétention entière de 1 à 365 jours.
- Défauts de l'image : `BACKUP_INTERVAL` = `INTERVAL_SEC` sinon `24h` ; `PRUNE_BACKUPS_DAYS` = `7` ; `INITIAL_DELAY` = `2m` ; `BACKUP_ON_STARTUP` vrai sauf `false` (insensible à la casse) ; `DEST_DIR` = `/backups` ; `SKIP_LOCKING` vrai seulement si `true` (insensible à la casse) ; `CRON_SCHEDULE` présent (même vide) = mode cron.
- Redémarrage de mc-backup avec `t: 10`. Seule action Docker ajoutée : `restart` de mc-backup ; jamais de création ni de suppression de conteneur.
- Audit : action `backup.settings`, détail `interval=<valeur> pruneDays=<n>`, suffixé ` (restart failed)` si le redémarrage échoue.
- Codes d'erreur stables : `invalid` (400), `not_managed` (409), `busy` (409), `container_missing` (503), `restart_failed` (502).
- Commits : messages en français au format `type(portée): …`, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Deux admins appliquent en même temps : le second reçoit 409 `busy`, un seul redémarrage a lieu (test ajouté à la tâche 3).
- Écriture du fichier impossible (dossier non inscriptible, `.mc-manager` occupé par un fichier) : erreur claire, verrou libéré, aucun redémarrage (test ajouté à la tâche 3).
- Valeur atypique du compose (`21600` secondes, `1.5h`) : affichée lisiblement ou telle quelle, formulaire prérempli seulement si convertible (tests ajoutés aux tâches 5 et 6).
- Redémarrage long (jusqu'à 10 s) : la fenêtre de confirmation reste ouverte en « traitement », pas de double envoi (test ajouté à la tâche 6).
- Extrait de compose copié par l'utilisateur : il doit être identique à `docker-compose.example.yml` et au README, `$$` compris (test ajouté à la tâche 7, plus `docker compose config`).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `packages/common/src/types/backups.ts` (modifié) | Bornes, regex, chemin, extrait de compose, types `BackupSettings*`, `intervalToMinutes` |
| `packages/common/src/types/audit.ts` (modifié) | `AuditAction` + `'backup.settings'` |
| `packages/backend/src/backups/backup-settings.ts` (créé) | Fonctions pures : détection, lecture, sérialisation, validation, valeurs effectives |
| `packages/backend/src/backups/backup-settings.test.ts` (créé) | Tests des fonctions pures |
| `packages/backend/src/docker/docker-like.ts` (modifié) | `Config.Entrypoint`/`Cmd`, `Env` d'exec |
| `packages/backend/src/docker/fake-docker.ts` (modifié) | `execEnvs`, `execReply`, fixture `Entrypoint`/`Cmd` |
| `packages/backend/src/docker/docker-service.ts` (modifié) | `inspectBackup`, `restartBackup`, `execBackup(cmd, env?)` |
| `packages/backend/src/data/data-lock.ts` (modifié) | `DataOp` + `'backup-settings'` |
| `packages/backend/src/backups/backup-settings-service.ts` (créé) | `read`, `apply`, `pruneDaysForExec` |
| `packages/backend/src/backups/backup-settings-service.test.ts` (créé) | Tests du service |
| `packages/backend/src/backups/backup-service.ts` (modifié) | `pruneDays` injecté, `Env` de `backup now` |
| `packages/backend/src/routes/backups.routes.ts` (modifié) | `GET/PUT /api/backups/settings` |
| `packages/backend/src/index.ts` (modifié) | Câblage |
| `packages/frontend/src/api/backups.api.ts` (modifié) | `settings`, `updateSettings` |
| `packages/frontend/src/components/backups/interval.ts` (créé) | `UNIT_MINUTES`, `splitInterval` |
| `packages/frontend/src/components/backups/backup-settings-errors.ts` (créé) | Traduction des codes d'erreur |
| `packages/frontend/src/components/backups/BackupScheduleCard.tsx` (créé) | Carte de planification |
| `packages/frontend/scripts/i18n-fragments/backup-settings.json` (créé) | Textes en/fr |
| `packages/frontend/src/pages/Backups.tsx` (modifié) | Intégration de la carte |
| `docker-compose.example.yml`, `README.md` (modifiés) | Documentation utilisateur |
| `CLAUDE.md` (modifié, **non suivi par git** : ignoré par le gitignore global de l'utilisateur) | Documentation agent |

---

### Task 1: Catalogue partagé et fonctions pures

**Files:**
- Modify: `packages/common/src/types/backups.ts`
- Modify: `packages/common/src/types/audit.ts:3`
- Create: `packages/backend/src/backups/backup-settings.ts`
- Test: `packages/backend/src/backups/backup-settings.test.ts`

**Interfaces:**
- Consumes: `envMap(env: string[]): Map<string, string>` de `packages/backend/src/mods/server-type.ts` ; `AppError(statusCode, message, details?, code?)` de `packages/backend/src/middleware/error-handler.ts`.
- Produces (`@mc/common`) : `BACKUP_INTERVAL_MIN_MINUTES`, `BACKUP_INTERVAL_MAX_MINUTES`, `PRUNE_DAYS_MIN`, `PRUNE_DAYS_MAX`, `BACKUP_INTERVAL_UNITS`, `type BackupIntervalUnit`, `BACKUP_SETTINGS_FILE_IN_CONTAINER`, `BACKUP_INTERVAL_FILE_RE`, `PRUNE_DAYS_FILE_RE`, `BACKUP_SETTINGS_COMPOSE_SNIPPET`, `type BackupSettingSource`, `interface BackupSettingValue { value: string; source: BackupSettingSource }`, `interface BackupSettings`, `interface BackupSettingsUpdate { interval: string; pruneDays: number }`, `type BackupSettingsErrorCode`, `intervalToMinutes(value: string): number | null`, `AuditAction` incluant `'backup.settings'`.
- Produces (backend, `backups/backup-settings.ts`) : `SETTINGS_RELATIVE = '.mc-manager/backup-settings.conf'`, `type CmdLike = string[] | string | null | undefined`, `interface SettingsFileValues { interval?: string; pruneDays?: string }`, `isManaged(entrypoint: CmdLike, cmd: CmdLike): boolean`, `parseSettingsFile(text: string): SettingsFileValues`, `serializeSettings(s: BackupSettingsUpdate): string`, `validateUpdate(body: unknown): BackupSettingsUpdate`, `effectiveSettings(file: SettingsFileValues, env: string[]): { interval: BackupSettingValue; pruneDays: BackupSettingValue }`.

- [ ] **Step 1: Ajouter le catalogue à `@mc/common`**

Ajouter à la fin de `packages/common/src/types/backups.ts` :

```ts
/** Bornes de l'intervalle entre deux sauvegardes réglable depuis l'interface, en minutes (30 min à 7 jours). */
export const BACKUP_INTERVAL_MIN_MINUTES = 30;
export const BACKUP_INTERVAL_MAX_MINUTES = 7 * 24 * 60;
/** Bornes de la rétention (PRUNE_BACKUPS_DAYS) : 0, « ne jamais supprimer », est refusé. */
export const PRUNE_DAYS_MIN = 1;
export const PRUNE_DAYS_MAX = 365;
export const BACKUP_INTERVAL_UNITS = ['m', 'h', 'd'] as const;
export type BackupIntervalUnit = (typeof BACKUP_INTERVAL_UNITS)[number];

/** Fichier de réglages tel que mc-backup le voit (volume des backups monté sur /backups). */
export const BACKUP_SETTINGS_FILE_IN_CONTAINER = '/backups/.mc-manager/backup-settings.conf';
/** Valeurs acceptées par le point d'entrée du compose ; le backend relit le fichier avec les mêmes regex. */
export const BACKUP_INTERVAL_FILE_RE = /^[1-9][0-9]*[mhd]$/;
export const PRUNE_DAYS_FILE_RE = /^[1-9][0-9]*$/;

/**
 * Bloc `entrypoint:` à coller sous le service mc-backup (indenté de 4 espaces). Ne fait jamais `source` du
 * fichier : seules deux clés sont exportées, après validation. `$$` est l'échappement de compose.
 */
export const BACKUP_SETTINGS_COMPOSE_SNIPPET = [
  '    entrypoint:',
  '      - /bin/bash',
  '      - -c',
  '      - |',
  `        f=${BACKUP_SETTINGS_FILE_IN_CONTAINER}`,
  '        if [ -r "$$f" ]; then',
  "          while IFS='=' read -r k v; do",
  '            case "$$k" in',
  '              BACKUP_INTERVAL) [[ "$$v" =~ ^[1-9][0-9]*[mhd]$$ ]] && export BACKUP_INTERVAL="$$v" ;;',
  '              PRUNE_BACKUPS_DAYS) [[ "$$v" =~ ^[1-9][0-9]*$$ ]] && export PRUNE_BACKUPS_DAYS="$$v" ;;',
  '            esac',
  '          done < "$$f"',
  '        fi',
  '        exec /usr/bin/backup loop',
].join('\n');

export type BackupSettingSource = 'file' | 'compose' | 'default';
export interface BackupSettingValue { value: string; source: BackupSettingSource }
export interface BackupSettings {
  containerFound: boolean;
  running: boolean;
  /** Le point d'entrée de mc-backup lit le fichier de réglages : modification possible depuis l'interface. */
  managed: boolean;
  /** Non nul : planification cron de l'image, l'intervalle ne s'applique pas. */
  cronSchedule: string | null;
  /** Valeurs brutes telles que mc-backup les voit ; null si le conteneur est introuvable. */
  interval: BackupSettingValue | null;
  pruneDays: BackupSettingValue | null;
  /** Fichier modifié après le dernier démarrage de mc-backup : pas encore appliqué. */
  pendingRestart: boolean;
  initialDelay: string;
  backupOnStartup: boolean;
}
export interface BackupSettingsUpdate { interval: string; pruneDays: number }
export type BackupSettingsErrorCode = 'invalid' | 'not_managed' | 'busy' | 'container_missing' | 'restart_failed';

const UNIT_TO_MINUTES: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1440 };
/** `30m`, `6h`, `7d`, `90s` ou nombre nu en secondes (comme `sleep`) → minutes ; null si non reconnu. */
export function intervalToMinutes(value: string): number | null {
  const m = /^(\d+)([smhd]?)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * UNIT_TO_MINUTES[m[2] || 's'];
}
```

Dans `packages/common/src/types/audit.ts`, ligne 3, remplacer `| 'backup.run' | 'backup.delete' | 'backup.download'` par `| 'backup.run' | 'backup.delete' | 'backup.download' | 'backup.settings'`.

Run: `pnpm --filter @mc/common run build`
Expected: aucune erreur.

- [ ] **Step 2: Écrire les tests des fonctions pures**

Créer `packages/backend/src/backups/backup-settings.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { BACKUP_INTERVAL_FILE_RE, BACKUP_SETTINGS_COMPOSE_SNIPPET, PRUNE_DAYS_FILE_RE, intervalToMinutes } from '@mc/common';
import { SETTINGS_RELATIVE, effectiveSettings, isManaged, parseSettingsFile, serializeSettings, validateUpdate } from './backup-settings.js';

const EP = ['/bin/bash', '-c', 'f=/backups/.mc-manager/backup-settings.conf\nexec /usr/bin/backup loop'];
/** Erreur levée par fn (toThrow ne compare pas les propriétés statusCode/code). */
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } return undefined; };

describe('intervalToMinutes', () => {
  it.each<[string, number]>([['30m', 30], ['6h', 360], ['7d', 10080], ['90s', 1.5], ['21600', 360]])('%s → %d', (v, n) => expect(intervalToMinutes(v)).toBe(n));
  it.each(['', '1.5h', '6 h', '-1h', 'h', '6w'])('rejects %j', (v) => expect(intervalToMinutes(v)).toBeNull());
});

describe('isManaged', () => {
  it('detects the settings path in an array entrypoint', () => expect(isManaged(EP, null)).toBe(true));
  it('detects it in a string entrypoint or in cmd', () => {
    expect(isManaged(EP.join(' '), undefined)).toBe(true);
    expect(isManaged(null, ['bash', '-c', 'cat /srv/b/.mc-manager/backup-settings.conf'])).toBe(true);
  });
  it('is false for the default image entrypoint', () => {
    expect(isManaged(['/usr/bin/backup'], ['loop'])).toBe(false);
    expect(isManaged(null, null)).toBe(false);
  });
});

describe('parseSettingsFile', () => {
  it('reads both keys', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\nPRUNE_BACKUPS_DAYS=7\n')).toEqual({ interval: '6h', pruneDays: '7' }));
  it('ignores unknown keys, invalid values and spaces like the compose script', () => {
    expect(parseSettingsFile('FOO=1\nBACKUP_INTERVAL=0h\nPRUNE_BACKUPS_DAYS= 7\nBACKUP_INTERVAL =6h\n')).toEqual({});
  });
  it('keeps a single valid key', () => expect(parseSettingsFile('PRUNE_BACKUPS_DAYS=14\n')).toEqual({ pruneDays: '14' }));
  it('rejects a CRLF value (read keeps the \\r)', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\r\n')).toEqual({}));
  it('ignores a last line without newline (read returns non-zero)', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\nPRUNE_BACKUPS_DAYS=7')).toEqual({ interval: '6h' }));
  it('keeps the last occurrence', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\nBACKUP_INTERVAL=12h\n')).toEqual({ interval: '12h' }));
  it('rejects shell injection attempts', () => expect(parseSettingsFile('BACKUP_INTERVAL=a[$(id)]\nPRUNE_BACKUPS_DAYS=$(id)\n')).toEqual({}));
  it('round-trips serializeSettings', () => expect(parseSettingsFile(serializeSettings({ interval: '6h', pruneDays: 7 }))).toEqual({ interval: '6h', pruneDays: '7' }));
});

describe('serializeSettings', () => {
  it('writes two LF-terminated lines', () => expect(serializeSettings({ interval: '30m', pruneDays: 365 })).toBe('BACKUP_INTERVAL=30m\nPRUNE_BACKUPS_DAYS=365\n'));
});

describe('validateUpdate', () => {
  it.each([[{ interval: '30m', pruneDays: 1 }], [{ interval: '7d', pruneDays: 365 }], [{ interval: '6h', pruneDays: 7 }]])('accepts %j', (b) => expect(validateUpdate(b)).toEqual(b));
  it.each([
    [{ interval: '29m', pruneDays: 7 }], [{ interval: '8d', pruneDays: 7 }], [{ interval: '0h', pruneDays: 7 }],
    [{ interval: '6', pruneDays: 7 }], [{ interval: 6, pruneDays: 7 }], [{ interval: '06h', pruneDays: 7 }],
    [{ interval: '6h', pruneDays: 0 }], [{ interval: '6h', pruneDays: 366 }], [{ interval: '6h', pruneDays: 1.5 }],
    [{ interval: '6h', pruneDays: '7' }], [{ interval: '6h' }], [null],
  ])('rejects %j with 400 invalid', (b) => {
    expect(thrown(() => validateUpdate(b))).toMatchObject({ statusCode: 400, code: 'invalid' });
  });
  it('returns only the two known fields', () => expect(validateUpdate({ interval: '6h', pruneDays: 7, extra: 1 })).toEqual({ interval: '6h', pruneDays: 7 }));
});

describe('effectiveSettings', () => {
  it('prefers the file, then the compose, then the image defaults', () => {
    expect(effectiveSettings({ interval: '12h' }, ['BACKUP_INTERVAL=6h', 'PRUNE_BACKUPS_DAYS=5'])).toEqual({
      interval: { value: '12h', source: 'file' }, pruneDays: { value: '5', source: 'compose' },
    });
    expect(effectiveSettings({}, [])).toEqual({ interval: { value: '24h', source: 'default' }, pruneDays: { value: '7', source: 'default' } });
  });
  it('falls back to INTERVAL_SEC and treats empty values as unset (":=" in the image)', () => {
    expect(effectiveSettings({}, ['BACKUP_INTERVAL=', 'INTERVAL_SEC=3600']).interval).toEqual({ value: '3600', source: 'compose' });
    expect(effectiveSettings({}, ['PRUNE_BACKUPS_DAYS=']).pruneDays).toEqual({ value: '7', source: 'default' });
  });
});

describe('compose snippet', () => {
  const inCompose = (re: RegExp) => `${re.source.slice(0, -1)}$$`;
  it('reads the settings file with the backend regexes', () => {
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).toContain(SETTINGS_RELATIVE);
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).toContain(`BACKUP_INTERVAL) [[ "$$v" =~ ${inCompose(BACKUP_INTERVAL_FILE_RE)} ]]`);
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).toContain(`PRUNE_BACKUPS_DAYS) [[ "$$v" =~ ${inCompose(PRUNE_DAYS_FILE_RE)} ]]`);
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).not.toMatch(/\bsource\b|^\s*\.\s/m);
  });
  it('is detected as managed once installed', () => expect(isManaged(BACKUP_SETTINGS_COMPOSE_SNIPPET, null)).toBe(true));
});
```

- [ ] **Step 3: Lancer les tests et constater l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-settings.test.ts`
Expected: FAIL (`Cannot find module './backup-settings.js'` ou équivalent).

- [ ] **Step 4: Implémenter `backups/backup-settings.ts`**

```ts
import { BACKUP_INTERVAL_FILE_RE, BACKUP_INTERVAL_MAX_MINUTES, BACKUP_INTERVAL_MIN_MINUTES, PRUNE_DAYS_FILE_RE, PRUNE_DAYS_MAX, PRUNE_DAYS_MIN, intervalToMinutes } from '@mc/common';
import type { BackupSettingValue, BackupSettingsUpdate } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';
import { envMap } from '../mods/server-type.js';

/** Fichier de réglages lu par le point d'entrée de mc-backup, relatif au dossier des backups. */
export const SETTINGS_RELATIVE = '.mc-manager/backup-settings.conf';
const DEFAULT_INTERVAL = '24h';
const DEFAULT_PRUNE_DAYS = '7';

export type CmdLike = string[] | string | null | undefined;
export interface SettingsFileValues { interval?: string; pruneDays?: string }

const asText = (v: CmdLike): string => (Array.isArray(v) ? v.join(' ') : v ?? '');

/** Le point d'entrée (ou la commande) de mc-backup lit notre fichier : l'extrait de compose est installé. */
export function isManaged(entrypoint: CmdLike, cmd: CmdLike): boolean {
  return `${asText(entrypoint)} ${asText(cmd)}`.includes(SETTINGS_RELATIVE);
}

/**
 * Relit le fichier exactement comme le `while IFS='=' read -r k v` du compose : seules les lignes terminées
 * par \n comptent, clé avant le premier `=`, aucun rognage (ni espace ni \r), mêmes regex, dernière occurrence gagnante.
 */
export function parseSettingsFile(text: string): SettingsFileValues {
  const out: SettingsFileValues = {};
  for (const line of text.split('\n').slice(0, -1)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (k === 'BACKUP_INTERVAL' && BACKUP_INTERVAL_FILE_RE.test(v)) out.interval = v;
    if (k === 'PRUNE_BACKUPS_DAYS' && PRUNE_DAYS_FILE_RE.test(v)) out.pruneDays = v;
  }
  return out;
}

export function serializeSettings(s: BackupSettingsUpdate): string {
  return `BACKUP_INTERVAL=${s.interval}\nPRUNE_BACKUPS_DAYS=${s.pruneDays}\n`;
}

function invalid(message: string): never { throw new AppError(400, message, undefined, 'invalid'); }

/** Contrôle le corps de PUT /api/backups/settings et n'en garde que les deux champs connus. */
export function validateUpdate(body: unknown): BackupSettingsUpdate {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { interval, pruneDays } = b;
  if (typeof interval !== 'string' || !BACKUP_INTERVAL_FILE_RE.test(interval)) invalid('interval must look like 30m, 6h or 2d');
  const minutes = intervalToMinutes(interval) ?? 0;
  if (minutes < BACKUP_INTERVAL_MIN_MINUTES || minutes > BACKUP_INTERVAL_MAX_MINUTES) {
    invalid(`interval must be between ${BACKUP_INTERVAL_MIN_MINUTES} minutes and ${BACKUP_INTERVAL_MAX_MINUTES / 1440} days`);
  }
  if (typeof pruneDays !== 'number' || !Number.isInteger(pruneDays) || pruneDays < PRUNE_DAYS_MIN || pruneDays > PRUNE_DAYS_MAX) {
    invalid(`pruneDays must be an integer between ${PRUNE_DAYS_MIN} and ${PRUNE_DAYS_MAX}`);
  }
  return { interval, pruneDays };
}

const nonEmpty = (v: string | undefined): string | undefined => (v ? v : undefined);

/** Valeurs effectives : fichier (déjà filtré par parseSettingsFile) → environnement du conteneur → défauts de l'image. */
export function effectiveSettings(file: SettingsFileValues, env: string[]): { interval: BackupSettingValue; pruneDays: BackupSettingValue } {
  const vars = envMap(env);
  const pick = (fromFile: string | undefined, fromEnv: string | undefined, def: string): BackupSettingValue => {
    if (fromFile !== undefined) return { value: fromFile, source: 'file' };
    if (fromEnv !== undefined) return { value: fromEnv, source: 'compose' };
    return { value: def, source: 'default' };
  };
  return {
    // Comme l'image : BACKUP_INTERVAL:=${INTERVAL_SEC:-24h}, une valeur vide vaut absente.
    interval: pick(file.interval, nonEmpty(vars.get('BACKUP_INTERVAL')) ?? nonEmpty(vars.get('INTERVAL_SEC')), DEFAULT_INTERVAL),
    pruneDays: pick(file.pruneDays, nonEmpty(vars.get('PRUNE_BACKUPS_DAYS')), DEFAULT_PRUNE_DAYS),
  };
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-settings.test.ts`
Expected: PASS (tous les tests).

- [ ] **Step 6: Typecheck et commit**

Run: `pnpm --filter @mc/backend run typecheck`
Expected: aucune erreur.

```bash
git add packages/common/src/types/backups.ts packages/common/src/types/audit.ts packages/backend/src/backups/backup-settings.ts packages/backend/src/backups/backup-settings.test.ts
git commit -m "feat(backups): catalogue et lecture du fichier de réglages de mc-backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Couche Docker (inspection, redémarrage et environnement d'exec de mc-backup)

**Files:**
- Modify: `packages/backend/src/docker/docker-like.ts:6,25`
- Modify: `packages/backend/src/docker/fake-docker.ts`
- Modify: `packages/backend/src/docker/docker-service.ts:62-68,236-249`
- Test: `packages/backend/src/docker/docker-service.test.ts`

**Interfaces:**
- Consumes: rien des autres tâches.
- Produces:
  - `ContainerInspect.Config.Entrypoint?: string[] | string | null`, `ContainerInspect.Config.Cmd?: string[] | string | null` ; `ContainerLike.exec(opts: { Cmd: string[]; Env?: string[]; AttachStdout: true; AttachStderr: true })`.
  - `interface BackupContainerInfo { env: string[]; entrypoint: string[] | string | null; cmd: string[] | string | null; startedAt: string | null; running: boolean }` exportée de `docker-service.ts`.
  - `DockerService.inspectBackup(): Promise<BackupContainerInfo | null>`, `DockerService.restartBackup(): Promise<void>` (503 code `container_missing` si absent, `restart({ t: 10 })`), `DockerService.execBackup(cmd: string[], env?: string[])`.
  - `FakeContainer.execEnvs: (string[] | undefined)[]`, `FakeContainer.execReply?: (cmd: string[]) => { exit: number; output?: string } | undefined` (réponse immédiate, flux déjà terminé), `inspectFixture({ ..., Entrypoint?, Cmd? })`.

- [ ] **Step 1: Écrire les tests**

Ajouter à la fin du `describe` principal de `packages/backend/src/docker/docker-service.test.ts` (les imports `FakeDocker`, `FakeContainer`, `inspectFixture`, `DockerService` et `PassThrough` y sont déjà) :

```ts
  it('inspectBackup returns env, entrypoint, cmd, start time and running flag; null when missing', async () => {
    const docker = new FakeDocker();
    const svc = new DockerService(docker, 'mc', 'b');
    expect(await svc.inspectBackup()).toBeNull();
    docker.containers.set('b', new FakeContainer(inspectFixture({ Env: ['A=1'], Entrypoint: ['/bin/bash', '-c', 'x'], Cmd: null, StartedAt: '2026-10-13T10:00:00Z' })));
    expect(await svc.inspectBackup()).toEqual({ env: ['A=1'], entrypoint: ['/bin/bash', '-c', 'x'], cmd: null, startedAt: '2026-10-13T10:00:00Z', running: true });
    expect(await svc.backupEnv()).toEqual(['A=1']);
  });

  it('restartBackup restarts mc-backup with t=10, and is 503 container_missing when it does not exist', async () => {
    const docker = new FakeDocker();
    const svc = new DockerService(docker, 'mc', 'b');
    await expect(svc.restartBackup()).rejects.toMatchObject({ statusCode: 503, code: 'container_missing' });
    const b = new FakeContainer(inspectFixture());
    docker.containers.set('b', b);
    await svc.restartBackup();
    expect(b.calls).toEqual(['restart:10']);
  });

  it('execBackup forwards the environment when given', async () => {
    const docker = new FakeDocker();
    const b = new FakeContainer(inspectFixture());
    b.execReply = () => ({ exit: 0 });
    docker.containers.set('b', b);
    const svc = new DockerService(docker, 'mc', 'b');
    await svc.execBackup(['backup', 'now'], ['PRUNE_BACKUPS_DAYS=14']);
    await svc.execBackup(['backup', 'now']);
    expect(b.execEnvs).toEqual([['PRUNE_BACKUPS_DAYS=14'], undefined]);
  });

  it('a FakeContainer execReply answers with an ended stream and its exit code', async () => {
    const docker = new FakeDocker();
    const b = new FakeContainer(inspectFixture());
    b.execReply = (cmd) => (cmd[0] === 'flock' ? { exit: 1 } : undefined);
    docker.containers.set('b', b);
    const r = await new DockerService(docker, 'mc', 'b').execBackup(['flock', '-n', '/backups/.mc-backup-lock', 'true']);
    r.stream.resume();
    expect(await r.wait()).toBe(1);
  });
```

- [ ] **Step 2: Lancer les tests et constater l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/docker/docker-service.test.ts`
Expected: FAIL (`svc.inspectBackup is not a function`, erreurs de type sur `Entrypoint`/`execReply`).

- [ ] **Step 3: Étendre `DockerLike`**

Dans `packages/backend/src/docker/docker-like.ts`, remplacer la ligne `Config` de `ContainerInspect` par :

```ts
  Config: { Tty: boolean; Image: string; Labels?: Record<string, string>; Env?: string[]; Entrypoint?: string[] | string | null; Cmd?: string[] | string | null };
```

et la signature `exec` de `ContainerLike` par :

```ts
  exec(opts: { Cmd: string[]; Env?: string[]; AttachStdout: true; AttachStderr: true }): Promise<{ start(opts: object): Promise<Readable>; inspect(): Promise<{ ExitCode: number | null; Running: boolean }> }>;
```

- [ ] **Step 4: Étendre le fake**

Dans `packages/backend/src/docker/fake-docker.ts`, remplacer la méthode `exec` de `FakeContainer` par :

```ts
  /** Environnement passé à chaque exec, dans l'ordre (undefined si aucun). */
  execEnvs: (string[] | undefined)[] = [];
  /** Réponse immédiate par commande (flux déjà terminé) ; undefined = comportement par défaut (execStream, execExit). */
  execReply?: (cmd: string[]) => { exit: number; output?: string } | undefined;
  async exec(opts: { Cmd: string[]; Env?: string[] }) {
    this.calls.push(`exec:${opts.Cmd.join(' ')}`);
    this.execEnvs.push(opts.Env);
    const reply = this.execReply?.(opts.Cmd);
    if (reply) {
      const s = new PassThrough();
      s.end(reply.output ?? '');
      return { start: async () => s as unknown as Readable, inspect: async () => ({ ExitCode: reply.exit, Running: false }) };
    }
    return { start: async () => this.execStream as unknown as Readable, inspect: async () => ({ ExitCode: this.execExit, Running: false }) };
  }
```

et `inspectFixture` par :

```ts
export function inspectFixture(over: Partial<ContainerInspect['State']> & { Tty?: boolean; Env?: string[]; Entrypoint?: string[] | string | null; Cmd?: string[] | string | null } = {}): ContainerInspect {
  const { Tty = false, Env = [], Entrypoint, Cmd, ...state } = over;
  return {
    Id: 'abc', Name: '/mc',
    Config: { Tty, Image: 'itzg/minecraft-server:latest', Env, ...(Entrypoint !== undefined ? { Entrypoint } : {}), ...(Cmd !== undefined ? { Cmd } : {}) },
    State: { Status: 'running', Running: true, StartedAt: '2026-10-10T10:00:00Z', Health: { Status: 'healthy' }, ...state },
  };
}
```

- [ ] **Step 5: Étendre `DockerService`**

Dans `packages/backend/src/docker/docker-service.ts`, ajouter après les imports :

```ts
export interface BackupContainerInfo { env: string[]; entrypoint: string[] | string | null; cmd: string[] | string | null; startedAt: string | null; running: boolean }
```

Remplacer `backupEnv()` par :

```ts
  /** Inspection du conteneur mc-backup (planification, point d'entrée) ; null s'il est introuvable. */
  async inspectBackup(): Promise<BackupContainerInfo | null> {
    const c = await this.docker.findByName(this.backupName);
    if (!c) return null;
    const i = await c.inspect();
    return { env: i.Config.Env ?? [], entrypoint: i.Config.Entrypoint ?? null, cmd: i.Config.Cmd ?? null, startedAt: i.State.StartedAt || null, running: i.State.Running };
  }

  /** Variables d'environnement du conteneur mc-backup (vide s'il est introuvable). */
  async backupEnv(): Promise<string[]> { return (await this.inspectBackup())?.env ?? []; }

  /** Redémarre mc-backup : son point d'entrée relit alors le fichier de réglages. */
  async restartBackup(): Promise<void> {
    const c = await this.docker.findByName(this.backupName);
    if (!c) throw new AppError(503, `Container "${this.backupName}" not found`, undefined, 'container_missing');
    await c.restart({ t: 10 });
  }
```

Remplacer la signature et l'appel `exec` de `execBackup` :

```ts
  async execBackup(cmd: string[], env?: string[]): Promise<{ stream: Readable; wait(): Promise<number> }> {
    const c = await this.docker.findByName(this.backupName);
    if (!c) throw new AppError(503, `Container "${this.backupName}" not found`);
    const exec = await c.exec({ Cmd: cmd, ...(env ? { Env: env } : {}), AttachStdout: true, AttachStderr: true });
```

(le reste de la méthode est inchangé).

- [ ] **Step 6: Lancer les tests du dossier docker et de la restauration**

Run: `pnpm --filter @mc/backend exec vitest run src/docker src/backups/restore-service.test.ts`
Expected: PASS (les tests existants qui vérifient `calls` toEqual `['exec:backup now']` passent toujours : `calls` ne contient pas l'environnement).

- [ ] **Step 7: Typecheck et commit**

Run: `pnpm --filter @mc/backend run typecheck`
Expected: aucune erreur.

```bash
git add packages/backend/src/docker
git commit -m "feat(docker): inspection, redémarrage et environnement d'exec de mc-backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `BackupSettingsService`

**Files:**
- Modify: `packages/backend/src/data/data-lock.ts:3-7`
- Create: `packages/backend/src/backups/backup-settings-service.ts`
- Test: `packages/backend/src/backups/backup-settings-service.test.ts`

**Interfaces:**
- Consumes: tâche 1 (`SETTINGS_RELATIVE`, `effectiveSettings`, `isManaged`, `parseSettingsFile`, `serializeSettings`, `validateUpdate`, `type SettingsFileValues`, `BackupSettings`), tâche 2 (`DockerService.inspectBackup`, `restartBackup`, `execBackup(cmd, env?)`, `FakeContainer.execReply`, `inspectFixture({ Entrypoint })`) ; `atomicWriteFile(file, content)` de `utils/atomic-write.ts` ; `DataLock.acquire(op): () => void` (409 code `busy`).
- Produces: `class BackupSettingsService { constructor(dir: string, docker: DockerService, lock: DataLock); read(): Promise<BackupSettings>; apply(body: unknown, audit: (detail: string) => Promise<void>): Promise<BackupSettings>; pruneDaysForExec(): Promise<number | null> }` ; `DataOp` incluant `'backup-settings'`.

- [ ] **Step 1: Ajouter l'opération au verrou**

Dans `packages/backend/src/data/data-lock.ts`, remplacer :

```ts
export type DataOp = 'backup' | 'restore' | 'properties' | 'mods';

/**
 * Verrou global des écritures dans /data et des sauvegardes : une seule opération à la fois.
```

par :

```ts
export type DataOp = 'backup' | 'restore' | 'properties' | 'mods' | 'backup-settings';

/**
 * Verrou global des écritures dans /data, des sauvegardes et du redémarrage de mc-backup : une seule opération à la fois.
```

- [ ] **Step 2: Écrire les tests du service**

Créer `packages/backend/src/backups/backup-settings-service.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { BackupSettingsService } from './backup-settings-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const EP = ['/bin/bash', '-c', 'f=/backups/.mc-manager/backup-settings.conf\nexec /usr/bin/backup loop'];
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('BackupSettingsService', () => {
  let dir: string; let docker: FakeDocker; let bk: FakeContainer; let lock: DataLock; let svc: BackupSettingsService; let audits: string[];
  const file = () => path.join(dir, '.mc-manager', 'backup-settings.conf');
  const auditFn = async (d: string) => { audits.push(d); };
  /** mc-backup « géré » démarré il y a une minute ; un redémarrage avance StartedAt dans le futur proche. */
  const setContainer = (over: Parameters<typeof inspectFixture>[0] = {}) => {
    bk = new FakeContainer(inspectFixture({ Env: ['BACKUP_INTERVAL=6h', 'PRUNE_BACKUPS_DAYS=7'], Entrypoint: EP, StartedAt: ago(60_000), ...over }));
    bk.restart = async (o: { t: number }) => { bk.calls.push(`restart:${o.t}`); bk.state.State.StartedAt = new Date(Date.now() + 1000).toISOString(); };
    docker.containers.set('mc-backup', bk);
  };
  const writeSettings = (text: string) => { mkdirSync(path.dirname(file()), { recursive: true }); writeFileSync(file(), text); };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-bks-'));
    docker = new FakeDocker();
    lock = new DataLock();
    svc = new BackupSettingsService(dir, new DockerService(docker, 'mc', 'mc-backup'), lock);
    audits = [];
    setContainer();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('read', () => {
    it('shows the compose values while no file exists', async () => {
      expect(await svc.read()).toEqual({
        containerFound: true, running: true, managed: true, cronSchedule: null,
        interval: { value: '6h', source: 'compose' }, pruneDays: { value: '7', source: 'compose' },
        pendingRestart: false, initialDelay: '2m', backupOnStartup: true,
      });
    });
    it('uses the file values and reports them pending until mc-backup restarts', async () => {
      writeSettings('BACKUP_INTERVAL=12h\nPRUNE_BACKUPS_DAYS=14\n');
      const s = await svc.read();
      expect(s.interval).toEqual({ value: '12h', source: 'file' });
      expect(s.pruneDays).toEqual({ value: '14', source: 'file' });
      expect(s.pendingRestart).toBe(true);
      bk.state.State.StartedAt = new Date(Date.now() + 1000).toISOString();
      expect((await svc.read()).pendingRestart).toBe(false);
    });
    it('ignores the file when the container does not read it', async () => {
      setContainer({ Entrypoint: undefined });
      writeSettings('BACKUP_INTERVAL=12h\n');
      const s = await svc.read();
      expect(s.managed).toBe(false);
      expect(s.interval).toEqual({ value: '6h', source: 'compose' });
      expect(s.pendingRestart).toBe(false);
    });
    it('reports a missing container', async () => {
      docker.containers.delete('mc-backup');
      expect(await svc.read()).toMatchObject({ containerFound: false, managed: false, interval: null, pruneDays: null });
    });
    it('reads image defaults, INITIAL_DELAY, BACKUP_ON_STARTUP and CRON_SCHEDULE', async () => {
      setContainer({ Env: ['INITIAL_DELAY=5m', 'BACKUP_ON_STARTUP=FALSE', 'CRON_SCHEDULE=0 */6 * * *'], Running: false });
      expect(await svc.read()).toMatchObject({
        running: false, cronSchedule: '0 */6 * * *', initialDelay: '5m', backupOnStartup: false,
        interval: { value: '24h', source: 'default' }, pruneDays: { value: '7', source: 'default' },
      });
    });
  });

  describe('apply', () => {
    it('writes the file atomically, restarts mc-backup, audits and returns the applied state', async () => {
      const s = await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(readFileSync(file(), 'utf8')).toBe('BACKUP_INTERVAL=12h\nPRUNE_BACKUPS_DAYS=14\n');
      expect(bk.calls).toEqual(['restart:10']);
      expect(audits).toEqual(['interval=12h pruneDays=14']);
      expect(s).toMatchObject({ interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' }, pendingRestart: false });
      expect(lock.busy).toBeNull();
    });
    it('does nothing when the file already holds the same applied values', async () => {
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toEqual(['restart:10']);
      expect(audits).toHaveLength(1);
    });
    it('refuses with 409 busy while mc-backup holds its backup lock', async () => {
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      bk.execReply = (cmd) => (cmd[0] === 'flock' ? { exit: 1 } : undefined);
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'busy' });
      expect(bk.calls).toEqual(['exec:flock -n /backups/.mc-backup-lock true']);
      expect(existsSync(file())).toBe(false);
      expect(audits).toEqual([]);
      expect(lock.busy).toBeNull();
    });
    it('checks the lock under DEST_DIR', async () => {
      setContainer({ Env: ['DEST_DIR=/srv/b'] });
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      bk.execReply = () => ({ exit: 0 });
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toEqual(['exec:flock -n /srv/b/.mc-backup-lock true', 'restart:10']);
    });
    it('goes on when the lock check itself fails (flock missing)', async () => {
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      bk.execReply = () => ({ exit: 127 });
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toContain('restart:10');
    });
    it('does not exec flock when no lock file exists or SKIP_LOCKING is true', async () => {
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toEqual(['restart:10']);
      setContainer({ Env: ['SKIP_LOCKING=TRUE'] });
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      await svc.apply({ interval: '1d', pruneDays: 30 }, auditFn);
      expect(bk.calls).toEqual(['restart:10']);
    });
    it('is 409 busy while another data operation holds the lock', async () => {
      const release = lock.acquire('restore');
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'busy' });
      expect(existsSync(file())).toBe(false);
      release();
    });
    it('lets only one of two concurrent applies through', async () => {
      const releaseRestart = (() => { let r!: () => void; const gate = new Promise<void>((res) => { r = res; }); const orig = bk.restart; bk.restart = async (o) => { await gate; await orig(o); }; return () => r(); })();
      const first = svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      await vi.waitFor(() => expect(lock.busy).toBe('backup-settings'));
      await expect(svc.apply({ interval: '1d', pruneDays: 30 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'busy' });
      releaseRestart();
      await first;
      expect(bk.calls).toEqual(['restart:10']);
      expect(readFileSync(file(), 'utf8')).toContain('BACKUP_INTERVAL=12h');
    });
    it('is 409 not_managed without the compose entrypoint or with CRON_SCHEDULE', async () => {
      setContainer({ Entrypoint: ['/usr/bin/backup'] });
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'not_managed' });
      setContainer({ Env: ['CRON_SCHEDULE='] });
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'not_managed' });
      expect(existsSync(file())).toBe(false);
    });
    it('is 503 container_missing without mc-backup', async () => {
      docker.containers.delete('mc-backup');
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 503, code: 'container_missing' });
    });
    it('is 400 invalid before touching anything', async () => {
      await expect(svc.apply({ interval: '0h', pruneDays: 7 }, auditFn)).rejects.toMatchObject({ statusCode: 400, code: 'invalid' });
      expect(bk.calls).toEqual([]);
    });
    it('keeps the file and reports 502 restart_failed when the restart fails', async () => {
      bk.restart = async () => { throw new Error('docker refused'); };
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 502, code: 'restart_failed' });
      expect(readFileSync(file(), 'utf8')).toContain('BACKUP_INTERVAL=12h');
      expect(audits).toEqual(['interval=12h pruneDays=14 (restart failed)']);
      expect((await svc.read()).pendingRestart).toBe(true);
      expect(lock.busy).toBeNull();
    });
    it('releases the lock and does not restart when the file cannot be written', async () => {
      writeFileSync(path.join(dir, '.mc-manager'), 'not a folder');
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toBeTruthy();
      expect(bk.calls).toEqual([]);
      expect(audits).toEqual([]);
      expect(lock.busy).toBeNull();
    });
  });

  describe('pruneDaysForExec', () => {
    it('returns the file retention when managed, null otherwise', async () => {
      expect(await svc.pruneDaysForExec()).toBeNull();
      writeSettings('PRUNE_BACKUPS_DAYS=14\n');
      expect(await svc.pruneDaysForExec()).toBe(14);
      setContainer({ Entrypoint: undefined });
      expect(await svc.pruneDaysForExec()).toBeNull();
      docker.containers.delete('mc-backup');
      expect(await svc.pruneDaysForExec()).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Lancer les tests et constater l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-settings-service.test.ts`
Expected: FAIL (`Cannot find module './backup-settings-service.js'`).

- [ ] **Step 4: Implémenter le service**

Créer `packages/backend/src/backups/backup-settings-service.ts` :

```ts
import { access, readFile, stat } from 'fs/promises';
import path from 'path';
import type { BackupSettings } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { atomicWriteFile } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';
import { envMap } from '../mods/server-type.js';
import { SETTINGS_RELATIVE, effectiveSettings, isManaged, parseSettingsFile, serializeSettings, validateUpdate, type SettingsFileValues } from './backup-settings.js';

type AuditFn = (detail: string) => Promise<void>;

const isTrue = (v: string | undefined): boolean => (v ?? '').toLowerCase() === 'true';

/**
 * Intervalle et rétention de mc-backup : écrits dans `<backups>/.mc-manager/backup-settings.conf`, que le point
 * d'entrée du compose lit à chaque démarrage ; appliqués en redémarrant mc-backup.
 */
export class BackupSettingsService {
  private readonly file: string;

  constructor(private dir: string, private docker: DockerService, private lock: DataLock) {
    this.file = path.join(dir, SETTINGS_RELATIVE);
  }

  async read(): Promise<BackupSettings> {
    const c = await this.docker.inspectBackup();
    if (!c) {
      return { containerFound: false, running: false, managed: false, cronSchedule: null, interval: null, pruneDays: null, pendingRestart: false, initialDelay: '2m', backupOnStartup: true };
    }
    const vars = envMap(c.env);
    const managed = isManaged(c.entrypoint, c.cmd);
    const file = managed ? await this.readFile() : null;
    const eff = effectiveSettings(file?.values ?? {}, c.env);
    const startedAt = c.startedAt ? Date.parse(c.startedAt) : Number.NaN;
    return {
      containerFound: true,
      running: c.running,
      managed,
      // `[[ -v CRON_SCHEDULE ]]` dans l'image : la présence suffit, même vide.
      cronSchedule: vars.has('CRON_SCHEDULE') ? vars.get('CRON_SCHEDULE') ?? '' : null,
      interval: eff.interval,
      pruneDays: eff.pruneDays,
      pendingRestart: file !== null && (Number.isNaN(startedAt) || file.mtimeMs > startedAt),
      initialDelay: vars.get('INITIAL_DELAY') || '2m',
      backupOnStartup: (vars.get('BACKUP_ON_STARTUP') || 'true').toUpperCase() !== 'FALSE',
    };
  }

  async apply(body: unknown, audit: AuditFn): Promise<BackupSettings> {
    const update = validateUpdate(body);
    const c = await this.docker.inspectBackup();
    if (!c) throw new AppError(503, 'Backup container not found', undefined, 'container_missing');
    const vars = envMap(c.env);
    if (!isManaged(c.entrypoint, c.cmd)) {
      throw new AppError(409, 'The backup container does not read the settings file: add the entrypoint shown in the README to its compose service', undefined, 'not_managed');
    }
    if (vars.has('CRON_SCHEDULE')) throw new AppError(409, 'The backup container is scheduled by CRON_SCHEDULE: the interval does not apply', undefined, 'not_managed');
    const current = await this.read();
    if (!current.pendingRestart && current.interval?.source === 'file' && current.interval.value === update.interval
      && current.pruneDays?.source === 'file' && current.pruneDays.value === String(update.pruneDays)) return current;

    const release = this.lock.acquire('backup-settings');
    try {
      await this.assertNoLoopBackup(vars);
      await atomicWriteFile(this.file, serializeSettings(update));
      const detail = `interval=${update.interval} pruneDays=${update.pruneDays}`;
      try {
        await this.docker.restartBackup();
      } catch (err) {
        logger.error({ err }, 'cannot restart the backup container after writing its settings');
        await audit(`${detail} (restart failed)`);
        throw new AppError(502, `Settings saved, but the backup container did not restart: ${(err as Error).message}`, undefined, 'restart_failed');
      }
      await audit(detail);
    } finally {
      release();
    }
    return this.read();
  }

  /** Rétention du fichier pour `backup now` (l'exec hérite de Config.Env, pas du fichier) ; null = valeur du conteneur. */
  async pruneDaysForExec(): Promise<number | null> {
    try {
      const c = await this.docker.inspectBackup();
      if (!c || !isManaged(c.entrypoint, c.cmd)) return null;
      const days = (await this.readFile())?.values.pruneDays;
      return days ? Number(days) : null;
    } catch (err) {
      logger.warn({ err }, 'cannot read the backup retention, using the container value');
      return null;
    }
  }

  private async readFile(): Promise<{ values: SettingsFileValues; mtimeMs: number } | null> {
    try {
      const [text, s] = await Promise.all([readFile(this.file, 'utf8'), stat(this.file)]);
      return { values: parseSettingsFile(text), mtimeMs: s.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file: this.file }, 'cannot read the backup settings file');
      return null;
    }
  }

  /**
   * Redémarrer pendant une sauvegarde de la boucle laisserait une archive tronquée et le serveur en save-off :
   * mc-backup tient flock sur $DEST_DIR/.mc-backup-lock pendant chaque sauvegarde.
   */
  private async assertNoLoopBackup(vars: Map<string, string>): Promise<void> {
    if (isTrue(vars.get('SKIP_LOCKING'))) return;
    // Sans fichier de verrou, aucune sauvegarde verrouillée n'a jamais tourné ; l'exec le créerait avec son propre propriétaire.
    try { await access(path.join(this.dir, '.mc-backup-lock')); } catch { return; }
    const destDir = vars.get('DEST_DIR') || '/backups';
    let code: number;
    try {
      const r = await this.docker.execBackup(['flock', '-n', `${destDir}/.mc-backup-lock`, 'true']);
      r.stream.resume();
      code = await r.wait();
    } catch (err) {
      logger.warn({ err }, 'cannot check the backup lock, restarting anyway');
      return;
    }
    if (code === 1) throw new AppError(409, 'A backup is running in the backup container, try again when it is done', undefined, 'busy');
    if (code !== 0) logger.warn({ code }, 'backup lock check failed, restarting anyway');
  }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-settings-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck et commit**

Run: `pnpm --filter @mc/backend run typecheck`
Expected: aucune erreur.

```bash
git add packages/backend/src/data/data-lock.ts packages/backend/src/backups/backup-settings-service.ts packages/backend/src/backups/backup-settings-service.test.ts
git commit -m "feat(backups): service d'écriture des réglages de mc-backup et redémarrage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rétention des sauvegardes manuelles, routes et câblage

**Files:**
- Modify: `packages/backend/src/backups/backup-service.ts:16-18,82-85`
- Modify: `packages/backend/src/routes/backups.routes.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/src/backups/backup-service.test.ts`, `packages/backend/src/routes/backups.routes.test.ts`

**Interfaces:**
- Consumes: tâche 2 (`execBackup(cmd, env?)`, `FakeContainer.execEnvs`), tâche 3 (`BackupSettingsService`, `pruneDaysForExec`), `audit(req, action, detail)`.
- Produces: `new BackupService(dir, docker, lock?, pruneDays?: () => Promise<number | null>)` ; `GET /api/backups/settings` → `BackupSettings` (tous rôles) ; `PUT /api/backups/settings` (admin) → `BackupSettings` ; `app.locals.backupSettings`.

- [ ] **Step 1: Écrire les tests de `runNow`**

Dans `packages/backend/src/backups/backup-service.test.ts`, ajouter l'import `import { DataLock } from '../data/data-lock.js';` s'il manque (il est déjà présent) puis, dans le `describe('BackupService')` :

```ts
  it('runNow passes the retention of the settings file to backup now', async () => {
    const withDays = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'), new DataLock(), async () => 14);
    const p = withDays.runNow();
    await wait(5);
    backupContainer.execStream.end();
    await p;
    expect(backupContainer.execEnvs).toEqual([['PRUNE_BACKUPS_DAYS=14']]);
  });

  it('runNow passes no environment when no retention is managed', async () => {
    const p = svc.runNow();
    await wait(5);
    backupContainer.execStream.end();
    await p;
    expect(backupContainer.execEnvs).toEqual([undefined]);
  });
```

- [ ] **Step 2: Écrire les tests de routes**

Dans `packages/backend/src/routes/backups.routes.test.ts`, ajouter l'import :

```ts
import { BackupSettingsService } from '../backups/backup-settings-service.js';
```

remplacer dans `appWith` la ligne `app.locals.backups = new BackupService(dir, new DockerService(fake, 'mc', 'mc-backup'));` par :

```ts
  const docker = new DockerService(fake, 'mc', 'mc-backup');
  app.locals.backups = new BackupService(dir, docker);
  app.locals.backupSettings = new BackupSettingsService(dir, docker, app.locals.backups.dataLock);
```

et ajouter dans le `describe('backups routes')` :

```ts
  const managedBackup = () => {
    const fake = new FakeDocker();
    fake.containers.set('mc-backup', new FakeContainer(inspectFixture({ Env: ['BACKUP_INTERVAL=6h'], Entrypoint: ['/bin/bash', '-c', 'f=/backups/.mc-manager/backup-settings.conf'] })));
    return fake;
  };
  it('viewer reads the backup settings but cannot change them', async () => {
    const app = appWith('viewer', managedBackup());
    const r = await request(app).get('/api/backups/settings');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ containerFound: true, managed: true, interval: { value: '6h', source: 'compose' } });
    expect((await request(app).put('/api/backups/settings').send({ interval: '12h', pruneDays: 14 })).status).toBe(403);
  });
  it('admin gets 400 invalid on a bad body', async () => {
    const r = await request(appWith('admin', managedBackup())).put('/api/backups/settings').send({ interval: '5m', pruneDays: 14 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid');
  });
  it('admin applies the settings and the change is audited as backup.settings', async () => {
    const app = appWith('admin', managedBackup());
    const r = await request(app).put('/api/backups/settings').send({ interval: '12h', pruneDays: 14 });
    expect(r.status).toBe(200);
    expect(r.body.interval).toEqual({ value: '12h', source: 'file' });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.settings', detail: 'interval=12h pruneDays=14' }) }));
  });
  it('settings answer 503 container_missing without mc-backup', async () => {
    const r = await request(appWith('admin')).put('/api/backups/settings').send({ interval: '12h', pruneDays: 14 });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('container_missing');
  });
```

- [ ] **Step 3: Lancer les tests et constater l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-service.test.ts src/routes/backups.routes.test.ts`
Expected: FAIL (environnement d'exec absent, routes `/settings` en 404).

- [ ] **Step 4: Passer la rétention à `backup now`**

Dans `packages/backend/src/backups/backup-service.ts`, remplacer le constructeur :

```ts
  constructor(
    private dir: string,
    private docker: DockerService,
    private lock: DataLock = new DataLock(),
    /** Rétention du fichier de réglages : `backup now` hérite de Config.Env, pas de l'environnement de la boucle. */
    private pruneDays: () => Promise<number | null> = async () => null,
  ) { super(); }
```

et, dans `runNow`, la ligne `const { stream, wait } = await this.docker.execBackup(['backup', 'now']);` par :

```ts
      const days = await this.pruneDays().catch(() => null);
      const { stream, wait } = await this.docker.execBackup(['backup', 'now'], days !== null ? [`PRUNE_BACKUPS_DAYS=${days}`] : undefined);
```

- [ ] **Step 5: Ajouter les routes**

Dans `packages/backend/src/routes/backups.routes.ts`, après la route `backupsRoutes.get('/', …)` :

```ts
// Planification de mc-backup : lecture pour tous les rôles, comme la liste.
backupsRoutes.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.backupSettings.read()); } catch (err) { next(err); }
});

// Écrit le fichier lu par mc-backup puis le redémarre ; le service audite le résultat avant la réponse.
backupsRoutes.put('/settings', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await req.app.locals.backupSettings.apply(req.body, (detail: string) => audit(req, 'backup.settings', detail)));
  } catch (err) { next(err); }
});
```

- [ ] **Step 6: Câbler dans `index.ts`**

Ajouter les imports :

```ts
import { BackupSettingsService } from './backups/backup-settings-service.js';
import { DataLock } from './data/data-lock.js';
```

Remplacer `const backups = new BackupService(config.mc.backupsDir, docker);` par :

```ts
  // Verrou partagé : sauvegarde manuelle, restauration, server.properties, mods et réglages de mc-backup.
  const dataLock = new DataLock();
  const backupSettings = new BackupSettingsService(config.mc.backupsDir, docker, dataLock);
  app.locals.backupSettings = backupSettings;
  const backups = new BackupService(config.mc.backupsDir, docker, dataLock, () => backupSettings.pruneDaysForExec());
```

(les usages existants de `backups.dataLock` restent valides : c'est le même objet).

- [ ] **Step 7: Lancer toute la suite backend**

Run: `pnpm --filter @mc/backend exec vitest run`
Expected: PASS (aucune régression).

- [ ] **Step 8: Typecheck, lint et commit**

Run: `pnpm --filter @mc/backend run typecheck && pnpm lint`
Expected: aucune erreur.

```bash
git add packages/backend/src/backups/backup-service.ts packages/backend/src/backups/backup-service.test.ts packages/backend/src/routes/backups.routes.ts packages/backend/src/routes/backups.routes.test.ts packages/backend/src/index.ts
git commit -m "feat(backups): routes de planification et rétention transmise à backup now

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Aides frontend (API, intervalle, erreurs, textes)

**Files:**
- Modify: `packages/frontend/src/api/backups.api.ts`
- Create: `packages/frontend/src/components/backups/interval.ts`
- Create: `packages/frontend/src/components/backups/interval.test.ts`
- Create: `packages/frontend/src/components/backups/backup-settings-errors.ts`
- Create: `packages/frontend/scripts/i18n-fragments/backup-settings.json`
- Modify (générés par le script) : `packages/frontend/src/i18n/locales/en.json`, `fr.json`

**Interfaces:**
- Consumes: tâche 1 (`intervalToMinutes`, `BackupIntervalUnit`, `BackupSettings`, `BackupSettingsUpdate`, `BackupSettingsErrorCode`) ; `type ApiError` de `@/components/mods/mods-errors`.
- Produces: `backupsApi.settings(): Promise<BackupSettings>`, `backupsApi.updateSettings(body: BackupSettingsUpdate): Promise<BackupSettings>` ; `UNIT_MINUTES: Record<BackupIntervalUnit, number>`, `splitInterval(value: string): { amount: number; unit: BackupIntervalUnit } | null` ; `describeBackupSettingsError(e: ApiError, t: TFunction): string` ; clés i18n `backups.schedule.*` (liste complète dans le fragment ci-dessous).

- [ ] **Step 1: Écrire les tests de `splitInterval`**

Créer `packages/frontend/src/components/backups/interval.test.ts` :

```ts
import { splitInterval } from './interval';

describe('splitInterval', () => {
  it.each<[string, { amount: number; unit: string }]>([
    ['6h', { amount: 6, unit: 'h' }], ['90m', { amount: 90, unit: 'm' }], ['1440m', { amount: 1, unit: 'd' }],
    ['2d', { amount: 2, unit: 'd' }], ['21600', { amount: 6, unit: 'h' }], ['120s', { amount: 2, unit: 'm' }],
  ])('%s → %j', (v, r) => expect(splitInterval(v)).toEqual(r));
  it.each(['1.5h', '', '0m', '30s', 'abc'])('%j → null', (v) => expect(splitInterval(v)).toBeNull());
});
```

- [ ] **Step 2: Lancer le test et constater l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/backups/interval.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `interval.ts`**

```ts
import { intervalToMinutes, type BackupIntervalUnit } from '@mc/common';

export const UNIT_MINUTES: Record<BackupIntervalUnit, number> = { m: 1, h: 60, d: 1440 };

/** Plus grande unité exacte (jours, heures, minutes) ; null si la valeur n'est pas un nombre entier et positif de minutes. */
export function splitInterval(value: string): { amount: number; unit: BackupIntervalUnit } | null {
  const minutes = intervalToMinutes(value);
  if (minutes === null || !Number.isInteger(minutes) || minutes <= 0) return null;
  for (const unit of ['d', 'h', 'm'] as const) {
    if (minutes % UNIT_MINUTES[unit] === 0) return { amount: minutes / UNIT_MINUTES[unit], unit };
  }
  return null;
}
```

- [ ] **Step 4: Lancer le test**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/backups/interval.test.ts`
Expected: PASS.

- [ ] **Step 5: API et traduction des erreurs**

Dans `packages/frontend/src/api/backups.api.ts`, remplacer l'import de types par :

```ts
import type { BackupList, BackupSettings, BackupSettingsUpdate, RestoreRequest, RestoreStatus } from '@mc/common';
```

et ajouter dans l'objet `backupsApi`, après `list` :

```ts
  settings: (): Promise<BackupSettings> => api.get('/backups/settings').then((r) => r.data),
  updateSettings: (body: BackupSettingsUpdate): Promise<BackupSettings> => api.put('/backups/settings', body).then((r) => r.data),
```

Créer `packages/frontend/src/components/backups/backup-settings-errors.ts` :

```ts
import type { TFunction } from 'i18next';
import type { BackupSettingsErrorCode } from '@mc/common';
import type { ApiError } from '@/components/mods/mods-errors';

const CODES: ReadonlySet<string> = new Set<BackupSettingsErrorCode>(['invalid', 'not_managed', 'busy', 'container_missing', 'restart_failed']);

/** Message traduit par code quand le backend en fournit un, sinon son message brut, sinon l'erreur générique. */
export function describeBackupSettingsError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  if (code && CODES.has(code)) return t(`backups.schedule.errors.${code}`);
  return e.response?.data?.error ?? t('shared.error');
}
```

- [ ] **Step 6: Textes en/fr**

Créer `packages/frontend/scripts/i18n-fragments/backup-settings.json` :

```json
{ "namespace": "backups", "keys": {
  "en": { "schedule": {
    "title": "Automatic backups",
    "interval": "Interval",
    "retention": "Retention",
    "unit": "Unit",
    "units": { "m": "minutes", "h": "hours", "d": "days" },
    "daysUnit": "days",
    "every": { "m_one": "every minute", "m_other": "every {{count}} minutes", "h_one": "every hour", "h_other": "every {{count}} hours", "d_one": "every day", "d_other": "every {{count}} days" },
    "everyRaw": "{{value}} (raw value)",
    "days_one": "{{count}} day",
    "days_other": "{{count}} days",
    "source": { "compose": "compose", "default": "image default" },
    "cron": "set by CRON_SCHEDULE ({{schedule}})",
    "noContainer": "The mc-backup container was not found.",
    "stopped": "mc-backup is stopped: no automatic backup until it starts again.",
    "pending": "Settings saved but not applied yet: mc-backup has not restarted since.",
    "retry": "Retry",
    "edit": "Edit",
    "apply": "Apply",
    "applied": "Backup schedule applied",
    "intervalRange": "Between {{min}} minutes and {{max}} days.",
    "daysRange": "Between {{min}} and {{max}} days.",
    "notManaged": {
      "title": "Settings read from the compose file",
      "description": "To change them here, add this entrypoint to the mc-backup service of your Minecraft stack, then recreate it (docker compose up -d). The values under environment: stay as fallbacks.",
      "snippet": "Entrypoint to add",
      "copy": "Copy"
    },
    "confirm": {
      "title": "Apply the backup schedule?",
      "description": "mc-backup restarts to apply these settings. Next backup in about {{delay}}, then {{every}}; archives are kept {{days}}.",
      "descriptionNoStartup": "mc-backup restarts to apply these settings. First backup after {{delay}} plus the interval, then {{every}}; archives are kept {{days}}."
    },
    "errors": {
      "invalid": "Invalid values.",
      "not_managed": "mc-backup does not read the settings file: add the entrypoint to its compose service first.",
      "busy": "A backup or a restore is running, try again when it is done.",
      "container_missing": "The mc-backup container was not found.",
      "restart_failed": "Settings saved, but mc-backup did not restart: they will apply at its next start."
    }
  } },
  "fr": { "schedule": {
    "title": "Sauvegardes automatiques",
    "interval": "Intervalle",
    "retention": "Rétention",
    "unit": "Unité",
    "units": { "m": "minutes", "h": "heures", "d": "jours" },
    "daysUnit": "jours",
    "every": { "m_one": "toutes les minutes", "m_other": "toutes les {{count}} minutes", "h_one": "toutes les heures", "h_other": "toutes les {{count}} heures", "d_one": "tous les jours", "d_other": "tous les {{count}} jours" },
    "everyRaw": "{{value}} (valeur brute)",
    "days_one": "{{count}} jour",
    "days_other": "{{count}} jours",
    "source": { "compose": "compose", "default": "défaut de l'image" },
    "cron": "défini par CRON_SCHEDULE ({{schedule}})",
    "noContainer": "Conteneur mc-backup introuvable.",
    "stopped": "mc-backup est arrêté : aucune sauvegarde automatique tant qu'il ne redémarre pas.",
    "pending": "Réglages enregistrés mais pas encore appliqués : mc-backup n'a pas redémarré depuis.",
    "retry": "Réessayer",
    "edit": "Modifier",
    "apply": "Appliquer",
    "applied": "Planification appliquée",
    "intervalRange": "Entre {{min}} minutes et {{max}} jours.",
    "daysRange": "Entre {{min}} et {{max}} jours.",
    "notManaged": {
      "title": "Réglages lus dans le compose",
      "description": "Pour les modifier ici, ajoutez ce point d'entrée au service mc-backup de votre stack Minecraft, puis recréez-le (docker compose up -d). Les valeurs de environment: restent les valeurs de repli.",
      "snippet": "Point d'entrée à ajouter",
      "copy": "Copier"
    },
    "confirm": {
      "title": "Appliquer la planification ?",
      "description": "mc-backup redémarre pour appliquer ces réglages. Prochaine sauvegarde dans {{delay}} environ, puis {{every}} ; les archives sont conservées {{days}}.",
      "descriptionNoStartup": "mc-backup redémarre pour appliquer ces réglages. Première sauvegarde après {{delay}} plus l'intervalle, puis {{every}} ; les archives sont conservées {{days}}."
    },
    "errors": {
      "invalid": "Valeurs invalides.",
      "not_managed": "mc-backup ne lit pas le fichier de réglages : ajoutez d'abord le point d'entrée à son service compose.",
      "busy": "Une sauvegarde ou une restauration est en cours, réessayez quand elle sera terminée.",
      "container_missing": "Conteneur mc-backup introuvable.",
      "restart_failed": "Réglages enregistrés, mais mc-backup n'a pas redémarré : ils s'appliqueront à son prochain démarrage."
    }
  } }
} }
```

Run: `node packages/frontend/scripts/merge-i18n.mjs`
Expected: dernière ligne `OK — N keys across 2 locales`.

- [ ] **Step 7: Typecheck et commit**

Run: `pnpm --filter @mc/frontend run typecheck`
Expected: aucune erreur.

```bash
git add packages/frontend/src/api/backups.api.ts packages/frontend/src/components/backups/interval.ts packages/frontend/src/components/backups/interval.test.ts packages/frontend/src/components/backups/backup-settings-errors.ts packages/frontend/scripts/i18n-fragments/backup-settings.json packages/frontend/src/i18n/locales/en.json packages/frontend/src/i18n/locales/fr.json
git commit -m "feat(frontend): API, intervalles et textes de la planification des sauvegardes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Carte de planification sur la page Sauvegardes

**Files:**
- Create: `packages/frontend/src/components/backups/BackupScheduleCard.tsx`
- Create: `packages/frontend/src/components/backups/BackupScheduleCard.test.tsx`
- Modify: `packages/frontend/src/pages/Backups.tsx:15-16,89`
- Modify: `packages/frontend/src/pages/Backups.test.tsx:12-14`

**Interfaces:**
- Consumes: tâche 5 (`backupsApi.settings`, `backupsApi.updateSettings`, `UNIT_MINUTES`, `splitInterval`, `describeBackupSettingsError`, clés `backups.schedule.*`) ; tâche 1 (bornes, `BACKUP_INTERVAL_UNITS`, `BACKUP_SETTINGS_COMPOSE_SNIPPET`, types) ; `ConfirmDialog` (`open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `onConfirm`, `loading`).
- Produces: `BackupScheduleCard({ isAdmin, busy }: { isAdmin: boolean; busy: boolean })`, query `['backups', 'settings']`.

- [ ] **Step 1: Écrire les tests du composant**

Créer `packages/frontend/src/components/backups/BackupScheduleCard.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BackupSettings } from '@mc/common';
import '@/i18n';
import { toast } from 'sonner';
import { BackupScheduleCard } from './BackupScheduleCard';
import { backupsApi } from '@/api/backups.api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/backups.api', () => ({ backupsApi: { settings: vi.fn(), updateSettings: vi.fn() } }));

const base: BackupSettings = {
  containerFound: true, running: true, managed: true, cronSchedule: null,
  interval: { value: '6h', source: 'compose' }, pruneDays: { value: '7', source: 'compose' },
  pendingRestart: false, initialDelay: '2m', backupOnStartup: true,
};

function setup(settings: BackupSettings, { isAdmin = true, busy = false } = {}) {
  vi.mocked(backupsApi.settings).mockResolvedValue(settings);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BackupScheduleCard isAdmin={isAdmin} busy={busy} /></QueryClientProvider>);
}

describe('BackupScheduleCard', () => {
  beforeEach(() => { vi.mocked(backupsApi.updateSettings).mockReset(); vi.mocked(toast.error).mockReset(); });

  it('viewer sees the values and their source, without edit button', async () => {
    setup(base, { isAdmin: false });
    expect(await screen.findByText('every 6 hours')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getAllByText('(compose)')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows a compose value given in seconds in a readable unit', async () => {
    setup({ ...base, interval: { value: '21600', source: 'compose' } }, { isAdmin: false });
    expect(await screen.findByText('every 6 hours')).toBeInTheDocument();
  });

  it('shows a value it cannot convert as is, and leaves the field empty', async () => {
    setup({ ...base, interval: { value: '1.5h', source: 'compose' } });
    expect(await screen.findByText('1.5h (raw value)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Interval')).toHaveValue(null);
  });

  it('admin edits, confirms and sends the new values', async () => {
    vi.mocked(backupsApi.updateSettings).mockResolvedValue({ ...base, interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' } });
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Interval')).toHaveValue(6);
    expect(screen.getByLabelText('Retention')).toHaveValue(7);
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Retention'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Next backup in about 2m, then every 12 hours; archives are kept 14 days/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(backupsApi.updateSettings).toHaveBeenCalledWith({ interval: '12h', pruneDays: 14 }));
    expect(await screen.findByText('every 12 hours')).toBeInTheDocument();
  });

  it('keeps the dialog open and blocks a second submit while mc-backup restarts', async () => {
    let resolve!: (s: BackupSettings) => void;
    vi.mocked(backupsApi.updateSettings).mockReturnValue(new Promise((r) => { resolve = r; }));
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const busyButton = await within(dialog).findByRole('button', { name: /processing/i });
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);
    expect(backupsApi.updateSettings).toHaveBeenCalledTimes(1);
    resolve({ ...base, interval: { value: '12h', source: 'file' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates the bounds before enabling Apply', async () => {
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '200' } });
    expect(screen.getByText('Between 30 minutes and 7 days.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Retention'), { target: { value: '0' } });
    expect(screen.getByText('Between 1 and 365 days.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('translates the error code of a refused change', async () => {
    vi.mocked(backupsApi.updateSettings).mockRejectedValue({ response: { status: 409, data: { error: 'x', code: 'busy' } } });
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A backup or a restore is running, try again when it is done.'));
  });

  it('admin sees the compose snippet when mc-backup does not read the file; a viewer does not', async () => {
    setup({ ...base, managed: false });
    expect(await screen.findByText('Settings read from the compose file')).toBeInTheDocument();
    expect(screen.getByText(/exec \/usr\/bin\/backup loop/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('a viewer of an unmanaged container sees no snippet', async () => {
    setup({ ...base, managed: false }, { isAdmin: false });
    await screen.findByText('every 6 hours');
    expect(screen.queryByText(/exec \/usr\/bin\/backup loop/)).not.toBeInTheDocument();
  });

  it('pending restart: banner and retry with the file values', async () => {
    vi.mocked(backupsApi.updateSettings).mockResolvedValue({ ...base, interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' } });
    setup({ ...base, interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' }, pendingRestart: true });
    expect(await screen.findByText(/not applied yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(backupsApi.updateSettings).toHaveBeenCalledWith({ interval: '12h', pruneDays: 14 }));
  });

  it('missing container', async () => {
    setup({ ...base, containerFound: false, managed: false, interval: null, pruneDays: null });
    expect(await screen.findByText('The mc-backup container was not found.')).toBeInTheDocument();
  });

  it('disables Edit while a backup or restore runs', async () => {
    setup(base, { busy: true });
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Lancer les tests et constater l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/backups/BackupScheduleCard.test.tsx`
Expected: FAIL (module `./BackupScheduleCard` introuvable).

- [ ] **Step 3: Implémenter `BackupScheduleCard.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import {
  BACKUP_INTERVAL_MAX_MINUTES, BACKUP_INTERVAL_MIN_MINUTES, BACKUP_INTERVAL_UNITS, BACKUP_SETTINGS_COMPOSE_SNIPPET, PRUNE_DAYS_MAX, PRUNE_DAYS_MIN,
  type BackupIntervalUnit, type BackupSettingValue, type BackupSettingsUpdate,
} from '@mc/common';
import { backupsApi } from '@/api/backups.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import type { ApiError } from '@/components/mods/mods-errors';
import { describeBackupSettingsError } from './backup-settings-errors';
import { UNIT_MINUTES, splitInterval } from './interval';

const QUERY_KEY = ['backups', 'settings'];

function everyText(value: string, t: TFunction): string {
  const s = splitInterval(value);
  return s ? t(`backups.schedule.every.${s.unit}`, { count: s.amount }) : t('backups.schedule.everyRaw', { value });
}

function daysText(value: string, t: TFunction): string {
  return /^\d+$/.test(value) ? t('backups.schedule.days', { count: Number(value) }) : value;
}

function SourceHint({ v }: { v: BackupSettingValue }) {
  const { t } = useTranslation();
  if (v.source === 'file') return null;
  return <span className="ml-1 text-xs text-muted-foreground">({t(`backups.schedule.source.${v.source}`)})</span>;
}

/** Intervalle et rétention de mc-backup : lecture pour tous, modification par un admin quand le compose lit le fichier. */
export function BackupScheduleCard({ isAdmin, busy }: { isAdmin: boolean; busy: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: QUERY_KEY, queryFn: backupsApi.settings });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<BackupIntervalUnit>('h');
  const [days, setDays] = useState('');
  const [toApply, setToApply] = useState<BackupSettingsUpdate | null>(null);
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: backupsApi.updateSettings,
    onSuccess: (s) => { qc.setQueryData(QUERY_KEY, s); setEditing(false); toast.success(t('backups.schedule.applied')); },
    onError: (e) => { toast.error(describeBackupSettingsError(e as ApiError, t)); void qc.invalidateQueries({ queryKey: QUERY_KEY }); },
    onSettled: () => setToApply(null),
  });

  if (!data) return null;
  const header = <CardHeader className="pb-3"><CardTitle className="text-base">{t('backups.schedule.title')}</CardTitle></CardHeader>;
  const { interval, pruneDays } = data;
  if (!data.containerFound || !interval || !pruneDays) {
    return <Card>{header}<CardContent><p className="text-sm text-muted-foreground">{t('backups.schedule.noContainer')}</p></CardContent></Card>;
  }

  const canEdit = isAdmin && data.managed && data.cronSchedule === null;
  const amountNum = Number(amount);
  const minutes = amount !== '' && Number.isInteger(amountNum) && amountNum > 0 ? amountNum * UNIT_MINUTES[unit] : null;
  const intervalOk = minutes !== null && minutes >= BACKUP_INTERVAL_MIN_MINUTES && minutes <= BACKUP_INTERVAL_MAX_MINUTES;
  const daysNum = Number(days);
  const daysOk = days !== '' && Number.isInteger(daysNum) && daysNum >= PRUNE_DAYS_MIN && daysNum <= PRUNE_DAYS_MAX;
  const next: BackupSettingsUpdate = { interval: `${amountNum}${unit}`, pruneDays: daysNum };
  const unchanged = !data.pendingRestart && interval.source === 'file' && interval.value === next.interval
    && pruneDays.source === 'file' && pruneDays.value === String(next.pruneDays);

  const startEdit = () => {
    const s = splitInterval(interval.value);
    setAmount(s ? String(s.amount) : '');
    setUnit(s?.unit ?? 'h');
    setDays(/^\d+$/.test(pruneDays.value) ? pruneDays.value : '');
    setEditing(true);
  };
  const copy = () => { void navigator.clipboard?.writeText(BACKUP_SETTINGS_COMPOSE_SNIPPET).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  return (
    <Card>
      {header}
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{t('backups.schedule.interval')}</dt>
          <dd>{data.cronSchedule !== null ? t('backups.schedule.cron', { schedule: data.cronSchedule }) : <>{everyText(interval.value, t)}<SourceHint v={interval} /></>}</dd>
          <dt className="text-muted-foreground">{t('backups.schedule.retention')}</dt>
          <dd>{daysText(pruneDays.value, t)}<SourceHint v={pruneDays} /></dd>
        </dl>
        {!data.running && <p className="text-xs text-amber-500">{t('backups.schedule.stopped')}</p>}
        {data.pendingRestart && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="flex-1">{t('backups.schedule.pending')}</span>
            {canEdit && <Button size="sm" variant="outline" disabled={busy || save.isPending} onClick={() => save.mutate({ interval: interval.value, pruneDays: Number(pruneDays.value) })}>{t('backups.schedule.retry')}</Button>}
          </div>
        )}
        {isAdmin && !data.managed && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="font-medium">{t('backups.schedule.notManaged.title')}</p>
            <p className="text-muted-foreground">{t('backups.schedule.notManaged.description')}</p>
            <p className="text-xs text-muted-foreground">{t('backups.schedule.notManaged.snippet')}</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono-data text-xs">{BACKUP_SETTINGS_COMPOSE_SNIPPET}</pre>
              <Button size="sm" variant="outline" onClick={copy} aria-label={t('backups.schedule.notManaged.copy')}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
            </div>
          </div>
        )}
        {canEdit && !editing && <Button size="sm" variant="outline" disabled={busy} onClick={startEdit}>{t('backups.schedule.edit')}</Button>}
        {canEdit && editing && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="backup-interval" className="w-full text-xs sm:w-32 sm:shrink-0">{t('backups.schedule.interval')}</Label>
              <Input id="backup-interval" type="number" min={1} className="h-8 w-full sm:w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Select value={unit} onValueChange={(v) => setUnit(v as BackupIntervalUnit)}>
                <SelectTrigger aria-label={t('backups.schedule.unit')} className="h-8 w-full sm:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{BACKUP_INTERVAL_UNITS.map((u) => <SelectItem key={u} value={u}>{t(`backups.schedule.units.${u}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {amount !== '' && !intervalOk && <p className="text-xs text-destructive">{t('backups.schedule.intervalRange', { min: BACKUP_INTERVAL_MIN_MINUTES, max: BACKUP_INTERVAL_MAX_MINUTES / 1440 })}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="backup-retention" className="w-full text-xs sm:w-32 sm:shrink-0">{t('backups.schedule.retention')}</Label>
              <Input id="backup-retention" type="number" min={PRUNE_DAYS_MIN} max={PRUNE_DAYS_MAX} className="h-8 w-full sm:w-24" value={days} onChange={(e) => setDays(e.target.value)} />
              <span className="text-xs text-muted-foreground">{t('backups.schedule.daysUnit')}</span>
            </div>
            {days !== '' && !daysOk && <p className="text-xs text-destructive">{t('backups.schedule.daysRange', { min: PRUNE_DAYS_MIN, max: PRUNE_DAYS_MAX })}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!intervalOk || !daysOk || unchanged || busy || save.isPending} onClick={() => setToApply(next)}>{t('backups.schedule.apply')}</Button>
              <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => setEditing(false)}>{t('shared.cancel')}</Button>
            </div>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={toApply !== null}
        onOpenChange={(o) => { if (!o && !save.isPending) setToApply(null); }}
        title={t('backups.schedule.confirm.title')}
        description={toApply ? t(data.backupOnStartup ? 'backups.schedule.confirm.description' : 'backups.schedule.confirm.descriptionNoStartup', {
          delay: data.initialDelay, every: everyText(toApply.interval, t), days: daysText(String(toApply.pruneDays), t),
        }) : ''}
        confirmLabel={t('backups.schedule.apply')}
        loading={save.isPending}
        onConfirm={() => { if (toApply && !save.isPending) save.mutate(toApply); }}
      />
    </Card>
  );
}
```

- [ ] **Step 4: Lancer les tests du composant**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/backups/BackupScheduleCard.test.tsx`
Expected: PASS (le bouton de confirmation affiche `shared.processing`, « Processing... », pendant la requête).

- [ ] **Step 5: Intégrer la carte à la page**

Dans `packages/frontend/src/pages/Backups.tsx`, ajouter l'import après `RestoreDialog` :

```tsx
import { BackupScheduleCard } from '@/components/backups/BackupScheduleCard';
```

et insérer, juste après le bloc `{interrupted && ( … )}` et avant `{(restoring || restoreOutput.length > 0 || restoreResult) ? (` :

```tsx
      <BackupScheduleCard isAdmin={isAdmin} busy={busy} />
```

Dans `packages/frontend/src/pages/Backups.test.tsx`, compléter le mock de l'API pour que la carte reçoive une réponse :

```tsx
vi.mock('@/api/backups.api', () => ({
  backupsApi: {
    list: vi.fn(), run: vi.fn(), remove: vi.fn(), download: vi.fn(), restore: vi.fn(), restoreStatus: vi.fn(), dismissInterrupted: vi.fn(),
    settings: vi.fn(async () => ({ containerFound: false, running: false, managed: false, cronSchedule: null, interval: null, pruneDays: null, pendingRestart: false, initialDelay: '2m', backupOnStartup: true })),
    updateSettings: vi.fn(),
  },
}));
```

- [ ] **Step 6: Lancer toute la suite frontend, typecheck et lint**

Run: `pnpm --filter @mc/frontend exec vitest run && pnpm --filter @mc/frontend run typecheck && pnpm lint`
Expected: PASS, aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/backups/BackupScheduleCard.tsx packages/frontend/src/components/backups/BackupScheduleCard.test.tsx packages/frontend/src/pages/Backups.tsx packages/frontend/src/pages/Backups.test.tsx
git commit -m "feat(frontend): carte de planification des sauvegardes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation et vérification complète

**Files:**
- Modify: `docker-compose.example.yml:23-37`
- Modify: `README.md` (nouvelle section après « Restore »)
- Modify: `CLAUDE.md` (non suivi par git)
- Test: `packages/backend/src/backups/backup-settings.test.ts`

**Interfaces:**
- Consumes: `BACKUP_SETTINGS_COMPOSE_SNIPPET` (tâche 1).
- Produces: documentation alignée sur l'extrait, garantie par un test.

- [ ] **Step 1: Écrire le test d'alignement de la documentation**

Ajouter à `packages/backend/src/backups/backup-settings.test.ts` :

```ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

describe('documentation', () => {
  const root = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  it('docker-compose.example.yml and the README carry the exact compose snippet', () => {
    expect(root('docker-compose.example.yml')).toContain(BACKUP_SETTINGS_COMPOSE_SNIPPET);
    expect(root('README.md')).toContain(BACKUP_SETTINGS_COMPOSE_SNIPPET);
  });
});
```

(les imports vont en tête de fichier avec les autres).

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-settings.test.ts`
Expected: FAIL sur `documentation`.

- [ ] **Step 2: Mettre à jour `docker-compose.example.yml`**

Remplacer le service `mc-backup` par :

```yaml
  mc-backup:
    image: itzg/mc-backup:latest
    container_name: mc-backup
    # Same UID as the MC Manager backend (node, 1000) so it can delete archives.
    user: "1000:1000"
    restart: unless-stopped
    depends_on: { mc: { condition: service_healthy } }
    # Reads the interval and retention set from the Backups page (see README, "Backup schedule").
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
      BACKUP_METHOD: tar
      # Fallbacks until a schedule is set from the Backups page.
      BACKUP_INTERVAL: "2h"
      PRUNE_BACKUPS_DAYS: "7"
      RCON_HOST: mc
      RCON_PASSWORD: "change-me"
      INITIAL_DELAY: "2m"
    volumes: ["mc-data:/data:ro", "mc-backups:/backups"]
    networks: [mc-network]
```

- [ ] **Step 3: Ajouter la section README**

Insérer après la section `## Restore` (avant `## Server configuration`) :

````markdown
## Backup schedule

The Backups page shows how often `mc-backup` runs and how long archives are kept, and lets an admin change both (interval from 30 minutes to 7 days, retention from 1 to 365 days).

Docker cannot change the environment of an existing container, so MC Manager writes the two values to a file in the backups volume, `.mc-manager/backup-settings.conf`, and restarts `mc-backup`. The image has no native way to read such a file: add this entrypoint once to the `mc-backup` service of your Minecraft stack, then recreate it with `docker compose up -d`:

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
```

- `$$` is the compose escape for `$`. The script never executes the file: it only exports the two variables, and only when they match a strict pattern. `BACKUP_INTERVAL` and `PRUNE_BACKUPS_DAYS` under `environment:` stay as fallbacks until a value is saved from the page.
- The backups volume must be mounted on `/backups` in `mc-backup` (the image default). Until the entrypoint is installed, the page shows the values read from the container, read-only, with the snippet to copy.
- Applying a change restarts `mc-backup` (MC Manager never creates nor removes containers). Its cycle starts over: the next backup runs after `INITIAL_DELAY` (2 minutes by default), then at the new interval. The change is refused while a backup or a restore is running.
- Manual backups ("Backup now") prune with the retention of the file too.
- With `CRON_SCHEDULE`, the image ignores the interval: the page shows the cron schedule and does not offer the change.
- Every change is admin-only and audited as `backup.settings`.
````

- [ ] **Step 4: Mettre à jour `CLAUDE.md` (fichier local, ignoré par git)**

Dans `## Architecture backend`, ajouter une puce après celle de **BackupService** :

```markdown
- **Planification de mc-backup** : `backups/backup-settings-service.ts` écrit `<MC_BACKUPS_DIR>/.mc-manager/backup-settings.conf` (`BACKUP_INTERVAL=…`, `PRUNE_BACKUPS_DAYS=…`) sous `DataLock('backup-settings')` puis redémarre mc-backup (`restartBackup`, `t: 10`) ; le point d'entrée à ajouter au compose (`BACKUP_SETTINGS_COMPOSE_SNIPPET` dans `@mc/common`, recopié dans `docker-compose.example.yml` et le README, un test vérifie l'identité) lit le fichier sans `source` et n'exporte que deux valeurs validées. `backups/backup-settings.ts` relit le fichier avec exactement les règles du `while read` du script (pas de rognage, dernière ligne non terminée ignorée) ; « géré » = `Config.Entrypoint`/`Cmd` contient `.mc-manager/backup-settings.conf` ; `CRON_SCHEDULE` présent = refus `not_managed`. Avant de redémarrer : `flock -n $DEST_DIR/.mc-backup-lock true` par exec si le fichier de verrou existe et sans `SKIP_LOCKING` (code 1 = 409 `busy`). `pendingRestart` = mtime du fichier > `StartedAt`. `BackupService.runNow()` passe `PRUNE_BACKUPS_DAYS` du fichier dans l'`Env` de l'exec (un exec hérite de `Config.Env`, pas du fichier). Routes `GET/PUT /api/backups/settings` (lecture tous rôles, écriture admin auditée `backup.settings`). Bornes : 30 min à 7 j, 1 à 365 jours.
```

Dans `## Architecture frontend`, ajouter :

```markdown
- `components/backups/BackupScheduleCard.tsx` (page Sauvegardes) : query `['backups', 'settings']`, formulaire nombre + unité et jours, confirmation qui annonce le redémarrage de mc-backup, bandeau `pendingRestart` avec « Réessayer », extrait de compose à copier pour un admin quand mc-backup ne lit pas le fichier.
```

Dans `## Invariants de sécurité`, remplacer le début de la puce « Le volume de données est monté en lecture-écriture… » pour ajouter, à la fin de cette puce :

```markdown
 Hors `/data`, la seule écriture est `.mc-manager/backup-settings.conf` (et son temporaire) dans le volume des backups, valeurs validées, admin, auditée, sous `DataLock` ; la seule action Docker ajoutée est le redémarrage de mc-backup (jamais de création ni de suppression de conteneur).
```

- [ ] **Step 5: Vérifier le compose et le test de documentation**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-settings.test.ts`
Expected: PASS.

Run (si Docker est disponible localement) : `docker compose -f docker-compose.example.yml config | grep -A14 "entrypoint:"`
Expected: le script rendu contient des `$` simples (`"$f"`, `"$k"`, `[mhd]$ ]]`) et aucun `$$`. Si Docker n'est pas disponible, le noter dans le rapport final.

- [ ] **Step 6: Reproduire la CI**

Run, dans l'ordre :

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @mc/common run build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: chaque commande se termine sans erreur. (`pnpm audit` et le build des Dockerfiles ne sont pas concernés par ce lot ; les lancer si le temps le permet.)

- [ ] **Step 7: Commit**

```bash
git add docker-compose.example.yml README.md packages/backend/src/backups/backup-settings.test.ts
git commit -m "docs(backups): point d'entrée de mc-backup et planification depuis la page Sauvegardes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## À faire par l'utilisateur après la fusion (hors plan)

- Ajouter le point d'entrée au service `mc-backup` de sa stack réelle, puis `docker compose up -d mc-backup`.
- Vérifier : `docker exec mc-backup cat /proc/1/environ | tr '\0' '\n' | grep -E 'BACKUP_INTERVAL|PRUNE'` après une application depuis la page ; la ligne « sleeping 12h... » dans les logs ; `flock -n` qui renvoie 1 pendant une vraie sauvegarde ; une sauvegarde environ 2 minutes après l'application ; une sauvegarde manuelle qui nettoie avec la rétention du fichier.

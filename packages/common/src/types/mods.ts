/** Grammaire d'une entrée MODRINTH_PROJECTS (partagée backend/frontend) : préfixe loader, projet, version, `?` optionnel. */
export const MODRINTH_ENTRY_RE = /^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$/i;
/** Taille maximale d'un jar déposé depuis la WebUI (nginx et backend appliquent la même limite). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export type ModsSource = 'file' | 'inline' | 'other' | 'none';
export type ModsDir = 'mods' | 'plugins';
export type ModsErrorCode =
  | 'invalid_entry' | 'duplicate' | 'unknown_project' | 'wrong_type' | 'loader_mismatch'
  | 'modrinth_unavailable' | 'unsupported_server' | 'busy' | 'conflict' | 'not_found'
  | 'invalid_query' | 'invalid_name' | 'too_large' | 'upload_aborted' | 'not_a_jar' | 'wrong_loader'
  | 'exists' | 'managed' | 'duplicate_mod';

/** Une entrée du fichier de liste Modrinth géré par MC Manager. */
export interface ModrinthMod {
  /** Texte exact de l'entrée (identifiant pour les routes). */
  entry: string;
  /** Partie projet, en minuscules, sans préfixe, version ni `?`. */
  slug: string;
  /** Ligne active (true) ou commentée (false). */
  enabled: boolean;
  /** Présent dans `projects` du manifeste écrit par l'image au dernier démarrage. */
  installed: boolean;
  title: string | null;
  /** Résumé court du projet Modrinth (anglais, 256 caractères max), null tant qu'il n'est pas en cache. */
  description: string | null;
  iconUrl: string | null;
  projectId: string | null;
}

/** Métadonnées lues dans le descripteur du jar (fabric.mod.json, mods.toml, plugin.yml). */
export interface JarMeta { id: string | null; name: string | null; version: string | null }

/** Un jar du dossier mods/ (ou plugins/) qui n'est pas géré par Modrinth. */
export interface ManualMod {
  /** Nom du fichier sans suffixe `.disabled` (identifiant pour les routes). */
  file: string;
  enabled: boolean;
  size: number;
  mtime: string;
  /** `file` et `file.disabled` existent tous les deux : aucune action possible. */
  conflict: boolean;
  /** null si le jar n'a pas de descripteur lisible. */
  meta: JarMeta | null;
}

export interface ModsView {
  /** null : type de serveur non supporté (vanilla, inconnu) ou conteneur introuvable ; voir serverIssue. */
  server: { loader: string; dir: ModsDir } | null;
  /** Pourquoi `server` est null : conteneur introuvable ou Docker injoignable, ou TYPE non supporté. */
  serverIssue: 'unavailable' | 'unsupported' | null;
  source: ModsSource;
  /** Entrées de la variable MODRINTH_PROJECTS quand source = 'inline' (pour l'import). */
  inlineEntries: string[];
  listingExists: boolean;
  /** Ligne à mettre dans le compose : MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt" */
  composeLine: string;
  restartRequired: boolean;
  modrinth: ModrinthMod[];
  /** Lignes du fichier conservées telles quelles : commentaires libres et lignes invalides. */
  unmanagedLines: { raw: string; invalid: boolean }[];
  manual: ManualMod[];
}

/** Un résultat de recherche Modrinth, relayé par le backend. */
export interface ModrinthSearchHit {
  slug: string;
  projectId: string;
  title: string;
  description: string | null;
  iconUrl: string | null;
  author: string | null;
  downloads: number;
  follows: number;
  latestVersion: string | null;
  /** Déjà dans le fichier de liste (actif ou désactivé). */
  alreadyListed: boolean;
}

/** Tags de catégorie Modrinth pour les projets de type mod (liste fixe de l'API, libellés dans i18n). */
export const MODRINTH_CATEGORIES = [
  'adventure', 'cursed', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics', 'library', 'magic', 'management',
  'minigame', 'mobs', 'optimization', 'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen',
] as const;
export type ModrinthCategory = (typeof MODRINTH_CATEGORIES)[number];

/** Tris acceptés par la recherche Modrinth ; `relevance` exige une requête, les autres permettent de feuilleter. */
export const MODS_SEARCH_INDEXES = ['relevance', 'downloads', 'follows', 'newest', 'updated'] as const;
export type ModsSearchIndex = (typeof MODS_SEARCH_INDEXES)[number];

export const MODS_SEARCH_PAGE = 20;
export const MODS_SEARCH_MAX_OFFSET = 10_000;

export interface ModsSearchQuery {
  q?: string;
  index?: ModsSearchIndex;
  offset?: number;
  category?: ModrinthCategory;
}

export interface ModsSearchResult {
  loader: string;
  /** Version Minecraft utilisée comme filtre ; null = inconnue, filtre sur le loader seul. */
  gameVersion: string | null;
  /** Nombre total de résultats côté Modrinth pour cette combinaison. */
  total: number;
  offset: number;
  hits: ModrinthSearchHit[];
}

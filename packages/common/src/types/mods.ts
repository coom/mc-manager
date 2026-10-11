export type ModsSource = 'file' | 'inline' | 'other' | 'none';
export type ModsDir = 'mods' | 'plugins';
export type ModsErrorCode =
  | 'invalid_entry' | 'duplicate' | 'unknown_project' | 'wrong_type' | 'loader_mismatch'
  | 'modrinth_unavailable' | 'unsupported_server' | 'busy' | 'conflict' | 'not_found';

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
  iconUrl: string | null;
  projectId: string | null;
}

/** Un jar du dossier mods/ (ou plugins/) qui n'est pas géré par Modrinth. */
export interface ManualMod {
  /** Nom du fichier sans suffixe `.disabled` (identifiant pour les routes). */
  file: string;
  enabled: boolean;
  size: number;
  mtime: string;
  /** `file` et `file.disabled` existent tous les deux : aucune action possible. */
  conflict: boolean;
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

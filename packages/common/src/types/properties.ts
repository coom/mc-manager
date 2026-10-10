export interface ServerPropertiesView {
  /** Contenu du fichier, mot de passe RCON masqué. */
  raw: string;
  values: Record<string, string>;
  /** clé → variable d'environnement itzg qui la gouverne (ou 'rcon' pour les clés RCON). */
  locked: Record<string, string>;
  exists: boolean;
  restartRequired: boolean;
}
export type ServerPropertiesUpdate = { values: Record<string, string> } | { raw: string };

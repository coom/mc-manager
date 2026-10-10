const ISO_RE = /^[A-Za-z]{2}$/;
/** Codes CLDR sans pays réel (ICU renvoie « Unknown Region » pour ZZ). */
const PSEUDO = new Set(['ZZ']);

/** Drapeau en indicateurs régionaux Unicode ; chaîne vide si le code est absent ou mal formé. */
export function flagEmoji(iso: string | null | undefined): string {
  if (!iso || !ISO_RE.test(iso)) return '';
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

/** Nom du pays dans la langue demandée via Intl.DisplayNames, sinon le code lui-même. */
export function countryName(iso: string, lang: string): string {
  if (PSEUDO.has(iso.toUpperCase())) return iso;
  try {
    const name = new Intl.DisplayNames([lang], { type: 'region' }).of(iso.toUpperCase());
    return name && name !== iso.toUpperCase() ? name : iso;
  } catch { return iso; }
}

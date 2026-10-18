import crypto from 'node:crypto';

// Sans 0/O/1/I pour éviter les erreurs de saisie
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function codeAleatoire(longueur) {
  let s = '';
  for (let i = 0; i < longueur; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

/** Identifiant d'organisation saisi dans l'application, ex. ORG-7KQ4MX */
export const genererCodeOrganisation = () => `ORG-${codeAleatoire(6)}`;

/** Jeton d'abonnement, ex. TMB-AB12-CD34-EF56-GH78-JK90 (environ 100 bits d'entropie) */
export const genererTokenLicence = () =>
  'TMB-' + Array.from({ length: 5 }, () => codeAleatoire(4)).join('-');

export const normaliserToken = (t) => String(t || '').trim().toUpperCase().replace(/\s+/g, '');

export const hashToken = (t) => crypto.createHash('sha256').update(normaliserToken(t)).digest('hex');

export function slugify(texte) {
  return String(texte)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'organisation';
}

export const estPinValide = (pin) => /^\d{4}$/.test(String(pin ?? ''));

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

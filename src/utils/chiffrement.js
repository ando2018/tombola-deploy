import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Chiffrement réversible (AES-256-GCM) des jetons d'abonnement, pour pouvoir les recopier
 * depuis l'admin. La vérification à la connexion continue de se faire sur le hash.
 */
const cle = () => crypto.createHash('sha256').update(config.tokenSecret).digest();

export function chiffrer(texte) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle(), iv);
  const donnees = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), donnees].map((b) => b.toString('base64url')).join('.');
}

/** Retourne null si la valeur est absente ou a été chiffrée avec une autre clé */
export function dechiffrer(valeur) {
  if (!valeur) return null;
  try {
    const [iv, tag, donnees] = valeur.split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', cle(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(donnees), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

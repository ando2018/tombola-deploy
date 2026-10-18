import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { chiffrer, dechiffrer } from '../utils/chiffrement.js';
import { genererTokenLicence, hashToken, normaliserToken } from '../utils/codes.js';
import { badRequest, forbidden, unauthorized } from '../utils/http-error.js';

const MESSAGES_STATUT = {
  REVOQUE: 'Ce jeton d\'abonnement a été révoqué',
  EXPIRE: 'L\'abonnement a expiré',
  A_VENIR: 'L\'abonnement n\'a pas encore commencé',
};

/** Statuts d'abonnement qui donnent accès à l'application (EXPIRE : consultation et export uniquement) */
export const STATUTS_ACCES = ['ACTIF', 'EXPIRE'];

/**
 * Vérifie le couple « identifiant d'organisation + jeton » saisi dans l'application.
 * Un abonnement expiré reste accepté en lecture seule (`lectureSeule: true`) ;
 * révoqué ou pas encore commencé : refusé.
 */
export async function verifierActivation(organisationCode, token) {
  const code = String(organisationCode || '').trim().toUpperCase();
  if (!code || !token) throw badRequest('Identifiant d\'organisation et jeton requis');

  // L'identifiant d'organisation n'est pas secret (il figure dans le lien de connexion) :
  // on peut donc dire précisément lequel des deux est faux.
  const org = await Organisation.findOne({ code });
  if (!org) throw unauthorized(`Identifiant d'organisation inconnu : ${code}`, { code: 'ORGANISATION_INCONNUE' });
  const licence = await Licence.findOne({ organisationId: org._id, tokenHash: hashToken(token) });
  if (!licence) {
    throw unauthorized('Jeton d\'abonnement invalide pour cette organisation. Vérifiez la saisie ou demandez un nouveau jeton à votre administrateur.', { code: 'ACTIVATION_INVALIDE' });
  }

  if (!org.actif) throw forbidden('Organisation désactivée', { code: 'ORGANISATION_INACTIVE' });
  if (!STATUTS_ACCES.includes(licence.statut)) {
    throw forbidden(MESSAGES_STATUT[licence.statut], { code: `LICENCE_${licence.statut}` });
  }
  return { org, licence, lectureSeule: licence.statut === 'EXPIRE' };
}

export function lirePeriode(body, existante) {
  const debut = body.dateDebut ? new Date(body.dateDebut) : (existante?.dateDebut ?? new Date());
  let fin;
  if (body.dateFin) fin = new Date(body.dateFin);
  else if (body.dureeMois) {
    fin = new Date(debut);
    fin.setMonth(fin.getMonth() + Number(body.dureeMois));
  } else fin = existante?.dateFin ?? new Date(new Date(debut).setFullYear(debut.getFullYear() + 1));

  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) throw badRequest('Dates invalides');
  if (fin <= debut) throw badRequest('La date de fin doit être postérieure à la date de début');
  return { dateDebut: debut, dateFin: fin };
}

/** Crée un abonnement. Le jeton en clair n'est retourné qu'ici. `token` imposé : démo uniquement. */
export async function creerLicence(organisationId, body = {}, token = genererTokenLicence()) {
  const licence = await Licence.create({
    organisationId,
    libelle: body.libelle?.trim() || 'Abonnement',
    ...lirePeriode(body),
    ...champsToken(token),
  });
  return { licence, token };
}

export async function regenererToken(licence) {
  const token = genererTokenLicence();
  Object.assign(licence, champsToken(token));
  await licence.save();
  return token;
}

/** Hash (vérification à la connexion), version chiffrée (copie depuis l'admin) et aperçu */
function champsToken(token) {
  const normalise = normaliserToken(token);
  return { tokenHash: hashToken(normalise), tokenChiffre: chiffrer(normalise), tokenApercu: normalise.slice(-4) };
}

/** Jeton en clair d'un abonnement, ou null s'il n'est pas récupérable (créé avant le chiffrement) */
export async function lireToken(licenceId) {
  const l = await Licence.findById(licenceId).select('+tokenChiffre').lean();
  return dechiffrer(l?.tokenChiffre);
}

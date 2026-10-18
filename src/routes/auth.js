import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { requireUser, signerJwt } from '../middleware/auth.js';
import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { User } from '../models/user.js';
import { verifierActivation } from '../services/licences.js';
import { estPinValide, normaliserToken } from '../utils/codes.js';
import { badRequest, HttpError, unauthorized } from '../utils/http-error.js';

export const router = Router();

/** Message avec le délai restant avant de pouvoir réessayer */
const messageLimite = (req) => {
  const minutes = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 60000));
  return { message: `Trop de tentatives échouées, réessayez dans ${minutes} min` };
};

// Un PIN à 4 chiffres = 10 000 combinaisons : on limite par IP en plus du verrouillage par compte.
// Seuls les échecs comptent : un utilisateur qui se connecte normalement n'est jamais bloqué.
const limiteur = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: messageLimite,
});

// Simple vérification du cookie à l'ouverture de la page : pas de devinette possible, limite large
const limiteurLecture = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Trop de requêtes, patientez une minute' },
});

// Hash factice pour garder un temps de réponse constant quand le login n'existe pas
const HASH_FACTICE = bcrypt.hashSync('0000', 10);

const resumeOrganisation = (o) => ({ id: o._id, nom: o.nom, code: o.code, slug: o.slug });
const resumeLicence = (l) => ({ id: l._id, libelle: l.libelle, dateDebut: l.dateDebut, dateFin: l.dateFin });

// ---------- Cookie du jeton d'abonnement ----------
// Un cookie par organisation, httpOnly : le jeton n'est jamais lisible par le JavaScript de la page.

const normaliserCode = (code) => String(code || '').trim().toUpperCase();
const nomCookie = (code) => `tombola_lic_${normaliserCode(code).replace(/[^A-Z0-9-]/g, '')}`;
const optionsCookie = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api/auth' };

/** Après la fin de l'abonnement, l'appareil garde un accès en consultation pendant cette durée */
const CONSULTATION_APRES_EXPIRATION_MS = 365 * 24 * 3600 * 1000;

function poserCookie(res, code, token, licence) {
  const expires = new Date(new Date(licence.dateFin).getTime() + CONSULTATION_APRES_EXPIRATION_MS);
  res.cookie(nomCookie(code), normaliserToken(token), { ...optionsCookie, expires });
}

function effacerCookie(res, code) {
  res.clearCookie(nomCookie(code), optionsCookie);
}

/**
 * Jeton fourni dans le corps (saisie) ou, à défaut, lu dans le cookie de l'organisation.
 * Si le jeton du cookie n'est plus valide (révoqué, expiré…), le cookie est effacé.
 */
async function activationDepuisRequete(req, res, organisationCode) {
  const duCookie = !req.body?.token;
  const token = req.body?.token || req.cookies?.[nomCookie(organisationCode)];
  if (!token) throw unauthorized('Jeton d\'abonnement requis', { code: 'ACTIVATION_REQUISE' });
  try {
    const resultat = await verifierActivation(organisationCode, token);
    // Les dates de l'abonnement ont pu changer : l'expiration du cookie suit la date de fin
    poserCookie(res, resultat.org.code, token, resultat.licence);
    return resultat;
  } catch (err) {
    if (duCookie) effacerCookie(res, organisationCode);
    throw err;
  }
}

/** Saisie du jeton : vérifié puis mémorisé dans le cookie de l'appareil. */
router.post('/activation', limiteur, async (req, res) => {
  const { organisationCode, token } = req.body ?? {};
  const { org, licence, lectureSeule } = await verifierActivation(organisationCode, token);
  poserCookie(res, org.code, token, licence);
  res.json({ organisation: resumeOrganisation(org), licence: resumeLicence(licence), lectureSeule });
});

/** L'appareil a-t-il un jeton valide pour cette organisation ? (lien /connexion/:code) */
router.get('/activation/:code', limiteurLecture, async (req, res) => {
  const token = req.cookies?.[nomCookie(req.params.code)];
  if (!token) return res.json({ activee: false });
  try {
    const { org, licence, lectureSeule } = await verifierActivation(req.params.code, token);
    poserCookie(res, org.code, token, licence);
    res.json({ activee: true, organisation: resumeOrganisation(org), licence: resumeLicence(licence), lectureSeule });
  } catch (err) {
    effacerCookie(res, req.params.code);
    res.json({ activee: false, message: err.message });
  }
});

/** Oublie le jeton sur cet appareil */
router.delete('/activation/:code', (req, res) => {
  effacerCookie(res, req.params.code);
  res.status(204).end();
});

/** Connexion : identifiant d'organisation + login + PIN (jeton pris dans le cookie). */
router.post('/login', limiteur, async (req, res) => {
  const { organisationCode, login, pin } = req.body ?? {};
  const { org, licence } = await activationDepuisRequete(req, res, organisationCode);
  if (!estPinValide(pin)) throw badRequest('Le code PIN doit comporter 4 chiffres');

  const user = await User.findOne({ organisationId: org._id, login: String(login || '').trim().toLowerCase() })
    .select('+pinHash +echecsPin');

  if (!user || !user.actif) {
    await bcrypt.compare(String(pin), HASH_FACTICE);
    throw unauthorized('Login ou code PIN incorrect');
  }

  const now = new Date();
  if (user.bloqueJusqua && user.bloqueJusqua > now) {
    const minutes = Math.ceil((user.bloqueJusqua - now) / 60000);
    throw new HttpError(423, `Compte verrouillé suite à trop d'essais. Réessayez dans ${minutes} min ou contactez un administrateur.`);
  }

  if (!(await bcrypt.compare(String(pin), user.pinHash))) {
    const maj = await User.findByIdAndUpdate(user._id, { $inc: { echecsPin: 1 } }, { returnDocument: 'after' })
      .select('+echecsPin');
    if (maj.echecsPin >= config.pinMaxEchecs) {
      await User.updateOne({ _id: user._id }, {
        echecsPin: 0, bloqueJusqua: new Date(now.getTime() + config.pinBlocageMinutes * 60000),
      });
      throw new HttpError(423, `Compte verrouillé pendant ${config.pinBlocageMinutes} minutes`);
    }
    const restants = config.pinMaxEchecs - maj.echecsPin;
    throw unauthorized(`Login ou code PIN incorrect (${restants} essai(s) restant(s))`);
  }

  await Promise.all([
    User.updateOne({ _id: user._id }, { echecsPin: 0, $unset: { bloqueJusqua: 1 }, derniereConnexion: now }),
    Licence.updateOne({ _id: licence._id }, { derniereUtilisation: now }),
  ]);

  // L'abonnement est revérifié à chaque requête : à son expiration, la session passe
  // simplement en lecture seule, elle n'a donc pas besoin de s'arrêter à la date de fin
  const duree = config.sessionHeures * 3600;
  const jwt = signerJwt({ typ: 'org', sub: String(user._id), org: String(org._id), lic: String(licence._id), role: user.role }, duree);

  res.json({
    token: jwt,
    expireLe: new Date(now.getTime() + duree * 1000),
    user: { id: user._id, login: user.login, nom: user.nom, role: user.role },
    organisation: resumeOrganisation(org),
    licence: resumeLicence(licence),
    lectureSeule: licence.statut === 'EXPIRE',
  });
});

router.get('/me', requireUser, async (req, res) => {
  const [user, org, licence] = await Promise.all([
    User.findById(req.auth.userId).lean(),
    Organisation.findById(req.auth.organisationId).lean(),
    Licence.findById(req.auth.licenceId).lean(),
  ]);
  res.json({
    user: { id: user._id, login: user.login, nom: user.nom, role: user.role },
    organisation: resumeOrganisation(org),
    licence: resumeLicence(licence),
    lectureSeule: req.auth.lectureSeule,
  });
});

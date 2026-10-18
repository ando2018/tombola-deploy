import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { User } from '../models/user.js';
import { STATUTS_ACCES } from '../services/licences.js';
import { forbidden, unauthorized } from '../utils/http-error.js';

export function signerJwt(payload, expiresInSec) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: Math.max(60, Math.floor(expiresInSec)) });
}

function lireJwt(req) {
  const [type, token] = (req.headers.authorization || '').split(' ');
  if (type !== 'Bearer' || !token) throw unauthorized();
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Session expirée, reconnectez-vous');
  }
}

export function requireSuperAdmin(req, _res, next) {
  if (lireJwt(req).role !== 'SUPERADMIN') throw forbidden();
  next();
}

/**
 * Utilisateur d'une organisation. On revérifie à chaque requête que l'organisation,
 * l'abonnement et le compte sont toujours actifs : une révocation prend effet immédiatement.
 */
export async function requireUser(req, _res, next) {
  const p = lireJwt(req);
  if (p.typ !== 'org') throw unauthorized();

  const [user, licence, org] = await Promise.all([
    User.findById(p.sub).lean(),
    Licence.findById(p.lic),
    Organisation.findById(p.org).lean(),
  ]);

  if (!org?.actif) throw unauthorized('Organisation désactivée', { code: 'ORGANISATION_INACTIVE' });
  if (!licence || String(licence.organisationId) !== p.org || !STATUTS_ACCES.includes(licence.statut)) {
    throw unauthorized('Abonnement révoqué ou invalide', { code: 'LICENCE_INVALIDE' });
  }
  if (!user?.actif || String(user.organisationId) !== p.org) throw unauthorized('Compte désactivé');

  req.auth = {
    userId: user._id, organisationId: org._id, role: user.role, licenceId: licence._id,
    // Abonnement expiré : consultation et export uniquement
    lectureSeule: licence.statut === 'EXPIRE',
  };
  next();
}

const METHODES_LECTURE = ['GET', 'HEAD', 'OPTIONS'];

/** Refuse toute modification quand l'abonnement est expiré (lecture seule). */
export function ecritureAutorisee(req, _res, next) {
  if (req.auth?.lectureSeule && !METHODES_LECTURE.includes(req.method)) {
    throw forbidden('Abonnement expiré : consultation et export uniquement. Demandez un nouveau jeton pour vendre ou modifier.', { code: 'LECTURE_SEULE' });
  }
  next();
}

/**
 * Identifie l'utilisateur s'il est connecté, sans bloquer les visiteurs (page de contact publique).
 * Une session encore signée mais dont l'abonnement a expiré reste identifiée
 * (flag `abonnementInvalide`) : c'est justement le moment de demander un nouveau jeton.
 */
export async function utilisateurOptionnel(req, res, next) {
  if (req.headers.authorization) {
    try {
      await requireUser(req, res, () => {});
    } catch {
      req.auth = undefined;
      try {
        const p = lireJwt(req);
        if (p.typ === 'org') req.auth = { userId: p.sub, organisationId: p.org, role: p.role, abonnementInvalide: true };
      } catch { /* jeton illisible ou expiré : visiteur */ }
    }
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.auth?.role !== 'ADMIN') throw forbidden('Réservé aux administrateurs');
  next();
}

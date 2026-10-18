import bcrypt from 'bcryptjs';
import { User } from '../models/user.js';
import { estPinValide } from '../utils/codes.js';
import { badRequest } from '../utils/http-error.js';

const ROLES = ['ADMIN', 'VENDEUR'];

function verifierPin(pin) {
  if (!estPinValide(pin)) throw badRequest('Le code PIN doit comporter exactement 4 chiffres');
  return String(pin);
}

/** Valide les champs d'un nouvel utilisateur et retourne le login normalisé. */
export function validerNouvelUtilisateur({ login, pin, role }) {
  const l = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(l)) {
    throw badRequest('Login invalide (2 à 30 caractères : lettres, chiffres, . _ -)');
  }
  if (role && !ROLES.includes(role)) throw badRequest('Rôle invalide');
  verifierPin(pin);
  return l;
}

export async function creerUtilisateur(organisationId, data) {
  const login = validerNouvelUtilisateur(data);
  return User.create({
    organisationId,
    login,
    nom: data.nom?.trim(),
    role: data.role || 'VENDEUR',
    pinHash: await bcrypt.hash(String(data.pin), 10),
  });
}

/** Modifie nom / rôle / actif / PIN. `debloquer` remet à zéro le verrouillage. */
export async function modifierUtilisateur(user, { nom, pin, role, actif, debloquer }) {
  if (nom !== undefined) user.nom = String(nom).trim();
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw badRequest('Rôle invalide');
    user.role = role;
  }
  if (actif !== undefined) user.actif = Boolean(actif);
  if (pin !== undefined && pin !== '') {
    user.pinHash = await bcrypt.hash(verifierPin(pin), 10);
    debloquer = true;
  }
  if (debloquer) {
    user.echecsPin = 0;
    user.bloqueJusqua = undefined;
  }
  await user.save();
  return user;
}

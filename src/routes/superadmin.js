import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { requireSuperAdmin, signerJwt } from '../middleware/auth.js';
import { Licence, statutLicence } from '../models/licence.js';
import { Message, STATUTS_MESSAGE, TYPES_MESSAGE } from '../models/message.js';
import { envoyerMail } from '../services/mail.js';
import { Organisation } from '../models/organisation.js';
import { User } from '../models/user.js';
import { creerLicence, lirePeriode, lireToken, regenererToken } from '../services/licences.js';
import { creerUtilisateur, modifierUtilisateur, validerNouvelUtilisateur } from '../services/users.js';
import { genererCodeOrganisation, slugify } from '../utils/codes.js';
import { badRequest, notFound, oid, unauthorized } from '../utils/http-error.js';

export const router = Router();

const egal = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest(),
);

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, message: { message: 'Trop de tentatives échouées, réessayez plus tard' } }), (req, res) => {
  const { login, password } = req.body ?? {};
  if (!egal(login ?? '', config.superAdmin.login) || !egal(password ?? '', config.superAdmin.password)) {
    throw unauthorized('Identifiants incorrects');
  }
  res.json({ token: signerJwt({ typ: 'superadmin', role: 'SUPERADMIN' }, 8 * 3600) });
});

router.use(requireSuperAdmin);

// ---------- Organisations ----------

async function codeUnique() {
  for (let i = 0; i < 10; i++) {
    const code = genererCodeOrganisation();
    if (!(await Organisation.exists({ code }))) return code;
  }
  throw new Error('Impossible de générer un code unique');
}

async function slugUnique(base, exclureId) {
  const racine = slugify(base);
  for (let i = 1; ; i++) {
    const slug = i === 1 ? racine : `${racine}-${i}`;
    if (!(await Organisation.exists({ slug, _id: { $ne: exclureId } }))) return slug;
  }
}

router.get('/organisations', async (_req, res) => {
  const [orgs, licences, comptes] = await Promise.all([
    Organisation.find().sort({ createdAt: -1 }).lean(),
    Licence.find().sort({ dateFin: -1 }).lean(),
    User.aggregate([{ $group: { _id: '$organisationId', n: { $sum: 1 } } }]),
  ]);
  const nbUsers = new Map(comptes.map((c) => [String(c._id), c.n]));

  res.json(orgs.map((o) => {
    const siennes = licences.filter((l) => String(l.organisationId) === String(o._id));
    const active = siennes.find((l) => statutLicence(l) === 'ACTIF');
    const aVenir = siennes.filter((l) => statutLicence(l) === 'A_VENIR')
      .sort((a, b) => a.dateDebut - b.dateDebut)[0];
    return {
      ...o,
      nbUtilisateurs: nbUsers.get(String(o._id)) ?? 0,
      nbLicences: siennes.length,
      abonnementActif: !!active,
      finAbonnement: active?.dateFin ?? siennes[0]?.dateFin ?? null,
      /** Prochain abonnement programmé (date de début dans le futur) */
      debutProchainAbonnement: aVenir?.dateDebut ?? null,
    };
  }));
});

/**
 * Crée une organisation. Optionnellement, crée en même temps le premier abonnement
 * (`licence`) et le premier administrateur (`admin`).
 */
router.post('/organisations', async (req, res) => {
  const { nom, contact, licence, admin } = req.body ?? {};
  if (!nom?.trim()) throw badRequest('Le nom est requis');
  // Validation avant toute écriture
  if (admin) validerNouvelUtilisateur(admin);
  if (licence) lirePeriode(licence);

  const org = await Organisation.create({
    nom, contact, code: await codeUnique(), slug: await slugUnique(req.body.slug || nom),
  });

  const resultat = { organisation: org };
  try {
    if (licence) Object.assign(resultat, await creerLicence(org._id, licence));
    if (admin) resultat.admin = await creerUtilisateur(org._id, { ...admin, role: 'ADMIN' });
  } catch (err) {
    // On ne laisse pas une organisation à moitié créée
    await Promise.all([
      Licence.deleteMany({ organisationId: org._id }),
      User.deleteMany({ organisationId: org._id }),
      Organisation.deleteOne({ _id: org._id }),
    ]);
    throw err;
  }
  res.status(201).json(resultat);
});

async function chargerOrganisation(id) {
  const org = await Organisation.findById(oid(id, 'Organisation introuvable'));
  if (!org) throw notFound('Organisation introuvable');
  return org;
}

router.get('/organisations/:id', async (req, res) => {
  const org = await chargerOrganisation(req.params.id);
  const [licences, utilisateurs] = await Promise.all([
    Licence.find({ organisationId: org._id }).select('+tokenChiffre').sort({ dateFin: -1 }),
    User.find({ organisationId: org._id }).sort({ login: 1 }),
  ]);
  // On indique seulement si le jeton peut être recopié ; il n'est envoyé qu'à la demande
  const liste = licences.map((l) => ({ ...l.toJSON(), tokenRecuperable: !!l.tokenChiffre }));
  res.json({ organisation: org, licences: liste, utilisateurs });
});

router.patch('/organisations/:id', async (req, res) => {
  const org = await chargerOrganisation(req.params.id);
  const { nom, contact, actif, slug } = req.body ?? {};
  if (nom !== undefined) org.nom = nom;
  if (contact !== undefined) org.contact = contact;
  if (actif !== undefined) org.actif = Boolean(actif);
  if (slug) org.slug = await slugUnique(slug, org._id);
  await org.save();
  res.json(org);
});

// ---------- Abonnements (jetons) ----------

router.post('/organisations/:id/licences', async (req, res) => {
  const org = await chargerOrganisation(req.params.id);
  const { licence, token } = await creerLicence(org._id, req.body ?? {});
  res.status(201).json({ licence, token });
});

async function chargerLicence(id) {
  const licence = await Licence.findById(oid(id, 'Abonnement introuvable'));
  if (!licence) throw notFound('Abonnement introuvable');
  return licence;
}

/** Prolonger, modifier ou révoquer un abonnement */
router.patch('/licences/:id', async (req, res) => {
  const licence = await chargerLicence(req.params.id);
  const { libelle, revoque, dateDebut, dateFin, dureeMois } = req.body ?? {};
  if (libelle !== undefined) licence.libelle = libelle;
  if (revoque !== undefined) licence.revoque = Boolean(revoque);
  if (dateDebut || dateFin || dureeMois) {
    Object.assign(licence, lirePeriode({ dateDebut, dateFin, dureeMois }, licence));
  }
  await licence.save();
  res.json(licence);
});

/** Jeton en clair, pour le copier */
router.get('/licences/:id/token', async (req, res) => {
  const licence = await chargerLicence(req.params.id);
  const token = await lireToken(licence._id);
  if (!token) {
    throw notFound('Ce jeton ne peut pas être recopié (créé avant cette fonctionnalité) : générez un nouveau jeton');
  }
  res.json({ token });
});

/** Nouveau jeton pour le même abonnement (l'ancien devient invalide) */
router.post('/licences/:id/regenerer', async (req, res) => {
  const licence = await chargerLicence(req.params.id);
  const token = await regenererToken(licence);
  res.json({ licence, token });
});

router.delete('/licences/:id', async (req, res) => {
  const licence = await chargerLicence(req.params.id);
  await licence.deleteOne();
  res.status(204).end();
});

// ---------- Messages reçus des organisations ----------

router.get('/messages', async (req, res) => {
  const { statut, type, organisationId } = req.query;
  const filtre = {};
  if (STATUTS_MESSAGE.includes(statut)) filtre.statut = statut;
  if (TYPES_MESSAGE.includes(type)) filtre.type = type;
  if (organisationId) filtre.organisationId = oid(organisationId, 'Organisation introuvable');
  const [messages, nonLus] = await Promise.all([
    Message.find(filtre).sort({ createdAt: -1 }).limit(300).lean(),
    Message.countDocuments({ statut: 'NOUVEAU' }),
  ]);
  res.json({ messages, nonLus });
});

router.get('/messages/non-lus', async (_req, res) => {
  res.json({ nonLus: await Message.countDocuments({ statut: 'NOUVEAU' }) });
});

async function chargerMessage(id) {
  const m = await Message.findById(oid(id, 'Message introuvable'));
  if (!m) throw notFound('Message introuvable');
  return m;
}

/** Statut (LU / TRAITE / NOUVEAU) et/ou réponse, envoyée par e-mail à l'auteur si possible */
router.patch('/messages/:id', async (req, res) => {
  const m = await chargerMessage(req.params.id);
  const { statut, reponse } = req.body ?? {};
  if (statut !== undefined) {
    if (!STATUTS_MESSAGE.includes(statut)) throw badRequest('Statut invalide');
    m.statut = statut;
  }
  let emailEnvoye = false;
  if (reponse !== undefined && String(reponse).trim()) {
    m.reponse = String(reponse).trim();
    m.reponduLe = new Date();
    m.reponseLueLe = undefined; // nouvelle réponse : non lue par l'organisation
    m.statut = 'TRAITE';
    emailEnvoye = await envoyerMail({
      a: m.auteur.email,
      sujet: `Re: ${m.sujet}`,
      texte: `${m.reponse}\n\n— Votre message du ${m.createdAt.toLocaleDateString('fr-FR')} :\n${m.message}`,
    });
  }
  await m.save();
  res.json({ message: m, emailEnvoye });
});

router.delete('/messages/:id', async (req, res) => {
  const m = await chargerMessage(req.params.id);
  await m.deleteOne();
  res.status(204).end();
});

// ---------- Utilisateurs d'une organisation ----------

router.post('/organisations/:id/utilisateurs', async (req, res) => {
  const org = await chargerOrganisation(req.params.id);
  res.status(201).json(await creerUtilisateur(org._id, req.body ?? {}));
});

async function chargerUtilisateur(id) {
  const user = await User.findById(oid(id, 'Utilisateur introuvable'));
  if (!user) throw notFound('Utilisateur introuvable');
  return user;
}

router.patch('/utilisateurs/:id', async (req, res) => {
  const user = await chargerUtilisateur(req.params.id);
  res.json(await modifierUtilisateur(user, req.body ?? {}));
});

router.delete('/utilisateurs/:id', async (req, res) => {
  const user = await chargerUtilisateur(req.params.id);
  await user.deleteOne();
  res.status(204).end();
});

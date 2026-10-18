import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { requireUser, utilisateurOptionnel } from '../middleware/auth.js';
import { Message, TYPES_MESSAGE } from '../models/message.js';
import { Organisation } from '../models/organisation.js';
import { User } from '../models/user.js';
import { envoyerMail } from '../services/mail.js';
import { badRequest } from '../utils/http-error.js';

/**
 * Contact du super admin. Accessible connecté (organisation et auteur renseignés automatiquement)
 * ou sans connexion (jeton expiré : l'utilisateur ne peut plus se connecter).
 */
export const router = Router();

// Les visiteurs non connectés sont limités (anti-spam) ; les utilisateurs connectés non
const limiteurPublic = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  skip: (req) => !!req.auth,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Trop de messages envoyés, réessayez plus tard' },
});

const LIBELLES_TYPE = { QUESTION: 'Question', DEMANDE_JETON: 'Demande de jeton', PROBLEME: 'Problème', AUTRE: 'Autre' };
const emailValide = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

router.post('/', utilisateurOptionnel, limiteurPublic, async (req, res) => {
  const b = req.body ?? {};
  // Champ piège invisible : rempli uniquement par les robots
  if (b.site) return res.status(201).json({ ok: true });

  const type = TYPES_MESSAGE.includes(b.type) ? b.type : 'QUESTION';
  const sujet = String(b.sujet ?? '').trim() || LIBELLES_TYPE[type];
  const texte = String(b.message ?? '').trim();
  if (texte.length < 5) throw badRequest('Écrivez votre message');
  if (texte.length > 5000) throw badRequest('Message trop long (5000 caractères maximum)');
  const email = String(b.email ?? '').trim();
  if (email && !emailValide(email)) throw badRequest('Adresse e-mail invalide');

  let org = null;
  let auteur;
  if (req.auth) {
    const [o, user] = await Promise.all([Organisation.findById(req.auth.organisationId).lean(), User.findById(req.auth.userId).lean()]);
    org = o;
    auteur = { nom: b.nom?.trim() || user.nom || user.login, login: user.login, email, telephone: b.telephone?.trim() };
  } else {
    if (!b.nom?.trim()) throw badRequest('Indiquez votre nom');
    if (!email && !b.telephone?.trim()) throw badRequest('Indiquez un e-mail ou un téléphone pour qu\'on puisse vous répondre');
    const code = String(b.organisationCode ?? '').trim().toUpperCase();
    org = code ? await Organisation.findOne({ code }).lean() : null;
    auteur = { nom: b.nom.trim(), email, telephone: b.telephone?.trim() };
    b.organisationCode = code;
  }

  const message = await Message.create({
    organisationId: org?._id,
    organisationCode: org?.code ?? (b.organisationCode || undefined),
    organisationNom: org?.nom,
    userId: req.auth?.userId,
    auteur,
    connecte: !!req.auth,
    type,
    sujet,
    message: texte,
  });

  // Copie par e-mail au super admin (si SMTP configuré)
  const envoye = await envoyerMail({
    a: config.superAdmin.email,
    repondreA: email,
    sujet: `[Tombola] ${LIBELLES_TYPE[type]} — ${org?.nom ?? message.organisationCode ?? 'organisation inconnue'} : ${sujet}`,
    texte: [
      `Organisation : ${org?.nom ?? '—'} (${message.organisationCode ?? 'non précisée'})`,
      `De : ${auteur.nom}${auteur.login ? ` (login ${auteur.login})` : ''}`,
      `E-mail : ${email || '—'} · Téléphone : ${auteur.telephone || '—'}`,
      '', texte,
    ].join('\n'),
  });
  if (envoye) await Message.updateOne({ _id: message._id }, { emailEnvoye: true });

  res.status(201).json({ ok: true, id: message._id });
});

/** Messages envoyés par l'organisation connectée, avec la réponse du super admin */
router.get('/mes-messages', requireUser, async (req, res) => {
  res.json(await Message.find({ organisationId: req.auth.organisationId })
    .sort({ createdAt: -1 }).limit(50)
    .select('type sujet message statut reponse reponduLe reponseLueLe createdAt auteur.nom').lean());
});

/** Réponses du super admin pas encore vues par l'organisation (pastille du menu Contact) */
const filtreNonLues = (organisationId) => ({ organisationId, reponse: { $nin: [null, ''] }, reponseLueLe: null });

router.get('/reponses-non-lues', requireUser, async (req, res) => {
  res.json({ nombre: await Message.countDocuments(filtreNonLues(req.auth.organisationId)) });
});

/** L'organisation a ouvert la page Contact : ses réponses sont lues */
router.post('/reponses-lues', requireUser, async (req, res) => {
  const r = await Message.updateMany(filtreNonLues(req.auth.organisationId), { reponseLueLe: new Date() });
  res.json({ marquees: r.modifiedCount });
});

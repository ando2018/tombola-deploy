import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { lireToken } from '../services/licences.js';
import { badRequest, notFound } from '../utils/http-error.js';

/**
 * Abonnement de l'organisation, vu par son administrateur : il peut recopier le jeton
 * pour activer d'autres appareils (téléphones des vendeurs). Seul le jeton de la session courante est exposé.
 */
export const router = Router();
router.use(requireAdmin);

router.get('/', async (req, res) => {
  const [org, licence] = await Promise.all([
    Organisation.findById(req.auth.organisationId).lean(),
    Licence.findById(req.auth.licenceId),
  ]);
  res.json({
    organisationCode: org.code,
    libelle: licence.libelle,
    dateDebut: licence.dateDebut,
    dateFin: licence.dateFin,
    statut: licence.statut,
    tokenApercu: licence.tokenApercu,
  });
});

router.get('/jeton', async (req, res) => {
  const token = await lireToken(req.auth.licenceId);
  if (!token) throw notFound('Ce jeton ne peut pas être recopié : demandez-le à votre fournisseur');
  res.json({ token });
});

// ---------- Logo de l'organisation (icône d'onglet du navigateur + en-tête) ----------

const TYPES_LOGO = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const TAILLE_MAX_LOGO = 150 * 1024;

/** { image: "data:image/png;base64,..." } — image déjà redimensionnée par l'application */
router.put('/logo', async (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image ?? ''));
  if (!m) throw badRequest('Image invalide : formats acceptés PNG, JPEG ou WebP');
  const donnees = Buffer.from(m[2], 'base64');
  if (donnees.length > TAILLE_MAX_LOGO) throw badRequest('Image trop lourde (150 Ko maximum)');
  // Le contenu doit correspondre au type annoncé
  if (!TYPES_LOGO[m[1]].every((o, i) => donnees[i] === o)) throw badRequest('Le contenu ne correspond pas à une image ' + m[1]);

  const logoMaj = new Date();
  await Organisation.updateOne({ _id: req.auth.organisationId }, { logo: { type: m[1], donnees }, logoMaj });
  res.json({ logoMaj });
});

router.delete('/logo', async (req, res) => {
  await Organisation.updateOne({ _id: req.auth.organisationId }, { $unset: { logo: 1, logoMaj: 1 } });
  res.json({ logoMaj: null });
});

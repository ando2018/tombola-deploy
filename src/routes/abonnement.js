import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { lireToken } from '../services/licences.js';
import { notFound } from '../utils/http-error.js';

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

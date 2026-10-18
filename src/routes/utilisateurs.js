import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { User } from '../models/user.js';
import { creerUtilisateur, modifierUtilisateur } from '../services/users.js';
import { badRequest, notFound, oid } from '../utils/http-error.js';

/** Gestion des comptes de l'organisation par son administrateur */
export const router = Router();
router.use(requireAdmin);

router.get('/', async (req, res) => {
  res.json(await User.find({ organisationId: req.auth.organisationId }).sort({ login: 1 }));
});

router.post('/', async (req, res) => {
  res.status(201).json(await creerUtilisateur(req.auth.organisationId, req.body ?? {}));
});

async function charger(req) {
  const user = await User.findOne({ _id: oid(req.params.id, 'Utilisateur introuvable'), organisationId: req.auth.organisationId });
  if (!user) throw notFound('Utilisateur introuvable');
  return user;
}

const estSoiMeme = (req, user) => String(user._id) === String(req.auth.userId);

router.patch('/:id', async (req, res) => {
  const user = await charger(req);
  const { role, actif } = req.body ?? {};
  if (estSoiMeme(req, user) && ((role && role !== 'ADMIN') || actif === false)) {
    throw badRequest('Vous ne pouvez pas retirer vos propres droits');
  }
  res.json(await modifierUtilisateur(user, req.body ?? {}));
});

router.delete('/:id', async (req, res) => {
  const user = await charger(req);
  if (estSoiMeme(req, user)) throw badRequest('Vous ne pouvez pas supprimer votre propre compte');
  await user.deleteOne();
  res.status(204).end();
});

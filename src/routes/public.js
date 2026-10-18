import { Router } from 'express';
import { Evenement } from '../models/evenement.js';
import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { Tirage } from '../models/tirage.js';
import { notFound, oid } from '../utils/http-error.js';

/** Page de publication : sans authentification, uniquement si l'abonnement est actif */
export const router = Router();

const STATUTS_PUBLICS = ['OUVERT', 'CLOS', 'TIRE'];

/**
 * Logo d'une organisation, par son identifiant (ORG-XXXXXX) ou son adresse publique.
 * Disponible même abonnement expiré : il sert d'icône d'onglet sur la page de connexion.
 * L'URL contient ?v=<date du logo> : le navigateur peut le garder en cache longtemps.
 */
router.get('/logo/:cle', async (req, res) => {
  const cle = String(req.params.cle);
  const org = await Organisation.findOne({ $or: [{ code: cle.toUpperCase() }, { slug: cle.toLowerCase() }], actif: true })
    .select('+logo.donnees logo.type').lean();
  if (!org?.logo?.donnees) throw notFound('Pas de logo');
  res.setHeader('Content-Type', org.logo.type);
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(org.logo.donnees.buffer ?? org.logo.donnees));
});

async function organisationPublique(slug) {
  const org = await Organisation.findOne({ slug: String(slug).toLowerCase(), actif: true }).lean();
  if (!org || !(await Licence.exists({ organisationId: org._id, ...Licence.filtreActif() }))) {
    throw notFound('Page indisponible');
  }
  return org;
}

/**
 * Informations publiques d'un événement. Ni le prix, ni le nombre de billets, ni les numéros
 * vendus ne sont exposés. La plage de numéros sert uniquement à l'animation du tirage.
 */
const champsPublics = (e) => ({
  id: e._id,
  nom: e.nom,
  description: e.description,
  dateTirage: e.dateTirage,
  numeroDebut: e.numeroDebut,
  numeroFin: e.numeroDebut + e.nombreTickets - 1,
  statut: e.statut,
  lots: e.lots,
});

router.get('/:slug', async (req, res) => {
  const org = await organisationPublique(req.params.slug);
  const evenements = await Evenement.find({ organisationId: org._id, statut: { $in: STATUTS_PUBLICS }, archive: { $ne: true } })
    .sort({ dateTirage: 1, createdAt: -1 }).lean();
  res.json({
    organisation: { nom: org.nom, slug: org.slug, logoMaj: org.logoMaj ?? null },
    evenements: evenements.map(champsPublics),
  });
});

router.get('/:slug/evenements/:id', async (req, res) => {
  const org = await organisationPublique(req.params.slug);
  const evt = await Evenement.findOne({
    _id: oid(req.params.id, 'Événement introuvable'), organisationId: org._id, statut: { $in: STATUTS_PUBLICS },
  }).lean();
  if (!evt) throw notFound('Événement introuvable');

  const tirage = await Tirage.findOne({ evenementId: evt._id }).populate('resultats.participantId', 'nom prenom').lean();

  // Tous les numéros sortis de l'urne, du plus récent au plus ancien (nom + numéro, sans coordonnées)
  const resultats = (tirage?.resultats ?? [])
    .sort((a, b) => b.ordre - a.ordre)
    .map((r) => ({
      ordre: r.ordre,
      numero: r.numero,
      statut: r.statut,
      lot: r.lot || undefined,
      tireLe: r.tireLe,
      nom: [r.participantId?.prenom, r.participantId?.nom].filter(Boolean).join(' '),
    }));

  res.json({
    organisation: { nom: org.nom, slug: org.slug, logoMaj: org.logoMaj ?? null },
    evenement: champsPublics(evt),
    resultats,
    enSuspens: resultats.find((r) => r.statut === 'EN_SUSPENS') ?? null,
  });
});

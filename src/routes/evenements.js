import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Evenement } from '../models/evenement.js';
import { Ticket } from '../models/ticket.js';
import { Tirage } from '../models/tirage.js';
import { Vente } from '../models/vente.js';
import { numerosVendus } from '../services/attribution.js';
import { annulerSaisie, deciderNumero, saisirNumero } from '../services/tirage.js';
import { statsEvenements } from '../services/ventes.js';
import { badRequest, conflict, notFound, oid } from '../utils/http-error.js';

export const router = Router();

/** Charge un événement de l'organisation connectée (jamais celui d'une autre). */
export async function chargerEvenement(req, id = req.params.id) {
  const evt = await Evenement.findOne({ _id: oid(id, 'Événement introuvable'), organisationId: req.auth.organisationId });
  if (!evt) throw notFound('Événement introuvable');
  return evt;
}

const TRANSITIONS = {
  BROUILLON: ['OUVERT'],
  OUVERT: ['CLOS', 'BROUILLON'],
  CLOS: ['OUVERT', 'TIRE'],
  TIRE: ['CLOS'],
};

function lireChamps(body) {
  const champs = {};
  for (const k of ['nom', 'description']) {
    if (body[k] !== undefined) champs[k] = body[k];
  }
  if (body.dateTirage !== undefined) champs.dateTirage = body.dateTirage || null;
  for (const k of ['prixTicket', 'nombreTickets', 'numeroDebut']) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 0) throw badRequest(`${k} doit être un entier positif`);
    champs[k] = n;
  }
  if (body.lots !== undefined) {
    if (!Array.isArray(body.lots)) throw badRequest('lots doit être une liste');
    // Liste indicative des lots, affichée sur la page publique
    champs.lots = body.lots
      .filter((l) => l?.libelle?.trim())
      .map((l, i) => ({ rang: i + 1, libelle: l.libelle.trim(), description: l.description?.trim() }));
  }
  return champs;
}

router.get('/', async (req, res) => {
  const evenements = await Evenement.find({ organisationId: req.auth.organisationId }).sort({ createdAt: -1 });
  const stats = await statsEvenements(evenements.map((e) => e._id));
  res.json(evenements.map((e) => ({ ...e.toJSON(), stats: stats.get(String(e._id)) })));
});

router.post('/', requireAdmin, async (req, res) => {
  const champs = lireChamps(req.body ?? {});
  const evt = await Evenement.create({ ...champs, organisationId: req.auth.organisationId, statut: 'BROUILLON' });
  res.status(201).json(evt);
});

router.get('/:id', async (req, res) => {
  const evt = await chargerEvenement(req);
  const [stats, tirage] = await Promise.all([
    statsEvenements([evt._id]),
    Tirage.findOne({ evenementId: evt._id }, { 'resultats.rang': 1 }).lean(),
  ]);
  res.json({ ...evt.toJSON(), stats: stats.get(String(evt._id)), tirageCommence: (tirage?.resultats.length ?? 0) > 0 });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const evt = await chargerEvenement(req);
  const champs = lireChamps(req.body ?? {});
  const tirage = await Tirage.findOne({ evenementId: evt._id }).lean();
  const tirageCommence = (tirage?.resultats.length ?? 0) > 0;

  const structurels = ['prixTicket', 'nombreTickets', 'numeroDebut'];
  if (tirageCommence && structurels.some((k) => k in champs)) {
    throw conflict('Le tirage a commencé : le prix et les numéros ne sont plus modifiables');
  }

  // La nouvelle plage doit contenir tous les numéros déjà vendus
  if ('nombreTickets' in champs || 'numeroDebut' in champs) {
    const debut = champs.numeroDebut ?? evt.numeroDebut;
    const fin = debut + (champs.nombreTickets ?? evt.nombreTickets) - 1;
    const horsPlage = await Ticket.countDocuments({ evenementId: evt._id, $or: [{ numero: { $lt: debut } }, { numero: { $gt: fin } }] });
    if (horsPlage) throw conflict(`${horsPlage} numéro(s) vendu(s) seraient hors de la nouvelle plage ${debut}-${fin}`);
  }

  const { statut } = req.body ?? {};
  if (statut && statut !== evt.statut) {
    if (!TRANSITIONS[evt.statut].includes(statut)) throw conflict(`Passage de ${evt.statut} à ${statut} impossible`);
    if (statut === 'OUVERT' && tirageCommence) throw conflict('Le tirage a commencé, les ventes ne peuvent pas rouvrir');
    const suspens = tirage?.resultats.find((r) => r.statut === 'EN_SUSPENS');
    if (statut === 'TIRE' && suspens) throw conflict(`Décidez d'abord du numéro ${suspens.numero} en suspens`);
    if (statut === 'BROUILLON' && await Vente.exists({ evenementId: evt._id, annulee: false })) {
      throw conflict('Des ventes existent, l\'événement ne peut pas repasser en brouillon');
    }
    champs.statut = statut;
  }

  Object.assign(evt, champs);
  await evt.save();
  res.json(evt);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const evt = await chargerEvenement(req);
  if (await Vente.exists({ evenementId: evt._id })) {
    throw conflict('Des ventes ont été enregistrées : clôturez l\'événement plutôt que de le supprimer');
  }
  await Promise.all([Tirage.deleteOne({ evenementId: evt._id }), evt.deleteOne()]);
  res.status(204).end();
});

/** Numéros vendus (les libres se déduisent de la plage) */
router.get('/:id/numeros', async (req, res) => {
  const evt = await chargerEvenement(req);
  res.json({ numeroDebut: evt.numeroDebut, numeroFin: evt.numeroFin, vendus: await numerosVendus(evt._id) });
});

// ---------- Tirage à l'urne ----------

async function etatTirage(evenementId) {
  const [evt, tirage, ticketsEnJeu] = await Promise.all([
    Evenement.findById(evenementId).lean(),
    Tirage.findOne({ evenementId })
      .populate('resultats.participantId', 'nom prenom telephone email')
      .populate('resultats.tirePar', 'login nom')
      .lean(),
    Ticket.countDocuments({ evenementId }),
  ]);
  const resultats = (tirage?.resultats ?? []).map(({ participantId, tirePar, ...r }) => ({ ...r, participant: participantId, tirePar }));

  // Signale à l'admin une personne qui a déjà gagné avec un autre ticket
  const gains = new Map();
  for (const r of resultats) {
    if (r.statut === 'GAGNANT') gains.set(String(r.participant?._id), (gains.get(String(r.participant?._id)) ?? 0) + 1);
  }
  for (const r of resultats) {
    r.autresGains = (gains.get(String(r.participant?._id)) ?? 0) - (r.statut === 'GAGNANT' ? 1 : 0);
  }

  return { statut: evt.statut, lots: evt.lots, ticketsEnJeu, resultats: resultats.sort((a, b) => b.ordre - a.ordre) };
}

router.get('/:id/tirage', async (req, res) => {
  const evt = await chargerEvenement(req);
  res.json(await etatTirage(evt._id));
});

/** Saisie du numéro sorti de l'urne */
router.post('/:id/tirage', requireAdmin, async (req, res) => {
  const evt = await chargerEvenement(req);
  await saisirNumero(evt, req.body?.numero, req.auth.userId);
  res.status(201).json(await etatTirage(evt._id));
});

/** Décision : { statut: 'GAGNANT' | 'NON_GAGNANT', lot? } */
router.patch('/:id/tirage/:resultatId', requireAdmin, async (req, res) => {
  const evt = await chargerEvenement(req);
  await deciderNumero(evt, req.params.resultatId, req.body ?? {}, req.auth.userId);
  res.json(await etatTirage(evt._id));
});

/** Annule une saisie erronée (numéro encore en suspens) */
router.delete('/:id/tirage/:resultatId', requireAdmin, async (req, res) => {
  const evt = await chargerEvenement(req);
  await annulerSaisie(evt, req.params.resultatId);
  res.json(await etatTirage(evt._id));
});

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Organisation } from '../models/organisation.js';
import { Participant } from '../models/participant.js';
import { Vente } from '../models/vente.js';
import * as exporter from '../services/export-ventes.js';
import { annulerVente, creerVente, lirePaiement } from '../services/ventes.js';
import { escapeRegex } from '../utils/codes.js';
import { notFound, oid } from '../utils/http-error.js';
import { chargerEvenement } from './evenements.js';

export const router = Router();

router.post('/evenements/:id/ventes', async (req, res) => {
  const evt = await chargerEvenement(req);
  const { vente } = await creerVente(evt, req.auth, req.body ?? {});
  const complete = await Vente.findById(vente._id).populate('participantId').populate('vendeurId', 'login nom').lean();
  res.status(201).json(formater(complete));
});

function formater({ participantId, vendeurId, ...v }) {
  return { ...v, participant: participantId, vendeur: vendeurId };
}

async function rechercherVentes(req, evt) {
  const { type, statut, q, annulees } = req.query;
  const filtre = { evenementId: evt._id };
  if (type) filtre['paiement.type'] = type;
  if (statut) filtre['paiement.statut'] = statut;
  if (annulees !== 'true') filtre.annulee = false;

  const texte = String(q || '').trim();
  if (/^\d+$/.test(texte)) {
    filtre.numeros = Number(texte);
  } else if (texte) {
    const re = new RegExp(escapeRegex(texte), 'i');
    const ids = await Participant.find({
      organisationId: evt.organisationId,
      $or: [{ nom: re }, { prenom: re }, { telephone: re }, { email: re }],
    }).distinct('_id');
    filtre.participantId = { $in: ids };
  }

  const ventes = await Vente.find(filtre).sort({ createdAt: -1 })
    .populate('participantId').populate('vendeurId', 'login nom').lean();
  return ventes.map(formater);
}

router.get('/evenements/:id/ventes', async (req, res) => {
  const evt = await chargerEvenement(req);
  res.json(await rechercherVentes(req, evt));
});

/** Export des ventes (mêmes filtres que la liste) : CSV, Excel ou PDF */
const FORMATS = {
  csv: { type: 'text/csv; charset=utf-8', generer: (lignes) => exporter.csv(lignes) },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', generer: exporter.excel },
  pdf: { type: 'application/pdf', generer: exporter.pdf },
};

router.get('/evenements/:id/ventes/export.:format', async (req, res) => {
  const format = FORMATS[req.params.format];
  if (!format) throw notFound("Format d'export inconnu");
  const evt = await chargerEvenement(req);
  const [ventes, org] = await Promise.all([rechercherVentes(req, evt), Organisation.findById(evt.organisationId).lean()]);
  const contenu = await format.generer(exporter.lignesVentes(ventes), {
    organisation: org?.nom ?? '', evenement: evt, filtres: exporter.descriptionFiltres(req.query),
  });
  const nom = `ventes-${evt.nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase()}.${req.params.format}`;
  res.setHeader('Content-Type', format.type);
  res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
  res.send(contenu);
});

async function chargerVente(req) {
  const vente = await Vente.findOne({ _id: oid(req.params.id, 'Vente introuvable'), organisationId: req.auth.organisationId });
  if (!vente) throw notFound('Vente introuvable');
  return vente;
}

/** Mise à jour du paiement (ex. chèque encaissé : EN_ATTENTE → RECU) */
router.patch('/ventes/:id/paiement', async (req, res) => {
  const vente = await chargerVente(req);
  vente.paiement = lirePaiement({ ...vente.paiement.toObject(), ...req.body });
  await vente.save();
  res.json(vente);
});

/** Annulation : la vente reste dans l'historique, ses numéros redeviennent libres */
router.delete('/ventes/:id', requireAdmin, async (req, res) => {
  const vente = await chargerVente(req);
  res.json(await annulerVente(vente));
});

/** Autocomplétion des participants déjà connus */
router.get('/participants', async (req, res) => {
  const texte = String(req.query.q || '').trim();
  if (texte.length < 2) return res.json([]);
  const re = new RegExp(escapeRegex(texte), 'i');
  res.json(await Participant.find({
    organisationId: req.auth.organisationId,
    $or: [{ nom: re }, { prenom: re }, { telephone: re }, { email: re }],
  }).sort({ nom: 1 }).limit(10).lean());
});

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Participant } from '../models/participant.js';
import { Vente } from '../models/vente.js';
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

const LIBELLES_PAIEMENT = { ESPECES: 'Espèces', CHEQUE: 'Chèque', CARTE: 'Carte', AUTRE: 'Autre' };

router.get('/evenements/:id/ventes/export.csv', async (req, res) => {
  const evt = await chargerEvenement(req);
  const ventes = await rechercherVentes(req, evt);
  const cellule = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lignes = [
    ['Date', 'Nom', 'Prénom', 'Téléphone', 'Email', 'Numéros', 'Quantité', 'Montant (€)', 'Paiement', 'Statut', 'Référence', 'Vendeur', 'Annulée'],
    ...ventes.map((v) => [
      new Date(v.createdAt).toLocaleString('fr-FR'),
      v.participant?.nom, v.participant?.prenom, v.participant?.telephone, v.participant?.email,
      v.numeros.join(' '), v.quantite, (v.montant / 100).toFixed(2).replace('.', ','),
      v.paiement.type === 'AUTRE' ? v.paiement.libelleAutre : LIBELLES_PAIEMENT[v.paiement.type],
      v.paiement.statut === 'RECU' ? 'Reçu' : 'En attente',
      v.paiement.cheque?.numero ? `Chèque n°${v.paiement.cheque.numero} ${v.paiement.cheque.banque ?? ''}`.trim() : v.paiement.reference,
      v.vendeur?.nom || v.vendeur?.login, v.annulee ? 'Oui' : '',
    ]),
  ];
  const nomFichier = `ventes-${evt.nom.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
  // BOM + « ; » pour une ouverture directe dans Excel en français
  res.send('﻿' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n'));
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

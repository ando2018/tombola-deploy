import mongoose from 'mongoose';
import { Evenement } from '../models/evenement.js';
import { Ticket } from '../models/ticket.js';
import { Tirage } from '../models/tirage.js';
import { badRequest, conflict, notFound, oid } from '../utils/http-error.js';

/**
 * Enregistre un numéro sorti de l'urne. Il reste « en suspens » jusqu'à ce que
 * l'admin décide s'il est gagnant ou non. Un seul numéro en suspens à la fois.
 */
export async function saisirNumero(evt, numero, userId) {
  if (evt.statut === 'TIRE') throw conflict('Le tirage est terminé : reprenez-le pour saisir un numéro');
  if (evt.statut === 'BROUILLON') throw conflict('L\'événement est encore en brouillon');

  const n = Number(numero);
  if (!Number.isInteger(n)) throw badRequest('Numéro invalide');

  const ticket = await Ticket.findOne({ evenementId: evt._id, numero: n }).lean();
  if (!ticket) throw conflict(`Le numéro ${n} n'a pas été vendu`);

  const tirage = await Tirage.findOneAndUpdate(
    { evenementId: evt._id },
    { $setOnInsert: { evenementId: evt._id } },
    { upsert: true, returnDocument: 'after' },
  );
  const enSuspens = tirage.resultats.find((r) => r.statut === 'EN_SUSPENS');
  if (enSuspens) throw conflict(`Décidez d'abord du numéro ${enSuspens.numero} (gagnant ou non gagnant)`);
  if (tirage.resultats.some((r) => r.numero === n)) throw conflict(`Le numéro ${n} a déjà été tiré`);

  const resultat = {
    _id: new mongoose.Types.ObjectId(),
    ordre: tirage.resultats.length + 1,
    numero: n,
    ticketId: ticket._id,
    participantId: ticket.participantId,
    statut: 'EN_SUSPENS',
    tireLe: new Date(),
    tirePar: userId,
  };

  // Garde contre deux saisies simultanées
  const maj = await Tirage.updateOne(
    { _id: tirage._id, 'resultats.numero': { $ne: n }, 'resultats.statut': { $ne: 'EN_SUSPENS' } },
    { $push: { resultats: resultat } },
  );
  if (maj.modifiedCount === 0) throw conflict('Un autre numéro vient d\'être saisi, actualisez la page');

  // Le tirage commence : plus de ventes
  if (evt.statut === 'OUVERT') await Evenement.updateOne({ _id: evt._id }, { statut: 'CLOS' });
  return resultat;
}

/** Décision sur un numéro tiré (GAGNANT / NON_GAGNANT) et/ou lot attribué. */
export async function deciderNumero(evt, resultatId, { statut, lot }, userId) {
  if (evt.statut === 'TIRE') throw conflict('Le tirage est terminé : reprenez-le pour modifier un résultat');
  const set = {};
  if (statut !== undefined) {
    if (!['GAGNANT', 'NON_GAGNANT'].includes(statut)) throw badRequest('Statut invalide');
    Object.assign(set, { 'resultats.$.statut': statut, 'resultats.$.decideLe': new Date(), 'resultats.$.decidePar': userId });
  }
  if (lot !== undefined) set['resultats.$.lot'] = String(lot ?? '').trim();
  if (!Object.keys(set).length) throw badRequest('Rien à modifier');

  const maj = await Tirage.updateOne(
    { evenementId: evt._id, 'resultats._id': oid(resultatId, 'Numéro introuvable') },
    { $set: set },
  );
  if (maj.matchedCount === 0) throw notFound('Numéro introuvable');
}

/** Annule une saisie (erreur de frappe) : uniquement tant que le numéro est en suspens. */
export async function annulerSaisie(evt, resultatId) {
  const id = oid(resultatId, 'Numéro introuvable');
  const maj = await Tirage.updateOne(
    { evenementId: evt._id, resultats: { $elemMatch: { _id: id, statut: 'EN_SUSPENS' } } },
    { $pull: { resultats: { _id: id } } },
  );
  if (maj.modifiedCount === 0) throw conflict('Seul un numéro en suspens peut être annulé');
}

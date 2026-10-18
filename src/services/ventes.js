import { Participant } from '../models/participant.js';
import { Ticket } from '../models/ticket.js';
import { Tirage } from '../models/tirage.js';
import { STATUTS_PAIEMENT, TYPES_PAIEMENT, Vente } from '../models/vente.js';
import { badRequest, conflict, notFound, oid } from '../utils/http-error.js';
import { verifierNumeros } from './attribution.js';

export function lirePaiement(p = {}) {
  if (!TYPES_PAIEMENT.includes(p.type)) throw badRequest('Type de paiement invalide');
  const statut = p.statut || 'RECU';
  if (!STATUTS_PAIEMENT.includes(statut)) throw badRequest('Statut de paiement invalide');

  const paiement = { type: p.type, statut, reference: p.reference?.trim() || undefined };
  if (p.type === 'CHEQUE') {
    if (!p.cheque?.numero?.trim()) throw badRequest('Le numéro de chèque est requis');
    paiement.cheque = {
      numero: p.cheque.numero.trim(),
      banque: p.cheque.banque?.trim(),
      emetteur: p.cheque.emetteur?.trim(),
    };
  }
  if (p.type === 'AUTRE') {
    if (!p.libelleAutre?.trim()) throw badRequest('Précisez le moyen de paiement');
    paiement.libelleAutre = p.libelleAutre.trim();
  }
  return paiement;
}

async function resoudreParticipant(organisationId, p = {}) {
  if (p.id) {
    const existant = await Participant.findOne({ _id: oid(p.id, 'Participant introuvable'), organisationId });
    if (!existant) throw notFound('Participant introuvable');
    return { participant: existant, nouveau: false };
  }
  if (!p.nom?.trim()) throw badRequest('Le nom du participant est requis');
  const participant = new Participant({
    organisationId,
    nom: p.nom, prenom: p.prenom, telephone: p.telephone, email: p.email,
  });
  await participant.validate();
  return { participant, nouveau: true };
}

/**
 * Enregistre une vente. L'attribution se fait toujours au choix : le vendeur sélectionne
 * les numéros sur la grille. Les tickets sont insérés en premier : l'index unique garantit
 * qu'aucun numéro n'est vendu deux fois. En cas de collision, on annule ce qui a été inséré.
 */
export async function creerVente(evt, auth, body) {
  if (evt.statut !== 'OUVERT') throw conflict('Les ventes ne sont pas ouvertes pour cet événement');

  const paiement = lirePaiement(body.paiement);
  const numeros = await verifierNumeros(evt, body.numeros);
  const { participant, nouveau } = await resoudreParticipant(evt.organisationId, body.participant);

  const vente = new Vente({
    organisationId: evt.organisationId,
    evenementId: evt._id,
    participantId: participant._id,
    numeros,
    quantite: numeros.length,
    montant: numeros.length * evt.prixTicket,
    modeAttribution: 'MANUEL',
    paiement,
    vendeurId: auth.userId,
  });

  try {
    await Ticket.insertMany(numeros.map((numero) => ({
      evenementId: evt._id, numero, venteId: vente._id, participantId: participant._id,
    })), { ordered: true });
  } catch (err) {
    await Ticket.deleteMany({ venteId: vente._id });
    if (err?.code !== 11000) throw err;
    throw conflict('Un ou plusieurs numéros viennent d\'être vendus, actualisez la grille', { code: 'NUMEROS_PRIS' });
  }

  try {
    if (nouveau) await participant.save();
    await vente.save();
  } catch (err) {
    await Ticket.deleteMany({ venteId: vente._id });
    throw err;
  }
  return { vente, participant };
}

export async function annulerVente(vente) {
  if (vente.annulee) throw conflict('Vente déjà annulée');
  const tirage = await Tirage.findOne({ evenementId: vente.evenementId }).lean();
  if (tirage?.resultats.some((r) => vente.numeros.includes(r.numero))) {
    throw conflict('Impossible d\'annuler : un des numéros a gagné un lot');
  }
  await Ticket.deleteMany({ venteId: vente._id });
  vente.annulee = true;
  vente.annuleeLe = new Date();
  await vente.save();
  return vente;
}

/** Statistiques de ventes par événement (hors ventes annulées). */
export async function statsEvenements(ids) {
  const lignes = await Vente.aggregate([
    { $match: { evenementId: { $in: ids }, annulee: false } },
    {
      $group: {
        _id: { e: '$evenementId', t: '$paiement.type', s: '$paiement.statut' },
        tickets: { $sum: '$quantite' }, montant: { $sum: '$montant' }, ventes: { $sum: 1 },
      },
    },
  ]);

  const vide = () => ({
    ticketsVendus: 0, montantTotal: 0, montantEnAttente: 0, nbVentes: 0,
    parType: Object.fromEntries(TYPES_PAIEMENT.map((t) => [t, { tickets: 0, montant: 0 }])),
  });
  const stats = new Map(ids.map((id) => [String(id), vide()]));
  for (const l of lignes) {
    const s = stats.get(String(l._id.e));
    s.ticketsVendus += l.tickets;
    s.montantTotal += l.montant;
    s.nbVentes += l.ventes;
    if (l._id.s === 'EN_ATTENTE') s.montantEnAttente += l.montant;
    s.parType[l._id.t].tickets += l.tickets;
    s.parType[l._id.t].montant += l.montant;
  }
  return stats;
}

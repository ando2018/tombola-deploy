import mongoose from 'mongoose';

/** Les ventes se font au choix (MANUEL) ; les autres valeurs restent pour l'historique. */
const MODES_ATTRIBUTION = ['MANUEL', 'AUTO_SEQUENTIEL', 'AUTO_ALEATOIRE'];

export const TYPES_PAIEMENT = ['ESPECES', 'CHEQUE', 'CARTE', 'AUTRE'];
export const STATUTS_PAIEMENT = ['RECU', 'EN_ATTENTE'];

const paiementSchema = new mongoose.Schema({
  type: { type: String, enum: TYPES_PAIEMENT, required: true },
  statut: { type: String, enum: STATUTS_PAIEMENT, default: 'RECU' },
  reference: { type: String, trim: true },
  cheque: {
    numero: { type: String, trim: true },
    banque: { type: String, trim: true },
    emetteur: { type: String, trim: true },
  },
  libelleAutre: { type: String, trim: true },
}, { _id: false });

const venteSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
  evenementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Evenement', required: true },
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  numeros: { type: [Number], required: true },
  quantite: { type: Number, required: true, min: 1 },
  /** Montant en centimes */
  montant: { type: Number, required: true, min: 0 },
  modeAttribution: { type: String, enum: MODES_ATTRIBUTION, default: 'MANUEL' },
  paiement: { type: paiementSchema, required: true },
  vendeurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  annulee: { type: Boolean, default: false },
  annuleeLe: { type: Date },
}, { timestamps: true });

venteSchema.index({ evenementId: 1, createdAt: -1 });

export const Vente = mongoose.model('Vente', venteSchema);

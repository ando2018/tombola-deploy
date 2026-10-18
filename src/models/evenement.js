import mongoose from 'mongoose';

const lotSchema = new mongoose.Schema({
  rang: { type: Number, required: true, min: 1 },
  libelle: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
}, { _id: false });

const evenementSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
  nom: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  dateTirage: { type: Date },
  /** Prix d'un ticket en centimes (200 = 2,00 €) */
  prixTicket: { type: Number, required: true, min: 0 },
  nombreTickets: { type: Number, required: true, min: 1, max: 100000 },
  numeroDebut: { type: Number, default: 1, min: 0 },
  /** Liste indicative des lots (page publique). Le tirage se fait à l'urne. */
  lots: { type: [lotSchema], default: [] },
  statut: { type: String, enum: ['BROUILLON', 'OUVERT', 'CLOS', 'TIRE'], default: 'BROUILLON' },
  /** Événement terminé rangé dans les archives : masqué de la liste principale et de la page publique */
  archive: { type: Boolean, default: false },
  archiveLe: { type: Date },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

evenementSchema.virtual('numeroFin').get(function () {
  return this.numeroDebut + this.nombreTickets - 1;
});

export const Evenement = mongoose.model('Evenement', evenementSchema);

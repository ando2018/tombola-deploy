import mongoose from 'mongoose';

/**
 * Tirage à l'urne : chaque numéro sorti est saisi par l'admin. Il reste EN_SUSPENS
 * (affiché comme tel sur la page publique) jusqu'à la décision : GAGNANT ou NON_GAGNANT.
 */
export const STATUTS_TIRAGE = ['EN_SUSPENS', 'GAGNANT', 'NON_GAGNANT'];

const resultatSchema = new mongoose.Schema({
  /** Ordre de sortie de l'urne (1, 2, 3…) */
  ordre: { type: Number, required: true },
  numero: { type: Number, required: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  statut: { type: String, enum: STATUTS_TIRAGE, default: 'EN_SUSPENS' },
  /** Lot attribué (texte libre, facultatif) */
  lot: { type: String, trim: true },
  tireLe: { type: Date, default: Date.now },
  tirePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decideLe: { type: Date },
  decidePar: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const tirageSchema = new mongoose.Schema({
  evenementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Evenement', required: true, unique: true },
  resultats: { type: [resultatSchema], default: [] },
}, { timestamps: true });

export const Tirage = mongoose.model('Tirage', tirageSchema);

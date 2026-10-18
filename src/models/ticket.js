import mongoose from 'mongoose';

/**
 * Un document par ticket VENDU. Numéros libres = plage de l'événement moins les tickets.
 * L'index unique (evenementId, numero) rend la double vente impossible, même en concurrence.
 */
const ticketSchema = new mongoose.Schema({
  evenementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Evenement', required: true },
  numero: { type: Number, required: true },
  venteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vente', required: true, index: true },
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
}, { timestamps: true });

ticketSchema.index({ evenementId: 1, numero: 1 }, { unique: true });

export const Ticket = mongoose.model('Ticket', ticketSchema);

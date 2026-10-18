import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
  nom: { type: String, required: true, trim: true },
  prenom: { type: String, trim: true },
  telephone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
}, { timestamps: true });

participantSchema.index({ organisationId: 1, nom: 1, prenom: 1 });

export const Participant = mongoose.model('Participant', participantSchema);

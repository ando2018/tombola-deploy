import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
  login: { type: String, required: true, lowercase: true, trim: true },
  nom: { type: String, trim: true },
  /** Code PIN à 4 chiffres, haché avec bcrypt */
  pinHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'VENDEUR'], default: 'VENDEUR' },
  actif: { type: Boolean, default: true },
  echecsPin: { type: Number, default: 0, select: false },
  bloqueJusqua: { type: Date },
  derniereConnexion: { type: Date },
}, { timestamps: true });

userSchema.index({ organisationId: 1, login: 1 }, { unique: true });

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pinHash;
    delete ret.echecsPin;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

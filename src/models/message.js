import mongoose from 'mongoose';

export const TYPES_MESSAGE = ['QUESTION', 'DEMANDE_JETON', 'PROBLEME', 'AUTRE'];
export const STATUTS_MESSAGE = ['NOUVEAU', 'LU', 'TRAITE'];

/** Message envoyé par une organisation (ou un visiteur dont le jeton a expiré) au super admin. */
const messageSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', index: true },
  /** Copie au moment de l'envoi : reste lisible même si l'organisation est modifiée ou inconnue */
  organisationCode: { type: String, trim: true, uppercase: true },
  organisationNom: { type: String, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auteur: {
    nom: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true },
    telephone: { type: String, trim: true },
    login: { type: String, trim: true },
  },
  /** Envoyé depuis l'application connectée (true) ou depuis la page publique /contact */
  connecte: { type: Boolean, default: false },
  type: { type: String, enum: TYPES_MESSAGE, default: 'QUESTION' },
  sujet: { type: String, trim: true, required: true, maxlength: 150 },
  message: { type: String, trim: true, required: true, maxlength: 5000 },
  statut: { type: String, enum: STATUTS_MESSAGE, default: 'NOUVEAU', index: true },
  reponse: { type: String, trim: true, maxlength: 5000 },
  reponduLe: { type: Date },
  /** Date à laquelle l'organisation a vu la réponse (vide : réponse non lue, pastille dans l'application) */
  reponseLueLe: { type: Date },
  emailEnvoye: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);

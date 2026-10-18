import mongoose from 'mongoose';

/** Abonnement : un jeton valable sur une période donnée pour une organisation. */
const licenceSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
  libelle: { type: String, trim: true, default: 'Abonnement' },
  /** On ne stocke que le hash : le jeton en clair n'est montré qu'à la création */
  tokenHash: { type: String, required: true, unique: true, select: false },
  /** Jeton chiffré (AES-256-GCM) : permet de le recopier depuis l'admin */
  tokenChiffre: { type: String, select: false },
  /** Derniers caractères, pour identifier le jeton dans les listes */
  tokenApercu: { type: String, required: true },
  dateDebut: { type: Date, required: true },
  dateFin: { type: Date, required: true },
  revoque: { type: Boolean, default: false },
  derniereUtilisation: { type: Date },
}, {
  timestamps: true,
  toObject: { virtuals: true },
  // Jamais de hash ni de jeton chiffré dans une réponse JSON
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => {
      delete ret.tokenHash;
      delete ret.tokenChiffre;
      return ret;
    },
  },
});

/** Fonctionne aussi sur un objet .lean() */
export function statutLicence(l, now = new Date()) {
  if (l.revoque) return 'REVOQUE';
  if (now < l.dateDebut) return 'A_VENIR';
  if (now > l.dateFin) return 'EXPIRE';
  return 'ACTIF';
}

licenceSchema.virtual('statut').get(function () {
  return statutLicence(this);
});

licenceSchema.methods.estValide = function () {
  return this.statut === 'ACTIF';
};

/** Filtre Mongo des licences utilisables maintenant. */
licenceSchema.statics.filtreActif = function () {
  const now = new Date();
  return { revoque: false, dateDebut: { $lte: now }, dateFin: { $gte: now } };
};

export const Licence = mongoose.model('Licence', licenceSchema);

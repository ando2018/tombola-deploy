import mongoose from 'mongoose';

const organisationSchema = new mongoose.Schema({
  /** Identifiant saisi dans l'application (ORG-XXXXXX), créé par le super admin */
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  nom: { type: String, required: true, trim: true },
  /** Utilisé dans l'URL publique : /o/:slug */
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  contact: {
    nom: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    telephone: { type: String, trim: true },
  },
  actif: { type: Boolean, default: true },
  /** Logo (icône d'onglet + en-tête), image carrée redimensionnée par l'application. Jamais renvoyé dans les listes. */
  logo: {
    type: { type: String, enum: ['image/png', 'image/jpeg', 'image/webp'] },
    donnees: { type: Buffer, select: false },
  },
  /** Date du dernier changement de logo : sert de version dans l'URL (cache du navigateur) */
  logoMaj: { type: Date },
}, { timestamps: true });

export const Organisation = mongoose.model('Organisation', organisationSchema);

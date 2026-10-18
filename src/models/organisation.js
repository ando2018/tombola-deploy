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
}, { timestamps: true });

export const Organisation = mongoose.model('Organisation', organisationSchema);

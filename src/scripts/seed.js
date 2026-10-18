/**
 * Crée (ou recrée) une organisation de démonstration :
 *   npm run seed
 */
import mongoose from 'mongoose';
import { connecterDb } from '../db.js';
import { Evenement } from '../models/evenement.js';
import { Licence } from '../models/licence.js';
import { Organisation } from '../models/organisation.js';
import { Participant } from '../models/participant.js';
import { Ticket } from '../models/ticket.js';
import { Tirage } from '../models/tirage.js';
import { User } from '../models/user.js';
import { Vente } from '../models/vente.js';
import { creerLicence } from '../services/licences.js';
import { creerUtilisateur } from '../services/users.js';

const CODE = 'ORG-DEMO26';
/** Jeton fixe pour que la démo reste utilisable après chaque `npm run seed` (ne jamais faire ça en production) */
const TOKEN_DEMO = process.env.DEMO_TOKEN || 'TMB-DEMO-2026-DEMO-2026-DEMO';

await connecterDb();
await Promise.all([Organisation, Licence, User, Evenement, Participant, Vente, Ticket, Tirage].map((m) => m.syncIndexes()));

const ancienne = await Organisation.findOne({ code: CODE });
if (ancienne) {
  const evts = await Evenement.find({ organisationId: ancienne._id }).distinct('_id');
  await Promise.all([
    Ticket.deleteMany({ evenementId: { $in: evts } }),
    Tirage.deleteMany({ evenementId: { $in: evts } }),
    Vente.deleteMany({ organisationId: ancienne._id }),
    Participant.deleteMany({ organisationId: ancienne._id }),
    Evenement.deleteMany({ organisationId: ancienne._id }),
    User.deleteMany({ organisationId: ancienne._id }),
    Licence.deleteMany({ organisationId: ancienne._id }),
    ancienne.deleteOne(),
  ]);
}

const org = await Organisation.create({ code: CODE, nom: 'Association Démo', slug: 'demo' });
const { token } = await creerLicence(org._id, { libelle: 'Abonnement démo', dureeMois: 12 }, TOKEN_DEMO);
await creerUtilisateur(org._id, { login: 'admin', nom: 'Administrateur', pin: '1234', role: 'ADMIN' });
await creerUtilisateur(org._id, { login: 'vendeur', nom: 'Vendeur', pin: '0000', role: 'VENDEUR' });
await Evenement.create({
  organisationId: org._id,
  nom: 'Tombola de Noël',
  description: 'Grande tombola au profit des activités de l\'association.',
  dateTirage: new Date(new Date().getFullYear(), 11, 20, 18, 0),
  prixTicket: 200,
  nombreTickets: 300,
  numeroDebut: 1,
  statut: 'OUVERT',
  lots: [
    { rang: 1, libelle: 'Week-end pour 2 personnes' },
    { rang: 2, libelle: 'Panier gourmand' },
    { rang: 3, libelle: 'Bon d\'achat 50 €' },
  ],
});

console.log(`
Organisation de démo créée
  Identifiant organisation : ${CODE}
  Jeton d'abonnement       : ${token}
  Admin                    : admin / PIN 1234
  Vendeur                  : vendeur / PIN 0000
  Lien de connexion        : http://localhost:3002/connexion/${CODE}
  Page publique            : http://localhost:3002/o/demo
`);
await mongoose.disconnect();

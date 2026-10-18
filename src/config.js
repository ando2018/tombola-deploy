export const config = {
  port: Number(process.env.PORT || 3002),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tombola',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-a-changer',
  superAdmin: {
    login: process.env.SUPERADMIN_LOGIN || 'superadmin',
    password: process.env.SUPERADMIN_PASSWORD || 'superadmin',
    /** Reçoit une copie des messages de contact (si SMTP configuré) */
    email: process.env.SUPERADMIN_EMAIL || '',
  },
  /** Envoi d'e-mails facultatif : sans SMTP_HOST, les messages sont seulement enregistrés */
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'tombola@localhost',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  /** Clé de chiffrement des jetons d'abonnement (par défaut dérivée de JWT_SECRET) */
  tokenSecret: process.env.TOKEN_SECRET || `tombola-jetons:${process.env.JWT_SECRET || 'dev-secret-a-changer'}`,
  /** Durée max d'une session utilisateur (bornée par la fin de l'abonnement). */
  sessionHeures: 12,
  /** Verrouillage du compte après N codes PIN erronés. */
  pinMaxEchecs: 5,
  pinBlocageMinutes: 15,
};

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET doit être défini en production');
}

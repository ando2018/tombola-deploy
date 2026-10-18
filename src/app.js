import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { ecritureAutorisee, requireUser } from './middleware/auth.js';
import { errorHandler, notFoundApi } from './middleware/errors.js';
import { router as abonnement } from './routes/abonnement.js';
import { router as auth } from './routes/auth.js';
import { router as contact } from './routes/contact.js';
import { router as evenements } from './routes/evenements.js';
import { router as publicRoutes } from './routes/public.js';
import { router as superadmin } from './routes/superadmin.js';
import { router as utilisateurs } from './routes/utilisateurs.js';
import { router as ventes } from './routes/ventes.js';

export function creerApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/superadmin', superadmin);
  app.use('/api/public', publicRoutes);
  app.use('/api/contact', contact);
  // Abonnement expiré : ces routes passent en lecture seule (ecritureAutorisee)
  app.use('/api/evenements', requireUser, ecritureAutorisee, evenements);
  app.use('/api/utilisateurs', requireUser, ecritureAutorisee, utilisateurs);
  app.use('/api/abonnement', requireUser, ecritureAutorisee, abonnement);
  app.use('/api', requireUser, ecritureAutorisee, ventes);
  app.use('/api', notFoundApi);

  // L'API sert aussi l'application Angular compilée, sur le même port.
  // Ordre de recherche : WEB_DIR, puis ./public (dossier deploy/), puis le build de développement.
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const web = [process.env.WEB_DIR, path.resolve(ici, '../public'), path.resolve(ici, '../../web/dist/web/browser')]
    .find((d) => d && fs.existsSync(path.join(d, 'index.html')));
  if (web) {
    app.use(express.static(web));
    app.get('/{*chemin}', (_req, res) => res.sendFile(path.join(web, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

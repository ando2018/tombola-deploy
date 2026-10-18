import mongoose from 'mongoose';
import { HttpError } from '../utils/http-error.js';

export function notFoundApi(_req, res) {
  res.status(404).json({ message: 'Route inconnue' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, ...err.extra });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const champs = Object.fromEntries(Object.entries(err.errors).map(([k, e]) => [k, e.message]));
    return res.status(400).json({ message: 'Données invalides', champs });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: `Valeur invalide pour ${err.path}` });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ message: 'Cet élément existe déjà', champs: err.keyValue });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON invalide' });
  }
  console.error(err);
  res.status(500).json({ message: 'Erreur serveur' });
}

import mongoose from 'mongoose';

export class HttpError extends Error {
  /** `extra` est fusionné dans la réponse JSON (ex. { code: 'LICENCE_EXPIREE' }) */
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Non authentifié', extra) => new HttpError(401, msg, extra);
export const forbidden = (msg = 'Accès refusé', extra) => new HttpError(403, msg, extra);
export const notFound = (msg = 'Introuvable') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

/** Valide un identifiant de route, sinon 404. */
export function oid(id, msg = 'Introuvable') {
  if (!mongoose.isValidObjectId(id)) throw notFound(msg);
  return new mongoose.Types.ObjectId(String(id));
}

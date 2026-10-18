import { Ticket } from '../models/ticket.js';
import { badRequest, conflict } from '../utils/http-error.js';

export async function numerosVendus(evenementId) {
  const vendus = await Ticket.distinct('numero', { evenementId });
  return vendus.sort((a, b) => a - b);
}

/**
 * Vérifie les numéros choisis sur la grille : présents, dans la plage, sans doublon et libres.
 * (L'attribution se fait toujours au choix.)
 */
export async function verifierNumeros(evt, numeros) {
  const debut = evt.numeroDebut;
  const fin = evt.numeroDebut + evt.nombreTickets - 1;

  if (!Array.isArray(numeros) || numeros.length === 0) throw badRequest('Choisissez au moins un numéro sur la grille');
  const choisis = numeros.map(Number);
  if (choisis.some((n) => !Number.isInteger(n) || n < debut || n > fin)) {
    throw badRequest(`Les numéros doivent être compris entre ${debut} et ${fin}`);
  }
  if (new Set(choisis).size !== choisis.length) throw badRequest('Numéro sélectionné deux fois');

  const vendus = new Set(await numerosVendus(evt._id));
  const dejaVendus = choisis.filter((n) => vendus.has(n));
  if (dejaVendus.length) {
    throw conflict(`Numéro(s) déjà vendu(s) : ${dejaVendus.join(', ')}`, { code: 'NUMEROS_PRIS', numeros: dejaVendus });
  }
  return choisis.sort((a, b) => a - b);
}

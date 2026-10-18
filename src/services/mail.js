import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport = null;

function obtenirTransport() {
  if (!config.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

/**
 * Envoie un e-mail si un serveur SMTP est configuré. Ne lève jamais d'erreur :
 * l'échec d'un e-mail ne doit pas faire échouer l'enregistrement du message.
 */
export async function envoyerMail({ a, sujet, texte, repondreA }) {
  const t = obtenirTransport();
  if (!t || !a) return false;
  try {
    await t.sendMail({ from: config.smtp.from, to: a, subject: sujet, text: texte, replyTo: repondreA || undefined });
    return true;
  } catch (err) {
    console.error('Envoi d\'e-mail impossible :', err.message);
    return false;
  }
}

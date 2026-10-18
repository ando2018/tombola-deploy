import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const LIBELLES_PAIEMENT = { ESPECES: 'Espèces', CHEQUE: 'Chèque', CARTE: 'Carte', AUTRE: 'Autre' };

const dateFr = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
const euros = (centimes) => (centimes / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/** Une ligne d'export par vente (valeurs brutes : montant en euros, date en Date) */
export function lignesVentes(ventes) {
  return ventes.map((v) => ({
    date: new Date(v.createdAt),
    nom: v.participant?.nom ?? '',
    prenom: v.participant?.prenom ?? '',
    telephone: v.participant?.telephone ?? '',
    email: v.participant?.email ?? '',
    numeros: v.numeros.join(' '),
    quantite: v.quantite,
    montant: v.montant / 100,
    paiement: v.paiement.type === 'AUTRE' ? (v.paiement.libelleAutre || 'Autre') : LIBELLES_PAIEMENT[v.paiement.type],
    statut: v.paiement.statut === 'RECU' ? 'Reçu' : 'En attente',
    reference: v.paiement.cheque?.numero
      ? `n°${v.paiement.cheque.numero} ${v.paiement.cheque.banque ?? ''}`.trim()
      : (v.paiement.reference ?? ''),
    vendeur: v.vendeur?.nom || v.vendeur?.login || '',
    annulee: !!v.annulee,
  }));
}

/** Totaux des ventes non annulées, globaux et par moyen de paiement */
export function totaux(lignes) {
  const valides = lignes.filter((l) => !l.annulee);
  const parPaiement = new Map();
  for (const l of valides) {
    const t = parPaiement.get(l.paiement) ?? { ventes: 0, tickets: 0, montant: 0 };
    t.ventes++; t.tickets += l.quantite; t.montant += l.montant;
    parPaiement.set(l.paiement, t);
  }
  return {
    ventes: valides.length,
    tickets: valides.reduce((s, l) => s + l.quantite, 0),
    montant: valides.reduce((s, l) => s + l.montant, 0),
    enAttente: valides.filter((l) => l.statut === 'En attente').reduce((s, l) => s + l.montant, 0),
    annulees: lignes.length - valides.length,
    parPaiement: [...parPaiement.entries()].sort((a, b) => b[1].montant - a[1].montant),
  };
}

/** Description lisible des filtres appliqués (rappelée en tête du fichier) */
export function descriptionFiltres(q) {
  const f = [];
  if (q.q) f.push(`recherche « ${q.q} »`);
  if (q.type) f.push(`paiement : ${LIBELLES_PAIEMENT[q.type] ?? q.type}`);
  if (q.statut) f.push(q.statut === 'RECU' ? 'paiements reçus' : 'paiements en attente');
  f.push(q.annulees === 'true' ? 'ventes annulées incluses' : 'hors ventes annulées');
  return f.join(' · ');
}

// ---------------------------------------------------------------- CSV

export function csv(lignes) {
  const cellule = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const contenu = [
    ['Date', 'Nom', 'Prénom', 'Téléphone', 'Email', 'Numéros', 'Quantité', 'Montant (€)', 'Paiement', 'Statut', 'Référence', 'Vendeur', 'Annulée'],
    ...lignes.map((l) => [dateFr(l.date), l.nom, l.prenom, l.telephone, l.email, l.numeros, l.quantite,
      l.montant.toFixed(2).replace('.', ','), l.paiement, l.statut, l.reference, l.vendeur, l.annulee ? 'Oui' : '']),
  ];
  // BOM + « ; » pour une ouverture directe dans Excel en français
  return '﻿' + contenu.map((l) => l.map(cellule).join(';')).join('\r\n');
}

// ---------------------------------------------------------------- Excel

export async function excel(lignes, { organisation, evenement, filtres }) {
  const t = totaux(lignes);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tombola';
  wb.created = new Date();

  // ----- Feuille « Ventes »
  const ws = wb.addWorksheet('Ventes', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [
    { key: 'date', width: 17 }, { key: 'nom', width: 18 }, { key: 'prenom', width: 15 }, { key: 'telephone', width: 15 },
    { key: 'email', width: 26 }, { key: 'numeros', width: 22 }, { key: 'quantite', width: 9 }, { key: 'montant', width: 12 },
    { key: 'paiement', width: 13 }, { key: 'statut', width: 12 }, { key: 'reference', width: 24 }, { key: 'vendeur', width: 15 },
    { key: 'annulee', width: 9 },
  ];
  ws.mergeCells('A1:M1');
  ws.getCell('A1').value = `${organisation} — ${evenement.nom}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A2:M2');
  ws.getCell('A2').value = `Export du ${dateFr(new Date())} · ${filtres}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

  const entete = ws.getRow(4);
  entete.values = ['Date', 'Nom', 'Prénom', 'Téléphone', 'Email', 'Numéros', 'Qté', 'Montant', 'Paiement', 'Statut', 'Référence', 'Vendeur', 'Annulée'];
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  entete.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6E5C' } };
    c.alignment = { vertical: 'middle' };
  });

  for (const l of lignes) {
    const r = ws.addRow({ ...l, annulee: l.annulee ? 'Oui' : '' });
    if (l.annulee) r.font = { strike: true, color: { argb: 'FF999999' } };
    else if (l.statut === 'En attente') r.getCell('statut').font = { bold: true, color: { argb: 'FFB45309' } };
  }
  ws.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm';
  ws.getColumn('montant').numFmt = '#,##0.00 "€"';
  if (lignes.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + lignes.length, column: 13 } };

  // Ligne de total (formules : se recalculent si on modifie le fichier)
  const fin = 4 + lignes.length;
  const total = ws.addRow([]);
  total.getCell(1).value = 'TOTAL (hors annulées)';
  if (lignes.length) {
    total.getCell(7).value = { formula: `SUMIFS(G5:G${fin},M5:M${fin},"<>Oui")`, result: t.tickets };
    total.getCell(8).value = { formula: `SUMIFS(H5:H${fin},M5:M${fin},"<>Oui")`, result: t.montant };
  }
  total.getCell(8).numFmt = '#,##0.00 "€"';
  total.font = { bold: true };
  total.eachCell((c) => { c.border = { top: { style: 'medium' } }; });

  // ----- Feuille « Résumé »
  const rs = wb.addWorksheet('Résumé');
  rs.columns = [{ width: 26 }, { width: 12 }, { width: 12 }, { width: 14 }];
  rs.addRow([`${organisation} — ${evenement.nom}`]).font = { bold: true, size: 14 };
  rs.addRow([filtres]).font = { italic: true, color: { argb: 'FF666666' } };
  rs.addRow([]);
  for (const [libelle, valeur, format] of [
    ['Ventes', t.ventes], ['Tickets vendus', t.tickets],
    ['Montant total', t.montant, '#,##0.00 "€"'], ['Dont paiements en attente', t.enAttente, '#,##0.00 "€"'],
    ['Ventes annulées', t.annulees],
  ]) {
    const r = rs.addRow([libelle, valeur]);
    r.getCell(1).font = { bold: true };
    if (format) r.getCell(2).numFmt = format;
  }
  rs.addRow([]);
  const tete = rs.addRow(['Moyen de paiement', 'Ventes', 'Tickets', 'Montant']);
  tete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  tete.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6E5C' } }; });
  for (const [p, v] of t.parPaiement) rs.addRow([p, v.ventes, v.tickets, v.montant]).getCell(4).numFmt = '#,##0.00 "€"';

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF

export function pdf(lignes, { organisation, evenement, filtres }) {
  const t = totaux(lignes);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: `Ventes — ${evenement.nom}` } });
  const morceaux = [];
  doc.on('data', (m) => morceaux.push(m));
  const termine = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(morceaux))));

  const largeur = doc.page.width - 72;
  const vert = '#0F6E5C';

  // ----- En-tête et résumé
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(evenement.nom);
  doc.font('Helvetica').fontSize(10).fillColor('#555').text(`${organisation} · export du ${dateFr(new Date())}`);
  doc.text(filtres);
  doc.moveDown(0.6);

  const cases = [
    ['Ventes', String(t.ventes)], ['Tickets vendus', String(t.tickets)],
    ['Montant total', euros(t.montant * 100)], ['Paiements en attente', euros(t.enAttente * 100)],
  ];
  const lCase = largeur / cases.length;
  const yCases = doc.y;
  cases.forEach(([lib, val], i) => {
    const x = 36 + i * lCase;
    doc.roundedRect(x, yCases, lCase - 8, 40, 4).fillAndStroke('#F3F7F6', '#D7E5E1');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(val, x + 8, yCases + 6, { width: lCase - 24 });
    doc.fillColor('#555').font('Helvetica').fontSize(8).text(lib, x + 8, yCases + 25, { width: lCase - 24 });
  });
  doc.y = yCases + 48;
  if (t.parPaiement.length) {
    doc.fillColor('#333').fontSize(9).text(
      'Par paiement : ' + t.parPaiement.map(([p, v]) => `${p} ${euros(v.montant * 100)} (${v.ventes})`).join('  ·  '),
      36, doc.y, { width: largeur },
    );
  }
  doc.moveDown(0.8);

  // ----- Tableau
  const colonnes = [
    { titre: 'Date', l: 84, v: (l) => dateFr(l.date) },
    { titre: 'Participant', l: 130, v: (l) => [l.prenom, l.nom].filter(Boolean).join(' ') },
    { titre: 'Contact', l: 120, v: (l) => [l.telephone, l.email].filter(Boolean).join('\n') },
    { titre: 'Numéros', l: 118, v: (l) => l.numeros },
    { titre: 'Qté', l: 30, v: (l) => String(l.quantite), droite: true },
    { titre: 'Montant', l: 60, v: (l) => euros(l.montant * 100), droite: true },
    { titre: 'Paiement', l: 120, v: (l) => [l.paiement, l.reference].filter(Boolean).join('\n') },
    { titre: 'Statut', l: 56, v: (l) => (l.annulee ? 'Annulée' : l.statut) },
  ];
  const reste = largeur - colonnes.reduce((s, c) => s + c.l, 0);
  colonnes.push({ titre: 'Vendeur', l: reste, v: (l) => l.vendeur });

  const enteteTableau = () => {
    const y = doc.y;
    doc.rect(36, y, largeur, 18).fill(vert);
    let x = 36;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
    for (const c of colonnes) {
      doc.text(c.titre, x + 4, y + 5, { width: c.l - 8, align: c.droite ? 'right' : 'left' });
      x += c.l;
    }
    doc.y = y + 18;
  };
  enteteTableau();

  const basPage = () => doc.page.height - 50;
  lignes.forEach((l, i) => {
    doc.font('Helvetica').fontSize(8.5);
    const hauteur = Math.max(...colonnes.map((c) => doc.heightOfString(c.v(l) || ' ', { width: c.l - 8 }))) + 8;
    if (doc.y + hauteur > basPage()) {
      doc.addPage();
      enteteTableau();
    }
    const y = doc.y;
    if (i % 2) doc.rect(36, y, largeur, hauteur).fill('#F7F7F5');
    let x = 36;
    doc.fillColor(l.annulee ? '#999' : '#000');
    for (const c of colonnes) {
      const gras = c.titre === 'Statut' && !l.annulee && l.statut === 'En attente';
      doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fillColor(gras ? '#B45309' : (l.annulee ? '#999' : '#000'));
      doc.text(c.v(l) || '', x + 4, y + 4, { width: c.l - 8, align: c.droite ? 'right' : 'left' });
      x += c.l;
    }
    if (l.annulee) doc.moveTo(36, y + hauteur / 2).lineTo(36 + largeur, y + hauteur / 2).lineWidth(0.5).stroke('#bbb');
    doc.y = y + hauteur;
  });

  if (!lignes.length) doc.font('Helvetica').fontSize(10).fillColor('#777').text('Aucune vente pour ces critères.', 36, doc.y + 10);
  else {
    if (doc.y + 22 > basPage()) { doc.addPage(); }
    const y = doc.y;
    doc.moveTo(36, y).lineTo(36 + largeur, y).lineWidth(1.2).stroke('#000');
    const xMontant = 36 + colonnes.slice(0, 5).reduce((s, c) => s + c.l, 0);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
    doc.text('TOTAL (hors annulées)', 40, y + 5);
    doc.text(String(t.tickets), xMontant - 30 + 4, y + 5, { width: 22, align: 'right' });
    doc.text(euros(t.montant * 100), xMontant + 4, y + 5, { width: 52, align: 'right' });
  }

  // ----- Pied de page : numéro de page
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // le pied de page est sous la marge : évite une page vide
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text(`${evenement.nom} — page ${i + 1} / ${pages.count}`, 36, doc.page.height - 30, { width: largeur, align: 'right', lineBreak: false });
  }
  doc.end();
  return termine;
}

/**
 * Scarta le suggestions che portano a un vicolo cieco.
 *
 * Il modello genera i chip di follow-up dal tema appena trattato, senza
 * verificare che il CV contenga il materiale per rispondere: dopo una risposta
 * su AWS proponeva "Quali servizi AWS usavi oltre a DynamoDB?", e al click il
 * bot poteva solo rispondere che il dato non ce l'ha. Meglio un chip in meno.
 *
 * Il filtro è deliberatamente conservativo: intercetta le formulazioni che
 * chiedono *per costruzione* qualcosa che il CV non contiene (un elemento in
 * più rispetto a un elenco, una versione, una percentuale, la dimensione di un
 * team), non i temi in sé.
 */

/** Chiedono un elemento ulteriore rispetto a quelli elencati nel CV. */
const OLTRE_L_ELENCO = [
  /\boltre a(l|i|lla|lle|llo)?\b/i,
  /\b(quali|che|altri|altre)\s+altr[ie]\b/i,
  /\baltr[ie]\s+(servizi|tool|strumenti|linguaggi|framework|database|tecnologie|librerie|provider|cloud)\b/i,
  /\bnient'?altro\b/i,
];

/** Chiedono un dettaglio che un CV non riporta mai. */
const DETTAGLIO_ASSENTE = [
  /\b(che|quale|quali)\s+version[ei]\b/i,
  /\bin\s+(che\s+)?percentuale\b/i,
  // niente \b dopo "è": in JS \b ragiona su [A-Za-z0-9_] e le accentate non fanno confine
  /\bdi\s+quanto\s+(hai|è|si\s+è)(?=\s|$)/i,
  /\bquant[oi]\s+(hai\s+)?(ridott|miglior|aumentat|risparmiat)/i,
  /\bquant[ei]\s+(person[ae]|svilupp|ingegner|membri)\b/i,
  /\b(dimensione|grandezza)\s+del\s+team\b/i,
  /\bquanto\s+(tempo\s+)?(ci\s+)?(hai|avete)\s+mess/i,
  /\bquanto\s+(guadagn|costav|ti\s+pagav)/i,
  /\bquant[oa]\s+era\b/i,
  /\bche\s+(tool|strumento)\s+di\s+(ci\/?cd|deploy|monitoring)\b/i,
];

const SCARTA = [...OLTRE_L_ELENCO, ...DETTAGLIO_ASSENTE];

export interface FilterResult {
  kept: string[];
  dropped: string[];
}

export function filterSuggestions(suggestions: string[]): FilterResult {
  const kept: string[] = [];
  const dropped: string[] = [];

  for (const s of suggestions) {
    if (SCARTA.some((re) => re.test(s))) dropped.push(s);
    else kept.push(s);
  }

  return { kept, dropped };
}

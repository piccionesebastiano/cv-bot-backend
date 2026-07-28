/**
 * Catalogo degli episodi raccontabili presenti nel CV.
 *
 * Serve a riconoscere, leggendo le risposte già date, quali episodi il bot ha
 * usato: la finestra di history inviata al modello è limitata, quindi senza
 * questo elenco a una richiesta "un altro" ripetuta il modello riproponeva
 * episodi usciti dalla finestra.
 *
 * `patterns` va inteso in OR: basta un match su una risposta per considerare
 * l'episodio raccontato. Le keyword sono scelte per essere specifiche
 * dell'episodio, non del progetto (più progetti condividono il cliente).
 */
export interface Episode {
  id: string;
  label: string;
  patterns: RegExp[];
}

export const EPISODES: Episode[] = [
  {
    id: 'strapi-incident',
    label: "l'incidente Strapi (process manager in fork invece di cluster)",
    patterns: [/\bfork\b.{0,40}\bcluster\b/i, /process manager/i, /200 container/i],
  },
  {
    id: 'listini',
    label: 'la riprogettazione del sistema listini prezzi',
    patterns: [/listin/i, /40\.?000 prodotti/i],
  },
  {
    id: 'cache-html',
    label: 'la scelta della cache HTML statica su bucket GCP al posto di Redis',
    patterns: [/cache html/i, /invalidazione per url/i, /redis lato frontend/i],
  },
  {
    id: 'retry-shopify',
    label: 'il retry/backoff dinamico sulle chiamate API Shopify',
    patterns: [/\b429\b/, /riduzione dinamica/i, /batch e concorrenza/i],
  },
  {
    id: 'azure-service-bus',
    label: "l'integrazione con Azure Service Bus",
    patterns: [/service bus/i],
  },
  {
    id: 'webhook-bullmq',
    label: 'il sistema di consumo webhook con BullMQ e alerting',
    patterns: [/bullmq/i, /soglia di (tentativi|retry)/i],
  },
  {
    id: 'hr-tool',
    label: "il tool interno di automazione HR (Factorial → Google Calendar e Tempo)",
    patterns: [/factorial/i, /\btempo\b.{0,30}atlassian/i, /automazione hr/i, /dashboard hr/i],
  },
  {
    id: 'tally-migration',
    label: 'la migrazione dei template Tally alla 2.0 su DynamoDB',
    patterns: [/template.{0,20}2\.0/i, /dynamodb/i, /chiavi dato/i],
  },
  {
    id: 'tally-stripe',
    label: "l'integrazione Stripe su Tally",
    patterns: [/stripe/i],
  },
  {
    id: 'tally-openai',
    label: "l'integrazione OpenAI per la generazione di contenuti su Tally",
    patterns: [/openai/i],
  },
  {
    id: 'uboat-aste',
    label: 'il microservizio WebSocket per le aste di Uboat',
    patterns: [/uboat/i, /\baste\b/i, /race condition/i],
  },
  {
    id: 'seo-microservizi',
    label: 'i microservizi per i controlli SEO automatici in ISmartFrame',
    patterns: [/hreflang/i, /controlli seo/i, /ismartframe/i],
  },
  {
    id: 'steal-drink',
    label: 'Steal Drink e la prevenzione dell\'oversell con decremento atomico',
    patterns: [/steal ?drink/i, /easydrink/i, /oversell/i, /decremento atomico/i],
  },
  {
    id: 'black-friday',
    label: 'la gestione dei picchi da ~20.000 utenti al Black Friday',
    patterns: [/black friday/i, /20\.?000 utenti/i],
  },
];

/**
 * Restituisce le label degli episodi già comparsi nelle risposte del bot.
 * Legge la history COMPLETA ricevuta dal client, non quella troncata per il modello.
 */
export function detectToldEpisodes(history: Array<{ role: string; content: string }>): string[] {
  const assistantText = history
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n');

  if (!assistantText) return [];

  return EPISODES.filter((ep) => ep.patterns.some((p) => p.test(assistantText))).map((ep) => ep.label);
}

/**
 * Nota di sistema da accodare al prompt per la singola richiesta.
 * `null` quando non c'è ancora nulla da segnalare.
 */
export function buildRepetitionNote(toldLabels: string[]): string | null {
  if (toldLabels.length === 0) return null;

  const list = toldLabels.map((l) => `- ${l}`).join('\n');
  const remaining = EPISODES.length - toldLabels.length;

  const closing =
    remaining > 0
      ? 'Se ti viene chiesto un altro episodio, scegline uno NON presente in questa lista.'
      : 'Hai esaurito gli episodi del CV: se te ne viene chiesto un altro, dillo apertamente invece di ripeterne uno.';

  return `EPISODI GIÀ RACCONTATI in questa conversazione — non riproporli:\n${list}\n${closing}`;
}

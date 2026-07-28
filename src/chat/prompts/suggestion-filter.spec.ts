import { filterSuggestions } from './suggestion-filter';

describe('filterSuggestions', () => {
  const scartata = (s: string) => filterSuggestions([s]).dropped;
  const tenuta = (s: string) => filterSuggestions([s]).kept;

  describe('scarta i vicoli ciechi', () => {
    it.each([
      'Quali servizi AWS usavi oltre a DynamoDB?',
      'Quali altri database hai usato?',
      'Che altri tool conosci?',
      'Altri servizi cloud?',
      'Che versione di PostgreSQL usavate?',
      'Quali versioni di Node hai usato?',
      'Di quanto è migliorata la latenza?',
      'In che percentuale hai ridotto i tempi?',
      'Quante persone c\'erano nel team?',
      'Quanto tempo ci hai messo a risolverlo?',
      'Che tool di CI/CD usavate?',
      'Quanto era carico il database?',
      'Che servizi AWS usavi?',
      'Quali servizi di GCP hai usato?',
      'Che componenti Strapi hai sviluppato?',
    ])('scarta "%s"', (s) => {
      expect(scartata(s)).toEqual([s]);
    });
  });

  describe('tiene gli approfondimenti legittimi', () => {
    it.each([
      'Come hai gestito la cache?',
      'Perché non Redis?',
      'Cosa faceva Tally esattamente?',
      'Come hai diagnosticato l\'incidente?',
      'Che problema risolveva il tool HR?',
      'Come funzionava la migrazione dei template?',
      'Perché hai scelto i webhook?',
      'Cosa è successo dopo l\'hotfix?',
      'Quali metriche monitoravi?',
      'Quali servizi hai integrato?',
      'Che parti del sistema hai riscritto?',
    ])('tiene "%s"', (s) => {
      expect(tenuta(s)).toEqual([s]);
    });
  });

  it('separa tenute e scartate nello stesso batch', () => {
    const result = filterSuggestions([
      'Come hai gestito la cache?',
      'Quali servizi AWS usavi oltre a DynamoDB?',
      'Perché non Redis?',
    ]);
    expect(result.kept).toEqual(['Come hai gestito la cache?', 'Perché non Redis?']);
    expect(result.dropped).toEqual(['Quali servizi AWS usavi oltre a DynamoDB?']);
  });

  it('non lancia su lista vuota', () => {
    expect(filterSuggestions([])).toEqual({ kept: [], dropped: [] });
  });

  it('è case-insensitive', () => {
    expect(scartata('QUALI SERVIZI OLTRE A QUELLI CITATI?')).toHaveLength(1);
  });
});

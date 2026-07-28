import { buildSystemPrompt } from './cv-system-prompt';

describe('buildSystemPrompt', () => {
  const SAMPLE_CV = 'Nome: Sebastiano Piccione\nEsperienza: Backend Engineer';

  let prompt: string;

  beforeAll(() => {
    prompt = buildSystemPrompt(SAMPLE_CV);
  });

  it('restituisce una stringa non vuota', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('contiene il contenuto del CV iniettato', () => {
    expect(prompt).toContain(SAMPLE_CV);
  });

  it('contiene la sezione identità', () => {
    expect(prompt).toContain('Sei Sebastiano Piccione');
  });

  it('contiene le regole assolute', () => {
    expect(prompt).toContain('REGOLE ASSOLUTE');
  });

  it('contiene il formato risposta JSON', () => {
    expect(prompt).toContain('FORMATO RISPOSTA');
    expect(prompt).toContain('"reply"');
    expect(prompt).toContain('"suggestions"');
  });

  it('contiene i delimitatori del CV', () => {
    expect(prompt).toContain('=== CV ===');
    expect(prompt).toContain('=== FINE CV ===');
  });

  it('il CV appare tra i delimitatori', () => {
    const cvStart = prompt.indexOf('=== CV ===');
    const cvEnd = prompt.indexOf('=== FINE CV ===');
    const cvSection = prompt.slice(cvStart, cvEnd);
    expect(cvSection).toContain(SAMPLE_CV);
  });

  it('genera prompt diversi con CV diversi', () => {
    const other = buildSystemPrompt('CV completamente diverso');
    expect(other).not.toBe(prompt);
    expect(other).toContain('CV completamente diverso');
    expect(other).not.toContain(SAMPLE_CV);
  });

  it('prompt vuoto non lancia eccezioni', () => {
    expect(() => buildSystemPrompt('')).not.toThrow();
  });

  it('vieta di aggiungere dettagli non presenti nel CV', () => {
    expect(prompt).toContain('FEDELTÀ AL CV');
    expect(prompt).toContain('specializzare un termine generico');
    expect(prompt).toContain('inventare metriche');
  });

  it('vieta di giudicare la propria esperienza', () => {
    expect(prompt).toContain('NON GIUDICARE LA TUA ESPERIENZA');
    expect(prompt).toContain('niente di super complesso');
    expect(prompt).toContain('era la prima volta');
  });

  it('vieta aperture e chiusure a stampino', () => {
    expect(prompt).toContain('ENTRA DRITTO NEL FATTO');
    expect(prompt).toContain('mai una morale');
  });

  it('vieta di ripetere episodi già raccontati', () => {
    expect(prompt).toContain('NON RIPETERE UN EPISODIO GIÀ RACCONTATO');
  });
});

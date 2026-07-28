import { EPISODES, detectToldEpisodes, buildRepetitionNote } from './episodes';

const assistant = (content: string) => ({ role: 'assistant', content });
const user = (content: string) => ({ role: 'user', content });

describe('detectToldEpisodes', () => {
  it('non rileva nulla su history vuota', () => {
    expect(detectToldEpisodes([])).toEqual([]);
  });

  it('non rileva nulla se ci sono solo messaggi utente', () => {
    const history = [user('parlami dell\'incidente Strapi con 200 container')];
    expect(detectToldEpisodes(history)).toEqual([]);
  });

  it('riconosce l\'incidente Strapi dalla risposta del bot', () => {
    const history = [
      user('raccontami un problema tecnico risolto'),
      assistant('Il process manager era avviato in modalità fork invece di cluster, con ~200 container in loop.'),
    ];
    const told = detectToldEpisodes(history);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('Strapi');
  });

  it('riconosce più episodi distinti nella stessa conversazione', () => {
    const history = [
      assistant('Ho riprogettato il sistema listini prezzi su ~40.000 prodotti.'),
      assistant('Sul progetto Uboat ho gestito le aste evitando race condition.'),
      assistant('Ho scelto una cache HTML statica con invalidazione per URL.'),
    ];
    expect(detectToldEpisodes(history)).toHaveLength(3);
  });

  it('non confonde episodi diversi dello stesso cliente', () => {
    const history = [assistant('Ho integrato Azure Service Bus per la sincronizzazione bidirezionale.')];
    const told = detectToldEpisodes(history);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('Service Bus');
  });

  it('è case-insensitive', () => {
    const history = [assistant('HO USATO FACTORIAL PER LE FERIE')];
    expect(detectToldEpisodes(history)).toHaveLength(1);
  });
});

describe('buildRepetitionNote', () => {
  it('restituisce null quando non è stato raccontato nulla', () => {
    expect(buildRepetitionNote([])).toBeNull();
  });

  it('elenca gli episodi già raccontati', () => {
    const note = buildRepetitionNote(['episodio A', 'episodio B']);
    expect(note).toContain('episodio A');
    expect(note).toContain('episodio B');
    expect(note).toContain('non riproporli');
  });

  it('elenca gli episodi ancora disponibili con il loro numero', () => {
    const primo = EPISODES[0].label;
    const note = buildRepetitionNote([primo]) as string;
    expect(note).toContain(`ANCORA DISPONIBILI (${EPISODES.length - 1})`);
    expect(note).toContain(EPISODES[1].label);
  });

  it('non elenca fra i disponibili quelli già raccontati', () => {
    const primo = EPISODES[0].label;
    const note = buildRepetitionNote([primo]) as string;
    const sezioneDisponibili = note.slice(note.indexOf('ANCORA DISPONIBILI'));
    expect(sezioneDisponibili).not.toContain(primo);
  });

  it('segnala di dirlo apertamente solo quando gli episodi sono davvero esauriti', () => {
    const tutti = EPISODES.map((e) => e.label);
    const note = buildRepetitionNote(tutti) as string;
    expect(note).toContain('esaurito');
    expect(note).not.toContain('ANCORA DISPONIBILI');
  });
});

describe('catalogo EPISODES', () => {
  it('non ha id duplicati', () => {
    const ids = EPISODES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ogni episodio ha almeno un pattern e una label', () => {
    for (const ep of EPISODES) {
      expect(ep.patterns.length).toBeGreaterThan(0);
      expect(ep.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('nessun pattern usa il flag globale (lo stato di lastIndex falserebbe i match ripetuti)', () => {
    for (const ep of EPISODES) {
      for (const p of ep.patterns) {
        expect(p.global).toBe(false);
      }
    }
  });
});

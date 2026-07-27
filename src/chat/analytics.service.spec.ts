import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';

// Nessun REDIS_URL => il servizio usa il fallback su file; i test non chiamano
// mai onModuleInit/Destroy, quindi non tocca il disco.
function makeService(): AnalyticsService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new AnalyticsService(config);
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    // I timer finti tengono fermo il save debounced: i test restano in memoria.
    jest.useFakeTimers();
    service = makeService();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('registra gli eventi e li restituisce dal più recente', () => {
    service.record([
      { name: 'session_start', sessionId: 'a' },
      { name: 'chip_click', sessionId: 'a', label: 'Che stack usi?' },
    ]);

    expect(service.size).toBe(2);
    expect(service.list()[0].name).toBe('chip_click');
  });

  it('usa "anon" quando il sessionId manca o è vuoto', () => {
    service.record([{ name: 'session_start' }, { name: 'widget_seen', sessionId: '  ' }]);

    expect(service.list().every((e) => e.sessionId === 'anon')).toBe(true);
  });

  it('tronca le label oltre i 200 caratteri', () => {
    service.record([{ name: 'message_sent', sessionId: 'a', label: 'x'.repeat(500) }]);

    const label = service.list()[0].label!;
    expect(label).toHaveLength(201);
    expect(label.endsWith('…')).toBe(true);
  });

  it('ignora il timestamp del client e usa quello del server', () => {
    service.record([{ name: 'session_start', sessionId: 'a', ts: '1999-01-01T00:00:00.000Z' }]);

    expect(service.list()[0].ts.startsWith('1999')).toBe(false);
  });

  describe('stats', () => {
    it('conta le sessioni distinte e il tasso di ingaggio', () => {
      service.record([
        { name: 'session_start', sessionId: 'a' },
        { name: 'message_sent', sessionId: 'a', label: 'Ciao', source: 'typed' },
        { name: 'message_sent', sessionId: 'a', label: 'Ancora', source: 'typed' },
        { name: 'session_start', sessionId: 'b' },
      ]);

      const stats = service.stats();
      expect(stats.sessions).toBe(2);
      expect(stats.engagement.withMessage).toBe(1);
      expect(stats.engagement.rate).toBe(0.5);
      expect(stats.engagement.messagesPerSession).toBe(1);
    });

    it('classifica i chip più cliccati in ordine decrescente', () => {
      service.record([
        { name: 'chip_click', sessionId: 'a', label: 'Stack', source: 'initial' },
        { name: 'chip_click', sessionId: 'b', label: 'Stack', source: 'initial' },
        { name: 'chip_click', sessionId: 'c', label: 'Progetti', source: 'context' },
      ]);

      expect(service.stats().topChips).toEqual([
        { label: 'Stack', count: 2 },
        { label: 'Progetti', count: 1 },
      ]);
    });

    it('calcola il tasso di conversione del nudge proattivo', () => {
      service.record([
        { name: 'proactive_shown', sessionId: 'a' },
        { name: 'proactive_shown', sessionId: 'b' },
        { name: 'proactive_shown', sessionId: 'c' },
        { name: 'proactive_shown', sessionId: 'd' },
        { name: 'proactive_converted', sessionId: 'a' },
      ]);

      expect(service.stats().proactive).toEqual({ shown: 4, converted: 1, rate: 0.25 });
    });

    it('non divide per zero quando non ci sono eventi', () => {
      const stats = service.stats();
      expect(stats.proactive.rate).toBe(0);
      expect(stats.engagement.rate).toBe(0);
      expect(stats.firstSeen).toBeNull();
    });

    it('aggrega sessioni e messaggi per pagina', () => {
      service.record([
        { name: 'session_start', sessionId: 'a', page: '/cv' },
        { name: 'message_sent', sessionId: 'a', page: '/cv', label: 'Q1' },
        { name: 'session_start', sessionId: 'b', page: '/cv' },
        { name: 'session_start', sessionId: 'c', page: '/progetti' },
      ]);

      expect(service.stats().byPage).toEqual([
        { page: '/cv', sessions: 2, messages: 1 },
        { page: '/progetti', sessions: 1, messages: 0 },
      ]);
    });
  });
});

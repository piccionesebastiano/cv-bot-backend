import { ConfigService } from '@nestjs/config';
import { SiteAnalyticsService, SiteEventInput } from './site-analytics.service';

// Nessun REDIS_URL => fallback su file. I test non chiamano mai
// onModuleInit/Destroy e usano timer finti, quindi non toccano il disco.
function makeService(): SiteAnalyticsService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new SiteAnalyticsService(config);
}

function click(overrides: Partial<SiteEventInput> = {}): SiteEventInput {
  return { type: 'click', path: '/', device: 'desktop', x: 50, y: 400, ...overrides };
}

describe('SiteAnalyticsService', () => {
  let service: SiteAnalyticsService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = makeService();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('normalizzazione del path', () => {
    it('collassa query string e slash finale sullo stesso bucket', () => {
      service.record('s1', [
        { type: 'pageview', path: '/lavoro', device: 'desktop' },
        { type: 'pageview', path: '/lavoro/', device: 'desktop' },
        { type: 'pageview', path: '/lavoro?utm_source=x', device: 'desktop' },
      ]);

      const pages = service.overview().pages;
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({ path: '/lavoro', views: 3 });
    });

    it('tiene la root come "/"', () => {
      service.record('s1', [{ type: 'pageview', path: '/', device: 'desktop' }]);
      expect(service.overview().pages[0].path).toBe('/');
    });
  });

  describe('griglia heatmap', () => {
    it('somma i click che cadono nella stessa cella', () => {
      // y 400 e 410 stanno entrambe nella riga 10 (celle da 40px).
      service.record('s1', [click({ y: 400 }), click({ y: 410 }), click({ y: 415 })]);

      const map = service.heatmap('/', 'desktop', 'click');
      expect(map.cells).toEqual([[50, 10, 3]]);
      expect(map.max).toBe(3);
      expect(map.samples).toBe(3);
    });

    it('separa le celle per device e per layer', () => {
      service.record('s1', [
        click({ device: 'desktop' }),
        click({ device: 'mobile' }),
        click({ type: 'move', device: 'desktop' }),
      ]);

      expect(service.heatmap('/', 'desktop', 'click').samples).toBe(1);
      expect(service.heatmap('/', 'mobile', 'click').samples).toBe(1);
      expect(service.heatmap('/', 'desktop', 'move').samples).toBe(1);
      expect(service.heatmap('/', 'mobile', 'move').samples).toBe(0);
    });

    it('clampa le coordinate fuori scala dentro la griglia', () => {
      service.record('s1', [click({ x: 100, y: 9_999_999 })]);

      const [[col, row]] = service.heatmap('/', 'desktop', 'click').cells;
      expect(col).toBe(99);   // 100 colonne, indice max 99
      expect(row).toBe(999);  // 1000 righe, indice max 999
    });

    it('restituisce una heatmap vuota per una pagina mai vista', () => {
      const map = service.heatmap('/mai-vista', 'desktop', 'click');
      expect(map.cells).toEqual([]);
      expect(map.max).toBe(0);
      expect(map.elements).toEqual([]);
    });
  });

  describe('scroll reach', () => {
    it('conta una sessione in tutte le bande fino a quella raggiunta', () => {
      service.record('s1', [
        { type: 'leave', path: '/', device: 'desktop', scroll: 100, seconds: 10 },
        { type: 'leave', path: '/', device: 'desktop', scroll: 50, seconds: 10 },
      ]);

      const reach = service.heatmap('/', 'desktop', 'click').scrollReach;
      // Normalizzato sulla prima banda: tutti vedono l'inizio, metà arriva in fondo.
      // Il 50% cade sul bordo alto della banda 10, quindi quella sessione la conta.
      expect(reach[0]).toBe(1);
      expect(reach[10]).toBe(1);
      expect(reach[11]).toBe(0.5); // oltre il 55%: solo chi è arrivato in fondo
      expect(reach[19]).toBe(0.5);
    });

    it('vale zero ovunque se nessuno ha ancora lasciato la pagina', () => {
      service.record('s1', [click()]);
      expect(service.heatmap('/', 'desktop', 'click').scrollReach.every((n) => n === 0)).toBe(true);
    });
  });

  describe('overview', () => {
    it('media scroll e tempo solo sugli eventi di uscita', () => {
      service.record('s1', [
        { type: 'pageview', path: '/', device: 'desktop' },
        { type: 'leave', path: '/', device: 'desktop', scroll: 80, seconds: 30 },
      ]);
      service.record('s2', [
        { type: 'pageview', path: '/', device: 'desktop' },
        { type: 'leave', path: '/', device: 'desktop', scroll: 40, seconds: 10 },
      ]);

      const o = service.overview();
      expect(o.sessions).toBe(2);
      expect(o.pageviews).toBe(2);
      expect(o.avgScroll).toBe(60);
      expect(o.avgSeconds).toBe(20);
    });

    it('conta i rage click a parte', () => {
      service.record('s1', [click(), click({ rage: true }), click({ rage: true })]);

      const o = service.overview();
      expect(o.clicks).toBe(3);
      expect(o.rageClicks).toBe(2);
    });

    it('classifica gli elementi cliccati e conserva l\'ultima etichetta', () => {
      service.record('s1', [
        click({ selector: 'a.cta', label: 'Contattami' }),
        click({ selector: 'a.cta', label: 'Contattami' }),
        click({ selector: 'button.nav', label: 'Menu' }),
      ]);

      expect(service.heatmap('/', 'desktop', 'click').elements).toEqual([
        { selector: 'a.cta', label: 'Contattami', count: 2 },
        { selector: 'button.nav', label: 'Menu', count: 1 },
      ]);
    });

    it('aggrega device e referrer sui soli pageview', () => {
      service.record('s1', [
        { type: 'pageview', path: '/', device: 'desktop', referrer: 'google.com' },
        { type: 'pageview', path: '/', device: 'mobile', referrer: 'google.com' },
        { type: 'pageview', path: '/', device: 'mobile', referrer: 'linkedin.com' },
      ]);

      const o = service.overview();
      expect(o.devices).toEqual({ desktop: 1, mobile: 2 });
      expect(o.referrers).toEqual([
        { host: 'google.com', count: 2 },
        { host: 'linkedin.com', count: 1 },
      ]);
    });

    it('conta le sessioni distinte per pagina', () => {
      service.record('s1', [click({ path: '/a' }), click({ path: '/b' })]);
      service.record('s2', [click({ path: '/a' })]);

      const byPath = Object.fromEntries(service.overview().pages.map((p) => [p.path, p.sessions]));
      expect(byPath).toEqual({ '/a': 2, '/b': 1 });
    });
  });

  describe('limiti', () => {
    it('smette di creare pagine oltre il tetto invece di crescere all\'infinito', () => {
      for (let i = 0; i < 150; i++) {
        service.record('s1', [{ type: 'pageview', path: `/p${i}`, device: 'desktop' }]);
      }
      expect(service.pageCount).toBe(100);
    });

    it('azzera tutto', async () => {
      service.record('s1', [click()]);
      await service.clearAll();

      const o = service.overview();
      expect(o.sessions).toBe(0);
      expect(o.pages).toEqual([]);
      expect(service.heatmap('/', 'desktop', 'click').cells).toEqual([]);
    });
  });
});

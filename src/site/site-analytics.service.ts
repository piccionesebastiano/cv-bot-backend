import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';

/**
 * Site-wide behavioural analytics.
 *
 * Raw hits are never kept. Every event is folded into fixed-size aggregates the
 * moment it arrives, so memory is bounded by the *shape* of the site (pages ×
 * devices × grid cells) rather than by traffic. A page that gets a million
 * clicks costs exactly as much as one that gets a thousand.
 */

export const DEVICES = ['mobile', 'tablet', 'desktop'] as const;
export type Device = (typeof DEVICES)[number];

export const LAYERS = ['click', 'move'] as const;
export type Layer = (typeof LAYERS)[number];

export const SITE_EVENT_TYPES = ['pageview', 'click', 'move', 'leave'] as const;
export type SiteEventType = (typeof SITE_EVENT_TYPES)[number];

export interface SiteEventInput {
  type: SiteEventType;
  path: string;
  device: Device;
  /** Horizontal position as % of viewport width (0–100) — survives reflow. */
  x?: number;
  /** Vertical position in absolute px from the top of the document. */
  y?: number;
  selector?: string;
  label?: string;
  rage?: boolean;
  /** Deepest scroll reached, % of document height. */
  scroll?: number;
  seconds?: number;
  docHeight?: number;
  viewportWidth?: number;
  /** Referrer host only — never the full URL. */
  referrer?: string;
}

export interface PageStats {
  path: string;
  views: number;
  clicks: number;
  rageClicks: number;
  sessions: number;
  avgScroll: number;
  avgSeconds: number;
  medianDocHeight: number;
}

export interface SiteOverview {
  sessions: number;
  pageviews: number;
  clicks: number;
  rageClicks: number;
  avgScroll: number;
  avgSeconds: number;
  firstSeen: string | null;
  lastSeen: string | null;
  pages: PageStats[];
  devices: Record<string, number>;
  referrers: Array<{ host: string; count: number }>;
}

export interface HeatmapResponse {
  path: string;
  device: Device;
  layer: Layer;
  /** Grid geometry the client needs to place cells back on the page. */
  columns: number;
  rowHeight: number;
  docHeight: number;
  samples: number;
  max: number;
  /** [column, row, count] triplets — sparse by construction. */
  cells: Array<[number, number, number]>;
  /** Share of sessions still present at each 5% depth band. */
  scrollReach: number[];
  elements: Array<{ selector: string; label: string; count: number }>;
}

// ─── Grid geometry ────────────────────────────────────────────────────────────

/** Horizontal resolution: 100 columns = 1% of viewport width each. */
const COLUMNS = 100;
/** Vertical resolution in CSS px. 40px keeps a 40 000px page inside 1 000 rows. */
const ROW_HEIGHT = 40;
const MAX_ROWS = 1000;
/** Cell keys pack (col, row) into one integer so the grid is a flat Map. */
const ROW_STRIDE = 1000;

const SCROLL_BANDS = 20; // 5% each

// ─── Caps (the memory ceiling) ────────────────────────────────────────────────

const MAX_PAGES = 100;
const MAX_CELLS_PER_GRID = 20000;
const MAX_ELEMENTS_PER_PAGE = 300;
const MAX_SESSIONS = 5000;
const MAX_REFERRERS = 200;
const MAX_LABEL_LEN = 80;
const MAX_SELECTOR_LEN = 160;
const MAX_PATH_LEN = 200;

const CACHE_DIR = process.env['CACHE_DIR'] ?? join(process.cwd(), 'data');
const SITE_FILE = join(CACHE_DIR, 'site-analytics.json');
const REDIS_SITE_KEY = 'cv:site-analytics';

interface PageAccumulator {
  views: number;
  clicks: number;
  rageClicks: number;
  sessions: Set<string>;
  scrollSum: number;
  scrollCount: number;
  secondsSum: number;
  secondsCount: number;
  docHeights: number[]; // reservoir of recent heights; median drives the viewer
  elements: Map<string, { count: number; label: string }>;
}

/** Everything the service owns, in one serialisable shape. */
interface Snapshot {
  pages: Array<[string, SerialisedPage]>;
  grids: Array<[string, Array<[number, number]>]>;
  scroll: Array<[string, number[]]>;
  sessions: string[];
  devices: Array<[string, number]>;
  referrers: Array<[string, number]>;
  firstSeen: string | null;
  lastSeen: string | null;
}

interface SerialisedPage {
  views: number;
  clicks: number;
  rageClicks: number;
  sessions: string[];
  scrollSum: number;
  scrollCount: number;
  secondsSum: number;
  secondsCount: number;
  docHeights: number[];
  elements: Array<[string, { count: number; label: string }]>;
}

@Injectable()
export class SiteAnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SiteAnalyticsService.name);
  private readonly redis: Redis | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private pages = new Map<string, PageAccumulator>();
  /** `path|device|layer` → packed cell key → hits. */
  private grids = new Map<string, Map<number, number>>();
  /** `path|device` → 20 bands of scroll reach. */
  private scroll = new Map<string, number[]>();
  private sessions = new Set<string>();
  private devices = new Map<string, number>();
  private referrers = new Map<string, number>();
  private firstSeen: string | null = null;
  private lastSeen: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      this.redis.on('error', (err) => this.logger.warn(`Redis site error: ${err.message}`));
      this.logger.log('Site analytics: Redis');
    } else {
      this.logger.log('Site analytics: file (REDIS_URL non impostato)');
    }
  }

  async onModuleInit(): Promise<void> {
    const snapshot = this.redis ? await this.readFromRedis() : await this.readFromDisk();
    if (snapshot) {
      this.hydrate(snapshot);
      this.logger.log(`Site analytics caricate: ${this.pages.size} pagine, ${this.sessions.size} sessioni`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist();
    if (this.redis) await this.redis.quit();
  }

  // ─── Ingestion ──────────────────────────────────────────────────────────────

  record(sessionId: string, events: SiteEventInput[]): number {
    const id = (sessionId ?? '').trim().slice(0, 64) || 'anon';
    const now = new Date().toISOString();

    this.trackSession(id);
    if (!this.firstSeen) this.firstSeen = now;
    this.lastSeen = now;

    let accepted = 0;
    for (const event of events) {
      const path = normalisePath(event.path);
      const page = this.pageFor(path);
      if (!page) continue; // page cap reached — drop rather than grow unbounded
      page.sessions.add(id);
      capSet(page.sessions, MAX_SESSIONS);

      switch (event.type) {
        case 'pageview':
          page.views++;
          this.bump(this.devices, event.device, 1);
          if (event.referrer) this.bumpCapped(this.referrers, event.referrer, MAX_REFERRERS);
          if (event.docHeight) pushHeight(page.docHeights, event.docHeight);
          break;

        case 'click':
          page.clicks++;
          if (event.rage) page.rageClicks++;
          this.plot(path, event.device, 'click', event.x, event.y);
          if (event.selector) this.trackElement(page, event.selector, event.label);
          break;

        case 'move':
          this.plot(path, event.device, 'move', event.x, event.y);
          break;

        case 'leave':
          if (typeof event.scroll === 'number') {
            page.scrollSum += clamp(event.scroll, 0, 100);
            page.scrollCount++;
            this.plotScroll(path, event.device, event.scroll);
          }
          if (typeof event.seconds === 'number') {
            page.secondsSum += clamp(event.seconds, 0, 7200);
            page.secondsCount++;
          }
          if (event.docHeight) pushHeight(page.docHeights, event.docHeight);
          break;
      }
      accepted++;
    }

    this.scheduleSave();
    return accepted;
  }

  // ─── Read models ────────────────────────────────────────────────────────────

  overview(): SiteOverview {
    let pageviews = 0;
    let clicks = 0;
    let rageClicks = 0;
    let scrollSum = 0;
    let scrollCount = 0;
    let secondsSum = 0;
    let secondsCount = 0;

    const pages: PageStats[] = [];

    for (const [path, page] of this.pages) {
      pageviews += page.views;
      clicks += page.clicks;
      rageClicks += page.rageClicks;
      scrollSum += page.scrollSum;
      scrollCount += page.scrollCount;
      secondsSum += page.secondsSum;
      secondsCount += page.secondsCount;

      pages.push({
        path,
        views: page.views,
        clicks: page.clicks,
        rageClicks: page.rageClicks,
        sessions: page.sessions.size,
        avgScroll: page.scrollCount ? round(page.scrollSum / page.scrollCount) : 0,
        avgSeconds: page.secondsCount ? round(page.secondsSum / page.secondsCount) : 0,
        medianDocHeight: median(page.docHeights),
      });
    }

    pages.sort((a, b) => b.views - a.views);

    return {
      sessions: this.sessions.size,
      pageviews,
      clicks,
      rageClicks,
      avgScroll: scrollCount ? round(scrollSum / scrollCount) : 0,
      avgSeconds: secondsCount ? round(secondsSum / secondsCount) : 0,
      firstSeen: this.firstSeen,
      lastSeen: this.lastSeen,
      pages,
      devices: Object.fromEntries(this.devices),
      referrers: [...this.referrers.entries()]
        .map(([host, count]) => ({ host, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
    };
  }

  heatmap(path: string, device: Device, layer: Layer): HeatmapResponse {
    const key = normalisePath(path);
    const grid = this.grids.get(gridKey(key, device, layer));
    const page = this.pages.get(key);

    const cells: Array<[number, number, number]> = [];
    let max = 0;
    let samples = 0;

    if (grid) {
      for (const [packed, count] of grid) {
        cells.push([Math.floor(packed / ROW_STRIDE), packed % ROW_STRIDE, count]);
        if (count > max) max = count;
        samples += count;
      }
    }

    const bands = this.scroll.get(`${key}|${device}`) ?? new Array<number>(SCROLL_BANDS).fill(0);
    const reachBase = bands[0] || 0;

    const elements = page
      ? [...page.elements.entries()]
          .map(([selector, e]) => ({ selector, label: e.label, count: e.count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 25)
      : [];

    return {
      path: key,
      device,
      layer,
      columns: COLUMNS,
      rowHeight: ROW_HEIGHT,
      docHeight: page ? median(page.docHeights) : 0,
      samples,
      max,
      cells,
      scrollReach: reachBase ? bands.map((n) => round(n / reachBase)) : bands.map(() => 0),
      elements,
    };
  }

  async clearAll(): Promise<void> {
    this.pages = new Map();
    this.grids = new Map();
    this.scroll = new Map();
    this.sessions = new Set();
    this.devices = new Map();
    this.referrers = new Map();
    this.firstSeen = null;
    this.lastSeen = null;
    if (this.redis) await this.redis.del(REDIS_SITE_KEY);
    else await this.persist();
  }

  get pageCount(): number {
    return this.pages.size;
  }

  // ─── Aggregation internals ──────────────────────────────────────────────────

  private pageFor(path: string): PageAccumulator | null {
    let page = this.pages.get(path);
    if (page) return page;
    if (this.pages.size >= MAX_PAGES) return null;

    page = {
      views: 0,
      clicks: 0,
      rageClicks: 0,
      sessions: new Set(),
      scrollSum: 0,
      scrollCount: 0,
      secondsSum: 0,
      secondsCount: 0,
      docHeights: [],
      elements: new Map(),
    };
    this.pages.set(path, page);
    return page;
  }

  /** Folds one point into the (path, device, layer) grid. */
  private plot(path: string, device: Device, layer: Layer, x?: number, y?: number): void {
    if (typeof x !== 'number' || typeof y !== 'number') return;

    const col = clampInt(Math.floor(clamp(x, 0, 99.999)), 0, COLUMNS - 1);
    const row = clampInt(Math.floor(Math.max(0, y) / ROW_HEIGHT), 0, MAX_ROWS - 1);
    const packed = col * ROW_STRIDE + row;

    const key = gridKey(path, device, layer);
    let grid = this.grids.get(key);
    if (!grid) this.grids.set(key, (grid = new Map()));

    const current = grid.get(packed);
    // Once the grid is full only known cells keep counting: hot areas stay
    // accurate and a long tail of one-off pixels can't blow up memory.
    if (current === undefined && grid.size >= MAX_CELLS_PER_GRID) return;
    grid.set(packed, (current ?? 0) + 1);
  }

  /** A session that reached N% is counted in every band up to N. */
  private plotScroll(path: string, device: Device, scrollPct: number): void {
    const key = `${path}|${device}`;
    let bands = this.scroll.get(key);
    if (!bands) this.scroll.set(key, (bands = new Array<number>(SCROLL_BANDS).fill(0)));

    const reached = clampInt(Math.floor(clamp(scrollPct, 0, 100) / (100 / SCROLL_BANDS)), 0, SCROLL_BANDS - 1);
    for (let i = 0; i <= reached; i++) bands[i]++;
  }

  private trackElement(page: PageAccumulator, selector: string, label?: string): void {
    const key = selector.slice(0, MAX_SELECTOR_LEN);
    const existing = page.elements.get(key);
    if (existing) {
      existing.count++;
      if (label) existing.label = label.slice(0, MAX_LABEL_LEN);
      return;
    }
    if (page.elements.size >= MAX_ELEMENTS_PER_PAGE) return;
    page.elements.set(key, { count: 1, label: (label ?? '').slice(0, MAX_LABEL_LEN) });
  }

  private trackSession(id: string): void {
    this.sessions.add(id);
    capSet(this.sessions, MAX_SESSIONS);
  }

  private bump(map: Map<string, number>, key: string, by: number): void {
    map.set(key, (map.get(key) ?? 0) + by);
  }

  private bumpCapped(map: Map<string, number>, key: string, cap: number): void {
    if (!map.has(key) && map.size >= cap) return;
    this.bump(map, key, 1);
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist().catch((err) => this.logger.error('Debounced save failed', err));
    }, 10000);
  }

  private persist(): Promise<void> {
    return this.redis ? this.saveToRedis() : this.saveToDisk();
  }

  private snapshot(): Snapshot {
    return {
      pages: [...this.pages.entries()].map(([path, p]) => [
        path,
        {
          views: p.views,
          clicks: p.clicks,
          rageClicks: p.rageClicks,
          sessions: [...p.sessions],
          scrollSum: p.scrollSum,
          scrollCount: p.scrollCount,
          secondsSum: p.secondsSum,
          secondsCount: p.secondsCount,
          docHeights: p.docHeights,
          elements: [...p.elements.entries()],
        },
      ]),
      grids: [...this.grids.entries()].map(([key, grid]) => [key, [...grid.entries()]]),
      scroll: [...this.scroll.entries()],
      sessions: [...this.sessions],
      devices: [...this.devices.entries()],
      referrers: [...this.referrers.entries()],
      firstSeen: this.firstSeen,
      lastSeen: this.lastSeen,
    };
  }

  private hydrate(s: Snapshot): void {
    this.pages = new Map(
      (s.pages ?? []).map(([path, p]) => [
        path,
        {
          views: p.views ?? 0,
          clicks: p.clicks ?? 0,
          rageClicks: p.rageClicks ?? 0,
          sessions: new Set(p.sessions ?? []),
          scrollSum: p.scrollSum ?? 0,
          scrollCount: p.scrollCount ?? 0,
          secondsSum: p.secondsSum ?? 0,
          secondsCount: p.secondsCount ?? 0,
          docHeights: p.docHeights ?? [],
          elements: new Map(p.elements ?? []),
        },
      ]),
    );
    this.grids = new Map((s.grids ?? []).map(([key, cells]) => [key, new Map(cells)]));
    this.scroll = new Map(s.scroll ?? []);
    this.sessions = new Set(s.sessions ?? []);
    this.devices = new Map(s.devices ?? []);
    this.referrers = new Map(s.referrers ?? []);
    this.firstSeen = s.firstSeen ?? null;
    this.lastSeen = s.lastSeen ?? null;
  }

  private async readFromRedis(): Promise<Snapshot | null> {
    try {
      const raw = await this.redis!.get(REDIS_SITE_KEY);
      return raw ? (JSON.parse(raw) as Snapshot) : null;
    } catch (err) {
      this.logger.error('Errore lettura site analytics da Redis — parto vuoto', err);
      return null;
    }
  }

  private async saveToRedis(): Promise<void> {
    try {
      await this.redis!.set(REDIS_SITE_KEY, JSON.stringify(this.snapshot()));
    } catch (err) {
      this.logger.error('Errore scrittura site analytics su Redis', err);
    }
  }

  private async readFromDisk(): Promise<Snapshot | null> {
    if (!existsSync(SITE_FILE)) return null;
    try {
      return JSON.parse(await readFile(SITE_FILE, 'utf-8')) as Snapshot;
    } catch (err) {
      this.logger.error('Errore lettura site analytics da disco — parto vuoto', err);
      return null;
    }
  }

  private async saveToDisk(): Promise<void> {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(SITE_FILE, JSON.stringify(this.snapshot()), 'utf-8');
    } catch (err) {
      this.logger.error('Errore scrittura site analytics su disco', err);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gridKey(path: string, device: Device, layer: Layer): string {
  return `${path}|${device}|${layer}`;
}

/** Collapses query strings and trailing slashes so one page is one bucket. */
function normalisePath(path: string): string {
  const raw = (path ?? '/').split('?')[0].slice(0, MAX_PATH_LEN) || '/';
  const trimmed = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
  return trimmed || '/';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Keeps the newest entries when a Set outgrows its cap (insertion-ordered). */
function capSet(set: Set<string>, cap: number): void {
  if (set.size <= cap) return;
  const excess = set.size - cap;
  let i = 0;
  for (const value of set) {
    if (i++ >= excess) break;
    set.delete(value);
  }
}

/** Bounded reservoir of the most recent document heights. */
function pushHeight(heights: number[], height: number): void {
  heights.push(Math.round(clamp(height, 0, 200000)));
  if (heights.length > 50) heights.shift();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

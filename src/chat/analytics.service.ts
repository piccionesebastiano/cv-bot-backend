import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';

/** Event names the widget is allowed to emit. Anything else is rejected by the DTO. */
export const EVENT_NAMES = [
  'session_start',
  'widget_seen',
  'chip_click',
  'message_sent',
  'proactive_shown',
  'proactive_converted',
  'copy_click',
  'conversation_reset',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Where a sent message or a clicked chip came from. */
export const EVENT_SOURCES = ['initial', 'context', 'dynamic', 'proactive', 'typed'] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];

export interface AnalyticsEvent {
  name: EventName;
  sessionId: string;
  ts: string;
  label?: string;
  page?: string;
  source?: EventSource;
}

export interface AnalyticsStats {
  totalEvents: number;
  sessions: number;
  firstSeen: string | null;
  lastSeen: string | null;
  byName: Record<string, number>;
  topChips: Array<{ label: string; count: number }>;
  topQuestions: Array<{ label: string; count: number }>;
  bySource: Record<string, number>;
  byPage: Array<{ page: string; sessions: number; messages: number }>;
  proactive: { shown: number; converted: number; rate: number };
  engagement: { sessions: number; withMessage: number; rate: number; messagesPerSession: number };
}

const MAX_EVENTS = 5000;
const MAX_LABEL_LEN = 200;
const CACHE_DIR = process.env['CACHE_DIR'] ?? join(process.cwd(), 'data');
const EVENTS_FILE = join(CACHE_DIR, 'analytics.json');
const REDIS_EVENTS_KEY = 'cv:analytics';

@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private events: AnalyticsEvent[] = [];
  private readonly redis: Redis | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      this.redis.on('error', (err) => this.logger.warn(`Redis analytics error: ${err.message}`));
      this.logger.log('Analytics: Redis');
    } else {
      this.logger.log('Analytics: file (REDIS_URL non impostato)');
    }
  }

  async onModuleInit(): Promise<void> {
    const raw = this.redis ? await this.readFromRedis() : await this.readFromDisk();
    if (raw) {
      this.events = raw.slice(-MAX_EVENTS);
      this.logger.log(`Eventi analytics caricati: ${this.events.length}`);
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

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Appends a batch of widget events. Fire-and-forget safe. */
  record(events: Array<Partial<Omit<AnalyticsEvent, 'name'>> & { name: EventName }>): number {
    const now = new Date().toISOString();

    for (const e of events) {
      this.events.push({
        name: e.name,
        sessionId: (e.sessionId ?? '').trim() || 'anon',
        // Client clocks can be skewed or spoofed — always stamp server-side.
        ts: now,
        ...(e.label ? { label: truncate(e.label) } : {}),
        ...(e.page ? { page: truncate(e.page) } : {}),
        ...(e.source ? { source: e.source } : {}),
      });
    }

    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }

    this.scheduleSave();
    return events.length;
  }

  /** Raw events, most recent first. */
  list(): AnalyticsEvent[] {
    return [...this.events].reverse();
  }

  stats(): AnalyticsStats {
    const byName: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const chipCounts = new Map<string, number>();
    const questionCounts = new Map<string, number>();
    const pageSessions = new Map<string, Set<string>>();
    const pageMessages = new Map<string, number>();
    const allSessions = new Set<string>();
    const sessionsWithMessage = new Set<string>();
    let messages = 0;

    for (const e of this.events) {
      byName[e.name] = (byName[e.name] ?? 0) + 1;
      allSessions.add(e.sessionId);

      if (e.source) bySource[e.source] = (bySource[e.source] ?? 0) + 1;

      if (e.name === 'chip_click' && e.label) {
        chipCounts.set(e.label, (chipCounts.get(e.label) ?? 0) + 1);
      }

      if (e.name === 'message_sent') {
        messages++;
        sessionsWithMessage.add(e.sessionId);
        if (e.label) questionCounts.set(e.label, (questionCounts.get(e.label) ?? 0) + 1);
        if (e.page) pageMessages.set(e.page, (pageMessages.get(e.page) ?? 0) + 1);
      }

      if (e.page) {
        let set = pageSessions.get(e.page);
        if (!set) pageSessions.set(e.page, (set = new Set()));
        set.add(e.sessionId);
      }
    }

    const shown = byName['proactive_shown'] ?? 0;
    const converted = byName['proactive_converted'] ?? 0;
    const sessions = allSessions.size;

    return {
      totalEvents: this.events.length,
      sessions,
      firstSeen: this.events[0]?.ts ?? null,
      lastSeen: this.events[this.events.length - 1]?.ts ?? null,
      byName,
      topChips: topN(chipCounts, 15),
      topQuestions: topN(questionCounts, 25),
      bySource,
      byPage: [...pageSessions.entries()]
        .map(([page, set]) => ({ page, sessions: set.size, messages: pageMessages.get(page) ?? 0 }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 15),
      proactive: { shown, converted, rate: shown ? round(converted / shown) : 0 },
      engagement: {
        sessions,
        withMessage: sessionsWithMessage.size,
        rate: sessions ? round(sessionsWithMessage.size / sessions) : 0,
        messagesPerSession: sessions ? round(messages / sessions) : 0,
      },
    };
  }

  async clearAll(): Promise<number> {
    const count = this.events.length;
    this.events = [];
    if (this.redis) await this.redis.del(REDIS_EVENTS_KEY);
    else await this.persist();
    return count;
  }

  get size(): number {
    return this.events.length;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist().catch((err) => this.logger.error('Debounced save failed', err));
    }, 5000);
  }

  private persist(): Promise<void> {
    return this.redis ? this.saveToRedis() : this.saveToDisk();
  }

  private async readFromRedis(): Promise<AnalyticsEvent[] | null> {
    try {
      const raw = await this.redis!.get(REDIS_EVENTS_KEY);
      return raw ? (JSON.parse(raw) as AnalyticsEvent[]) : null;
    } catch (err) {
      this.logger.error('Errore lettura analytics da Redis — parto vuoto', err);
      return null;
    }
  }

  private async saveToRedis(): Promise<void> {
    try {
      await this.redis!.set(REDIS_EVENTS_KEY, JSON.stringify(this.events));
    } catch (err) {
      this.logger.error('Errore scrittura analytics su Redis', err);
    }
  }

  private async readFromDisk(): Promise<AnalyticsEvent[] | null> {
    if (!existsSync(EVENTS_FILE)) return null;
    try {
      return JSON.parse(await readFile(EVENTS_FILE, 'utf-8')) as AnalyticsEvent[];
    } catch (err) {
      this.logger.error('Errore lettura analytics da disco — parto vuoto', err);
      return null;
    }
  }

  private async saveToDisk(): Promise<void> {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(EVENTS_FILE, JSON.stringify(this.events), 'utf-8');
    } catch (err) {
      this.logger.error('Errore scrittura analytics su disco', err);
    }
  }
}

function truncate(s: string): string {
  return s.length > MAX_LABEL_LEN ? s.slice(0, MAX_LABEL_LEN) + '…' : s;
}

function topN(counts: Map<string, number>, n: number): Array<{ label: string; count: number }> {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

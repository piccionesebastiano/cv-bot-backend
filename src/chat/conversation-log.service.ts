import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';

export interface ConversationTurn {
  q: string;
  a: string;
  ts: string;
}

export interface Conversation {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  turns: ConversationTurn[];
}

const MAX_CONVERSATIONS = 200;
const MAX_TURNS_PER_CONV = 50;
const MAX_FIELD_LEN = 4000; // truncate abnormally long q/a before persisting
const CACHE_DIR = process.env['CACHE_DIR'] ?? join(process.cwd(), 'data');
const LOG_FILE = join(CACHE_DIR, 'conversations.json');
const REDIS_LOG_KEY = 'cv:conversations';

@Injectable()
export class ConversationLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationLogService.name);
  private readonly conversations = new Map<string, Conversation>();
  private readonly redis: Redis | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      this.redis.on('error', (err) => this.logger.warn(`Redis log error: ${err.message}`));
      this.logger.log('Log conversazioni: Redis');
    } else {
      this.logger.log('Log conversazioni: file (REDIS_URL non impostato)');
    }
  }

  async onModuleInit(): Promise<void> {
    const raw = this.redis ? await this.readFromRedis() : await this.readFromDisk();
    if (raw) {
      for (const conv of raw) this.conversations.set(conv.sessionId, conv);
      this.logger.log(`Conversazioni caricate: ${this.conversations.size}`);
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

  /** Appends a Q&A turn to the conversation identified by sessionId. Fire-and-forget safe. */
  logTurn(sessionId: string | undefined, question: string, answer: string): void {
    const id = (sessionId ?? '').trim() || 'anon';
    const now = new Date().toISOString();

    let conv = this.conversations.get(id);
    if (!conv) {
      conv = { sessionId: id, startedAt: now, updatedAt: now, turns: [] };
      this.conversations.set(id, conv);
      this.evictIfNeeded();
    }

    conv.turns.push({
      q: truncate(question),
      a: truncate(answer),
      ts: now,
    });
    if (conv.turns.length > MAX_TURNS_PER_CONV) {
      conv.turns.splice(0, conv.turns.length - MAX_TURNS_PER_CONV);
    }
    conv.updatedAt = now;

    this.scheduleSave();
  }

  /** All conversations, most recently updated first. */
  list(): Conversation[] {
    return [...this.conversations.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async clearAll(): Promise<number> {
    const count = this.conversations.size;
    this.conversations.clear();
    if (this.redis) await this.redis.del(REDIS_LOG_KEY);
    else await this.persist();
    return count;
  }

  get size(): number {
    return this.conversations.size;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private evictIfNeeded(): void {
    if (this.conversations.size <= MAX_CONVERSATIONS) return;
    // Evict the least-recently-updated conversation
    let oldestId: string | null = null;
    let oldestTs = Infinity;
    for (const conv of this.conversations.values()) {
      const t = Date.parse(conv.updatedAt);
      if (t < oldestTs) {
        oldestTs = t;
        oldestId = conv.sessionId;
      }
    }
    if (oldestId) this.conversations.delete(oldestId);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist().catch((err) => this.logger.error('Debounced save failed', err));
    }, 2000);
  }

  private persist(): Promise<void> {
    return this.redis ? this.saveToRedis() : this.saveToDisk();
  }

  // ─── Redis persistence ──────────────────────────────────────────────────────

  private async readFromRedis(): Promise<Conversation[] | null> {
    try {
      const raw = await this.redis!.get(REDIS_LOG_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : null;
    } catch (err) {
      this.logger.error('Errore lettura log da Redis — parto vuoto', err);
      return null;
    }
  }

  private async saveToRedis(): Promise<void> {
    try {
      await this.redis!.set(REDIS_LOG_KEY, JSON.stringify(this.list()));
    } catch (err) {
      this.logger.error('Errore scrittura log su Redis', err);
    }
  }

  // ─── File persistence (fallback) ────────────────────────────────────────────

  private async readFromDisk(): Promise<Conversation[] | null> {
    if (!existsSync(LOG_FILE)) return null;
    try {
      return JSON.parse(await readFile(LOG_FILE, 'utf-8')) as Conversation[];
    } catch (err) {
      this.logger.error('Errore lettura log da disco — parto vuoto', err);
      return null;
    }
  }

  private async saveToDisk(): Promise<void> {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(LOG_FILE, JSON.stringify(this.list()), 'utf-8');
    } catch (err) {
      this.logger.error('Errore scrittura log su disco', err);
    }
  }
}

function truncate(s: string): string {
  return s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN) + '…' : s;
}

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import Redis from 'ioredis';
import { CvLoaderService } from '../common/cv-loader.service';

interface CacheEntry {
  question: string;
  embedding: number[];
  answer: string;
  suggestions: string[];
  hits: number;
  createdAt: string;
  promptHash: string;
}

export type CacheLookupResult =
  | { hit: true;  answer: string; suggestions: string[]; embedding: number[] }
  | { hit: false; embedding: number[] }
  | { hit: false; embedding: null };

const SIMILARITY_THRESHOLD = 0.88;
const MAX_CACHE_SIZE = 300;
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_TIMEOUT_MS = 10_000;
const CACHE_DIR = process.env['CACHE_DIR'] ?? join(process.cwd(), 'data');
const CACHE_FILE = join(CACHE_DIR, 'cache.json');
const REDIS_CACHE_KEY = 'cv:semantic-cache';

@Injectable()
export class SemanticCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly cache: CacheEntry[] = [];
  private readonly apiKey: string;
  private readonly redis: Redis | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly cvLoader: CvLoaderService,
  ) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') ?? '';
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      this.redis.on('error', (err) =>
        this.logger.warn(`Redis cache error: ${err.message}`),
      );
      this.logger.log('Cache persistenza: Redis');
    } else {
      this.logger.log('Cache persistenza: file (REDIS_URL non impostato)');
    }
  }

  async onModuleInit(): Promise<void> {
    // CvLoaderService is initialized before this service (dependency order)
    this.logger.log(`Prompt hash corrente: ${this.cvLoader.promptHash}`);
    if (this.redis) {
      await this.loadFromRedis();
    } else {
      await this.loadFromDisk();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.redis) {
      await this.saveToRedis();
      await this.redis.quit();
    } else {
      await this.saveToDisk();
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async lookup(question: string): Promise<CacheLookupResult> {
    let embedding: number[];
    try {
      embedding = await this.embed(question);
    } catch (err) {
      this.logger.warn('Embedding fallito, skip cache lookup', err);
      return { hit: false, embedding: null };
    }

    if (this.cache.length === 0) {
      this.logger.log('Cache vuota, MISS');
      return { hit: false, embedding };
    }

    const currentHash = this.cvLoader.promptHash;
    let bestSimilarity = 0;
    let bestEntry: CacheEntry | null = null;

    for (const entry of this.cache) {
      if (entry.promptHash !== currentHash) continue;
      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestEntry = entry;
      }
    }

    this.logger.log(
      `Similarity massima: ${bestSimilarity.toFixed(3)} (soglia: ${SIMILARITY_THRESHOLD}) — ` +
      `entry più vicina: "${bestEntry?.question?.slice(0, 60) ?? 'n/a'}"`,
    );

    if (bestSimilarity >= SIMILARITY_THRESHOLD && bestEntry) {
      bestEntry.hits++;
      this.logger.log(`HIT — risposta da cache (hits totali: ${bestEntry.hits})`);
      return { hit: true, answer: bestEntry.answer, suggestions: bestEntry.suggestions, embedding };
    }

    this.logger.log(`MISS — nessuna entry supera la soglia`);
    return { hit: false, embedding };
  }

  async set(question: string, embedding: number[], answer: string, suggestions: string[]): Promise<void> {
    if (this.cache.length >= MAX_CACHE_SIZE) {
      const minHitsIdx = this.cache.reduce(
        (minIdx, entry, idx, arr) => (entry.hits < arr[minIdx].hits ? idx : minIdx),
        0,
      );
      const evicted = this.cache.splice(minHitsIdx, 1)[0];
      this.logger.log(`Cache piena — evicted LFU: "${evicted.question.slice(0, 60)}" (${evicted.hits} hits)`);
    }

    this.cache.push({
      question,
      embedding,
      answer,
      suggestions,
      hits: 0,
      createdAt: new Date().toISOString(),
      promptHash: this.cvLoader.promptHash,
    });
    this.logger.log(`Salvata in cache: "${question.slice(0, 60)}" | entries totali: ${this.cache.length}`);

    this.scheduleSave();
  }

  async clearAll(): Promise<number> {
    const count = this.cache.length;
    this.cache.splice(0, this.cache.length);
    this.logger.log(`Cache svuotata — rimosse ${count} entries`);

    if (this.redis) {
      await this.redis.del(REDIS_CACHE_KEY);
    } else {
      await this.saveToDisk();
    }
    return count;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const save = this.redis ? this.saveToRedis() : this.saveToDisk();
      save.catch((err) => this.logger.error('Debounced save failed', err));
    }, 2000);
  }

  get size(): number {
    return this.cache.length;
  }

  // ─── Redis persistence ────────────────────────────────────────────────────

  private async loadFromRedis(): Promise<void> {
    try {
      const raw = await this.redis!.get(REDIS_CACHE_KEY);
      if (!raw) {
        this.logger.log('Nessuna cache trovata in Redis — parto con cache vuota');
        return;
      }
      const entries: CacheEntry[] = JSON.parse(raw);
      const currentHash = this.cvLoader.promptHash;
      const valid = entries.filter((e) => e.promptHash === currentHash);
      const stale = entries.length - valid.length;
      if (stale > 0) {
        this.logger.warn(`Scartate ${stale} entries con prompt hash diverso (CV aggiornato)`);
      }
      this.cache.push(...valid);
      this.logger.log(`Cache caricata da Redis: ${valid.length} entries valide`);
    } catch (err) {
      this.logger.error('Errore lettura cache da Redis — parto con cache vuota', err);
    }
  }

  private async saveToRedis(): Promise<void> {
    try {
      const json = await this.serializeInWorker(this.cache);
      await this.redis!.set(REDIS_CACHE_KEY, json);
      this.logger.log(`Cache salvata su Redis (${this.cache.length} entries)`);
    } catch (err) {
      this.logger.error('Errore scrittura cache su Redis', err);
    }
  }

  // ─── File persistence (fallback quando Redis non è configurato) ───────────

  private async loadFromDisk(): Promise<void> {
    if (!existsSync(CACHE_FILE)) {
      this.logger.log(`Nessun file cache trovato — parto con cache vuota`);
      return;
    }

    try {
      const raw = await readFile(CACHE_FILE, 'utf-8');
      const entries: CacheEntry[] = JSON.parse(raw);
      const currentHash = this.cvLoader.promptHash;
      const valid = entries.filter((e) => e.promptHash === currentHash);
      const stale = entries.length - valid.length;

      if (stale > 0) {
        this.logger.warn(`Scartate ${stale} entries con prompt hash diverso (CV aggiornato)`);
      }

      this.cache.push(...valid);
      this.logger.log(`Cache caricata da disco: ${valid.length} entries valide`);
    } catch (err) {
      this.logger.error('Errore lettura cache da disco — parto con cache vuota', err);
    }
  }

  private async saveToDisk(): Promise<void> {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      const json = await this.serializeInWorker(this.cache);
      await writeFile(CACHE_FILE, json, 'utf-8');
    } catch (err) {
      this.logger.error('Errore scrittura cache su disco', err);
    }
  }

  private serializeInWorker(data: CacheEntry[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        `const { workerData, parentPort } = require('worker_threads');
         parentPort.postMessage(JSON.stringify(workerData));`,
        { eval: true, workerData: data },
      );
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`Cache worker exited with code ${code}`));
      });
    });
  }

  // ─── Embedding ────────────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    this.logger.log(`→ Embedding: "${text.slice(0, 60)}"`);
    const t0 = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      this.logger.error(`Timeout embedding dopo ${EMBEDDING_TIMEOUT_MS}ms`);
    }, EMBEDDING_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`Embedding API HTTP ${response.status}`);

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding?.length) throw new Error('Embedding vuoto nella risposta');

    this.logger.log(`← Embedding ricevuto (${embedding.length} dim) in ${Date.now() - t0}ms`);
    return embedding;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

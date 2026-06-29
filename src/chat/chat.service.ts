import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { SemanticCacheService, CacheLookupResult } from './semantic-cache.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { CvLoaderService } from '../common/cv-loader.service';
import { INJECTION_PATTERNS } from './injection-patterns';

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
  error?: { message: string; code: number };
}

interface LLMParsed {
  reply: string;
  suggestions: string[];
}

const LLM_TIMEOUT_MS = 40_000;
const MAX_HISTORY_PAIRS = 6; // max 6 scambi = 12 messaggi

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly apiKey: string;

  private readonly OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly MODEL = 'deepseek/deepseek-chat';
  private readonly MAX_TOKENS = 900;
  private readonly SITE_URL = 'https://sebastianopiccionecv.com';
  private readonly SITE_NAME = 'Sebastiano Piccione - CV Bot';

  constructor(
    private readonly configService: ConfigService,
    private readonly semanticCache: SemanticCacheService,
    private readonly cvLoader: CvLoaderService,
  ) {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurata nelle variabili d'ambiente.");
    this.apiKey = apiKey;
  }

  async chat(dto: ChatRequestDto): Promise<ChatResponseDto> {
    const preview = dto.message.slice(0, 80) + (dto.message.length > 80 ? '…' : '');
    const hasHistory = (dto.history?.length ?? 0) > 0;
    this.logger.log(`▶ Domanda ricevuta: "${preview}" | history: ${dto.history?.length ?? 0} messaggi`);

    this.checkInjection(dto.message, 'message');
    for (const item of dto.history ?? []) {
      if (item.role === 'user') {
        this.checkInjection(item.content, `history[${item.role}]`);
      }
    }

    // Cache solo per messaggi standalone — con history il contesto cambia il significato
    if (!hasHistory) {
      const lookup: CacheLookupResult = await this.semanticCache.lookup(dto.message);

      if (lookup.hit) {
        this.logger.log(`✓ Cache HIT — risposta servita senza chiamata LLM`);
        return { reply: lookup.answer, suggestions: lookup.suggestions };
      }

      this.logger.log(`✗ Cache MISS — invio a OpenRouter (${this.MODEL})`);
      const { reply, suggestions } = await this.callLLM(dto.message, []);

      if (lookup.embedding) {
        this.semanticCache.set(dto.message, lookup.embedding, reply, suggestions).catch((err) => {
          this.logger.warn('Errore salvataggio in cache', err);
        });
      }

      return { reply, suggestions };
    }

    // Multi-turn: vai diretto al LLM con la history
    this.logger.log(`→ Multi-turn, skip cache — invio a OpenRouter (${this.MODEL})`);
    const cappedHistory = (dto.history ?? []).slice(-(MAX_HISTORY_PAIRS * 2));
    const { reply, suggestions } = await this.callLLM(dto.message, cappedHistory);
    return { reply, suggestions };
  }

  async streamChat(dto: ChatRequestDto, res: Response): Promise<void> {
    const preview = dto.message.slice(0, 80) + (dto.message.length > 80 ? '…' : '');
    this.logger.log(`▶ [stream] "${preview}" | history: ${dto.history?.length ?? 0}`);

    // Injection checks before committing to SSE — exceptions still reach the filter here
    this.checkInjection(dto.message, 'message');
    for (const item of dto.history ?? []) {
      this.checkInjection(item.content, `history[${item.role}]`);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const hasHistory = (dto.history?.length ?? 0) > 0;

      if (!hasHistory) {
        const lookup: CacheLookupResult = await this.semanticCache.lookup(dto.message);

        if (lookup.hit) {
          this.logger.log('✓ [stream] Cache HIT');
          send({ token: lookup.answer });
          send({ done: true, reply: lookup.answer, suggestions: lookup.suggestions });
          return;
        }

        this.logger.log(`✗ [stream] Cache MISS — OpenRouter`);
        const parsed = await this.streamLLM(dto.message, [], send);

        if (lookup.embedding && parsed) {
          this.semanticCache.set(dto.message, lookup.embedding, parsed.reply, parsed.suggestions).catch((err) => {
            this.logger.warn('Errore salvataggio in cache (stream)', err);
          });
        }
        return;
      }

      this.logger.log(`→ [stream] Multi-turn, skip cache`);
      const cappedHistory = (dto.history ?? []).slice(-(MAX_HISTORY_PAIRS * 2));
      await this.streamLLM(dto.message, cappedHistory, send);
    } catch (err) {
      this.logger.error('Errore nel streaming SSE', err);
      try { send({ error: 'Errore interno del server' }); } catch (_) {}
    } finally {
      res.end();
    }
  }

  private async streamLLM(
    userMessage: string,
    history: Array<{ role: string; content: string }>,
    send: (data: object) => void,
  ): Promise<LLMParsed | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      this.logger.error(`[stream] Timeout LLM dopo ${LLM_TIMEOUT_MS}ms`);
    }, LLM_TIMEOUT_MS);

    let fetchRes: globalThis.Response;
    try {
      fetchRes = await fetch(this.OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': this.SITE_URL,
          'X-Title': this.SITE_NAME,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.MODEL,
          max_tokens: this.MAX_TOKENS,
          stream: true,
          messages: [
            { role: 'system', content: this.cvLoader.systemPrompt },
            ...history,
            { role: 'user', content: userMessage },
          ],
        }),
      });
    } catch (err) {
      clearTimeout(timeout);
      send({ error: (err as Error).name === 'AbortError' ? 'Timeout' : 'Errore di rete' });
      return null;
    }

    clearTimeout(timeout);

    if (!fetchRes.ok || !fetchRes.body) {
      this.logger.error(`[stream] OpenRouter HTTP ${fetchRes.status}`);
      send({ error: `OpenRouter HTTP ${fetchRes.status}` });
      return null;
    }

    const reader = (fetchRes.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    let fullBuffer = '';     // all delta content concatenated — for final parseResponse
    let scanBuffer = '';     // accumulates chars until we find "reply": "
    type State = 'before' | 'in_reply' | 'after';
    let state: State = 'before';
    let escapeNext = false;

    const REPLY_OPEN_RE = /"reply"\s*:\s*"/;

    const processChar = (ch: string): string | null => {
      // Returns the decoded char to forward, or null to stop (closing quote hit)
      if (escapeNext) {
        escapeNext = false;
        switch (ch) {
          case '"':  return '"';
          case '\\': return '\\';
          case 'n':  return '\n';
          case 'r':  return '\r';
          case 't':  return '\t';
          case '/':  return '/';
          default:   return ch;
        }
      }
      if (ch === '\\') { escapeNext = true; return ''; }
      if (ch === '"') return null; // closing quote of reply value
      return ch;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const rawText = decoder.decode(value, { stream: true });
      const lines = rawText.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;

        let chunk: { choices?: Array<{ delta?: { content?: string } }> };
        try { chunk = JSON.parse(payload) as typeof chunk; } catch { continue; }

        const token: string = chunk.choices?.[0]?.delta?.content ?? '';
        if (!token) continue;

        fullBuffer += token;

        if (state === 'before') {
          scanBuffer += token;
          const match = REPLY_OPEN_RE.exec(scanBuffer);
          if (match) {
            state = 'in_reply';
            let toSend = '';
            const afterOpen = scanBuffer.slice(match.index + match[0].length);
            scanBuffer = '';
            for (const ch of afterOpen) {
              const decoded = processChar(ch);
              if (decoded === null) { state = 'after'; break; }
              toSend += decoded;
            }
            if (toSend) send({ token: toSend });
          }
        } else if (state === 'in_reply') {
          let toSend = '';
          for (const ch of token) {
            const decoded = processChar(ch);
            if (decoded === null) { state = 'after'; break; }
            toSend += decoded;
          }
          if (toSend) send({ token: toSend });
        }
      }
    }

    const parsed = this.parseResponse(fullBuffer);
    this.logger.log(`← [stream] Completato (fullBuffer: ${fullBuffer.length} chars)`);
    send({ done: true, reply: parsed.reply, suggestions: parsed.suggestions });
    return parsed;
  }

  private checkInjection(message: string, source = 'message'): void {
    const matched = INJECTION_PATTERNS.find((p) => p.test(message));
    if (matched) {
      this.logger.warn(`Possibile prompt injection in ${source}: "${message.slice(0, 100)}"`);
      throw new BadRequestException('Messaggio non valido.');
    }
  }

  private async callLLM(userMessage: string, history: Array<{ role: string; content: string }>): Promise<LLMParsed> {
    this.logger.log(`→ POST ${this.OPENROUTER_URL}`);
    const t0 = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      this.logger.error(`Timeout LLM dopo ${LLM_TIMEOUT_MS}ms`);
    }, LLM_TIMEOUT_MS);

    let response: globalThis.Response;
    try {
      response = await fetch(this.OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': this.SITE_URL,
          'X-Title': this.SITE_NAME,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.MODEL,
          max_tokens: this.MAX_TOKENS,
          messages: [
            { role: 'system', content: this.cvLoader.systemPrompt },
            ...history,
            { role: 'user', content: userMessage },
          ],
        }),
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new InternalServerErrorException('Si è verificato un errore. Riprova tra qualche istante.');
      }
      this.logger.error('Errore di rete verso OpenRouter', err);
      throw new InternalServerErrorException('Si è verificato un errore. Riprova tra qualche istante.');
    } finally {
      clearTimeout(timeout);
    }

    let data: OpenRouterResponse;
    try {
      data = (await response.json()) as OpenRouterResponse;
    } catch {
      const elapsed = Date.now() - t0;
      this.logger.error(`OpenRouter risposta non parsabile — HTTP ${response.status} (${elapsed}ms)`);
      throw new InternalServerErrorException('Si è verificato un errore. Riprova tra qualche istante.');
    }

    const elapsed = Date.now() - t0;

    if (!response.ok || data.error) {
      this.logger.error(`OpenRouter error — HTTP ${response.status}: ${data.error?.message ?? 'unknown'}`);
      throw new InternalServerErrorException('Si è verificato un errore. Riprova tra qualche istante.');
    }

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      this.logger.error('OpenRouter ha restituito una risposta vuota', data);
      throw new InternalServerErrorException('Si è verificato un errore. Riprova tra qualche istante.');
    }

    const usage = data.usage;
    this.logger.log(
      `← Risposta ricevuta in ${elapsed}ms` +
      (usage ? ` | token: ${usage.prompt_tokens} in / ${usage.completion_tokens} out` : ''),
    );

    return this.parseResponse(raw);
  }

  private parseResponse(raw: string): LLMParsed {
    // Rimuovi eventuali backtick markdown che il modello potrebbe aggiungere
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned) as { reply?: unknown; suggestions?: unknown };
      const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
      const suggestions = Array.isArray(parsed.suggestions)
        ? (parsed.suggestions as unknown[])
            .filter((s): s is string => typeof s === 'string')
            .slice(0, 3)
        : [];

      if (!reply) {
        this.logger.warn('JSON parsato ma reply vuoto, uso raw come fallback');
        return { reply: raw, suggestions: [] };
      }

      this.logger.log(`Suggestions generate: ${JSON.stringify(suggestions)}`);
      return { reply, suggestions };
    } catch {
      this.logger.warn('Risposta LLM non è JSON valido, uso come testo puro');
      return { reply: raw, suggestions: [] };
    }
  }
}

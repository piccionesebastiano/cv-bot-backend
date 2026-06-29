import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { buildSystemPrompt } from '../chat/prompts/cv-system-prompt';

// Volume path — persists across deploys when a Railway Volume is mounted here
const CACHE_DIR = process.env['CACHE_DIR'] ?? join(process.cwd(), 'data');
const CV_VOLUME_PATH = join(CACHE_DIR, 'cv-content.md');

// Default bundled with the Docker image (outside the volume mount point)
const CV_DEFAULT_PATH = join(process.cwd(), 'cv-defaults', 'cv-content.md');

@Injectable()
export class CvLoaderService implements OnModuleInit {
  private readonly logger = new Logger(CvLoaderService.name);
  private _systemPrompt = '';
  private _promptHash = '';
  private _cvContent = '';

  async onModuleInit(): Promise<void> {
    await this.loadAndBuild();
  }

  get systemPrompt(): string { return this._systemPrompt; }
  get promptHash(): string   { return this._promptHash;   }
  get cvContent(): string    { return this._cvContent;    }

  async reload(newContent: string): Promise<{ previousHash: string; newHash: string }> {
    await mkdir(dirname(CV_VOLUME_PATH), { recursive: true });
    await writeFile(CV_VOLUME_PATH, newContent, 'utf-8');

    const previousHash = this._promptHash;
    this.build(newContent);
    this.logger.log(`CV aggiornato — hash: ${previousHash} → ${this._promptHash}`);
    return { previousHash, newHash: this._promptHash };
  }

  private async loadAndBuild(): Promise<void> {
    let content: string;

    if (existsSync(CV_VOLUME_PATH)) {
      content = await readFile(CV_VOLUME_PATH, 'utf-8');
      this.logger.log('CV caricato dal volume persistente');
    } else {
      content = await readFile(CV_DEFAULT_PATH, 'utf-8');
      await mkdir(dirname(CV_VOLUME_PATH), { recursive: true });
      await writeFile(CV_VOLUME_PATH, content, 'utf-8');
      this.logger.log('CV inizializzato dal bundle → copiato sul volume');
    }

    this.build(content);
    this.logger.log(`Prompt hash corrente: ${this._promptHash}`);
  }

  private build(cvContent: string): void {
    this._cvContent = cvContent;
    this._systemPrompt = buildSystemPrompt(cvContent);
    this._promptHash = createHash('sha256').update(this._systemPrompt).digest('hex').slice(0, 8);
  }
}

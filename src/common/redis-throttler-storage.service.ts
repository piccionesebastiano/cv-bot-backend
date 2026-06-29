import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

// Local definition — compatible with @nestjs/throttler v5 and v6
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.client.on('error', (err) =>
      this.logger.warn(`Redis throttler error: ${err.message}`),
    );
  }

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    try {
      const totalHits = await this.client.incr(key);
      if (totalHits === 1) {
        await this.client.pexpire(key, ttl);
      }
      const timeToExpire = await this.client.ttl(key);
      return { totalHits, timeToExpire: Math.max(0, timeToExpire), isBlocked: false, timeToBlockExpire: 0 };
    } catch {
      this.logger.warn('Redis non raggiungibile, throttle check saltato');
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}

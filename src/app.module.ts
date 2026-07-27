import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ChatModule } from './chat/chat.module';
import { SiteModule } from './site/site.module';
import { RedisThrottlerStorage } from './common/redis-throttler-storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttl   = parseInt(config.get('THROTTLE_TTL',   '60000'));
        const limit = parseInt(config.get('THROTTLE_LIMIT', '10'));
        const redisUrl = config.get<string>('REDIS_URL');

        if (redisUrl) {
          return { throttlers: [{ ttl, limit }], storage: new RedisThrottlerStorage(redisUrl) };
        }
        return [{ ttl, limit }];
      },
    }),

    ChatModule,
    SiteModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

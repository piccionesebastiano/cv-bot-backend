import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SemanticCacheService } from './semantic-cache.service';
import { WidgetTokenGuard } from '../common/guards/widget-token.guard';

@Module({
  controllers: [ChatController],
  providers: [ChatService, SemanticCacheService, WidgetTokenGuard],
})
export class ChatModule {}

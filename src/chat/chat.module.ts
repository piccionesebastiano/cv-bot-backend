import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { AdminController } from './admin.controller';
import { ChatService } from './chat.service';
import { SemanticCacheService } from './semantic-cache.service';
import { ConversationLogService } from './conversation-log.service';
import { WidgetTokenGuard } from '../common/guards/widget-token.guard';
import { CvLoaderService } from '../common/cv-loader.service';

@Module({
  controllers: [ChatController, AdminController],
  // CvLoaderService must be listed before SemanticCacheService so NestJS resolves it first
  providers: [CvLoaderService, ChatService, SemanticCacheService, ConversationLogService, WidgetTokenGuard],
})
export class ChatModule {}

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { CvLoaderService } from '../common/cv-loader.service';
import { SemanticCacheService } from './semantic-cache.service';
import { ConversationLogService, Conversation } from './conversation-log.service';
import { safeEqual } from '../common/safe-equal';

class UpdateCvDto {
  @IsString()
  @MinLength(10)
  content: string;
}

@Controller('admin')
@Throttle({ default: { limit: 3, ttl: 60000 } })
export class AdminController {
  private readonly secret: string | undefined;

  constructor(
    private readonly cvLoader: CvLoaderService,
    private readonly semanticCache: SemanticCacheService,
    private readonly conversationLog: ConversationLogService,
    private readonly configService: ConfigService,
  ) {
    this.secret = this.configService.get<string>('ADMIN_SECRET');
  }

  @Post('cv')
  @HttpCode(HttpStatus.OK)
  async updateCv(
    @Headers('x-admin-secret') token: string,
    @Body() dto: UpdateCvDto,
  ): Promise<{ previousHash: string; newHash: string; clearedEntries: number }> {
    this.authorize(token);
    const hashes = await this.cvLoader.reload(dto.content);
    const clearedEntries = await this.semanticCache.clearAll();
    return { ...hashes, clearedEntries };
  }

  @Get('cv')
  @HttpCode(HttpStatus.OK)
  getCvInfo(
    @Headers('x-admin-secret') token: string,
  ): { hash: string; cacheSize: number } {
    this.authorize(token);
    return {
      hash: this.cvLoader.promptHash,
      cacheSize: this.semanticCache.size,
    };
  }

  @Get('cv/content')
  @HttpCode(HttpStatus.OK)
  getCvContent(
    @Headers('x-admin-secret') token: string,
  ): { content: string } {
    this.authorize(token);
    return { content: this.cvLoader.cvContent };
  }

  @Get('conversations')
  @HttpCode(HttpStatus.OK)
  getConversations(
    @Headers('x-admin-secret') token: string,
  ): { count: number; conversations: Conversation[] } {
    this.authorize(token);
    const conversations = this.conversationLog.list();
    return { count: conversations.length, conversations };
  }

  @Delete('conversations')
  @HttpCode(HttpStatus.OK)
  async clearConversations(
    @Headers('x-admin-secret') token: string,
  ): Promise<{ cleared: number }> {
    this.authorize(token);
    const cleared = await this.conversationLog.clearAll();
    return { cleared };
  }

  private authorize(token: string): void {
    if (!this.secret) throw new BadRequestException('ADMIN_SECRET non configurato');
    if (!safeEqual(token, this.secret)) throw new UnauthorizedException('Token non valido');
  }
}

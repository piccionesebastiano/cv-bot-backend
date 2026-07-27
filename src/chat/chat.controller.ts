import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { AnalyticsService } from './analytics.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { TrackEventsDto } from './dto/track-events.dto';
import { WidgetTokenGuard } from '../common/guards/widget-token.guard';

@Controller()
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WidgetTokenGuard)
  async chat(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.chatService.chat(dto);
  }

  @Post('chat/stream')
  @UseGuards(WidgetTokenGuard)
  async chatStream(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    return this.chatService.streamChat(dto, res);
  }

  // Batched widget telemetry. The widget flushes a queue, so it needs a looser
  // budget than /chat — but still bounded, since the endpoint is unauthenticated
  // whenever WIDGET_SECRET is unset.
  @Post('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(WidgetTokenGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  track(@Body() dto: TrackEventsDto): void {
    this.analytics.record(dto.events);
  }

  @Get('health')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  health(): { status: string; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}

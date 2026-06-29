import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { WidgetTokenGuard } from '../common/guards/widget-token.guard';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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

  @Get('health')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  health(): { status: string; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}

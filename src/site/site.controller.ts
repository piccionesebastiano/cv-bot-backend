import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SiteAnalyticsService } from './site-analytics.service';
import { SiteEventsDto } from './dto/site-events.dto';
import { WidgetTokenGuard } from '../common/guards/widget-token.guard';

@Controller('site')
export class SiteController {
  constructor(private readonly siteAnalytics: SiteAnalyticsService) {}

  /**
   * Batched behavioural events from the site tracker. The client buffers and
   * flushes on a timer, so a normal visit costs a handful of requests — but the
   * budget still has to cover a long session on a click-heavy page.
   */
  @Post('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(WidgetTokenGuard)
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  track(@Body() dto: SiteEventsDto): void {
    this.siteAnalytics.record(dto.sessionId ?? '', dto.events);
  }
}

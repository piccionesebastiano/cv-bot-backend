import {
  Controller,
  Get,
  Delete,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  SiteAnalyticsService,
  SiteOverview,
  HeatmapResponse,
  DEVICES,
  LAYERS,
  Device,
  Layer,
} from './site-analytics.service';
import { safeEqual } from '../common/safe-equal';

// Più permissivo del resto di /admin (3/min): la dashboard ricarica la heatmap
// a ogni cambio di pagina/device/layer. Resta irrilevante per un brute-force,
// visto che ADMIN_SECRET è una chiave a 256 bit.
@Controller('admin/site')
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class SiteAdminController {
  private readonly secret: string | undefined;

  constructor(
    private readonly siteAnalytics: SiteAnalyticsService,
    private readonly configService: ConfigService,
  ) {
    this.secret = this.configService.get<string>('ADMIN_SECRET');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  overview(@Headers('x-admin-secret') token: string): SiteOverview {
    this.authorize(token);
    return this.siteAnalytics.overview();
  }

  @Get('heatmap')
  @HttpCode(HttpStatus.OK)
  heatmap(
    @Headers('x-admin-secret') token: string,
    @Query('path') path?: string,
    @Query('device') device?: string,
    @Query('layer') layer?: string,
  ): HeatmapResponse {
    this.authorize(token);

    const resolvedDevice = (DEVICES as readonly string[]).includes(device ?? '')
      ? (device as Device)
      : 'desktop';
    const resolvedLayer = (LAYERS as readonly string[]).includes(layer ?? '')
      ? (layer as Layer)
      : 'click';

    return this.siteAnalytics.heatmap(path || '/', resolvedDevice, resolvedLayer);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async clear(@Headers('x-admin-secret') token: string): Promise<{ cleared: boolean }> {
    this.authorize(token);
    await this.siteAnalytics.clearAll();
    return { cleared: true };
  }

  private authorize(token: string): void {
    if (!this.secret) throw new BadRequestException('ADMIN_SECRET non configurato');
    if (!safeEqual(token, this.secret)) throw new UnauthorizedException('Token non valido');
  }
}

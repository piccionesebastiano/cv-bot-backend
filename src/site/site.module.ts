import { Module } from '@nestjs/common';
import { SiteController } from './site.controller';
import { SiteAdminController } from './site-admin.controller';
import { SiteAnalyticsService } from './site-analytics.service';
import { WidgetTokenGuard } from '../common/guards/widget-token.guard';

@Module({
  controllers: [SiteController, SiteAdminController],
  providers: [SiteAnalyticsService, WidgetTokenGuard],
})
export class SiteModule {}

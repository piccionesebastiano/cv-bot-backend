import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class WidgetTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.configService.get<string>('WIDGET_SECRET');

    // Se WIDGET_SECRET non è configurato il guard è trasparente (backwards compat)
    if (!secret) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-widget-token'];

    if (token !== secret) {
      throw new UnauthorizedException('Token non valido.');
    }

    return true;
  }
}

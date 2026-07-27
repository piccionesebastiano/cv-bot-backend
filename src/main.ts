import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // Disabilitiamo il body parser built-in per impostare un limite esplicito
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  // Body size limit: 4kb è più che sufficiente per { message: string }
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  // crossOriginResourcePolicy 'cross-origin': permette ai browser di leggere le risposte
  // API da origini diverse (necessario insieme a CORS per richieste cross-origin).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // Trust proxy: necessario per ottenere l'IP reale del client dietro Nginx/Railway/Render
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  if (isProduction) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  const allowedOrigins = configService
    .get<string>('ALLOWED_ORIGINS', '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning', 'x-widget-token', 'x-admin-secret'],
  });

  const port = parseInt(configService.get('PORT', '3000'), 10);
  await app.listen(port);
  logger.log(`CV Bot backend running on port ${port} [${configService.get('NODE_ENV')}]`);
}

bootstrap();

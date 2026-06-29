import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WidgetTokenGuard } from './widget-token.guard';

function mockContext(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token !== undefined ? { 'x-widget-token': token } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(secret: string | undefined): WidgetTokenGuard {
  const config = { get: () => secret } as unknown as ConfigService;
  return new WidgetTokenGuard(config);
}

describe('WidgetTokenGuard', () => {
  describe('WIDGET_SECRET non configurato', () => {
    it('permette qualsiasi richiesta', () => {
      const guard = makeGuard(undefined);
      expect(guard.canActivate(mockContext())).toBe(true);
      expect(guard.canActivate(mockContext('qualsiasi'))).toBe(true);
    });
  });

  describe('WIDGET_SECRET configurato', () => {
    const SECRET = 'super-secret-token';

    it('permette richiesta con token corretto', () => {
      const guard = makeGuard(SECRET);
      expect(guard.canActivate(mockContext(SECRET))).toBe(true);
    });

    it('rigetta richiesta con token sbagliato', () => {
      const guard = makeGuard(SECRET);
      expect(() => guard.canActivate(mockContext('wrong-token'))).toThrow(UnauthorizedException);
    });

    it('rigetta richiesta senza header x-widget-token', () => {
      const guard = makeGuard(SECRET);
      expect(() => guard.canActivate(mockContext())).toThrow(UnauthorizedException);
    });

    it('rigetta token vuoto', () => {
      const guard = makeGuard(SECRET);
      expect(() => guard.canActivate(mockContext(''))).toThrow(UnauthorizedException);
    });
  });
});

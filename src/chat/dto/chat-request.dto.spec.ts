import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChatRequestDto } from './chat-request.dto';

async function validateDto(plain: object): Promise<import('class-validator').ValidationError[]> {
  return validate(plainToInstance(ChatRequestDto, plain));
}

describe('ChatRequestDto', () => {
  describe('campo message', () => {
    it('valida un messaggio normale', async () => {
      expect(await validateDto({ message: 'Ciao!' })).toHaveLength(0);
    });

    it('valida un messaggio alla lunghezza massima (500 char)', async () => {
      expect(await validateDto({ message: 'a'.repeat(500) })).toHaveLength(0);
    });

    it('rigetta messaggio vuoto', async () => {
      const errors = await validateDto({ message: '' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('message');
    });

    it('rigetta messaggio troppo lungo (501 char)', async () => {
      const errors = await validateDto({ message: 'a'.repeat(501) });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rigetta assenza del campo message', async () => {
      const errors = await validateDto({});
      expect(errors.some((e) => e.property === 'message')).toBe(true);
    });
  });

  describe('campo history', () => {
    it('è opzionale — valido senza history', async () => {
      expect(await validateDto({ message: 'ok' })).toHaveLength(0);
    });

    it('valida history con messaggi user e assistant', async () => {
      const errors = await validateDto({
        message: 'ok',
        history: [
          { role: 'user', content: 'domanda' },
          { role: 'assistant', content: 'risposta' },
        ],
      });
      expect(errors).toHaveLength(0);
    });

    it('rigetta history con ruolo non valido', async () => {
      const errors = await validateDto({
        message: 'ok',
        history: [{ role: 'admin', content: 'test' }],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rigetta history con content vuoto', async () => {
      const errors = await validateDto({
        message: 'ok',
        history: [{ role: 'user', content: '' }],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rigetta history con content troppo lungo (>2000 char)', async () => {
      const errors = await validateDto({
        message: 'ok',
        history: [{ role: 'user', content: 'a'.repeat(2001) }],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rigetta history con più di 20 messaggi', async () => {
      const history = Array.from({ length: 21 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `messaggio ${i}`,
      }));
      const errors = await validateDto({ message: 'ok', history });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accetta history con esattamente 20 messaggi', async () => {
      const history = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `messaggio ${i}`,
      }));
      const errors = await validateDto({ message: 'ok', history });
      expect(errors).toHaveLength(0);
    });
  });
});

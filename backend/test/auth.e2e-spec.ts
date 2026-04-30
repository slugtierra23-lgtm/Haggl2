import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Nonce Generation', () => {
    it('should return nonce for valid Ethereum address', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/nonce/ethereum')
        .send({ address: '0x742d35Cc6634C0532925a3b8D4C9a3ec7eC55f81' })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.nonce).toBeDefined();
          expect(res.body.message).toContain('haggl');
        });
    });

    it('should reject invalid Ethereum address', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/nonce/ethereum')
        .send({ address: 'invalid-address' })
        .expect(400);
    });

    it('should return nonce for valid Solana address', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/nonce/solana')
        .send({ address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.nonce).toBeDefined();
        });
    });

    it('should reject invalid Solana address', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/nonce/solana')
        .send({ address: 'bad!' })
        .expect(400);
    });
  });

  describe('Security Headers', () => {
    it('should include X-Frame-Options header', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/chart/price');
      expect(res.headers['x-frame-options'] || res.headers['content-security-policy']).toBeDefined();
    });

    it('should include X-Content-Type-Options header', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/chart/price');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('Rate Limiting', () => {
    it('should block after excessive requests', async () => {
      const requests = Array.from({ length: 25 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/nonce/ethereum')
          .send({ address: '0x742d35Cc6634C0532925a3b8D4C9a3ec7eC55f81' }),
      );

      const results = await Promise.all(requests);
      const rateLimited = results.some((r: any) => r.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('Input Validation', () => {
    it('should reject SQL injection attempts', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/nonce/ethereum')
        .send({ address: "'; DROP TABLE users; --" })
        .expect(400);
    });

    it('should reject XSS attempts in body', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/nonce/ethereum')
        .send({ address: '<script>alert(1)</script>' })
        .expect(400);
    });
  });
});

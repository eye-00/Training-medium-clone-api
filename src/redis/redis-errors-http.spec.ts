import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArticlesController } from '../articles/articles.controller.js';
import { ArticlesService } from '../articles/articles.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { UsersService } from '../users/users.service.js';

const { client } = vi.hoisted(() => ({
    client: { isReady: true, on: vi.fn(), exists: vi.fn() },
}));
vi.mock('redis', () => ({ createClient: vi.fn(() => client) }));

import { RedisService } from './redis.service.js';

describe('Redis revocation failures over HTTP', () => {
    let app: INestApplication;
    const marker = 'synthetic-redis-error-canary';
    const articles = {
        findAll: vi.fn().mockResolvedValue({ articles: [], articlesCount: 0 }),
        getFeed: vi.fn().mockResolvedValue({ articles: [], articlesCount: 0 }),
    };
    const users = { findPublicById: vi.fn() };
    const jwt = {
        verifyAsync: vi.fn(async () => {
            const now = Math.floor(Date.now() / 1000);
            return {
                sub: '00000000-0000-4000-8000-000000000001',
                jti: '00000000-0000-4000-8000-000000000002',
                iat: now,
                exp: now + 900,
            };
        }),
    };

    beforeAll(async () => {
        // No real Redis connection: exercise RedisService's own request methods
        // with a fake client, while retaining the real guard/controller chain.
        vi.spyOn(RedisService.prototype, 'onModuleInit').mockResolvedValue();
        vi.spyOn(RedisService.prototype, 'onModuleDestroy').mockResolvedValue();
        const module = await Test.createTestingModule({
            controllers: [ArticlesController],
            providers: [
                JwtAuthGuard,
                OptionalJwtAuthGuard,
                RedisService,
                { provide: ConfigService, useValue: { getOrThrow: () => 'redis://127.0.0.1:6380/1' } },
                { provide: JwtService, useValue: jwt },
                { provide: UsersService, useValue: users },
                { provide: ArticlesService, useValue: articles },
            ],
        }).compile();
        app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        client.exists.mockReset();
        client.isReady = true;
    });
    afterAll(async () => {
        if (app) await app.close();
        vi.restoreAllMocks();
    });

    it.each([
        ['/api/articles/feed', 'getFeed'],
        ['/api/articles', 'findAll'],
    ] as const)('fails closed on a Redis query error for %s', async (url, handler) => {
        client.exists.mockRejectedValueOnce(new Error(marker));
        const response = await request(app.getHttpServer())
            .get(url)
            .set('Authorization', 'Bearer synthetic-test-token');
        expect(response.status).toBe(503);
        expect(response.body.message).toBe('Authentication service temporarily unavailable');
        expect(JSON.stringify(response.body).includes(marker)).toBe(false);
        expect(client.exists).toHaveBeenCalledOnce();
        expect(users.findPublicById).not.toHaveBeenCalled();
        expect(articles[handler]).not.toHaveBeenCalled();
    });

    it.each([
        ['/api/articles/feed', 'getFeed'],
        ['/api/articles', 'findAll'],
    ] as const)('fails closed when Redis is not ready for %s', async (url, handler) => {
        client.isReady = false;
        const response = await request(app.getHttpServer())
            .get(url)
            .set('Authorization', 'Bearer synthetic-test-token');
        expect(response.status).toBe(503);
        expect(response.body.message).toBe('Authentication service temporarily unavailable');
        expect(client.exists).not.toHaveBeenCalled();
        expect(users.findPublicById).not.toHaveBeenCalled();
        expect(articles[handler]).not.toHaveBeenCalled();
    });

    it('allows anonymous optional access without querying Redis', async () => {
        client.isReady = false;
        await request(app.getHttpServer()).get('/api/articles').expect(200);
        expect(client.exists).not.toHaveBeenCalled();
        expect(jwt.verifyAsync).not.toHaveBeenCalled();
        expect(articles.findAll).toHaveBeenCalledOnce();
    });

    it('keeps missing authentication as 401 without querying Redis', async () => {
        await request(app.getHttpServer()).get('/api/articles/feed').expect(401);
        expect(client.exists).not.toHaveBeenCalled();
        expect(articles.getFeed).not.toHaveBeenCalled();
    });
});

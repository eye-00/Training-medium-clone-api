import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { RedisService } from '../redis/redis.service.js';
import { UsersService } from '../users/users.service.js';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';

const user = {
    id: '308fac1d-401f-4a06-b2bd-32dd50234048',
    username: 'test_user', email: 'test@example.com', bio: null, image: null,
};
const payload = {
    sub: user.id, jti: 'b5740140-c476-44c0-b860-ec523c5308dd', iat: 100, exp: 200,
};
const findAll = vi.fn().mockResolvedValue({ articles: [], articlesCount: 0 });
const getFeed = vi.fn().mockResolvedValue({ articles: [], articlesCount: 0 });
const verifyAsync = vi.fn(async (token: string) => {
    if (token !== 'synthetic-valid') throw new Error('invalid token');
    return payload;
});
const isTokenRevoked = vi.fn().mockResolvedValue(false);
const findPublicById = vi.fn().mockResolvedValue(user);

describe('Article query HTTP validation', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const jwt = { verifyAsync } as unknown as JwtService;
        const redis = { isTokenRevoked } as unknown as RedisService;
        const users = { findPublicById } as unknown as UsersService;
        const moduleRef = await Test.createTestingModule({
            controllers: [ArticlesController],
            providers: [{ provide: ArticlesService, useValue: { findAll, getFeed } }],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue(new JwtAuthGuard(jwt, redis, users))
            .overrideGuard(OptionalJwtAuthGuard)
            .useValue(new OptionalJwtAuthGuard(jwt, redis, users))
            .compile();

        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    beforeEach(() => vi.clearAllMocks());
    afterAll(async () => { await app?.close(); });

    const routes = [
        { label: 'public listing', url: '/api/articles', auth: false },
        { label: 'authenticated feed', url: '/api/articles/feed', auth: true },
    ];

    describe.each(routes)('$label', ({ url, auth }) => {
        async function get(query: string) {
            let call = request(app.getHttpServer()).get(`${url}${query}`);
            if (auth) call = call.set('Authorization', 'Bearer synthetic-valid');
            return call;
        }

        it.each([
            { label: 'defaults', query: '', expected: { limit: 20, offset: 0 } },
            { label: 'minimums', query: '?limit=1&offset=0', expected: { limit: 1, offset: 0 } },
            { label: 'maximums', query: '?limit=100&offset=100000', expected: { limit: 100, offset: 100000 } },
            { label: 'leading zeroes', query: '?limit=01&offset=000', expected: { limit: 1, offset: 0 } },
        ])('passes $label as numeric arguments to the service', async ({ query, expected }) => {
            const response = await get(query);
            expect(response.status).toBe(200);
            if (auth) {
                expect(getFeed).toHaveBeenCalledExactlyOnceWith(user.id, expect.objectContaining(expected));
                expect(findAll).not.toHaveBeenCalled();
            } else {
                expect(findAll).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(expected), undefined);
                expect(getFeed).not.toHaveBeenCalled();
            }
        });

        it.each([
            '?limit=', '?limit=%20', '?limit=1%0A', '?limit=%2B1',
            '?limit=1.5', '?limit=1e1', '?limit=abc', '?limit=0', '?limit=101',
            '?offset=-1', '?offset=100001', '?offset=9007199254740992',
            '?limit=1&limit=2', '?offset=0&offset=1',
            '?limit%5B%5D=10', '?limit%5Bfoo%5D=10', '?unknown=value',
        ])('rejects invalid query %s before calling a service', async (query) => {
            const response = await get(query);
            expect(response.status).toBe(400);
            expect(findAll).not.toHaveBeenCalled();
            expect(getFeed).not.toHaveBeenCalled();
        });
    });

    it('trims permitted listing filters before calling the service', async () => {
        await request(app.getHttpServer())
            .get('/api/articles?tag=%20NestJS%20&author=%20author%20&favorited=%20reader%20')
            .expect(200);
        expect(findAll).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ tag: 'NestJS', author: 'author', favorited: 'reader', limit: 20, offset: 0 }),
            undefined,
        );
    });

    it.each(['?tag=', '?author=%20', '?tag=a&tag=b', '?author=a&author=b', '?favorited=a&favorited=b', '?tag%5B%5D=a'])(
        'rejects malformed or repeated listing filter %s', async (query) => {
            await request(app.getHttpServer()).get(`/api/articles${query}`).expect(400);
            expect(findAll).not.toHaveBeenCalled();
        },
    );

    it('accepts a short Unicode listing filter and rejects one above its length limit', async () => {
        const shortTag = '😀'.repeat(3);
        await request(app.getHttpServer()).get(`/api/articles?tag=${encodeURIComponent(shortTag)}`).expect(200);
        expect(findAll).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ tag: shortTag, limit: 20, offset: 0 }), undefined,
        );
        findAll.mockClear();
        await request(app.getHttpServer()).get(`/api/articles?tag=${encodeURIComponent('😀'.repeat(101))}`).expect(400);
        expect(findAll).not.toHaveBeenCalled();
    });

    it('rejects listing filters on the feed', async () => {
        await request(app.getHttpServer()).get('/api/articles/feed?tag=nestjs')
            .set('Authorization', 'Bearer synthetic-valid').expect(400);
        expect(getFeed).not.toHaveBeenCalled();
    });

    it('requires authentication before validating a feed query', async () => {
        await request(app.getHttpServer()).get('/api/articles/feed?limit=0').expect(401);
        expect(getFeed).not.toHaveBeenCalled();
        expect(verifyAsync).not.toHaveBeenCalled();
    });

    it('rejects an invalid supplied token on the feed', async () => {
        await request(app.getHttpServer()).get('/api/articles/feed?limit=2')
            .set('Authorization', 'Bearer synthetic-invalid').expect(401);
        expect(getFeed).not.toHaveBeenCalled();
    });

    it('rejects an invalid supplied token before validating a public query', async () => {
        await request(app.getHttpServer()).get('/api/articles?limit=0')
            .set('Authorization', 'Bearer synthetic-invalid').expect(401);
        expect(findAll).not.toHaveBeenCalled();
    });
});

import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import {
    AcceptLanguageLocaleResolver,
    I18nModule,
    JsonI18nLoader,
    QueryLocaleResolver,
} from '@nestjs/i18n';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ArticlesController } from './articles/articles.controller.js';
import { ArticlesService } from './articles/articles.service.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from './auth/guards/optional-jwt-auth.guard.js';

describe('Locale resolution and article query validation over HTTP', () => {
    let app: INestApplication;
    const articles = {
        findAll: vi.fn().mockResolvedValue({ articles: [], articlesCount: 0 }),
        getFeed: vi.fn().mockResolvedValue({ articles: [], articlesCount: 0 }),
    };
    const allowAnonymous = { canActivate: () => true };
    const allowAuthenticated = {
        canActivate(context: { switchToHttp: () => { getRequest: () => { user: { id: string } } } }) {
            context.switchToHttp().getRequest().user = {
                id: '00000000-0000-4000-8000-000000000001',
            };
            return true;
        },
    };

    beforeAll(async () => {
        // Mirror AppModule's i18n configuration while leaving DB/Redis out.
        // JsonI18nLoader reads the real source translations.
        const builder = Test.createTestingModule({
            imports: [
                I18nModule.forRoot({
                    defaultLocale: 'en',
                    supportedLocales: ['en', 'vi'],
                    loader: new JsonI18nLoader({ path: join(import.meta.dirname, 'i18n') }),
                    resolvers: [
                        new QueryLocaleResolver('lang'),
                        new AcceptLanguageLocaleResolver(),
                    ],
                }),
            ],
            controllers: [AppController, ArticlesController],
            providers: [AppService, { provide: ArticlesService, useValue: articles }],
        });
        builder.overrideGuard(JwtAuthGuard).useValue(allowAuthenticated);
        builder.overrideGuard(OptionalJwtAuthGuard).useValue(allowAnonymous);
        const module = await builder.compile();
        app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    beforeEach(() => vi.clearAllMocks());
    afterAll(async () => { if (app) await app.close(); });

    it.each([
        ['default', '/api/hello', undefined, 'Hello World!'],
        ['English query', '/api/hello?lang=en', undefined, 'Hello World!'],
        ['Vietnamese query', '/api/hello?lang=vi', undefined, 'Xin chào Thế giới!'],
        ['Vietnamese header', '/api/hello', 'vi', 'Xin chào Thế giới!'],
        ['query before header', '/api/hello?lang=en', 'vi', 'Hello World!'],
        ['unsupported query fallback', '/api/hello?lang=zz', undefined, 'Hello World!'],
        ['unsupported query falls through to header', '/api/hello?lang=zz', 'vi', 'Xin chào Thế giới!'],
    ])('%s', async (_name, url, language, expected) => {
        let call = request(app.getHttpServer()).get(url);
        if (language) call = call.set('Accept-Language', language);
        const response = await call.expect(200);
        expect(response.body).toEqual({ message: expected });
    });

    it.each([
        ['/api/articles', 'findAll'],
        ['/api/articles/feed', 'getFeed'],
    ] as const)('accepts the default query for %s', async (url, method) => {
        await request(app.getHttpServer()).get(url).expect(200);
        expect(articles[method]).toHaveBeenCalledOnce();
    });

    it.each([
        ['/api/articles?lang=vi', 'findAll'],
        ['/api/articles/feed?lang=vi', 'getFeed'],
    ] as const)('rejects lang as an undeclared article query on %s', async (url, method) => {
        const response = await request(app.getHttpServer()).get(url).expect(400);
        expect(response.body.message).toContain('property lang should not exist');
        expect(articles[method]).not.toHaveBeenCalled();
    });
});

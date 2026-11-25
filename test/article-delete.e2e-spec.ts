import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';

import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';

describe('Article Delete E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{ id: string; email: string }> = [];
    const createdTags = new Set<string>();
    const suiteSuffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const password = 'ExamplePass123!';

    beforeAll(async () => {
        const env = process.env;

        if (
            env.NODE_ENV !== 'test' ||
            env.DB_HOST !== '127.0.0.1' ||
            env.DB_PORT !== '3307' ||
            env.DB_DATABASE !== 'medium_clone_test' ||
            env.DB_USERNAME !== 'medium_test_user' ||
            env.REDIS_URL !== 'redis://127.0.0.1:6380' ||
            !env.DB_TEST_SERVER_UUID
        ) {
            throw new Error('Unsafe E2E environment');
        }

        const { AppModule } = await import('../src/app.module.js');
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );

        await app.init();

        const rows = (await app.get(DataSource).query(`
            SELECT
                DATABASE() AS db,
                CURRENT_USER() AS dbUser,
                @@server_uuid AS serverUuid
        `)) as Array<{
            db: string;
            dbUser: string;
            serverUuid: string;
        }>;

        const identity = rows[0];

        if (
            identity?.db !== 'medium_clone_test' ||
            !identity.dbUser.startsWith('medium_test_user@') ||
            identity.serverUuid !== env.DB_TEST_SERVER_UUID
        ) {
            throw new Error('E2E database identity verification failed');
        }

        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified) {
                const db = app.get(DataSource);

                // Only remove users registered by this suite.
                // Their article records and relationships cascade.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Only remove uniquely generated tags from this suite.
                if (createdTags.size > 0) {
                    await db.getRepository(Tag).delete({
                        name: In([...createdTags]),
                    });
                }
            }
        } finally {
            await app.close();
        }
    }, 20000);

    function context() {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }
        return {
            server: app.getHttpServer(),
            db: app.get(DataSource),
        };
    }

    function makeTag(prefix: string): string {
        const value = `${prefix}_${suiteSuffix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
        createdTags.add(value);
        return value;
    }

    async function registerUser() {
        const { server } = context();
        const identity = `${suiteSuffix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
        const username = `del_${identity}`;
        const email = `${username}@example.com`;
        const registration = await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);

        const id = registration.body.user.id as string;
        createdUsers.push({ id, email });

        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);

        return {
            id,
            authorization: `Bearer ${login.body.accessToken as string}`,
        };
    }

    async function createArticle(
        authorization: string,
        title: string,
        tagList: string[],
    ) {
        const { server, db } = context();
        const response = await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send({
                article: {
                    title,
                    description: `Description of ${title}`,
                    body: `Body of ${title}`,
                    tagList,
                },
            })
            .expect(201);
        const slug = response.body.article.slug as string;
        return db.getRepository(Article).findOneByOrFail({ slug });
    }

    async function fixture() {
        const { server, db } = context();
        const owner = await registerUser();
        const oldTag = makeTag('delete_old');
        const sharedTag = makeTag('delete_shared');
        const article = await createArticle(
            owner.authorization,
            'Article to delete',
            [oldTag, sharedTag],
        );
        expect(article.authorId).toBe(owner.id);
        return {
            server, db, owner, article, oldTag, sharedTag,
            url: `/api/articles/${article.slug}`,
        };
    }

    it('requires a valid JWT to delete an article', async () => {
        const { server, db, article, url } = await fixture();

        await request(server).delete(url).expect(401);
        await request(server)
            .delete(url)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(true);
    }, 30000);

    it('forbids a non-author from deleting an article', async () => {
        const { server, db, article, url } = await fixture();
        const other = await registerUser();

        await request(server)
            .delete(url)
            .set('Authorization', other.authorization)
            .expect(403);

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(true);
        expect(await db.getRepository(ArticleTag).countBy({
            articleId: article.id,
        })).toBe(2);
        await request(server).get(url).expect(200);
    }, 30000);

    it('returns 404 when deleting an unknown slug', async () => {
        const { server } = context();
        const owner = await registerUser();

        await request(server)
            .delete(`/api/articles/missing-${randomUUID()}`)
            .set('Authorization', owner.authorization)
            .expect(404);
    }, 30000);

    it('allows the author to delete an article and returns an empty 204 response', async () => {
        const { server, db, owner, article, url } = await fixture();

        const deleted = await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(204);
        expect(deleted.text).toBe('');

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(false);
        await request(server).get(url).expect(404);
        await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(404);
    }, 30000);

    it('cascades article-tag links and favorites when deleting an article', async () => {
        const { server, db, owner, article, url } = await fixture();
        const other = await registerUser();
        const links = db.getRepository(ArticleTag);
        const favorites = db.getRepository(ArticleFavorite);

        // Seed dependent data directly to isolate the deletion contract.
        await favorites.insert({ userId: other.id, articleId: article.id });
        expect(await links.countBy({ articleId: article.id })).toBe(2);
        expect(await favorites.countBy({ articleId: article.id })).toBe(1);

        await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(204);

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(false);
        expect(await links.countBy({ articleId: article.id })).toBe(0);
        expect(await favorites.countBy({ articleId: article.id })).toBe(0);
    }, 30000);

    it('preserves users, tag records and unrelated articles when deleting an article', async () => {
        const { server, db, owner, article, url, oldTag, sharedTag } = await fixture();
        const other = await registerUser();
        const sibling = await createArticle(
            other.authorization,
            'Article to retain',
            [sharedTag],
        );
        const favorites = db.getRepository(ArticleFavorite);
        const links = db.getRepository(ArticleTag);
        const tags = db.getRepository(Tag);

        await favorites.insert([
            { userId: other.id, articleId: article.id },
            { userId: owner.id, articleId: sibling.id },
        ]);
        const sharedTagRow = await tags.findOneByOrFail({ name: sharedTag });
        expect(await links.countBy({ tagId: sharedTagRow.id })).toBe(2);

        await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(204);

        expect(await db.getRepository(User).countBy({
            id: In([owner.id, other.id]),
        })).toBe(2);
        expect(await tags.countBy({
            name: In([oldTag, sharedTag]),
        })).toBe(2);
        expect(await db.getRepository(Article).existsBy({
            id: sibling.id,
        })).toBe(true);
        expect(await links.countBy({ articleId: sibling.id })).toBe(1);
        expect(await links.countBy({ tagId: sharedTagRow.id })).toBe(1);
        expect(await favorites.countBy({
            userId: owner.id, articleId: sibling.id,
        })).toBe(1);
        expect(await favorites.countBy({ articleId: article.id })).toBe(0);
        const detail = await request(server)
            .get(`/api/articles/${sibling.slug}`)
            .expect(200);
        expect(detail.body.article.tagList).toEqual([sharedTag]);
        expect(detail.body.article.favoritesCount).toBe(1);
    }, 30000);
});

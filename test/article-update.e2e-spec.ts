
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

describe('Article Update E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{
        id: string;
        email: string;
    }> = [];

    const suffix = randomUUID()
        .replaceAll('-', '')
        .slice(0, 16);

    const ownerEmail = `e2e-edit-owner-${suffix}@example.com`;
    const otherEmail = `e2e-edit-other-${suffix}@example.com`;

    const ownerUsername = `edit_owner_${suffix}`;
    const otherUsername = `edit_other_${suffix}`;

    const password = 'ExamplePass123!';

    const oldTag = `nestjs_${suffix}`;
    const keptTag = `backend_${suffix}`;
    const newTag = `typescript_${suffix}`;

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

        const { AppModule } = await import(
            '../src/app.module.js'
        );

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
            throw new Error(
                'E2E database identity verification failed',
            );
        }

        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified) {
                const db = app.get(DataSource);

                // Only remove users created by this test.
                // FK cascades remove their articles and links.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Remove only this test's uniquely named tags.
                await db.getRepository(Tag).delete({
                    name: In([oldTag, keptTag, newTag]),
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);

    it('validates authorization, updates and persistence', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const tags = db.getRepository(Tag);
        const articleTags = db.getRepository(ArticleTag);

        // 1. Register the article owner.
        const ownerRegistration = await request(server)
            .post('/api/users')
            .send({
                email: ownerEmail,
                username: ownerUsername,
                password,
            })
            .expect(201);

        const ownerId =
            ownerRegistration.body.user.id as string;

        createdUsers.push({
            id: ownerId,
            email: ownerEmail,
        });

        // 2. Register a different user.
        const otherRegistration = await request(server)
            .post('/api/users')
            .send({
                email: otherEmail,
                username: otherUsername,
                password,
            })
            .expect(201);

        createdUsers.push({
            id: otherRegistration.body.user.id as string,
            email: otherEmail,
        });

        // 3. Log in as both users.
        const ownerLogin = await request(server)
            .post('/api/users/login')
            .send({
                email: ownerEmail,
                password,
            })
            .expect(200);

        const otherLogin = await request(server)
            .post('/api/users/login')
            .send({
                email: otherEmail,
                password,
            })
            .expect(200);

        const ownerAuth =
            `Bearer ${ownerLogin.body.accessToken as string}`;

        const otherAuth =
            `Bearer ${otherLogin.body.accessToken as string}`;

        // 4. Create an article owned by the first user.
        const initialBody = 'Original article body';

        const created = await request(server)
            .post('/api/articles')
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    title: 'Original NestJS Guide',
                    description: 'Original description',
                    body: initialBody,
                    tagList: [oldTag, keptTag],
                },
            })
            .expect(201);

        const originalSlug =
            created.body.article.slug as string;

        const originalArticle =
            await articles.findOneByOrFail({
                slug: originalSlug,
            });

        expect(originalArticle.authorId).toBe(ownerId);

        const url = `/api/articles/${originalSlug}`;

        // 5. Authentication is required.
        await request(server)
            .put(url)
            .send({
                article: { title: 'Unauthorized change' },
            })
            .expect(401);

        await request(server)
            .put(url)
            .set('Authorization', 'Bearer invalid.token')
            .send({
                article: { title: 'Unauthorized change' },
            })
            .expect(401);

        // 6. A non-author cannot update this article.
        await request(server)
            .put(url)
            .set('Authorization', otherAuth)
            .send({
                article: { title: 'Hacked title' },
            })
            .expect(403);

        const unchanged = await articles.findOneByOrFail({
            id: originalArticle.id,
        });

        expect(unchanged.title).toBe('Original NestJS Guide');

        // 7. Unknown article.
        await request(server)
            .put(`/api/articles/missing-${randomUUID()}`)
            .set('Authorization', ownerAuth)
            .send({
                article: { title: 'New title' },
            })
            .expect(404);

        // 8. Invalid updates.
        const invalidPayloads = [
            {},
            { article: {} },
            { article: { title: '   ' } },
            { article: { title: null } },
            { article: { description: null } },
            { article: { tagList: null } },
            { article: { tagList: [''] } },
            { article: { authorId: randomUUID() } },
        ];

        for (const payload of invalidPayloads) {
            await request(server)
                .put(url)
                .set('Authorization', ownerAuth)
                .send(payload)
                .expect(400);
        }

        // 9. Partial update: description only.
        const descriptionUpdate = await request(server)
            .put(url)
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    description: 'Updated description',
                },
            })
            .expect(200);

        expect(descriptionUpdate.body.article).toMatchObject({
            slug: originalSlug,
            title: 'Original NestJS Guide',
            description: 'Updated description',
            body: initialBody,
        });

        // 10. Update title and verify slug changes.
        const titleUpdate = await request(server)
            .put(url)
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    title: 'Updated NestJS Guide',
                },
            })
            .expect(200);

        const updatedSlug =
            titleUpdate.body.article.slug as string;

        expect(updatedSlug).not.toBe(originalSlug);

        expect(updatedSlug).toMatch(
            /^updated-nestjs-guide-[0-9a-f-]{36}$/,
        );

        // The original slug must no longer resolve.
        await request(server)
            .get(url)
            .expect(404);

        await request(server)
            .get(`/api/articles/${updatedSlug}`)
            .expect(200);

        // Updating title must not create a second article.
        const savedAfterTitle =
            await articles.findOneByOrFail({
                id: originalArticle.id,
            });

        expect(savedAfterTitle.slug).toBe(updatedSlug);
        expect(savedAfterTitle.authorId).toBe(ownerId);

        expect(
            await articles.countBy({ authorId: ownerId }),
        ).toBe(1);

        // 11. Partial update: body only.
        const bodyUpdate = await request(server)
            .put(`/api/articles/${updatedSlug}`)
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    body: 'Updated body content',
                },
            })
            .expect(200);

        expect(bodyUpdate.body.article.body)
            .toBe('Updated body content');

        expect(bodyUpdate.body.article.description)
            .toBe('Updated description');

        const timestampBeforeTagUpdate =
            bodyUpdate.body.article.updatedAt as string;

        // Ensure the stored timestamp can advance
        // even after JavaScript Date serialization.
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
        });


        // 12. Replace tags; normalize and deduplicate.
        const tagUpdate = await request(server)
            .put(`/api/articles/${updatedSlug}`)
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    tagList: [
                        ` ${newTag.toUpperCase()} `,
                        newTag,
                        keptTag,
                    ],
                },
            })
            .expect(200);

        expect(tagUpdate.body.article.tagList).toEqual([
            keptTag,
            newTag,
        ]);


        const timestampAfterTagUpdate =
            tagUpdate.body.article.updatedAt as string;

        // Updating only tags must change updatedAt.
        expect(
            new Date(timestampAfterTagUpdate).getTime(),
        ).toBeGreaterThan(
            new Date(timestampBeforeTagUpdate).getTime(),
        );

        // createdAt must never change.
        expect(
            tagUpdate.body.article.createdAt,
        ).toBe(bodyUpdate.body.article.createdAt);

        // The database must store the new timestamp.
        const savedAfterTags =
            await articles.findOneByOrFail({
                id: originalArticle.id,
            });

        expect(
            savedAfterTags.updatedAt.toISOString(),
        ).toBe(timestampAfterTagUpdate);

        // Other article fields must remain unchanged.
        expect(savedAfterTags).toMatchObject({
            slug: updatedSlug,
            title: 'Updated NestJS Guide',
            description: 'Updated description',
            body: 'Updated body content',
        });

        const updatedLinks = await articleTags.findBy({
            articleId: originalArticle.id,
        });

        expect(updatedLinks).toHaveLength(2);

        const linkedTags = await tags.findBy({
            id: In(updatedLinks.map((link) => link.tagId)),
        });

        expect(
            linkedTags.map((tag) => tag.name).sort(),
        ).toEqual([keptTag, newTag]);

        // 13. An omitted tagList must retain current tags.
        const retainTags = await request(server)
            .put(`/api/articles/${updatedSlug}`)
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    description: 'Tags should remain',
                },
            })
            .expect(200);

        expect(retainTags.body.article.tagList).toEqual([
            keptTag,
            newTag,
        ]);

        // 14. An empty tagList removes all links.
        const clearTags = await request(server)
            .put(`/api/articles/${updatedSlug}`)
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    tagList: [],
                },
            })
            .expect(200);

        expect(clearTags.body.article.tagList).toEqual([]);

        expect(
            await articleTags.countBy({
                articleId: originalArticle.id,
            }),
        ).toBe(0);

        // 15. Final persisted article state.
        const finalArticle =
            await articles.findOneByOrFail({
                id: originalArticle.id,
            });

        expect(finalArticle).toMatchObject({
            slug: updatedSlug,
            title: 'Updated NestJS Guide',
            description: 'Tags should remain',
            body: 'Updated body content',
            authorId: ownerId,
        });

        expect(
            await articles.countBy({
                authorId: ownerId,
            }),
        ).toBe(1);
    }, 40000);
});

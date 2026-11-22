
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

describe('Article Tags E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{
        id: string;
        email: string;
    }> = [];

    const suffix = randomUUID()
        .replaceAll('-', '')
        .slice(0, 16);

    const password = 'ExamplePass123!';

    const ownerUsername = `tags_owner_${suffix}`;
    const otherUsername = `tags_other_${suffix}`;

    const tagA = `e2e_tags_a_${suffix}`;
    const tagB = `e2e_tags_b_${suffix}`;
    const scopeTag = `e2e_tags_scope_${suffix}`;
    const orphanTag = `e2e_tags_orphan_${suffix}`;
    const plainTag = `e2e_cafe_${suffix}`;
    const accentedTag = `e2e_café_${suffix}`;

    const testTags = [
        tagA,
        tagB,
        scopeTag,
        orphanTag,
        plainTag,
        accentedTag,
    ];

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

        await app.listen(0, '127.0.0.1');

        const rows = (await app
            .get(DataSource)
            .query(`
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

                // Delete only users created by this test.
                // Their articles and article-tag links cascade.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Delete only this test's uniquely named tags.
                await db.getRepository(Tag).delete({
                    name: In(testTags),
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);

    it('validates public tags, deduplication and article lifecycle', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const tags = db.getRepository(Tag);
        const articleTags = db.getRepository(ArticleTag);

        const tagsUrl = '/api/tags';

        // Only inspect tags belonging to this test.
        function ownTags(items: string[]): string[] {
            return items.filter((name) =>
                testTags.includes(name),
            );
        }

        async function registerUser(username: string) {
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
                authorization:
                    `Bearer ${login.body.accessToken as string}`,
            };
        }

        async function createArticle(
            authorization: string,
            title: string,
            tagList: string[],
        ) {
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

            return articles.findOneByOrFail({ slug });
        }

        // 1. Register two users.
        const owner = await registerUser(ownerUsername);
        const other = await registerUser(otherUsername);

        // 2. Initially, no tags created by this test exist.
        const initial = await request(server)
            .get(tagsUrl)
            .expect(200);

        expect(Array.isArray(initial.body.tags)).toBe(true);
        expect(ownTags(initial.body.tags)).toEqual([]);

        // 3. Create Article A.
        // The same tag is supplied twice with different case.
        const articleA = await createArticle(
            owner.authorization,
            'Article Tags Test A',
            [
                scopeTag,
                tagA,
                ` ${scopeTag.toUpperCase()} `,
            ],
        );

        // 4. Create Article B.
        // Both articles share scopeTag.
        const articleB = await createArticle(
            other.authorization,
            'Article Tags Test B',
            [
                scopeTag,
                tagB,
            ],
        );

        // 5. Insert a tag with no article relationship.
        await tags.insert({
            id: randomUUID(),
            name: orphanTag,
        });

        // 6. GET /api/tags is public.
        const initialTags = await request(server)
            .get(tagsUrl)
            .expect(200);

        expect(ownTags(initialTags.body.tags)).toEqual(
            [tagA, tagB, scopeTag].sort(),
        );

        // Each name appears only once.
        for (const name of [tagA, tagB, scopeTag]) {
            expect(
                initialTags.body.tags.filter(
                    (value: string) => value === name,
                ),
            ).toHaveLength(1);
        }

        // Orphan tag must not appear.
        expect(initialTags.body.tags).not.toContain(
            orphanTag,
        );

        // All active test tags exist in MySQL.
        expect(
            await tags.countBy({
                name: In([tagA, tagB, scopeTag]),
            }),
        ).toBe(3);

        const sharedTag = await tags.findOneByOrFail({
            name: scopeTag,
        });

        // The shared tag has two article relationships.
        expect(
            await articleTags.countBy({
                tagId: sharedTag.id,
            }),
        ).toBe(2);

        // 7. Update Article A.
        // tagA becomes unused; tagB becomes shared.
        const updated = await request(server)
            .put(`/api/articles/${articleA.slug}`)
            .set('Authorization', owner.authorization)
            .send({
                article: {
                    tagList: [scopeTag, tagB],
                },
            })
            .expect(200);

        expect(updated.body.article.tagList).toEqual(
            [scopeTag, tagB].sort(),
        );

        const afterUpdate = await request(server)
            .get(tagsUrl)
            .expect(200);

        expect(ownTags(afterUpdate.body.tags)).toEqual(
            [tagB, scopeTag].sort(),
        );

        // tagA still exists in the tags table.
        expect(
            await tags.existsBy({ name: tagA }),
        ).toBe(true);

        // But it has no remaining article relationship.
        const unusedTag = await tags.findOneByOrFail({
            name: tagA,
        });

        expect(
            await articleTags.countBy({
                tagId: unusedTag.id,
            }),
        ).toBe(0);

        const sharedTagB = await tags.findOneByOrFail({
            name: tagB,
        });

        expect(
            await articleTags.countBy({
                tagId: sharedTagB.id,
            }),
        ).toBe(2);

        // 8. Delete Article B.
        await request(server)
            .delete(`/api/articles/${articleB.slug}`)
            .set('Authorization', other.authorization)
            .expect(204);

        const afterDelete = await request(server)
            .get(tagsUrl)
            .expect(200);

        // Article A still uses both tags.
        expect(ownTags(afterDelete.body.tags)).toEqual(
            [tagB, scopeTag].sort(),
        );

        expect(
            await articleTags.countBy({
                tagId: sharedTagB.id,
            }),
        ).toBe(1);

        // 9. Clear all tags from Article A.
        const cleared = await request(server)
            .put(`/api/articles/${articleA.slug}`)
            .set('Authorization', owner.authorization)
            .send({
                article: {
                    tagList: [],
                },
            })
            .expect(200);

        expect(cleared.body.article.tagList).toEqual([]);

        // 10. No tags created by this test remain active.
        const afterClear = await request(server)
            .get(tagsUrl)
            .expect(200);

        expect(ownTags(afterClear.body.tags)).toEqual([]);

        // The tag records are still retained for reuse.
        expect(
            await tags.countBy({
                name: In(testTags),
            }),
        ).toBe(4);

        // None of the test tags has an article relationship.
        const allTestTagRows = await tags.findBy({
            name: In(testTags),
        });

        expect(
            await articleTags.countBy({
                tagId: In(
                    allTestTagRows.map((tag) => tag.id),
                ),
            }),
        ).toBe(0);

        // 11. Article A still exists; clearing tags
        // must not delete the article.
        expect(
            await articles.existsBy({
                id: articleA.id,
            }),
        ).toBe(true);


        // 12. Create an article with names that are
        // distinct in JavaScript but equivalent in
        // the database's accent-insensitive collation.
        const collationArticle = await createArticle(
            owner.authorization,
            'Article Collation Create',
            [plainTag, accentedTag],
        );

        const createLinks = await articleTags.findBy({
            articleId: collationArticle.id,
        });

        // One canonical tag ID, one relationship.
        expect(createLinks).toHaveLength(1);

        const createDetail = await request(server)
            .get(`/api/articles/${collationArticle.slug}`)
            .expect(200);

        expect(createDetail.body.article.tagList)
            .toHaveLength(1);

        // The unique index must contain one
        // logical tag rather than two.
        expect(
            await tags.countBy({
                name: In([plainTag, accentedTag]),
            }),
        ).toBe(1);

        // 13. Also verify Update Article.
        const updateArticle = await createArticle(
            owner.authorization,
            'Article Collation Update',
            [scopeTag],
        );

        const updatedCollation = await request(server)
            .put(`/api/articles/${updateArticle.slug}`)
            .set('Authorization', owner.authorization)
            .send({
                article: {
                    tagList: [accentedTag, plainTag],
                },
            })
            .expect(200);

        expect(updatedCollation.body.article.tagList)
            .toHaveLength(1);

        const updateLinks = await articleTags.findBy({
            articleId: updateArticle.id,
        });

        expect(updateLinks).toHaveLength(1);

        // Both articles must refer to the same tag.
        expect(updateLinks[0].tagId)
            .toBe(createLinks[0].tagId);

        // 14. The public Tags API must also expose
        // the logical tag only once.
        const afterCollation = await request(server)
            .get(tagsUrl)
            .expect(200);

        const matchingTags = (
            afterCollation.body.tags as string[]
        ).filter(
            (name) =>
                name === plainTag ||
                name === accentedTag,
        );

        expect(matchingTags).toHaveLength(1);

        // 15. Invalid tagList values must return 400.
        // The API must never accept malformed tag data
        // or turn validation failures into HTTP 500.

        const invalidTagLists: unknown[] = [
            null,
            'nestjs',
            [123],
            [null],
            ['   '],
            [tagA, '   '],
        ];

        const validationUrl =
            `/api/articles/${collationArticle.slug}`;

        // Save the original state before invalid requests.
        const beforeInvalid = await request(server)
            .get(validationUrl)
            .expect(200);

        for (const tagList of invalidTagLists) {
            // Create Article must reject invalid tagList.
            await request(server)
                .post('/api/articles')
                .set('Authorization', owner.authorization)
                .send({
                    article: {
                        title: `Validation Test ${randomUUID()}`,
                        description: 'Validation test',
                        body: 'Validation test body',
                        tagList,
                    },
                })
                .expect(400);

            // Update Article must reject the same input.
            await request(server)
                .put(validationUrl)
                .set('Authorization', owner.authorization)
                .send({
                    article: {
                        tagList,
                    },
                })
                .expect(400);
        }

        // 16. An unknown field must be rejected.
        await request(server)
            .put(validationUrl)
            .set('Authorization', owner.authorization)
            .send({
                article: {
                    tagList: [scopeTag],
                    unexpectedField: true,
                },
            })
            .expect(400);

        // 17. Rejected requests must not mutate the article.
        const afterInvalid = await request(server)
            .get(validationUrl)
            .expect(200);

        expect(afterInvalid.body.article).toEqual(
            beforeInvalid.body.article,
        );


    }, 40000);
});

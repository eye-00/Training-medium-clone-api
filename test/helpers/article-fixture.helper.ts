import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { DataSource, EntityManager } from 'typeorm';

import { Article } from '../../src/articles/entities/article.entity.js';

import type {
    ArticleDetailsDto,
} from '../../src/articles/dto/article-response.dto.js';

import type {
    CreateArticleFieldsDto,
} from '../../src/articles/dto/create-article.dto.js';

import type {
    TestAppContext,
} from './test-app.helper.js';
import {
    assertSafeTestEnvironment,
    verifyTestDatabaseIdentity,
} from './database-safety.helper.js';

export type ArticleFixtureInput = Readonly<
    Partial<CreateArticleFieldsDto>
>;

export type ArticleFixture = Readonly<{
    saved: Article;
    response: ArticleDetailsDto;
}>;

/**
 * Generates a unique tag and tracks it before
 * any database operation can create it.
 */
export function makeUniqueTag(
    createdTags: Set<string>,
    prefix: string,
): string {
    const suffix = randomUUID()
        .replaceAll('-', '');

    const name = `${prefix}_${suffix}`;

    createdTags.add(name);

    return name;
}

/**
 * Creates an article through the public HTTP API
 * and retrieves the persisted database record.
 *
 * Business assertions remain in the calling suite.
 */
export async function createArticleFixture(
    context: Pick<TestAppContext, 'server' | 'db'>,
    authorization: string,
    input: ArticleFixtureInput = {},
): Promise<ArticleFixture> {
    const payload: CreateArticleFieldsDto = {
        title: 'Comment E2E article',
        description: 'Comment E2E description',
        body: 'Comment E2E body',
        tagList: [],
        ...input,
    };

    const result = await request(context.server)
        .post('/api/articles')
        .set('Authorization', authorization)
        .send({
            article: payload,
        })
        .expect(201);

    const slug: unknown =
        result.body?.article?.slug;

    if (
        typeof slug !== 'string' ||
        !slug.trim()
    ) {
        throw new Error(
            'Article fixture returned an invalid slug',
        );
    }

    const saved = await context.db
        .getRepository(Article)
        .findOneByOrFail({ slug });

    return Object.freeze({
        saved,
        response:
            result.body.article as ArticleDetailsDto,
    });
}

type OwnedTag = { id: string; name: string; confirmed: boolean };
const ownedTagStates = new WeakMap<OwnedTagRegistry, Map<string, OwnedTag>>();

/** Opaque ownership records populated only by successful fixture inserts. */
export class OwnedTagRegistry {
    constructor() {
        ownedTagStates.set(this, new Map());
    }
}

function registryState(registry: OwnedTagRegistry): Map<string, OwnedTag> {
    const state = ownedTagStates.get(registry);
    if (!state) throw new Error('Invalid owned tag registry');
    return state;
}

async function verifyManager(manager: EntityManager, expectedServerUuid: string): Promise<void> {
    const uuid = assertSafeTestEnvironment();
    if (!expectedServerUuid || uuid !== expectedServerUuid) {
        throw new Error('Test database identity changed during execution');
    }
    await verifyTestDatabaseIdentity(manager, expectedServerUuid);
}

/**
 * Insert a fixture with an explicit ID. A failed/ambiguous commit remains
 * pending and is never silently promoted to owned during cleanup.
 */
export async function createOwnedTagFixture(
    db: DataSource,
    registry: OwnedTagRegistry,
    name: string,
    expectedServerUuid: string,
): Promise<Readonly<{ id: string; name: string }>> {
    if (typeof name !== 'string' || !name.trim() || name !== name.trim()) {
        throw new Error('Invalid tag fixture name');
    }
    const state = registryState(registry);
    const tag: OwnedTag = { id: randomUUID(), name, confirmed: false };

    await db.transaction(async (manager) => {
        await verifyManager(manager, expectedServerUuid);
        const existing: unknown = await manager.query(
            'SELECT id FROM tags WHERE name = ? LIMIT 1', [name],
        );
        if (!Array.isArray(existing) || existing.length !== 0) {
            throw new Error('Tag fixture name already exists or could not be verified');
        }
        state.set(tag.id, tag);
        await manager.query('INSERT INTO tags (id, name) VALUES (?, ?)', [tag.id, tag.name]);
        const inserted: unknown = await manager.query(
            'SELECT id, name FROM tags WHERE id = ? FOR UPDATE', [tag.id],
        );
        if (!Array.isArray(inserted) || inserted.length !== 1 ||
            inserted[0]?.id !== tag.id || inserted[0]?.name !== tag.name) {
            throw new Error('Tag fixture insert could not be verified');
        }
    });

    tag.confirmed = true;
    return Object.freeze({ id: tag.id, name: tag.name });
}

/**
 * Recheck identity on the transaction connection and delete confirmed
 * fixtures only after locking their row and verifying no links exist.
 * Call after user/article cleanup, inside closeTestApp's verified callback.
 */
export async function cleanupOwnedTagFixtures(
    db: DataSource,
    registry: OwnedTagRegistry,
    expectedServerUuid: string,
): Promise<void> {
    const state = registryState(registry);
    const errors: unknown[] = [];
    for (const tag of state.values()) {
        try {
            await db.transaction(async (manager) => {
                await verifyManager(manager, expectedServerUuid);
                const rows: unknown = await manager.query(
                    'SELECT id, name FROM tags WHERE id = ? FOR UPDATE', [tag.id],
                );
                if (!Array.isArray(rows) || rows.length > 1) {
                    throw new Error('Tag fixture identity could not be verified');
                }
                if (rows.length === 0) {
                    if (tag.confirmed) throw new Error('Owned tag fixture is missing');
                    return;
                }
                if (!tag.confirmed || rows[0]?.id !== tag.id || rows[0]?.name !== tag.name) {
                    throw new Error('Tag fixture ownership is uncertain');
                }
                const links: unknown = await manager.query(
                    'SELECT tag_id FROM article_tags WHERE tag_id = ? LIMIT 1 FOR UPDATE', [tag.id],
                );
                if (!Array.isArray(links) || links.length !== 0) {
                    throw new Error('Owned tag fixture has links or links could not be verified');
                }
                const result: unknown = await manager.query(
                    'DELETE FROM tags WHERE id = ? AND BINARY name = BINARY ? ' +
                    'AND NOT EXISTS (SELECT 1 FROM article_tags WHERE tag_id = ?)',
                    [tag.id, tag.name, tag.id],
                );
                if (typeof result !== 'object' || result === null ||
                    !('affectedRows' in result) || result.affectedRows !== 1) {
                    throw new Error('Owned tag fixture deletion was not confirmed');
                }
                const remaining: unknown = await manager.query(
                    'SELECT id FROM tags WHERE id = ?', [tag.id],
                );
                const remainingLinks: unknown = await manager.query(
                    'SELECT tag_id FROM article_tags WHERE tag_id = ? LIMIT 1', [tag.id],
                );
                if (!Array.isArray(remaining) || remaining.length !== 0 ||
                    !Array.isArray(remainingLinks) || remainingLinks.length !== 0) {
                    throw new Error('Owned tag fixture cleanup could not be verified');
                }
            });
            state.delete(tag.id);
        } catch (error: unknown) {
            errors.push(error);
        }
    }
    if (errors.length) throw new AggregateError(errors, 'Owned tag fixture cleanup failed');
}

/**
 * Legacy name candidates carry no ownership proof. Confirm that each name
 * is absent under the database collation; never delete an existing row.
 */
export async function cleanupTagFixtures(
    db: DataSource,
    createdTags: ReadonlySet<string>,
): Promise<void> {
    if (createdTags.size === 0) return;
    await db.transaction(async (manager) => {
        const uuid = assertSafeTestEnvironment();
        await verifyTestDatabaseIdentity(manager, uuid);
        for (const name of createdTags) {
            const rows: unknown = await manager.query(
                'SELECT id FROM tags WHERE name = ? LIMIT 1 FOR UPDATE', [name],
            );
            if (!Array.isArray(rows) || rows.length !== 0) {
                throw new Error('Tag candidate exists or could not be verified; ownership is uncertain');
            }
        }
    });
}

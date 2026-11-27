import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cleanupOwnedTagFixtures,
    cleanupTagFixtures,
    createOwnedTagFixture,
    OwnedTagRegistry,
} from './article-fixture.helper.js';

type Row = { id: string; name: string };
const serverUuid = '11111111-2222-4333-8444-555555555555';

function collationKey(value: string): string {
    return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function fakeDatabase(initial: Row[] = []) {
    const rows = new Map(initial.map((row) => [row.id, { ...row }]));
    const links = new Set<string>();
    const state = { uuid: serverUuid, failCommit: false, failLinkRead: false };
    const queries: string[] = [];
    const manager = {
        async query(sql: string, params: string[] = []): Promise<unknown> {
            queries.push(sql);
            if (sql.includes('DATABASE()')) {
                return [{ db: 'medium_clone_test', dbUser: 'medium_test_user@localhost', serverUuid: state.uuid }];
            }
            if (sql.startsWith('SELECT id FROM tags WHERE name')) {
                return [...rows.values()].filter((row) => collationKey(row.name) === collationKey(params[0]!)).map(({ id }) => ({ id }));
            }
            if (sql.startsWith('INSERT INTO tags')) {
                const [id, name] = params as [string, string];
                if ([...rows.values()].some((row) => collationKey(row.name) === collationKey(name))) {
                    throw new Error('synthetic unique constraint');
                }
                rows.set(id, { id, name });
                return { affectedRows: 1 };
            }
            if (sql.startsWith('SELECT id, name FROM tags WHERE id')) {
                const row = rows.get(params[0]!);
                return row ? [{ ...row }] : [];
            }
            if (sql.startsWith('SELECT id FROM tags WHERE id')) {
                const row = rows.get(params[0]!);
                return row ? [{ id: row.id }] : [];
            }
            if (sql.startsWith('SELECT tag_id FROM article_tags')) {
                if (state.failLinkRead) throw new Error('synthetic links read failure');
                return links.has(params[0]!) ? [{ tag_id: params[0] }] : [];
            }
            if (sql.startsWith('DELETE FROM tags')) {
                const [id, name, linkedId] = params as [string, string, string];
                const row = rows.get(id);
                if (row && row.name === name && !links.has(linkedId)) {
                    rows.delete(id);
                    return { affectedRows: 1 };
                }
                return { affectedRows: 0 };
            }
            throw new Error('Unexpected SQL');
        },
    };
    const db = {
        async transaction(callback: (txManager: typeof manager) => Promise<unknown>) {
            const result = await callback(manager);
            if (state.failCommit) {
                state.failCommit = false;
                throw new Error('synthetic uncertain commit');
            }
            return result;
        },
    } as unknown as DataSource;
    return { db, rows, links, state, queries };
}

describe('Tag fixture cleanup ownership', () => {
    beforeEach(() => {
        const env = {
            NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '3307',
            DB_DATABASE: 'medium_clone_test', DB_USERNAME: 'medium_test_user',
            REDIS_URL: 'redis://127.0.0.1:6380/1', DB_TEST_SERVER_UUID: serverUuid,
        };
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    });
    afterEach(() => { vi.unstubAllEnvs(); });

    it('refuses legacy collation-equivalent candidates without deleting preexisting data', async () => {
        const existing = { id: 'preexisting', name: 'e2e_café_synthetic' };
        const f = fakeDatabase([existing]);
        f.links.add(existing.id);
        await expect(cleanupTagFixtures(f.db, new Set(['e2e_cafe_synthetic'])))
            .rejects.toThrow('ownership is uncertain');
        expect(f.rows.get(existing.id)).toEqual(existing);
        expect(f.links.has(existing.id)).toBe(true);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('does not claim an existing collation-equivalent name', async () => {
        const existing = { id: 'preexisting', name: 'e2e_café_synthetic' };
        const f = fakeDatabase([existing]);
        const registry = new OwnedTagRegistry();
        await expect(createOwnedTagFixture(f.db, registry, 'e2e_cafe_synthetic', serverUuid))
            .rejects.toThrow('already exists');
        await cleanupOwnedTagFixtures(f.db, registry, serverUuid);
        expect(f.rows.get(existing.id)).toEqual(existing);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('deletes only an inserted and confirmed unlinked tag by ID and name', async () => {
        const other = { id: 'unowned', name: 'other' };
        const f = fakeDatabase([other]);
        const registry = new OwnedTagRegistry();
        const owned = await createOwnedTagFixture(f.db, registry, 'owned_tag', serverUuid);
        expect(f.rows.get(owned.id)).toEqual(owned);
        await cleanupOwnedTagFixtures(f.db, registry, serverUuid);
        expect(f.rows.has(owned.id)).toBe(false);
        expect(f.rows.get(other.id)).toEqual(other);
    });

    it('retains a confirmed tag linked to an unrelated article', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        const owned = await createOwnedTagFixture(f.db, registry, 'owned_tag', serverUuid);
        f.links.add(owned.id);
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid)).rejects.toBeInstanceOf(AggregateError);
        expect(f.rows.get(owned.id)).toEqual(owned);
        expect(f.links.has(owned.id)).toBe(true);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('retains a confirmed tag if its exact name changes', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        const owned = await createOwnedTagFixture(f.db, registry, 'owned_tag', serverUuid);
        f.rows.set(owned.id, { id: owned.id, name: 'changed_tag' });
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid)).rejects.toBeInstanceOf(AggregateError);
        expect(f.rows.get(owned.id)?.name).toBe('changed_tag');
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('does not delete a pending tag after an ambiguous commit', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        f.state.failCommit = true;
        await expect(createOwnedTagFixture(f.db, registry, 'pending_tag', serverUuid)).rejects.toThrow('uncertain commit');
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid)).rejects.toBeInstanceOf(AggregateError);
        expect([...f.rows.values()].map((row) => row.name)).toEqual(['pending_tag']);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('does not mutate when database identity changes', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        const owned = await createOwnedTagFixture(f.db, registry, 'owned_tag', serverUuid);
        f.state.uuid = 'other-server';
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid)).rejects.toBeInstanceOf(AggregateError);
        expect(f.rows.get(owned.id)).toEqual(owned);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('refuses inserts and deletions if environment UUID differs from the original snapshot', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        const owned = await createOwnedTagFixture(f.db, registry, 'owned_tag', serverUuid);
        vi.stubEnv('DB_TEST_SERVER_UUID', 'different-server');
        await expect(createOwnedTagFixture(f.db, registry, 'another_tag', serverUuid))
            .rejects.toThrow('identity changed');
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid))
            .rejects.toBeInstanceOf(AggregateError);
        expect(f.rows.get(owned.id)).toEqual(owned);
        expect([...f.rows.values()].map((row) => row.name)).toEqual(['owned_tag']);
        expect(f.queries.filter((sql) => sql.startsWith('INSERT'))).toHaveLength(1);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('retains an owned tag when the links query fails', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        const owned = await createOwnedTagFixture(f.db, registry, 'owned_tag', serverUuid);
        f.state.failLinkRead = true;
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid)).rejects.toBeInstanceOf(AggregateError);
        expect(f.rows.get(owned.id)).toEqual(owned);
        expect(f.queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
    });

    it('preserves multiple failures and still attempts independent owned tags', async () => {
        const f = fakeDatabase();
        const registry = new OwnedTagRegistry();
        const first = await createOwnedTagFixture(f.db, registry, 'first_tag', serverUuid);
        const second = await createOwnedTagFixture(f.db, registry, 'second_tag', serverUuid);
        const third = await createOwnedTagFixture(f.db, registry, 'third_tag', serverUuid);
        f.links.add(first.id);
        f.links.add(second.id);
        await expect(cleanupOwnedTagFixtures(f.db, registry, serverUuid)).rejects.toMatchObject({
            errors: [expect.any(Error), expect.any(Error)],
        });
        expect(f.rows.has(first.id)).toBe(true);
        expect(f.rows.has(second.id)).toBe(true);
        expect(f.rows.has(third.id)).toBe(false);
    });
});

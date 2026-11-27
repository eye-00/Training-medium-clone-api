import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import {
    closeTestApp,
    createTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

type Fixture = { email: string; username: string; id?: string };

describe('Unicode username validation E2E', () => {
    let testApp: TestAppContext | undefined;
    const password = 'ExamplePass123!';
    const plane = '✈️';
    const emojiChoices = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂'];

    beforeAll(async () => {
        testApp = await createTestApp();
    });

    afterAll(async () => {
        if (testApp) await closeTestApp(testApp);
    });

    function context(): TestAppContext {
        if (!testApp) throw new Error('Test application was not initialized');
        return testApp;
    }

    function randomEmoji(count: number): string {
        const bytes = randomBytes(count);
        return Array.from(bytes, (byte) => emojiChoices[byte % emojiChoices.length]).join('');
    }

    async function fixture(username: string): Promise<Fixture> {
        const suffix = randomUUID().replaceAll('-', '');
        const value: Fixture = {
            email: `username-validation-${suffix}@example.com`,
            username,
        };
        const users = context().db.getRepository(User);
        if (await users.existsBy({ email: value.email })) {
            throw new Error('User fixture email collision');
        }
        // Uses the database collation, not merely string equality.
        if (await users.existsBy({ username })) {
            throw new Error('Username fixture collision');
        }
        return value;
    }

    async function register(value: Fixture) {
        try {
            return await request(context().server)
                .post('/api/users')
                .send({ email: value.email, username: value.username, password });
        } finally {
            const user = await context().db.getRepository(User).findOneBy({
                email: value.email,
            });
            if (user) value.id = user.id;
        }
    }

    async function expectAccepted(username: string): Promise<void> {
        const value = await fixture(username);
        const response = await register(value);
        expect(response.status).toBe(201);
        expect(response.body.user?.username).toBe(username);
        if (!value.id) throw new Error('Accepted registration has no persisted user');
        const saved = await context().db.getRepository(User).findOneByOrFail({
            id: value.id,
            email: value.email,
        });
        expect(saved.username).toBe(username);

        const profile = await request(context().server)
            .get(`/api/profiles/${encodeURIComponent(username)}`)
            .expect(200);
        expect(profile.body).toEqual({
            profile: {
                username,
                bio: null,
                image: null,
                followersCount: 0,
                followingCount: 0,
            },
        });
        expect(await context().db.getRepository(User).findOneByOrFail({
            id: value.id,
            email: value.email,
        })).toEqual(saved);
    }

    async function expectRejected(username: string): Promise<void> {
        const value = await fixture(username);
        const response = await register(value);
        expect(response.status).toBe(400);
        expect(value.id === undefined).toBe(true);
    }

    it.each([51, 100])('registers %i emoji and preserves the username', async (count) => {
        const username = randomEmoji(count);
        expect(Array.from(username)).toHaveLength(count);
        await expectAccepted(username);
    }, 40000);

    it.each([2, 101])('rejects %i emoji without creating a user', async (count) => {
        await expectRejected(randomEmoji(count));
    }, 40000);

    it('rejects two planes with variation selectors at the minimum', async () => {
        const username = plane.repeat(2);
        expect(Array.from(username)).toHaveLength(4);
        await expectRejected(username);
    }, 40000);

    it('accepts three planes with variation selectors at the minimum', async () => {
        await expectAccepted(plane.repeat(3));
    }, 40000);

    it('accepts fifty planes with variation selectors at 100 code points', async () => {
        const username = plane.repeat(50);
        expect(Array.from(username)).toHaveLength(100);
        await expectAccepted(username);
    }, 40000);

    it('updates to 51 emoji and rejects 102 code points without changing it', async () => {
        const initial = `username_${randomUUID().replaceAll('-', '')}`;
        const value = await fixture(initial);
        const registration = await register(value);
        expect(registration.status).toBe(201);
        if (!value.id) throw new Error('Accepted registration has no persisted user');

        const login = await request(context().server)
            .post('/api/users/login')
            .send({ email: value.email, password });
        expect(login.status).toBe(200);
        const token: unknown = login.body.accessToken;
        if (typeof token !== 'string' || !token) throw new Error('Login returned no token');
        const updated = randomEmoji(51);
        if (await context().db.getRepository(User).existsBy({ username: updated })) {
            throw new Error('Updated username fixture collision');
        }
        const success = await request(context().server)
            .put('/api/user')
            .set('Authorization', `Bearer ${token}`)
            .send({ username: updated });
        expect(success.status).toBe(200);
        expect(success.body.user?.username).toBe(updated);
        const tooLong = plane.repeat(51);
        expect(Array.from(tooLong)).toHaveLength(102);
        const rejected = await request(context().server)
            .put('/api/user')
            .set('Authorization', `Bearer ${token}`)
            .send({ username: tooLong });
        expect(rejected.status).toBe(400);
        const persisted = await context().db.getRepository(User).findOneByOrFail({
            id: value.id,
            email: value.email,
        });
        expect(persisted.username).toBe(updated);
    }, 40000);
});

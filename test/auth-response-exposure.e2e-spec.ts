import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    closeTestApp,
    createTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';
import {
    cleanupUserFixtures,
    type CreatedUser,
} from './helpers/user-fixture.helper.js';

describe('Authentication response exposure E2E', () => {
    let testApp: TestAppContext | undefined;
    const createdUsers: CreatedUser[] = [];
    const password = 'ExamplePass123!';

    beforeAll(async () => {
        testApp = await createTestApp();
    });

    afterAll(async () => {
        if (!testApp) return;
        await closeTestApp(testApp, async ({ db }) => {
            await cleanupUserFixtures(db, createdUsers);
        });
    });

    function context(): TestAppContext {
        if (!testApp) throw new Error('Test application was not initialized');
        return testApp;
    }

    async function register() {
        const suffix = randomUUID().replaceAll('-', '');
        const email = `response-${suffix}@example.com`;
        const username = `response_${suffix.slice(0, 20)}`;
        const response = await request(context().server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);
        const id: unknown = response.body.user?.id;
        if (typeof id !== 'string' || !id.trim()) {
            throw new Error('Registration returned an invalid user ID');
        }
        createdUsers.push({ id, email });
        return { response, id, email, username };
    }

    function expectUserFields(
        user: Record<string, unknown>,
        expected: { id: string; email: string; username: string },
    ) {
        expect(Object.keys(user).sort()).toEqual(
            ['bio', 'email', 'id', 'image', 'username'],
        );
        expect(user.id).toBe(expected.id);
        expect(user.email).toBe(expected.email);
        expect(user.username).toBe(expected.username);
        expect(user.bio).toBeNull();
        expect(user.image).toBeNull();
    }

    it('returns only the allowed user fields on registration', async () => {
        const fixture = await register();
        expect(Object.keys(fixture.response.body).sort()).toEqual(['user']);
        expectUserFields(fixture.response.body.user, fixture);
    });

    it('returns only the allowed user fields and a token on login', async () => {
        const fixture = await register();
        const response = await request(context().server)
            .post('/api/users/login')
            .send({ email: fixture.email, password })
            .expect(200);
        expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'user']);
        expectUserFields(response.body.user, fixture);
        const token: unknown = response.body.accessToken;
        expect(typeof token === 'string' && token.length > 0).toBe(true);
    });

    it('returns only the allowed user fields for the current user', async () => {
        const fixture = await register();
        const login = await request(context().server)
            .post('/api/users/login')
            .send({ email: fixture.email, password })
            .expect(200);
        const token: unknown = login.body.accessToken;
        if (typeof token !== 'string' || !token) {
            throw new Error('Login returned an invalid token');
        }
        const response = await request(context().server)
            .get('/api/user')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(Object.keys(response.body).sort()).toEqual(['user']);
        expectUserFields(response.body.user, fixture);
    });
});

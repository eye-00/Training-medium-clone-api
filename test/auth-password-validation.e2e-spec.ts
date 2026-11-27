import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import {
    closeTestApp,
    createTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

type Fixture = { email: string; username: string; id?: string };

describe('Authentication password and primitive validation E2E', () => {
    let testApp: TestAppContext | undefined;
    const validPassword = '😀'.repeat(18); // 72 UTF-8 bytes.
    const oversizedPassword = `${validPassword}x`; // 73 UTF-8 bytes.

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

    async function newFixture(): Promise<Fixture> {
        const suffix = randomUUID().replaceAll('-', '');
        const fixture: Fixture = {
            email: `password-validation-${suffix}@example.com`,
            username: `password_${suffix}`,
        };
        const exists = await context().db.getRepository(User).existsBy({
            email: fixture.email,
        });
        if (exists) throw new Error('User fixture email collision');
        return fixture;
    }

    async function register(
        fixture: Fixture,
        username: unknown,
        password: unknown,
    ) {
        try {
            return await request(context().server)
                .post('/api/users')
                .send({ email: fixture.email, username, password });
        } finally {
            // Track the persisted identity even if the response is malformed
            // or the request fails after registration has completed.
            const user = await context().db.getRepository(User).findOneBy({
                email: fixture.email,
            });
            if (user) fixture.id = user.id;
        }
    }

    it('registers and logs in at the 72-byte boundary, rejecting 73-byte login', async () => {
        const fixture = await newFixture();
        expect(Buffer.byteLength(validPassword, 'utf8')).toBe(72);
        expect(Buffer.byteLength(oversizedPassword, 'utf8')).toBe(73);
        const registration = await register(fixture, fixture.username, validPassword);
        expect(registration.status).toBe(201);
        expect(typeof fixture.id === 'string' && fixture.id.length > 0).toBe(true);

        const login = await request(context().server)
            .post('/api/users/login')
            .send({ email: fixture.email, password: validPassword });
        expect(login.status).toBe(200);
        expect(typeof login.body.accessToken === 'string' && login.body.accessToken.length > 0)
            .toBe(true);

        const tooLong = await request(context().server)
            .post('/api/users/login')
            .send({ email: fixture.email, password: oversizedPassword });
        expect(tooLong.status).toBe(401);
        expect(tooLong.body.message).toBe('Invalid email or password');

        const unknown = await request(context().server)
            .post('/api/users/login')
            .send({ email: `absent-${randomUUID()}@example.com`, password: oversizedPassword });
        expect(unknown.status).toBe(401);
        expect(unknown.body.message).toBe(tooLong.body.message);
    }, 40000);

    it('rejects a 73-byte registration without creating a user', async () => {
        const fixture = await newFixture();
        const response = await register(fixture, fixture.username, oversizedPassword);
        expect(response.status).toBe(400);
        expect(fixture.id === undefined).toBe(true);
    });

    it('rejects a numeric username without creating a user', async () => {
        const fixture = await newFixture();
        const response = await register(fixture, 12345, validPassword);
        expect(response.status).toBe(400);
        expect(fixture.id === undefined).toBe(true);
    });

    it('rejects a numeric registration password without creating a user', async () => {
        const fixture = await newFixture();
        const response = await register(fixture, fixture.username, 12345678);
        expect(response.status).toBe(400);
        expect(fixture.id === undefined).toBe(true);
    });

    it('rejects a numeric login password', async () => {
        const fixture = await newFixture();
        const response = await request(context().server)
            .post('/api/users/login')
            .send({ email: fixture.email, password: 12345678 });
        expect(response.status).toBe(400);
    });
});

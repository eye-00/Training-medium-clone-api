import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { User } from '../../src/users/entities/user.entity.js';

import type {
    TestAppContext,
} from './test-app.helper.js';

const DEFAULT_TEST_PASSWORD = 'ExamplePass123!';

export type CreatedUser = Readonly<{
    id: string;
    email: string;
}>;

export type UserFixture = Readonly<{
    id: string;
    email: string;
    username: string;
    token: string;
    authorization: string;
}>;

export type UserFixtureOptions = Readonly<{
    prefix: string;
    password?: string;
}>;

/**
 * Registers and authenticates a unique test user.
 *
 * Tracks the registered user before attempting login
 * so that cleanup remains possible if login fails.
 */
export async function registerUserFixture(
    context: Pick<TestAppContext, 'server'>,
    createdUsers: CreatedUser[],
    options: UserFixtureOptions,
): Promise<UserFixture> {
    const suffix = randomUUID()
        .replaceAll('-', '');

    const username =
        `${options.prefix}_${suffix}`;

    const email =
        `${username}@example.com`;

    const password =
        options.password ?? DEFAULT_TEST_PASSWORD;

    const registration = await request(context.server)
        .post('/api/users')
        .send({
            email,
            username,
            password,
        })
        .expect(201);

    const id: unknown =
        registration.body.user?.id;

    if (
        typeof id !== 'string' ||
        !id.trim()
    ) {
        throw new Error(
            'User fixture registration returned an invalid user ID',
        );
    }

    createdUsers.push({
        id,
        email,
    });

    const login = await request(context.server)
        .post('/api/users/login')
        .send({
            email,
            password,
        })
        .expect(200);

    const token: unknown =
        login.body.accessToken;

    if (
        typeof token !== 'string' ||
        !token.trim()
    ) {
        throw new Error(
            'User fixture login returned an invalid access token',
        );
    }

    return Object.freeze({
        id,
        email,
        username,
        token,
        authorization: `Bearer ${token}`,
    });
}


/**
 * Deletes only users registered by the current suite.
 *
 * Continues cleaning independent user fixtures when
 * an individual deletion fails.
 *
 * Must be called inside the verified cleanup callback
 * provided to closeTestApp().
 */
export async function cleanupUserFixtures(
    db: DataSource,
    createdUsers: readonly CreatedUser[],
): Promise<void> {
    if (createdUsers.length === 0) {
        return;
    }

    const repository = db.getRepository(User);
    const errors: unknown[] = [];

    for (const user of createdUsers) {
        try {
            if (
                typeof user.id !== 'string' ||
                !user.id.trim() ||
                typeof user.email !== 'string' ||
                !user.email.trim()
            ) {
                throw new Error(
                    'Invalid user fixture cleanup identity',
                );
            }

            await repository.delete({
                id: user.id,
                email: user.email,
            });
        } catch (error: unknown) {
            errors.push(error);
        }
    }

    if (errors.length > 0) {
        throw new AggregateError(
            errors,
            `User fixture cleanup failed for ${errors.length} fixture(s)`,
        );
    }
}

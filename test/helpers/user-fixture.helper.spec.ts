import type { Server } from 'node:http';
import type { DataSource } from 'typeorm';

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    registerUserFixture,
    cleanupUserFixtures,
    type CreatedUser,
} from './user-fixture.helper.js';

import { User } from '../../src/users/entities/user.entity.js';

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    post: vi.fn(),
    send: vi.fn(),
    expectStatus: vi.fn(),
    getRepository: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('supertest', () => ({
    default: mocks.request,
}));

const context = {
    server: {} as Server,
};

const db = {
    getRepository: mocks.getRepository,
} as unknown as DataSource;

function mockRegistration(id = 'test-user-id') {
    return {
        body: {
            user: { id },
        },
    };
}

function mockLogin(token = 'test-access-token') {
    return {
        body: {
            accessToken: token,
        },
    };
}

describe('Shared User Fixture', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        mocks.request.mockReturnValue({
            post: mocks.post,
        });

        mocks.post.mockReturnValue({
            send: mocks.send,
        });

        mocks.send.mockReturnValue({
            expect: mocks.expectStatus,
        });

        mocks.getRepository.mockReturnValue({
            delete: mocks.delete,
        });

        mocks.delete.mockResolvedValue({
            affected: 1,
        });
    });

    it('registers and authenticates a test user', async () => {
        const createdUsers: CreatedUser[] = [];

        mocks.expectStatus
            .mockResolvedValueOnce(mockRegistration())
            .mockResolvedValueOnce(mockLogin());

        const user = await registerUserFixture(
            context,
            { prefix: 'cmt' },
            createdUsers,
        );

        expect(user.id).toBe('test-user-id');

        expect(user.username)
            .toMatch(/^cmt_[0-9a-f]{32}$/);

        expect(user.email)
            .toBe(`${user.username}@example.com`);

        expect(user.token)
            .toBe('test-access-token');

        expect(user.authorization)
            .toBe('Bearer test-access-token');

        expect(Object.isFrozen(user)).toBe(true);

        expect(createdUsers).toEqual([{
            id: user.id,
            email: user.email,
        }]);

        expect(mocks.post)
            .toHaveBeenNthCalledWith(
                1,
                '/api/users',
            );

        expect(mocks.post)
            .toHaveBeenNthCalledWith(
                2,
                '/api/users/login',
            );

        expect(mocks.send)
            .toHaveBeenNthCalledWith(1, {
                email: user.email,
                username: user.username,
                password: 'ExamplePass123!',
            });

        expect(mocks.send)
            .toHaveBeenNthCalledWith(2, {
                email: user.email,
                password: 'ExamplePass123!',
            });

        expect(mocks.expectStatus)
            .toHaveBeenNthCalledWith(1, 201);

        expect(mocks.expectStatus)
            .toHaveBeenNthCalledWith(2, 200);
    });

    it('generates unique identities for repeated fixture creation', async () => {
        const createdUsers: CreatedUser[] = [];

        mocks.expectStatus
            .mockResolvedValueOnce(mockRegistration('user-1'))
            .mockResolvedValueOnce(mockLogin('token-1'))
            .mockResolvedValueOnce(mockRegistration('user-2'))
            .mockResolvedValueOnce(mockLogin('token-2'));

        const options = {
            prefix: 'fixture',
            password: 'CustomTestPass123!',
        };

        const first = await registerUserFixture(
            context,
            options,
            createdUsers,
        );

        const second = await registerUserFixture(
            context,
            options,
            createdUsers,
        );

        expect(first.id).not.toBe(second.id);
        expect(first.username).not.toBe(second.username);
        expect(first.email).not.toBe(second.email);
        expect(first.token).not.toBe(second.token);

        expect(createdUsers).toEqual([
            { id: first.id, email: first.email },
            { id: second.id, email: second.email },
        ]);

        expect(mocks.send)
            .toHaveBeenNthCalledWith(1, {
                email: first.email,
                username: first.username,
                password: options.password,
            });

        expect(mocks.send)
            .toHaveBeenNthCalledWith(2, {
                email: first.email,
                password: options.password,
            });
    });

    it('does not track users when registration fails', async () => {
        const createdUsers: CreatedUser[] = [];

        const error = new Error(
            'Registration failed',
        );

        mocks.expectStatus
            .mockRejectedValueOnce(error);

        await expect(
            registerUserFixture(
                context,
                { prefix: 'cmt' },
                createdUsers,
            ),
        ).rejects.toBe(error);

        expect(createdUsers).toHaveLength(0);

        expect(mocks.post)
            .toHaveBeenCalledTimes(1);

        expect(mocks.post)
            .not.toHaveBeenCalledWith(
                '/api/users/login',
            );
    });

    it('tracks the registered user before attempting login', async () => {
        const createdUsers: CreatedUser[] = [];

        const error = new Error('Login failed');

        mocks.expectStatus
            .mockResolvedValueOnce(
                mockRegistration(),
            )
            .mockImplementationOnce(async () => {
                expect(createdUsers)
                    .toHaveLength(1);

                expect(createdUsers[0])
                    .toMatchObject({
                        id: 'test-user-id',
                    });

                throw error;
            });

        await expect(
            registerUserFixture(
                context,
                { prefix: 'cmt' },
                createdUsers,
            ),
        ).rejects.toBe(error);

        expect(createdUsers)
            .toHaveLength(1);
    });

    it('rejects an invalid access token but retains cleanup tracking', async () => {
        const createdUsers: CreatedUser[] = [];

        mocks.expectStatus
            .mockResolvedValueOnce(
                mockRegistration(),
            )
            .mockResolvedValueOnce(
                mockLogin('   '),
            );

        await expect(
            registerUserFixture(
                context,
                { prefix: 'cmt' },
                createdUsers,
            ),
        ).rejects.toThrow(
            'User fixture login returned an invalid access token',
        );

        expect(createdUsers)
            .toHaveLength(1);
    });

    it('deletes only users tracked by the current suite', async () => {
        const createdUsers: CreatedUser[] = [
            {
                id: 'user-1',
                email: 'first@example.com',
            },
            {
                id: 'user-2',
                email: 'second@example.com',
            },
        ];

        await cleanupUserFixtures(
            db,
            createdUsers,
        );

        expect(mocks.getRepository)
            .toHaveBeenCalledWith(User);

        expect(mocks.delete)
            .toHaveBeenCalledTimes(2);

        expect(mocks.delete)
            .toHaveBeenNthCalledWith(
                1,
                createdUsers[0],
            );

        expect(mocks.delete)
            .toHaveBeenNthCalledWith(
                2,
                createdUsers[1],
            );
    });

    it('does not access the repository when no users were created', async () => {
        await cleanupUserFixtures(db, []);

        expect(mocks.getRepository)
            .not.toHaveBeenCalled();

        expect(mocks.delete)
            .not.toHaveBeenCalled();
    });

    it('continues cleaning remaining users after a deletion fails', async () => {
        const createdUsers: CreatedUser[] = [
            {
                id: 'user-1',
                email: 'first@example.com',
            },
            {
                id: 'user-2',
                email: 'second@example.com',
            },
            {
                id: 'user-3',
                email: 'third@example.com',
            },
        ];

        const error = new Error(
            'First user deletion failed',
        );

        mocks.delete.mockRejectedValueOnce(error);

        const result = cleanupUserFixtures(
            db,
            createdUsers,
        );

        await expect(result)
            .rejects.toBeInstanceOf(AggregateError);

        await expect(result)
            .rejects.toMatchObject({
                errors: [error],
            });

        expect(mocks.delete)
            .toHaveBeenCalledTimes(3);

        for (const [index, user] of createdUsers.entries()) {
            expect(mocks.delete)
                .toHaveBeenNthCalledWith(
                    index + 1,
                    user,
                );
        }
    });

    it('preserves all user deletion errors', async () => {
        const createdUsers: CreatedUser[] = [
            {
                id: 'user-1',
                email: 'first@example.com',
            },
            {
                id: 'user-2',
                email: 'second@example.com',
            },
            {
                id: 'user-3',
                email: 'third@example.com',
            },
        ];

        const firstError = new Error(
            'First deletion failed',
        );

        const secondError = new Error(
            'Second deletion failed',
        );

        mocks.delete
            .mockRejectedValueOnce(firstError)
            .mockRejectedValueOnce(secondError);

        const result = cleanupUserFixtures(
            db,
            createdUsers,
        );

        await expect(result)
            .rejects.toBeInstanceOf(AggregateError);

        await expect(result)
            .rejects.toMatchObject({
                errors: [
                    firstError,
                    secondError,
                ],
            });

        expect(mocks.delete)
            .toHaveBeenCalledTimes(3);

        expect(mocks.delete)
            .toHaveBeenNthCalledWith(
                3,
                createdUsers[2],
            );
    });

    it.each([
        {
            id: '',
            email: 'invalid@example.com',
        },
        {
            id: 'invalid-user-id',
            email: '   ',
        },
    ])(
        'rejects invalid cleanup identity: %j',
        async (invalidUser) => {
            const validUser: CreatedUser = {
                id: 'valid-user-id',
                email: 'valid@example.com',
            };

            const result = cleanupUserFixtures(
                db,
                [invalidUser, validUser],
            );

            await expect(result)
                .rejects.toBeInstanceOf(AggregateError);

            await expect(result)
                .rejects.toMatchObject({
                    errors: [
                        expect.objectContaining({
                            message:
                                'Invalid user fixture cleanup identity',
                        }),
                    ],
                });

            expect(mocks.delete)
                .toHaveBeenCalledTimes(1);

            expect(mocks.delete)
                .toHaveBeenCalledWith(validUser);
        },
    );

});

import type { Server } from 'node:http';
import type { DataSource } from 'typeorm';

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { Comment } from '../../src/comments/entities/comment.entity.js';

import {
    commentEndpoint,
    postComment,
    getComments,
    deleteComment,
    createCommentFixture,
} from './comment-fixture.helper.js';

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    set: vi.fn(),
    send: vi.fn(),
    expectStatus: vi.fn(),

    getRepository: vi.fn(),
    findOneByOrFail: vi.fn(),
}));

vi.mock('supertest', () => ({
    default: mocks.request,
}));

const fakeRequest = {
    set: mocks.set,
    send: mocks.send,
    expect: mocks.expectStatus,
};

const db = {
    getRepository: mocks.getRepository,
} as unknown as DataSource;

const context = {
    server: {} as Server,
    db,
};

const AUTHORIZATION = 'Bearer test-token';

const ENDPOINT =
    '/api/articles/example-article/comments';

function mockCommentResponse() {
    return {
        id: 123,
        body: 'Example comment',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        author: {
            username: 'test-user',
            bio: null,
            image: null,
            following: false,
        },
    };
}

function mockSavedComment() {
    return {
        id: 123,
        body: 'Example comment',
        articleId: 'test-article-id',
        authorId: 'test-user-id',
        createdAt: new Date(
            '2026-01-01T00:00:00.000Z',
        ),
        updatedAt: new Date(
            '2026-01-01T00:00:00.000Z',
        ),
    };
}

describe('Shared Comment Fixture', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        mocks.request.mockReturnValue({
            post: mocks.post,
            get: mocks.get,
            delete: mocks.delete,
        });

        mocks.post.mockReturnValue(
            fakeRequest,
        );

        mocks.get.mockReturnValue(
            fakeRequest,
        );

        mocks.delete.mockReturnValue(
            fakeRequest,
        );

        mocks.set.mockReturnValue(
            fakeRequest,
        );

        mocks.send.mockReturnValue(
            fakeRequest,
        );

        mocks.expectStatus.mockResolvedValue({
            body: {
                comment: mockCommentResponse(),
            },
        });

        mocks.getRepository.mockReturnValue({
            findOneByOrFail:
                mocks.findOneByOrFail,
        });

        mocks.findOneByOrFail.mockResolvedValue(
            mockSavedComment(),
        );
    });

    it('builds the comments endpoint from an article slug', () => {
        expect(
            commentEndpoint('example-article'),
        ).toBe(ENDPOINT);
    });

    it('builds a POST request with authorization and the comment body', () => {
        const result = postComment(
            context,
            ENDPOINT,
            AUTHORIZATION,
            '  Example comment  ',
        );

        expect(mocks.request)
            .toHaveBeenCalledWith(
                context.server,
            );

        expect(mocks.post)
            .toHaveBeenCalledWith(ENDPOINT);

        expect(mocks.set)
            .toHaveBeenCalledWith(
                'Authorization',
                AUTHORIZATION,
            );

        expect(mocks.send)
            .toHaveBeenCalledWith({
                comment: {
                    body: '  Example comment  ',
                },
            });

        expect(result).toBe(fakeRequest);

        expect(mocks.expectStatus)
            .not.toHaveBeenCalled();
    });

    it('builds an anonymous GET request without an authorization header', () => {
        const result = getComments(
            context,
            ENDPOINT,
        );

        expect(mocks.get)
            .toHaveBeenCalledWith(ENDPOINT);

        expect(mocks.set)
            .not.toHaveBeenCalled();

        expect(result).toBe(fakeRequest);
    });

    it('builds an authenticated GET request', () => {
        const result = getComments(
            context,
            ENDPOINT,
            AUTHORIZATION,
        );

        expect(mocks.get)
            .toHaveBeenCalledWith(ENDPOINT);

        expect(mocks.set)
            .toHaveBeenCalledWith(
                'Authorization',
                AUTHORIZATION,
            );

        expect(result).toBe(fakeRequest);
    });

    it('builds an authenticated DELETE request', () => {
        const result = deleteComment(
            context,
            ENDPOINT,
            123,
            AUTHORIZATION,
        );

        expect(mocks.delete)
            .toHaveBeenCalledWith(
                `${ENDPOINT}/123`,
            );

        expect(mocks.set)
            .toHaveBeenCalledWith(
                'Authorization',
                AUTHORIZATION,
            );

        expect(result).toBe(fakeRequest);
    });

    it('preserves malformed comment IDs and supports missing authorization', () => {
        const result = deleteComment(
            context,
            ENDPOINT,
            '01',
        );

        expect(mocks.delete)
            .toHaveBeenCalledWith(
                `${ENDPOINT}/01`,
            );

        expect(mocks.set)
            .not.toHaveBeenCalled();

        expect(result).toBe(fakeRequest);
    });

    it('creates a comment fixture and retrieves its persisted record', async () => {
        const response = mockCommentResponse();
        const saved = mockSavedComment();

        mocks.expectStatus.mockResolvedValue({
            body: { comment: response },
        });

        mocks.findOneByOrFail
            .mockResolvedValue(saved);

        const result =
            await createCommentFixture(
                context,
                ENDPOINT,
                AUTHORIZATION,
                'Example comment',
            );

        expect(mocks.post)
            .toHaveBeenCalledWith(ENDPOINT);

        expect(mocks.set)
            .toHaveBeenCalledWith(
                'Authorization',
                AUTHORIZATION,
            );

        expect(mocks.send)
            .toHaveBeenCalledWith({
                comment: {
                    body: 'Example comment',
                },
            });

        expect(mocks.expectStatus)
            .toHaveBeenCalledWith(201);

        expect(mocks.getRepository)
            .toHaveBeenCalledWith(Comment);

        expect(mocks.findOneByOrFail)
            .toHaveBeenCalledWith({
                id: response.id,
            });

        expect(result.saved).toBe(saved);
        expect(result.response).toBe(response);

        expect(Object.isFrozen(result))
            .toBe(true);
    });

    it('does not query the database when comment creation fails', async () => {
        const error = new Error(
            'Comment creation failed',
        );

        mocks.expectStatus
            .mockRejectedValue(error);

        await expect(
            createCommentFixture(
                context,
                ENDPOINT,
                AUTHORIZATION,
                'Example comment',
            ),
        ).rejects.toBe(error);

        expect(mocks.getRepository)
            .not.toHaveBeenCalled();

        expect(mocks.findOneByOrFail)
            .not.toHaveBeenCalled();
    });

    it.each([
        {
            label: 'missing ID',
            id: undefined,
        },
        {
            label: 'string ID',
            id: '123',
        },
        {
            label: 'zero ID',
            id: 0,
        },
        {
            label: 'negative ID',
            id: -1,
        },
        {
            label: 'fractional ID',
            id: 1.5,
        },
        {
            label: 'unsafe integer ID',
            id: Number.MAX_SAFE_INTEGER + 1,
        },
        {
            label: 'unsigned integer overflow',
            id: 4294967296,
        },
    ])(
        'rejects $label before querying the database',
        async ({ id }) => {
            mocks.expectStatus.mockResolvedValue({
                body: {
                    comment: { id },
                },
            });

            await expect(
                createCommentFixture(
                    context,
                    ENDPOINT,
                    AUTHORIZATION,
                    'Example comment',
                ),
            ).rejects.toThrow(
                'Comment fixture returned an invalid comment ID',
            );

            expect(mocks.getRepository)
                .not.toHaveBeenCalled();

            expect(mocks.findOneByOrFail)
                .not.toHaveBeenCalled();
        },
    );

    it('propagates errors when the persisted comment cannot be found', async () => {
        const error = new Error(
            'Persisted comment not found',
        );

        mocks.findOneByOrFail
            .mockRejectedValue(error);

        await expect(
            createCommentFixture(
                context,
                ENDPOINT,
                AUTHORIZATION,
                'Example comment',
            ),
        ).rejects.toBe(error);

        expect(mocks.findOneByOrFail)
            .toHaveBeenCalledTimes(1);

        expect(mocks.findOneByOrFail)
            .toHaveBeenCalledWith({
                id: 123,
            });
    });
});

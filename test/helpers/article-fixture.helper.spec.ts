
import type { Server } from 'node:http';
import type { DataSource } from 'typeorm';

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { Article } from '../../src/articles/entities/article.entity.js';

import {
    createArticleFixture,
    makeUniqueTag,
    cleanupTagFixtures,
} from './article-fixture.helper.js';

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    post: vi.fn(),
    set: vi.fn(),
    send: vi.fn(),
    expectStatus: vi.fn(),

    getRepository: vi.fn(),
    findOneByOrFail: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('supertest', () => ({
    default: mocks.request,
}));

const db = {
    getRepository: mocks.getRepository,
} as unknown as DataSource;

const context = {
    server: {} as Server,
    db,
};

const AUTHORIZATION = 'Bearer test-token';

function mockArticleResponse() {
    return {
        slug: 'example-article',
        title: 'Example article',
        description: 'Example description',
        body: 'Example body',
        tagList: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        favorited: false,
        favoritesCount: 0,
        author: {
            username: 'test-user',
            bio: null,
            image: null,
            following: false,
        },
    };
}

function mockSavedArticle() {
    return {
        id: 'test-article-id',
        slug: 'example-article',
        title: 'Example article',
        authorId: 'test-user-id',
    };
}

describe('Shared Article Fixture', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        mocks.request.mockReturnValue({
            post: mocks.post,
        });

        mocks.post.mockReturnValue({
            set: mocks.set,
        });

        mocks.set.mockReturnValue({
            send: mocks.send,
        });

        mocks.send.mockReturnValue({
            expect: mocks.expectStatus,
        });

        mocks.expectStatus.mockResolvedValue({
            body: {
                article: mockArticleResponse(),
            },
        });

        mocks.getRepository.mockReturnValue({
            findOneByOrFail:
                mocks.findOneByOrFail,
            delete: mocks.delete,
        });

        mocks.findOneByOrFail.mockResolvedValue(
            mockSavedArticle(),
        );

        mocks.delete.mockResolvedValue({
            affected: 1,
        });
    });

    it('creates an article with the default fixture payload', async () => {
        const response = mockArticleResponse();
        const saved = mockSavedArticle();

        mocks.expectStatus.mockResolvedValue({
            body: { article: response },
        });

        mocks.findOneByOrFail
            .mockResolvedValue(saved);

        const result = await createArticleFixture(
            context,
            AUTHORIZATION,
        );

        expect(mocks.request)
            .toHaveBeenCalledWith(context.server);

        expect(mocks.post)
            .toHaveBeenCalledWith('/api/articles');

        expect(mocks.set)
            .toHaveBeenCalledWith(
                'Authorization',
                AUTHORIZATION,
            );

        expect(mocks.send)
            .toHaveBeenCalledWith({
                article: {
                    title: 'Comment E2E article',
                    description: 'Comment E2E description',
                    body: 'Comment E2E body',
                    tagList: [],
                },
            });

        expect(mocks.expectStatus)
            .toHaveBeenCalledWith(201);

        expect(mocks.getRepository)
            .toHaveBeenCalledWith(Article);

        expect(mocks.findOneByOrFail)
            .toHaveBeenCalledWith({
                slug: response.slug,
            });

        expect(result.saved).toBe(saved);
        expect(result.response).toBe(response);
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('supports custom article fields and preserves supplied tags', async () => {
        const input = {
            title: 'Custom article',
            description: 'Custom description',
            body: 'Custom body',
            tagList: [
                'UniqueTag',
                'SharedTag',
            ],
        };

        await createArticleFixture(
            context,
            AUTHORIZATION,
            input,
        );

        expect(mocks.send)
            .toHaveBeenCalledWith({
                article: input,
            });

        expect(input.tagList).toEqual([
            'UniqueTag',
            'SharedTag',
        ]);
    });

    it('does not query the database when article creation fails', async () => {
        const error = new Error(
            'Article creation failed',
        );

        mocks.expectStatus
            .mockRejectedValue(error);

        await expect(
            createArticleFixture(
                context,
                AUTHORIZATION,
            ),
        ).rejects.toBe(error);

        expect(mocks.getRepository)
            .not.toHaveBeenCalled();

        expect(mocks.findOneByOrFail)
            .not.toHaveBeenCalled();
    });

    it('rejects an invalid article slug before querying the database', async () => {
        mocks.expectStatus.mockResolvedValue({
            body: {
                article: {
                    slug: '   ',
                },
            },
        });

        await expect(
            createArticleFixture(
                context,
                AUTHORIZATION,
            ),
        ).rejects.toThrow(
            'Article fixture returned an invalid slug',
        );

        expect(mocks.getRepository)
            .not.toHaveBeenCalled();
    });

    it('propagates errors when the persisted article cannot be found', async () => {
        const error = new Error(
            'Persisted article not found',
        );

        mocks.findOneByOrFail
            .mockRejectedValue(error);

        await expect(
            createArticleFixture(
                context,
                AUTHORIZATION,
            ),
        ).rejects.toBe(error);

        expect(mocks.findOneByOrFail)
            .toHaveBeenCalledTimes(1);
    });

    it('generates and tracks unique tag names', () => {
        const createdTags = new Set<string>();

        const first = makeUniqueTag(
            'scope',
            createdTags,
        );

        const second = makeUniqueTag(
            'scope',
            createdTags,
        );

        expect(first)
            .toMatch(/^scope_[0-9a-f]{32}$/);

        expect(second)
            .toMatch(/^scope_[0-9a-f]{32}$/);

        expect(first).not.toBe(second);

        expect(createdTags).toEqual(
            new Set([first, second]),
        );
    });

    it('does not access the repository when no tags are tracked', async () => {
        await cleanupTagFixtures(
            db,
            new Set<string>(),
        );

        expect(mocks.getRepository)
            .not.toHaveBeenCalled();

        expect(mocks.delete)
            .not.toHaveBeenCalled();
    });
});

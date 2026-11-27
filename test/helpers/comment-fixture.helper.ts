import request from 'supertest';

import { Comment } from '../../src/comments/entities/comment.entity.js';

import type {
    CommentDetailsDto,
} from '../../src/comments/dto/comment-response.dto.js';

import type {
    TestAppContext,
} from './test-app.helper.js';

type HttpContext = Pick<
    TestAppContext,
    'server'
>;

export type CommentFixture = Readonly<{
    saved: Comment;
    response: CommentDetailsDto;
}>;

/**
 * Builds the comments collection endpoint.
 */
export function commentEndpoint(
    slug: string,
): string {
    return `/api/articles/${slug}/comments`;
}

/**
 * Builds a comment creation request.
 *
 * The caller determines the expected HTTP status.
 */
export function postComment(
    context: HttpContext,
    endpoint: string,
    authorization: string,
    body: string,
) {
    return request(context.server)
        .post(endpoint)
        .set('Authorization', authorization)
        .send({
            comment: { body },
        });
}

/**
 * Builds a public or authenticated comments request.
 */
export function getComments(
    context: HttpContext,
    endpoint: string,
    authorization?: string,
) {
    const req = request(context.server)
        .get(endpoint);

    if (authorization !== undefined) {
        req.set(
            'Authorization',
            authorization,
        );
    }

    return req;
}

/**
 * Builds a comment deletion request.
 *
 * String IDs are intentionally supported so that
 * validation tests can send malformed route parameters.
 */
export function deleteComment(
    context: HttpContext,
    endpoint: string,
    id: number | string,
    authorization?: string,
) {
    const req = request(context.server)
        .delete(`${endpoint}/${id}`);

    if (authorization !== undefined) {
        req.set(
            'Authorization',
            authorization,
        );
    }

    return req;
}

/**
 * Creates a valid comment through the public HTTP API
 * and retrieves its persisted database record.
 */
export async function createCommentFixture(
    context: Pick<TestAppContext, 'server' | 'db'>,
    endpoint: string,
    authorization: string,
    body: string,
): Promise<CommentFixture> {
    const result = await postComment(
        context,
        endpoint,
        authorization,
        body,
    ).expect(201);

    const id: unknown =
        result.body?.comment?.id;

    if (
        typeof id !== 'number' ||
        !Number.isSafeInteger(id) ||
        id < 1 ||
        id > 4294967295
    ) {
        throw new Error(
            'Comment fixture returned an invalid comment ID',
        );
    }

    const saved = await context.db
        .getRepository(Comment)
        .findOneByOrFail({ id });

    return Object.freeze({
        saved,
        response:
            result.body.comment as CommentDetailsDto,
    });
}

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/** Register the standard Express parsers and sanitize only JSON parse errors. */
export function configureBodyParser(app: NestExpressApplication): void {
    app.useBodyParser('json');
    app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
        if (
            error instanceof SyntaxError &&
            'type' in error && error.type === 'entity.parse.failed' &&
            'status' in error && error.status === 400
        ) {
            response.status(400).json({
                statusCode: 400,
                message: 'Invalid JSON payload',
                error: 'Bad Request',
            });
            return;
        }
        next(error);
    });
    app.useBodyParser('urlencoded', { extended: true });
}

import {
    BadRequestException,
    Injectable,
    type PipeTransform,
} from '@nestjs/common';

@Injectable()
export class CommentIdPipe
    implements PipeTransform<unknown, number> {

    transform(value: unknown): number {
        if (
            typeof value !== 'string' ||
            value !== value.trim() ||
            !/^[1-9][0-9]*$/.test(value)
        ) {
            throw new BadRequestException(
                'Invalid comment ID',
            );
        }

        const id = Number(value);

        if (
            !Number.isSafeInteger(id) ||
            id > 4294967295
        ) {
            throw new BadRequestException(
                'Invalid comment ID',
            );
        }

        return id;
    }
}

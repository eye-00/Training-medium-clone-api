import { Transform } from 'class-transformer';
import {
    IsInt,
    Max,
    Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const parseInteger = ({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : value;

export class FeedArticlesQueryDto {
    @ApiPropertyOptional({
        default: 20,
        minimum: 1,
        maximum: 100,
    })
    @Transform(parseInteger)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;

    @ApiPropertyOptional({
        default: 0,
        minimum: 0,
        maximum: 100000,
    })
    @Transform(parseInteger)
    @IsInt()
    @Min(0)
    @Max(100000)
    offset: number = 0;
}

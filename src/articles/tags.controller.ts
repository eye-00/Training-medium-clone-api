import {
    Controller,
    Get,
} from '@nestjs/common';

import {
    ApiOkResponse,
    ApiTags,
} from '@nestjs/swagger';

import { ArticlesService } from './articles.service.js';
import { TagsResponseDto } from './dto/tags-response.dto.js';

@ApiTags('Tags')
@Controller('tags')
export class TagsController {
    constructor(
        private readonly articlesService: ArticlesService,
    ) { }

    @Get()
    @ApiOkResponse({
        type: TagsResponseDto,
        description: 'List of tags used by articles',
    })
    findAll(): Promise<TagsResponseDto> {
        return this.articlesService.getTags();
    }
}

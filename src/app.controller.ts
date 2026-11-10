import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { AppService } from './app.service.js';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('hello')
  @ApiOperation({
    summary: 'Return a localized greeting',
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    enum: ['en', 'vi'],
    description: 'Response Language',
  })
  @ApiOkResponse({
    description: 'Localized greeting',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Hello World!',
        },
      },
      required: ['message'],
    },
  })
  getHello() {
    return {
      message: this.appService.getHello(),
    };
  }
}

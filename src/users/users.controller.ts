import { Body, Controller, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { RegisterUserDto } from './dto/register-user.dto.js';
import { RegisterRespondDto } from './dto/register-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post()
    @ApiCreatedResponse({ type: RegisterRespondDto })
    @ApiBadRequestResponse({ description: 'Invalid request data', })
    @ApiConflictResponse({ description: 'Email or username already exists', })
    register(
        @Body() dto: RegisterUserDto,

    ): Promise<RegisterRespondDto> {
        return this.usersService.register(dto);
    }
}

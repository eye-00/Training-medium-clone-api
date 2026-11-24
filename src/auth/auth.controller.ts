import {
    Body,
    Controller,
    Post,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiUnauthorizedResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginUserDto } from './dto/login-user.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';

@ApiTags('Authentication')
@Controller('users')
export class AuthController {
    constructor(private readonly authService: AuthService) { }
    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: LoginResponseDto })
    @ApiBadRequestResponse({ description: 'Invalid request body', })
    @ApiUnauthorizedResponse({ description: 'Invalid email or password', })
    login(
        @Body() dto: LoginUserDto,
    ): Promise<LoginResponseDto> {
        return this.authService.login(dto);
    }
}
import { ApiProperty } from '@nestjs/swagger';
import { PublicUserDto } from '../../users/dto/register-response.dto.js';

export class LoginResponseDto {
    @ApiProperty({ type: () => PublicUserDto })
    user!: PublicUserDto;

    @ApiProperty({
        description: 'JWT token for authentication, valid for 15 minutes',
    })
    accessToken!: string;
}

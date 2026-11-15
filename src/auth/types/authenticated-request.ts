import type { PublicUserDto } from '../../users/dto/register-response.dto.js';
export interface AuthenticatedRequest {
    headers: {
        authorization?: string;
    };
    user?: PublicUserDto;
}
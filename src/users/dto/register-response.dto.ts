import { ApiProperty } from '@nestjs/swagger';
export class PublicUserDto {
    @ApiProperty({ format: 'uuid' })
    id!: string;

    @ApiProperty()
    email!: string;

    @ApiProperty()
    username!: string;

    @ApiProperty({ nullable: true })
    bio!: string | null;

    @ApiProperty({ nullable: true })
    image!: string | null;
}

export class RegisterResponseDto {
    @ApiProperty({ type: () => PublicUserDto })
    user!: PublicUserDto;
}
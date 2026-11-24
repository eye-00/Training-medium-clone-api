import { ApiProperty } from '@nestjs/swagger';

export class PublicProfileDto {
    @ApiProperty()
    username!: string;

    @ApiProperty({ nullable: true })
    bio!: string | null;

    @ApiProperty({ nullable: true })
    image!: string | null;

    @ApiProperty({ minimum: 0 })
    followersCount!: number;

    @ApiProperty({ minimum: 0 })
    followingCount!: number;
}

export class ProfileResponseDto {
    @ApiProperty({ type: () => PublicProfileDto })
    profile!: PublicProfileDto;
}

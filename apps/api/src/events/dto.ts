import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** §events — schedule a one-off landing-page event (a call). */
export class CreateEventDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MinLength(1) @MaxLength(2000) url!: string;
  @IsISO8601() startAt!: string;
  @IsISO8601() endAt!: string;
}

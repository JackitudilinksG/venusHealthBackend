import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";

export class SignInDto {
  @ApiProperty({example: 'john@example.com'})
  @IsEmail({}, {message: 'Please provide a valid email id'})
  @IsNotEmpty()
  email!: string;

  @ApiProperty({example: 'password123'})
  @IsString()
  @MinLength(6, {message: 'Password must be at least 6 characters long'})
  @IsNotEmpty()
  password!: string;
}

export class SignInResponseDto {
    @ApiProperty()
    accessToken!: string;

    @ApiProperty()
    userId!: string;

    @ApiProperty()
    first_name!: string
}
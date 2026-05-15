import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignInDto, SignInResponseDto } from './dto/sign-in.dto';
//import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    // @Public() //when usign real guards
    @Post('sign-in')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Sign in a user' })
    @ApiResponse({ status: 200, description: 'Successful login', type: SignInResponseDto })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async signIn(@Body() dto: SignInDto): Promise<SignInResponseDto> {
        return this.authService.signIn(dto);
    }
}

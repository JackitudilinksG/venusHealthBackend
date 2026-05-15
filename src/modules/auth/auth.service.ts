import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { SignInDto, SignInResponseDto } from './dto/sign-in.dto';
import { AuthRerpository } from './auth.repository';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name)
    constructor(private readonly authRepository: AuthRerpository) {}

    async signIn(dto: SignInDto): Promise<SignInResponseDto> {
        this.logger.log('Sign in attempt for email:', dto.email);

        // mock user for auth testign
        // const mockDbUser = {
        //     id: '123abc',
        //     username: 'admin@venushealth.com',
        //     password: 'password123'
        // }

        const user = await this.authRepository.findUserByEmail(dto.email) as any;

        if(!user || dto.password !== user.password) {
            this.logger.warn(`Failed sign-in attempt for email: ${dto.email}`);
            throw new UnauthorizedException('Invalid credentials');
        }

        this.logger.log(`User ${user.id} signed in successfully`);

        // todo: return JWT when not mock
        return {
            accessToken: 'jwt-token',
            userId: user.id,
            first_name: user.first_name
        };
    }
}

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { SignInDto, SignInResponseDto } from './dto/sign-in.dto';
import { AuthRerpository } from './auth.repository';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name)
    constructor(private readonly authRepository: AuthRerpository) {}

    async signIn(dto: SignInDto): Promise<SignInResponseDto> {
        this.logger.log('Sign in attempt for email:', dto.email);

        const user = await this.authRepository.findUserByEmail(dto.email) as any;

        // this.logger.log(`Database returned user: ${JSON.stringify(user)}`);

        if(!user || dto.password !== user.passwordHash) {
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

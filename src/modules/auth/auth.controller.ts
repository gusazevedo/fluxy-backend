import type { FastifyReply, FastifyRequest } from 'fastify'
import type { IAuthService } from './auth.service.js'

interface SocialLoginBody {
  id_token: string
}

export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  async loginWithGoogle(
    request: FastifyRequest<{ Body: SocialLoginBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const tokens = await this.authService.loginWithProvider('google', request.body.id_token)
    reply.status(200).send(tokens)
  }

  async loginWithApple(
    request: FastifyRequest<{ Body: SocialLoginBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const tokens = await this.authService.loginWithProvider('apple', request.body.id_token)
    reply.status(200).send(tokens)
  }
}

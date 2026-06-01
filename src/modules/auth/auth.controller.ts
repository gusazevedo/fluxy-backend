import type { FastifyReply, FastifyRequest } from 'fastify'
import type { IAuthService } from './auth.service.js'

interface RegisterBody {
  email: string
  password: string
}

interface LoginBody {
  email: string
  password: string
}

export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  async register(request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply): Promise<void> {
    const { email, password } = request.body
    const result = await this.authService.register(email, password)
    reply.status(201).send(result)
  }

  async login(request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply): Promise<void> {
    const { email, password } = request.body
    const tokens = await this.authService.login(email, password)
    reply.status(200).send(tokens)
  }
}

import type { FastifyInstance } from 'fastify'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { registerSchema, loginSchema } from './auth.schema.js'

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new AuthController(new AuthService())

  fastify.post('/register', { schema: registerSchema }, controller.register.bind(controller))
  fastify.post('/login', { schema: loginSchema }, controller.login.bind(controller))
}

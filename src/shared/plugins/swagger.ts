import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import fp from 'fastify-plugin'

/**
 * OpenAPI generation from the route TypeBox schemas, served as Swagger UI at
 * `/docs`. Declares a `bearerAuth` scheme so protected routes (added by later
 * specs) can reference it via `security: [{ bearerAuth: [] }]`.
 */
export const swaggerPlugin = fp(
  async (app): Promise<void> => {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Fluxy API',
          description: 'Personal finance REST API — income & expense tracking.',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
    })

    await app.register(swaggerUi, {
      routePrefix: '/docs',
    })
  },
  { name: 'swagger' },
)

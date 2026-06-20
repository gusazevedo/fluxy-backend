import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { createCategoryRepository } from './category.repository.js'
import { createCategoryService } from './category.service.js'
import {
  CategoryListResponse,
  CategoryParams,
  CategoryResponse,
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from './category.schema.js'

export const categoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = createCategoryService({
    repo: createCategoryRepository(app.db),
    // No transactions exist until spec 0005, so every category is "unused" and
    // deletion is a hard delete; 0005 replaces this with a real usage check.
    isCategoryInUse: async () => false,
  })

  app.get(
    '/categories',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['categories'],
        summary: 'List categories',
        security: [{ bearerAuth: [] }],
        querystring: ListCategoriesQuery,
        response: { 200: CategoryListResponse },
      },
    },
    (request) =>
      service.list(request.user.sub, {
        kind: request.query.kind,
        includeArchived: request.query.includeArchived === true,
      }),
  )

  app.post(
    '/categories',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['categories'],
        summary: 'Create a category',
        security: [{ bearerAuth: [] }],
        body: CreateCategoryBody,
        response: { 201: CategoryResponse },
      },
    },
    async (request, reply) => {
      const category = await service.create(request.user.sub, request.body)
      reply.code(201)
      return category
    },
  )

  app.get(
    '/categories/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['categories'],
        summary: 'Get a category',
        security: [{ bearerAuth: [] }],
        params: CategoryParams,
        response: { 200: CategoryResponse },
      },
    },
    (request) => service.get(request.user.sub, request.params.id),
  )

  app.patch(
    '/categories/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['categories'],
        summary: 'Rename a category',
        security: [{ bearerAuth: [] }],
        params: CategoryParams,
        body: UpdateCategoryBody,
        response: { 200: CategoryResponse },
      },
    },
    (request) => service.rename(request.user.sub, request.params.id, request.body.name),
  )

  app.delete(
    '/categories/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['categories'],
        summary: 'Delete a category',
        security: [{ bearerAuth: [] }],
        params: CategoryParams,
      },
    },
    async (request, reply) => {
      await service.remove(request.user.sub, request.params.id)
      return reply.code(204).send()
    },
  )
}

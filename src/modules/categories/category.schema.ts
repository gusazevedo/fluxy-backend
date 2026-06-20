import { Type } from '@fastify/type-provider-typebox'

const Kind = Type.Union([Type.Literal('expense'), Type.Literal('income')])
const Name = Type.String({ minLength: 1, maxLength: 60 })
const Uuid = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
})

export const CreateCategoryBody = Type.Object({ name: Name, kind: Kind })
export const UpdateCategoryBody = Type.Object({ name: Name })
export const CategoryParams = Type.Object({ id: Uuid })
export const ListCategoriesQuery = Type.Object({
  kind: Type.Optional(Kind),
  includeArchived: Type.Optional(Type.Boolean()),
})

export const CategoryResponse = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: Kind,
  archived: Type.Boolean(),
  createdAt: Type.String(),
})
export const CategoryListResponse = Type.Array(CategoryResponse)

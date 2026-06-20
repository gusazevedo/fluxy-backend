import type { Category, TransactionKind } from '../../shared/database/schema.js'
import { AppError } from '../../shared/errors.js'
import type { CategoryRepository, ListCategoriesFilter } from './category.repository.js'

export interface CategoryDto {
  id: string
  name: string
  kind: TransactionKind
  archived: boolean
  createdAt: string
}

export interface CategoryServiceDeps {
  repo: CategoryRepository
  /**
   * Whether the category is referenced by any transaction. Until transactions
   * exist (spec 0005) this is always false, so deletion is a hard delete; 0005
   * wires the real check so used categories are archived instead (0004 §7).
   */
  isCategoryInUse: (categoryId: string) => Promise<boolean>
}

export interface CategoryService {
  create(userId: string, input: { name: string; kind: TransactionKind }): Promise<CategoryDto>
  list(userId: string, filter: ListCategoriesFilter): Promise<CategoryDto[]>
  get(userId: string, id: string): Promise<CategoryDto>
  rename(userId: string, id: string, name: string): Promise<CategoryDto>
  remove(userId: string, id: string): Promise<void>
}

const notFound = (): AppError => new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
const nameInUse = (): AppError =>
  new AppError(409, 'CATEGORY_NAME_IN_USE', 'A category with this name and type already exists')

function toDto(c: Category): CategoryDto {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    archived: c.archivedAt !== null,
    createdAt: c.createdAt.toISOString(),
  }
}

export function createCategoryService(deps: CategoryServiceDeps): CategoryService {
  const { repo, isCategoryInUse } = deps

  return {
    async create(userId, input): Promise<CategoryDto> {
      const name = input.name.trim()
      const existing = await repo.findActiveByName(userId, input.kind, name)
      if (existing) throw nameInUse()
      return toDto(await repo.create(userId, name, input.kind))
    },

    async list(userId, filter): Promise<CategoryDto[]> {
      const rows = await repo.list(userId, filter)
      return rows.map(toDto)
    },

    async get(userId, id): Promise<CategoryDto> {
      const category = await repo.findById(userId, id)
      if (!category) throw notFound()
      return toDto(category)
    },

    async rename(userId, id, rawName): Promise<CategoryDto> {
      const category = await repo.findById(userId, id)
      if (!category) throw notFound()
      const name = rawName.trim()
      const duplicate = await repo.findActiveByName(userId, category.kind, name)
      if (duplicate && duplicate.id !== id) throw nameInUse()
      const updated = await repo.updateName(id, name)
      if (!updated) throw notFound()
      return toDto(updated)
    },

    async remove(userId, id): Promise<void> {
      const category = await repo.findById(userId, id)
      if (!category) throw notFound()
      if (await isCategoryInUse(id)) {
        await repo.archive(id)
      } else {
        await repo.hardDelete(id)
      }
    },
  }
}

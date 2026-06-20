import { describe, expect, it, vi } from 'vitest'
import type { Category } from '../../shared/database/schema.js'
import type { CategoryRepository } from './category.repository.js'
import { createCategoryService } from './category.service.js'

function makeCategory(over: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    userId: 'user-1',
    name: 'Lazer',
    kind: 'expense',
    archivedAt: null,
    createdAt: new Date('2026-06-20T00:00:00Z'),
    updatedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  }
}

function makeRepo(over: Partial<CategoryRepository> = {}): CategoryRepository {
  return {
    create: vi.fn(),
    insertMany: vi.fn(),
    findById: vi.fn(),
    findActiveByName: vi.fn(),
    list: vi.fn(),
    updateName: vi.fn(),
    archive: vi.fn(),
    hardDelete: vi.fn(),
    ...over,
  }
}

describe('category service', () => {
  it('rejects a duplicate active name of the same kind', async () => {
    const repo = makeRepo({ findActiveByName: vi.fn().mockResolvedValue(makeCategory()) })
    const service = createCategoryService({ repo, isCategoryInUse: async () => false })
    await expect(service.create('user-1', { name: 'Lazer', kind: 'expense' })).rejects.toMatchObject({
      code: 'CATEGORY_NAME_IN_USE',
    })
  })

  it('creates a category when the name is free', async () => {
    const created = makeCategory({ name: 'Viagem' })
    const repo = makeRepo({
      findActiveByName: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(created),
    })
    const service = createCategoryService({ repo, isCategoryInUse: async () => false })
    const dto = await service.create('user-1', { name: 'Viagem', kind: 'expense' })
    expect(dto).toMatchObject({ name: 'Viagem', kind: 'expense', archived: false })
  })

  it('archives a category that is in use', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeCategory()) })
    const service = createCategoryService({ repo, isCategoryInUse: async () => true })
    await service.remove('user-1', 'cat-1')
    expect(repo.archive).toHaveBeenCalledWith('cat-1')
    expect(repo.hardDelete).not.toHaveBeenCalled()
  })

  it('hard-deletes a category that is not in use', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeCategory()) })
    const service = createCategoryService({ repo, isCategoryInUse: async () => false })
    await service.remove('user-1', 'cat-1')
    expect(repo.hardDelete).toHaveBeenCalledWith('cat-1')
    expect(repo.archive).not.toHaveBeenCalled()
  })

  it('404s when removing a category that does not exist', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(undefined) })
    const service = createCategoryService({ repo, isCategoryInUse: async () => false })
    await expect(service.remove('user-1', 'missing')).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    })
  })
})

import type { TransactionKind } from '../../shared/database/schema.js'
import type { CategoryRepository, NewCategoryInput } from './category.repository.js'

/** Default categories seeded for every new user at registration (0004 §5). */
export const DEFAULT_CATEGORIES: NewCategoryInput[] = [
  { name: 'Alimentação', kind: 'expense' },
  { name: 'Transporte', kind: 'expense' },
  { name: 'Moradia', kind: 'expense' },
  { name: 'Saúde', kind: 'expense' },
  { name: 'Educação', kind: 'expense' },
  { name: 'Lazer', kind: 'expense' },
  { name: 'Compras', kind: 'expense' },
  { name: 'Contas e Serviços', kind: 'expense' },
  { name: 'Outros', kind: 'expense' },
  { name: 'Salário', kind: 'income' },
  { name: 'Investimentos', kind: 'income' },
  { name: 'Outros', kind: 'income' },
] satisfies { name: string; kind: TransactionKind }[]

export function seedDefaultCategories(repo: CategoryRepository, userId: string): Promise<void> {
  return repo.insertMany(userId, DEFAULT_CATEGORIES)
}

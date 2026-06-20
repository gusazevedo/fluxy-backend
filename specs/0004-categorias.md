# 0004 — Categorias

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-06-20 |
| **Versão** | 1.0 |
| **Specs relacionadas** | [0001](./0001-visao-geral-do-produto.md), [0002](./0002-arquitetura-tecnica.md), [0003](./0003-autenticacao-e-contas.md) |

## 1. Contexto e Objetivo

Especificar as **categorias** que organizam as transações (RF-3 e RF-4 da 0001) e **definir o
mecanismo** que preserva a categoria nas transações ao excluí-la (RN-4/D3 da 0001, que delegou
a decisão a esta spec). Segue os padrões da 0002 (UUID, isolamento por usuário, TypeBox,
envelope de erro) e exige usuário autenticado (0003).

## 2. Escopo

- CRUD de categorias do usuário.
- **Tipo** da categoria: despesa ou receita (RN-2 da 0001).
- **Categorias padrão** criadas no cadastro do usuário (RF-4 da 0001).
- **Mecanismo de exclusão** que preserva o histórico (D3 da 0001).
- Modelo de dados, regras de unicidade e isolamento.

## 3. Fora de Escopo

- **Subcategorias / hierarquia** de categorias.
- **Compartilhamento** de categorias entre usuários.
- **Reordenação manual** / ordenação personalizada persistida.
- Regras de associação transação↔categoria (detalhadas na 0005), exceto a restrição de tipo.

## 4. Modelo de Dados

Convenções da 0002: UUID (PD-2), `timestamptz` (PD-6), isolamento por `user_id` (PD-3).

### `categories`
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users` (on delete cascade) |
| `name` | TEXT | Nome exibido |
| `kind` | ENUM | `expense` \| `income` |
| `archived_at` | timestamptz | Nulo = ativa; preenchido = arquivada (soft-delete) |
| `created_at` / `updated_at` | timestamptz | default `now()` |

Índices:
- **Unicidade:** índice único parcial em `(user_id, kind, lower(name))` **onde `archived_at IS NULL`**
  (categorias ativas).
- Índice em `(user_id)` para listagem.

## 5. Categorias Padrão (seed no cadastro)

No registro do usuário (0003), o sistema cria um conjunto padrão (proposta — *ver D2*):

- **Despesas:** Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Compras,
  Contas e Serviços, Outros.
- **Receitas:** Salário, Investimentos, Outros.

As categorias padrão são **categorias comuns do usuário** (sem status especial): podem ser
editadas e excluídas (*ver D3*).

## 6. Endpoints

Todas autenticadas e isoladas por usuário (PD-3). Erros no envelope `{ error: { code, message } }`.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/categories` | Lista categorias. Filtros: `?kind=expense\|income`, `?includeArchived=true` |
| POST | `/categories` | Cria categoria (`name`, `kind`) |
| GET | `/categories/:id` | Detalha uma categoria |
| PATCH | `/categories/:id` | Atualiza `name` |
| DELETE | `/categories/:id` | Remove (arquiva se usada; exclui se não usada) |

**Códigos de erro:** `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_IN_USE`, `CATEGORY_KIND_IMMUTABLE`,
`VALIDATION_ERROR`.

## 7. Regras de Exclusão (mecanismo da D3)

> Mecanismo confirmado (D4): **arquivar (soft-delete)**.

- Ao excluir uma categoria **sem transações associadas**, ela é **removida de fato** (*ver D1*).
- Ao excluir uma categoria **com transações associadas**, ela é **arquivada** (`archived_at`
  preenchido): some da lista ativa e deixa de ser oferecida para novas transações, **mas as
  transações existentes continuam vinculadas a ela** (relatórios/extratos seguem exibindo a
  categoria original — RN-4 da 0001).
- Renomear uma categoria reflete em todo o histórico (fonte única da verdade via FK).
- Alternativa descartada: **congelar o nome** da categoria na transação e excluí-la de fato —
  preterida por duplicar dados e quebrar agrupamentos por categoria após renomeações.

## 8. Requisitos Funcionais

- **RF-1** Criar categoria informando nome e tipo.
- **RF-2** Listar as categorias do usuário, com filtro por tipo e opção de incluir arquivadas.
- **RF-3** Detalhar uma categoria.
- **RF-4** Editar uma categoria (nome).
- **RF-5** Excluir uma categoria, preservando o histórico conforme §7.
- **RF-6** Novo usuário recebe as categorias padrão no cadastro.

## 9. Requisitos Não-Funcionais

- **RNF-1** Isolamento por usuário: nenhuma operação acessa categorias de outro usuário (PD-3).
- **RNF-2** Validação de entrada via TypeBox; respostas de erro no envelope padrão (PD-5).
- **RNF-3** Endpoints documentados no OpenAPI/Swagger (RNF-5 da 0001).

## 10. Regras de Negócio

- **RN-1** Nome único entre as categorias **ativas** do usuário, por **(usuário + tipo)**.
- **RN-2** O **tipo** (`kind`) é **imutável** após a criação.
- **RN-3** Exclusão segue §7 (usada → arquiva; não usada → exclui).
- **RN-4** Categoria arquivada não aparece na lista padrão nem é oferecida para novas transações.
- **RN-5** Uma transação só pode referenciar categoria **do mesmo tipo** (detalhe na 0005).
- **RN-6** Categorias padrão são categorias comuns (editáveis/excluíveis), sem proteção especial.

## 11. Critérios de Aceitação

- **CA-1** Criar, listar, detalhar, editar e excluir categorias funciona, isolado por usuário.
- **CA-2** Excluir uma categoria **usada** a remove da lista ativa, mas as transações dela
  continuam exibindo a categoria.
- **CA-3** Excluir uma categoria **não usada** a remove de fato.
- **CA-4** Não é possível ter duas categorias ativas com o mesmo nome e tipo.
- **CA-5** Um usuário recém-cadastrado já possui as categorias padrão.
- **CA-6** Não é possível alterar o `kind` de uma categoria existente.

## 12. Glossário

- **Categoria** Rótulo que agrupa transações, com um tipo (despesa/receita).
- **Categoria padrão** Categoria criada automaticamente no cadastro do usuário.
- **Categoria arquivada** Categoria excluída que foi preservada por ter transações associadas.
- **Tipo (`kind`)** Natureza da categoria: `expense` (despesa) ou `income` (receita).

## 13. Decisões e Questões em Aberto

### Defaults confirmados

- **D1 — Exclusão de categoria não usada:** excluída **de fato** (somente as usadas são arquivadas).
- **D2 — Lista de categorias padrão:** conforme §5 (ajustável).
- **D3 — Categorias padrão:** editáveis/excluíveis, sem status especial.

### Decisões confirmadas (Q1–Q4)

- **D4 (Q1) — Mecanismo:** **arquivar (soft-delete)**; categoria usada é arquivada e preservada
  nas transações.
- **D5 (Q2) — Campos visuais:** **apenas nome + tipo** (sem cor/ícone no MVP).
- **D6 (Q3) — Unicidade:** por **(usuário + tipo)** entre categorias ativas.
- **D7 (Q4) — Tipo:** **imutável** após a criação.

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20.

## 14. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md) (RN-4/D3, RF-3, RF-4)
- [0002 — Arquitetura Técnica](./0002-arquitetura-tecnica.md)
- [0003 — Autenticação & Contas](./0003-autenticacao-e-contas.md)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.

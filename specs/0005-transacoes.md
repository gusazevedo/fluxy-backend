# 0005 — Transações

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-06-20 |
| **Versão** | 1.0 |
| **Specs relacionadas** | [0001](./0001-visao-geral-do-produto.md), [0002](./0002-arquitetura-tecnica.md), [0003](./0003-autenticacao-e-contas.md), [0004](./0004-categorias.md) |

## 1. Contexto e Objetivo

Especificar as **transações** (despesas e receitas) — o núcleo do Fluxy (RF-5, RF-6, RF-7 da
0001). Define o modelo de dados, o contrato dos endpoints (CRUD, filtros e paginação), a
representação monetária e as regras de associação com **categorias** (0004). É a base para os
**relatórios** (0006).

## 2. Escopo

- CRUD de transações do usuário (criar, listar, detalhar, editar, excluir).
- **Valor** em centavos (PD-1) e **tipo** despesa/receita (RN-2 da 0001).
- **Associação a categoria** do mesmo tipo (RN-5 da 0004).
- **Filtros** por período, categoria e tipo, com **paginação** (RF-7 da 0001).
- Validações e regras de negócio das transações.

## 3. Fora de Escopo

- **Transações recorrentes/agendadas** (fora de escopo na 0001).
- **Anexos/comprovantes** (fora de escopo na 0001).
- **Importação** (CSV/Open Finance) (fora de escopo na 0001).
- **Relatórios/agregações** — especificados na 0006.
- **Busca textual** por descrição (pode virar iteração futura).

## 4. Modelo de Dados

Convenções da 0002: UUID (PD-2), centavos inteiros (PD-1), `timestamptz` (PD-6), isolamento por
`user_id` (PD-3).

### `transactions`
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users` (on delete cascade) |
| `category_id` | UUID | FK → `categories`. **NOT NULL** (obrigatória) |
| `amount_cents` | BIGINT | Inteiro **positivo** (magnitude); o sinal vem do `kind` |
| `kind` | ENUM | `expense` \| `income` |
| `description` | TEXT | Opcional (máx. 280 — *ver D4*) |
| `occurred_at` | DATE | Data do fato financeiro |
| `created_at` / `updated_at` | timestamptz | default `now()` |

Índices: `(user_id, occurred_at)`, `(user_id, category_id)`, `(user_id, kind)`.

> FK de categoria com `ON DELETE` restritivo: o app garante que categoria **usada** é
> **arquivada** (0004), nunca apagada — então a referência nunca fica órfã.

## 5. Representação Monetária

- Armazenamento: **centavos inteiros** (`amount_cents`), sempre **positivo**.
- API: **centavos inteiros** (`amountCents`), ex.: `1250` = R$ 12,50.
- O **tipo** (`kind`) determina o efeito no saldo: `income` soma, `expense` subtrai (0006).

## 6. Endpoints

Todas autenticadas e isoladas por usuário (PD-3). Erros no envelope `{ error: { code, message } }`.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/transactions` | Lista transações com filtros e paginação (ver abaixo) |
| POST | `/transactions` | Cria (`amountCents`, `kind`, `categoryId`, `occurredAt`, [`description`]) |
| GET | `/transactions/:id` | Detalha uma transação |
| PATCH | `/transactions/:id` | Atualiza campos (`amountCents`, `categoryId`, `kind`, `occurredAt`, `description`) |
| DELETE | `/transactions/:id` | Exclui de fato |

**GET `/transactions` — query params:**
- `from`, `to` (DATE): intervalo em `occurred_at`.
- `categoryId` (UUID), `kind` (`expense\|income`).
- `limit` (default **20**, máx **100**), `offset` (default **0**) — *ver D1*.
- Ordenação padrão: `occurred_at` **desc** (mais recentes primeiro).
- Resposta: `{ items: [...], page: { total, limit, offset } }`.

**Códigos de erro:** `TRANSACTION_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`,
`CATEGORY_ARCHIVED`, `INVALID_AMOUNT`, `VALIDATION_ERROR`.

## 7. Validações e Regras de Associação

- `amountCents` é **inteiro > 0** (senão `INVALID_AMOUNT`).
- `occurredAt` é uma data válida; **datas futuras são permitidas**.
- `description` opcional, até **280** caracteres (*D4*).
- **Ao criar:** `categoryId` deve referenciar categoria **do usuário**, **ativa** (não arquivada)
  e com `kind` **igual** ao da transação. Categoria arquivada ⇒ `CATEGORY_ARCHIVED`; tipo
  divergente ⇒ `CATEGORY_KIND_MISMATCH`.
- **Ao editar:** mesma regra de categoria; se o `kind` mudar, a categoria precisa corresponder
  ao novo tipo (*ver D2*).
- Transações já vinculadas a uma categoria que **veio a ser arquivada** permanecem válidas
  (não são alteradas).

## 8. Requisitos Funcionais

- **RF-1** Criar transação com valor, data, categoria, tipo e descrição opcional (RF-5 da 0001).
- **RF-2** Listar transações com filtros por período, categoria e tipo, paginadas (RF-7 da 0001).
- **RF-3** Detalhar uma transação.
- **RF-4** Editar uma transação (RF-6 / RN-6 da 0001).
- **RF-5** Excluir uma transação (RF-6 da 0001).

## 9. Requisitos Não-Funcionais

- **RNF-1** Isolamento por usuário (PD-3): nenhuma operação acessa transações de outro usuário.
- **RNF-2** Valor sempre em **centavos inteiros**, sem ponto flutuante (PD-1 / RNF-2 da 0001).
- **RNF-3** Validação via TypeBox; respostas de erro no envelope padrão (PD-5).
- **RNF-4** Paginação limita o tamanho das respostas de listagem.
- **RNF-5** Endpoints documentados no OpenAPI/Swagger (RNF-5 da 0001).

## 10. Regras de Negócio

- **RN-1** Toda transação pertence a um usuário (PD-3).
- **RN-2** `amountCents` é inteiro positivo; o `kind` define soma/subtração no saldo.
- **RN-3** A categoria associada deve ser **do mesmo tipo** da transação (RN-5 da 0004).
- **RN-4** Novas transações só usam categorias **ativas**; vínculos com categorias arquivadas
  são preservados.
- **RN-5** Transação é **excluída de fato** (sem soft-delete) — *ver D3*.
- **RN-6** Categoria é **obrigatória** (exatamente uma por transação), refinando a RN-1 da 0001.

## 11. Critérios de Aceitação

- **CA-1** Criar uma transação válida e recuperá-la depois.
- **CA-2** Listar transações filtrando por período, categoria e tipo, com paginação.
- **CA-3** Criar/editar com categoria de **tipo diferente** falha (`CATEGORY_KIND_MISMATCH`).
- **CA-4** Usar categoria de **outro usuário** ou **arquivada** (na criação) falha.
- **CA-5** Editar altera os campos; excluir remove a transação.
- **CA-6** Um usuário nunca vê/edita transações de outro (PD-3).

## 12. Glossário

- **Transação** Registro de uma despesa ou receita.
- **`amountCents`** Valor em centavos inteiros (magnitude positiva).
- **`occurredAt`** Data em que o fato financeiro ocorreu.
- **`kind`** Tipo da transação: `expense` (despesa) ou `income` (receita).

## 13. Decisões e Questões em Aberto

### Defaults confirmados

- **D1 — Paginação:** `offset`/`limit` (default 20, máx 100); ordenação por `occurred_at` desc.
- **D2 — Editar `kind`:** permitido, desde que a categoria corresponda ao novo tipo.
- **D3 — Exclusão:** hard delete (transações não têm soft-delete).
- **D4 — `description`:** opcional, até 280 caracteres.

### Decisões confirmadas (Q1–Q3)

- **D5 (Q1) — Categoria:** **obrigatória** (exatamente uma por transação).
- **D6 (Q2) — Valor na API:** **centavos inteiros** (`amountCents`).
- **D7 (Q3) — Data futura:** **permitida** (`occurredAt` aceita qualquer data válida).

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20.

## 14. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md) (RF-5/6/7, RN-1/2/3)
- [0002 — Arquitetura Técnica](./0002-arquitetura-tecnica.md) (PD-1 centavos)
- [0003 — Autenticação & Contas](./0003-autenticacao-e-contas.md)
- [0004 — Categorias](./0004-categorias.md) (RN-5 tipo, arquivamento)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.

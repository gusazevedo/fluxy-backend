# 0006 — Relatórios

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-06-20 |
| **Versão** | 1.0 |
| **Specs relacionadas** | [0001](./0001-visao-geral-do-produto.md), [0002](./0002-arquitetura-tecnica.md), [0003](./0003-autenticacao-e-contas.md), [0004](./0004-categorias.md), [0005](./0005-transacoes.md) |

## 1. Contexto e Objetivo

Especificar os **relatórios/resumos** do Fluxy (RF-8 da 0001), que dão ao usuário visibilidade
de para onde o dinheiro vai: **totais** de receita/despesa, **saldo** (RN-3 da 0001) e
**breakdown por categoria** em um período, mais a **evolução mês a mês** prevista na D5 da 0001.
São endpoints **read-only** que agregam sobre as transações (0005).

## 2. Escopo

- **Resumo por período:** totais de receita, despesa, saldo e contagem.
- **Breakdown por categoria** no período (incluindo categorias arquivadas com histórico).
- Definição das métricas, parâmetros de período e isolamento por usuário.

## 3. Fora de Escopo

- **Orçamentos/metas** e comparação realizado × planejado (fora de escopo na 0001).
- **Projeções/previsões** futuras.
- **Exportação** (CSV/PDF) dos relatórios.
- **Evolução mês a mês (timeline)** e granularidades diária/semanal — adiadas para iteração futura.
- Qualquer escrita de dados (estes endpoints são somente leitura).

## 4. Endpoints

Todas autenticadas e isoladas por usuário (PD-3). Valores em **centavos inteiros** (0005/D6).
Erros no envelope `{ error: { code, message } }` (PD-5).

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/reports/summary` | Totais (receita, despesa, saldo, contagem) + breakdown por categoria, no período |

### Exemplo — `GET /reports/summary?from=2026-06-01&to=2026-06-30`
```json
{
  "period": { "from": "2026-06-01", "to": "2026-06-30" },
  "totals": {
    "incomeCents": 500000,
    "expenseCents": 320000,
    "balanceCents": 180000,
    "transactionCount": 42
  },
  "byCategory": [
    { "categoryId": "…", "name": "Alimentação", "kind": "expense", "archived": false, "totalCents": 120000, "transactionCount": 18 },
    { "categoryId": "…", "name": "Salário", "kind": "income", "archived": false, "totalCents": 500000, "transactionCount": 1 }
  ]
}
```

## 5. Período e Parâmetros

- `from`, `to` (DATE): intervalo **inclusivo** sobre `occurred_at`.
- Quando omitidos: default = **mês corrente**.
- `from` não pode ser maior que `to` (senão `VALIDATION_ERROR`).

## 6. Métricas e Agregações

- **`incomeCents`** = soma de `amountCents` das transações `kind=income` no período.
- **`expenseCents`** = soma de `amountCents` das transações `kind=expense` no período.
- **`balanceCents`** = `incomeCents − expenseCents` (pode ser **negativo**) (RN-3 da 0001).
- **`transactionCount`** = nº de transações no período.
- **`byCategory`** = agregação por `category_id`; cada item traz `name`, `kind`, `archived`,
  `totalCents` e `transactionCount`. Inclui **categorias arquivadas** que tiveram transações no
  período (marcadas `archived: true`), preservando o histórico (0004).
- As agregações são feitas **no banco** (SQL), não em memória (*D3* / RNF-5).

## 7. Requisitos Funcionais

- **RF-1** Obter os totais (receita, despesa, saldo, contagem) de um período (RF-8/CA-4 da 0001).
- **RF-2** Obter o breakdown por categoria de um período (RF-8/CA-3 da 0001).

## 8. Requisitos Não-Funcionais

- **RNF-1** Isolamento por usuário (PD-3): agregações somente sobre os dados do próprio usuário.
- **RNF-2** Valores em **centavos inteiros** (PD-1).
- **RNF-3** Endpoints **read-only**; validação via TypeBox; envelope de erro (PD-5).
- **RNF-4** Documentados no OpenAPI/Swagger (RNF-5 da 0001).
- **RNF-5** Agregações eficientes no banco (sem carregar todas as transações em memória).

## 9. Regras de Negócio

- **RN-1** `balanceCents` = receitas − despesas no período (RN-3 da 0001).
- **RN-2** O breakdown inclui categorias **arquivadas** com transações no período, marcadas.
- **RN-3** O período filtra por `occurred_at` de forma **inclusiva** nas duas pontas.
- **RN-4** `from`/`to` omitidos ⇒ default **mês corrente**.

## 10. Critérios de Aceitação

- **CA-1** Para um período conhecido, os totais batem com a soma das transações.
- **CA-2** `balanceCents` = `incomeCents − expenseCents`, podendo ser negativo.
- **CA-3** O breakdown por categoria soma corretamente e inclui categorias **arquivadas** com
  transações no período.
- **CA-4** Agregações **não** contabilizam dados de outro usuário (PD-3).

## 11. Glossário

- **Resumo (summary)** Totais e breakdown de um período.
- **Saldo (balance)** Receitas menos despesas no período.
- **Breakdown por categoria** Soma agregada por categoria no período.

## 12. Decisões e Questões em Aberto

### Defaults confirmados

- **D1 — `byCategory`:** lista única com `kind` por item (o frontend separa despesa/receita);
  inclui arquivadas com `archived: true`.
- **D2 — Percentual por categoria:** **não** incluído no MVP (frontend calcula a partir dos totais).
- **D3 — Agregações:** executadas **no banco** (SQL).

### Decisões confirmadas (Q1–Q2)

- **D4 (Q1) — Timeline:** **fora do MVP** (`/reports/timeline` fica para iteração futura).
- **D5 (Q2) — Período:** `from`/`to` **opcionais**, com default = **mês corrente**.

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20.

## 13. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md) (RF-8, RN-3, D5)
- [0004 — Categorias](./0004-categorias.md) (arquivamento)
- [0005 — Transações](./0005-transacoes.md) (modelo, centavos)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.

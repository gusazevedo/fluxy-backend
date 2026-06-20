# Specs — Fonte da Verdade do Fluxy

Este diretório versiona **todas as especificações** do projeto. Conforme o
[CLAUDE.md](../CLAUDE.md), o Fluxy segue **SSD (System-Driven Development)**:

> Nenhuma implementação ocorre fora do escopo de uma especificação **aprovada**.
> Toda spec é criada e aprovada **antes** do desenvolvimento começar.

## Convenção de nomenclatura

```
specs/NNNN-titulo-em-kebab-case.md
```

- `NNNN` — número sequencial com 4 dígitos (`0001`, `0002`, ...), na ordem de criação.
- Toda spec segue o [TEMPLATE.md](./TEMPLATE.md).

## Ciclo de vida (status)

| Status | Significado |
|--------|-------------|
| `Rascunho` | Em elaboração, ainda não revisado. |
| `Em revisão` | Aguardando aprovação do desenvolvedor. |
| `Aprovada` | Fonte da verdade; libera o desenvolvimento do escopo descrito. |
| `Implementada` | Escopo entregue e coberto por testes. |
| `Substituída` | Sucedida por outra spec (referenciar a que a substitui). |

> Só specs com status **Aprovada** autorizam implementação.

## Índice

| # | Título | Status |
|---|--------|--------|
| [0001](./0001-visao-geral-do-produto.md) | Visão Geral do Produto | Aprovada |
| [0002](./0002-arquitetura-tecnica.md) | Arquitetura Técnica | Aprovada |
| [0003](./0003-autenticacao-e-contas.md) | Autenticação & Contas | Aprovada |
| [0004](./0004-categorias.md) | Categorias | Aprovada |
| [0005](./0005-transacoes.md) | Transações | Aprovada |
| [0006](./0006-relatorios.md) | Relatórios | Aprovada |

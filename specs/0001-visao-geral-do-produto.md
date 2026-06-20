# 0001 — Visão Geral do Produto

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-06-20 |
| **Versão** | 1.0 |
| **Specs relacionadas** | (a criar: Arquitetura, Autenticação & Contas, Categorias, Transações, Relatórios) |

## 1. Contexto e Objetivo

O **Fluxy** é uma **API REST** que serve de backend para um **web app de controle de
finanças pessoais**. O objetivo é ajudar o usuário a **entender e controlar seus gastos**,
registrando suas movimentações financeiras do dia a dia organizadas por **categorias**
(ex.: alimentação, transporte, saúde, lazer) e oferecendo **resumos** que mostrem para onde
o dinheiro está indo, por categoria e por período.

Esta spec define o **produto em alto nível** (escopo, funcionalidades e termos) e serve de
fonte da verdade que orienta as demais specs (arquitetura e cada feature).

## 2. Escopo

Funcionalidades de alto nível previstas para o produto:

- **Conta de usuário**: o usuário cria uma conta e autentica para acessar seus próprios dados.
- **Categorias**: organização das movimentações em categorias; conjunto de categorias padrão
  disponível ao novo usuário.
- **Transações**: registro de movimentações (despesas e receitas) com valor, data,
  categoria e descrição.
- **Consultas**: listagem das transações com filtros (período, categoria, tipo).
- **Relatórios/Resumos**: totais por período e por categoria, e saldo do período.

> Os detalhes de cada item serão tratados em specs próprias. Esta spec apenas delimita o
> produto.

## 3. Fora de Escopo

Não fazem parte do produto neste momento (podem virar specs futuras):

- Transações **recorrentes/agendadas**.
- **Orçamentos** e **metas** por categoria.
- **Múltiplas carteiras/contas** (corrente, poupança, cartão).
- **Importação automática** (Open Finance, extratos bancários, CSV) e sincronização bancária.
- **Multi-moeda** (todos os valores em BRL).
- **Compartilhamento/colaboração** entre usuários.
- **Anexos/comprovantes** em transações.
- **App mobile nativo** e qualquer camada de frontend (o produto é a API).

## 4. Requisitos Funcionais

> Alto nível; cada um será detalhado na spec da feature correspondente.

- **RF-1** O sistema permite que uma pessoa **crie uma conta** e **autentique**.
- **RF-2** Cada usuário acessa **somente os próprios dados**.
- **RF-3** O usuário pode **criar, listar, editar e remover categorias**.
- **RF-4** Um novo usuário recebe um conjunto de **categorias padrão**.
- **RF-5** O usuário pode **registrar uma transação** informando valor, data, categoria,
  tipo e descrição.
- **RF-6** O usuário pode **listar, editar e remover** suas transações.
- **RF-7** O usuário pode **filtrar** transações por período, categoria e tipo.
- **RF-8** O sistema fornece **resumos**: total por período, total por categoria e saldo.

## 5. Requisitos Não-Funcionais

- **RNF-1 (Privacidade/Isolamento)** Os dados de um usuário nunca são acessíveis por outro.
- **RNF-2 (Precisão monetária)** Valores monetários são tratados sem erro de arredondamento.
- **RNF-3 (Custo/Operação)** O produto deve poder ser operado a baixo custo (deploy serverless
  na AWS — detalhado na spec de Arquitetura).
- **RNF-4 (Qualidade)** Toda implementação acompanha testes unitários e de integração, com
  lint obedecido (conforme CLAUDE.md).
- **RNF-5 (Documentação da API)** A API expõe documentação navegável (ex.: OpenAPI/Swagger).

## 6. Regras de Negócio

- **RN-1** Toda transação pertence a **um** usuário e (no máximo) **uma** categoria.
- **RN-2** Categorias e transações têm um **tipo**: despesa ou receita.
- **RN-3** O **saldo** de um período = soma das receitas − soma das despesas no período.
- **RN-4** Ao **excluir uma categoria** já usada, as transações existentes **preservam a
  categoria** (a associação é mantida), para que relatórios e extratos históricos continuem
  exibindo a categoria original. A categoria deixa de ser oferecida para novas transações.
- **RN-5** Todos os valores monetários estão em **BRL** (moeda única).
- **RN-6** Transações podem ser **editadas** após criadas.

## 7. Critérios de Aceitação

- **CA-1** Um usuário autenticado consegue registrar uma despesa e recuperá-la depois.
- **CA-2** Um usuário **não** consegue ver dados de outro usuário.
- **CA-3** É possível obter o total gasto por categoria em um intervalo de datas.
- **CA-4** É possível obter o saldo (receitas − despesas) de um intervalo de datas.

> Critérios detalhados e testáveis serão definidos nas specs de cada feature.

## 8. Glossário

- **Transação**: um registro de movimentação financeira (uma despesa ou uma receita).
- **Despesa**: transação que reduz o saldo (saída de dinheiro).
- **Receita**: transação que aumenta o saldo (entrada de dinheiro).
- **Categoria**: rótulo que agrupa transações (ex.: alimentação, transporte).
- **Saldo**: receitas menos despesas em um período.
- **Período**: intervalo de datas usado em consultas e relatórios.

## 9. Decisões e Questões em Aberto

### Decisões confirmadas

- **D1 (Q2) — Receitas:** o produto controla **despesas e receitas**, habilitando saldo.
- **D2 (Q1) — Moeda:** **moeda única (BRL)**; multi-moeda fora de escopo.
- **D3 (Q4) — Exclusão de categoria:** as transações existentes **preservam a categoria** (não
  ficam "sem categoria"), mantendo relatórios/extratos históricos coerentes; a categoria apenas
  deixa de ser oferecida para novas transações. O **mecanismo** (arquivar a categoria vs.
  congelar o nome na transação) será definido na spec de Categorias/Transações.
- **D4 (Q5) — Carteiras:** **sem** conceito de carteiras/contas; transações ficam direto no
  usuário.

- **D5 (Q3) — Relatórios:** os resumos cobrem **total por categoria**, **total por período** e
  **saldo**; recortes adicionais (ex.: evolução mês a mês) serão detalhados na spec de Relatórios.
- **D6 (Q6) — Edição de transações:** transações **podem ser editadas** após criadas.

> Todas as questões foram resolvidas. Spec **Aprovada** em 2026-06-20.

## 10. Referências

- [CLAUDE.md](../CLAUDE.md) — diretrizes de desenvolvimento (SSD, testes, lint).
- [specs/README.md](./README.md) — convenção e índice das specs.

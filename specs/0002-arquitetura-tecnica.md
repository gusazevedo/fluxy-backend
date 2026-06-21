# 0002 — Arquitetura Técnica

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-06-21 |
| **Versão** | 1.1 |
| **Specs relacionadas** | [0001](./0001-visao-geral-do-produto.md) |

## 1. Contexto e Objetivo

Definir a arquitetura técnica que sustenta o produto descrito na [0001](./0001-visao-geral-do-produto.md):
uma **API REST** de finanças pessoais, com **deploy serverless de baixo custo na AWS**
(RNF-3), **isolamento de dados por usuário** (RNF-1), **precisão monetária** (RNF-2),
**qualidade com testes e lint** (RNF-4) e **documentação navegável da API** (RNF-5).

Esta spec fixa o "como" técnico (runtime, framework, banco, deploy, padrões) **antes** das
specs de feature. Decisões de contrato/endpoints e modelo de dados de cada feature ficam nas
specs próprias (0003+).

> Observação: o scaffolding atual do repositório (incl. Supabase no `package.json`) é herança
> do reset e será **reconciliado/removido** durante a implementação, conforme estas decisões.

## 2. Escopo

- Topologia de **compute** e **borda** (Lambda + API Gateway).
- **Framework HTTP** e camada de **validação/documentação**.
- **Banco de dados** e **estratégia de acesso a dados** (runtime e dev local).
- **Rede** (VPC) e seu impacto em custo.
- **Mecanismo de autenticação** e **hash de senha** (cross-cutting; fluxos detalhados na 0003).
- **E-mail transacional**.
- **Gestão de segredos**.
- **IaC/Deploy** e **migrações de banco**.
- **Estrutura de pastas** e **padrões/convenções** de projeto.
- **Estratégia de testes** e **observabilidade**.
- **Modelo de custo** em repouso.

## 3. Fora de Escopo

- Contratos de endpoints e **modelo de dados por feature** (specs 0003+).
- **Frontend**/web app.
- Detalhes finos de **pipeline CI/CD** (ver Q4) e de **tracing distribuído** (X-Ray).
- Tópicos já fora de escopo do produto na 0001 (multi-moeda, carteiras, importação, etc.).

## 4. Decisões de Arquitetura

| # | Área | Decisão | Justificativa |
|---|------|---------|---------------|
| AD-1 | Linguagem/Runtime | **TypeScript** em **Node.js 22 (ESM)**, Lambda **arm64** | Tipagem forte; arm64 mais barato/eficiente |
| AD-2 | Compute | **AWS Lambda** | Serverless, escala a zero, free tier cobre o início |
| AD-3 | Borda/API | **API Gateway HTTP API** com proxy `ANY /{proxy+}` | HTTP API é mais barato que REST API |
| AD-4 | Topologia | **Monólito modular** rodando o app Fastify inteiro **num único Lambda** | Simplicidade e custo no MVP; divisível depois |
| AD-5 | Framework HTTP | **Fastify v5** + **@fastify/aws-lambda** | Mesmo app roda local (servidor) e no Lambda (handler) |
| AD-6 | Validação & Docs | **TypeBox** (`@fastify/type-provider-typebox`) + **@fastify/swagger(-ui)** | Schema único = validação em runtime + OpenAPI automático (RNF-5) |
| AD-7 | Banco | **Neon (PostgreSQL serverless)**, scale-to-zero | Postgres serverless com free tier que cobre o MVP (~US$0); escala a zero em repouso (RNF-3). Revisado da v1.0 (era Aurora Serverless v2 — bloqueado no AWS Free plan e mais caro no uso ativo). |
| AD-8 | Acesso a dados | **Driver HTTP do Neon** (`drizzle-orm/neon-http` + `@neondatabase/serverless`) nos stages; **Postgres local (Docker)** via `postgres.js` no dev | Sem pool de conexões persistentes; **Lambda fora da VPC** (ver AD-9). Connection string lida do SSM no cold start (AD-13). |
| AD-9 | Rede | **Sem VPC.** O Lambda fica fora da VPC e fala com o Neon por **HTTPS** (Data API do Neon) | Evita **NAT Gateway (~$32/mês)** e ENI cold start; Lambda mantém internet (Resend) e alcança o Neon. Revisado da v1.0 (não há mais VPC/subnets/SG só para o banco). |
| AD-10 | Autenticação | **JWT próprio** (`@fastify/jwt`): access token curto + **refresh token rotativo** (hasheado no banco). Detalhes na 0003 | Controle total; offload de complexidade evitado por libs maduras |
| AD-11 | Hash de senha | **Argon2id** via `@node-rs/argon2` | Padrão atual recomendado; binário pré-compilado (sem dor de build no Lambda) |
| AD-12 | E-mail | **Resend** (transacional: verificação e reset) | Simples; alcançável pelo Lambda fora da VPC |
| AD-13 | Segredos | **SSM Parameter Store (SecureString)** para a connection string do Neon, a chave JWT e a key do Resend, lidos/cacheados no cold start | SSM é gratuito; sem Secrets Manager (não há mais credencial gerenciada de Aurora). Revisado da v1.0. |
| AD-14 | IaC/Deploy | **AWS SAM** (`template.yaml`), build/bundle via **esbuild** | Ferramenta oficial AWS; reproduzível |
| AD-15 | Migrações | **Drizzle Kit**: `generate` local; aplicação remota via **connection string direta (unpooled) do Neon** pós-deploy | Sem Lambda de migração; mesma origem de schema. Revisado da v1.0 (era via Data API). |
| AD-16 | Testes | **Vitest** — unit (com mocks) + integração (**pglite** + migrations Drizzle) | Integração com Postgres em memória, sem Docker (RNF-4) |
| AD-17 | Observabilidade | **Logs estruturados** (pino via Fastify) → **CloudWatch** | Padrão Lambda, custo baixo |

### 4.1 Parâmetros de ambiente

- **Região:** `us-east-1`.
- **Stages:** `dev` + `prod` (parametrizados no `samconfig.toml`).
- **Exposição:** URL gerada pelo API Gateway (sem domínio customizado no MVP).
- **Deploy:** manual via SAM CLI (`sam build && sam deploy`).

## 5. Requisitos Não-Funcionais (como a arquitetura atende a 0001)

- **RNF-1 (Isolamento)** Todo acesso a dados filtra pelo `user_id` extraído do JWT; nenhum
  endpoint retorna dados de outro usuário (ver PD-3).
- **RNF-2 (Precisão monetária)** Valores em **inteiro de centavos** (ver PD-1), sem ponto
  flutuante.
- **RNF-3 (Custo)** Lambda (free tier), Neon serverless com scale-to-zero (free tier cobre o
  MVP), SSM gratuito, **sem Secrets Manager** e **sem NAT/VPC**. Estimativa para o MVP **≈ US$ 0/mês**.
- **RNF-4 (Qualidade)** Testes unitários + integração (AD-16) e lint obrigatório (CLAUDE.md).
- **RNF-5 (Docs)** OpenAPI gerado dos schemas (AD-6), Swagger UI em `/docs`.
- **Segurança** HTTPS na borda; `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`;
  IAM de **menor privilégio** (apenas `ssm:GetParameter*` nos params da app — a connection string
  do Neon trafega por HTTPS, não por IAM).
- **Cold start / latência** arm64 + bundle enxuto; o driver HTTP do Neon dispensa ENI de VPC.
  Após ociosidade, o Neon leva alguns segundos para retomar do scale-to-zero (tradeoff aceito
  para um app pessoal).

## 6. Padrões e Convenções de Projeto

Estrutura de pastas (monólito modular):

```
src/
  app.ts            # buildApp(): instância Fastify (plugins + rotas)
  server.ts         # entry do dev local (listen)
  lambda.ts         # handler do Lambda (adapter)
  shared/           # config, database (schema/client/migrations), plugins, errors, secrets
  modules/          # auth, users, categories, transactions, reports
  email/            # client Resend + templates
template.yaml       # infraestrutura (SAM)
```

- **PD-1 (Dinheiro)** Armazenar valores como **inteiro de centavos**; nunca `float`.
- **PD-2 (IDs)** Chaves primárias **UUID**.
- **PD-3 (Isolamento)** Toda query de dados do usuário inclui o filtro por `user_id` do token.
- **PD-4 (Camadas por módulo)** `routes` (schema TypeBox) → `service` (regra de negócio) →
  `repository` (Drizzle).
- **PD-5 (Envelope de erro)** Respostas de erro no formato `{ error: { code, message } }`.
- **PD-6 (Datas)** Timestamps com timezone (`timestamptz`).

## 7. Critérios de Aceitação

- **CA-1** O mesmo app Fastify sobe localmente (`server.ts`) e responde via Lambda+HTTP API.
- **CA-2** A API expõe OpenAPI/Swagger em `/docs`.
- **CA-3** O Lambda acessa o banco **sem estar na VPC** (via driver HTTP do Neon) e consegue
  chamar o Resend (internet) — sem NAT Gateway nem VPC no stack.
- **CA-4** Migrações são geradas pelo Drizzle Kit e aplicáveis local (Postgres) e remoto (Neon).
- **CA-5** Suíte de testes roda unit + integração (pglite) sem depender de infraestrutura externa.
- **CA-6** Em repouso, o stack AWS não possui recursos de custo fixo relevante (o banco fica no
  Neon, em scale-to-zero); o stack guarda apenas o Lambda, o HTTP API e os params no SSM.

## 8. Glossário

- **Neon** Provedor de PostgreSQL serverless (externo à AWS) com scale-to-zero e driver HTTP.
- **Driver HTTP do Neon** (`@neondatabase/serverless`) Executa SQL no Neon por HTTPS, sem
  conexões TCP persistentes — adequado a Lambda fora da VPC.
- **Connection string (unpooled)** String de conexão direta do Neon (sem pooler), usada pelas
  migrações; o app usa a string com o driver HTTP.
- **NAT Gateway** Recurso que dá saída à internet para sub-redes privadas (custo fixo relevante).
- **Cold start** Latência da primeira execução de um container Lambda novo.
- **IaC** Infraestrutura como código.
- **ADR / PD** Decisão de arquitetura / Padrão de projeto.

## 9. Decisões e Questões em Aberto

### Defaults confirmados

- **D1 — Migrações remotas:** via Drizzle Kit + Data API pós-deploy (AD-15), **sem** Lambda de
  migração.
- **D2 — Rate limiting:** in-memory por container no MVP (limite global estrito fica para depois).
- **D3 — Observabilidade:** apenas logs no CloudWatch no MVP (sem X-Ray/tracing).

### Decisões confirmadas (Q1–Q4)

- **D4 (Q1) — Região:** **us-east-1**.
- **D5 (Q2) — Ambientes:** **dev + prod**.
- **D6 (Q3) — Exposição:** **URL do API Gateway** no MVP; domínio próprio fica para depois.
- **D7 (Q4) — Deploy:** **manual via SAM CLI** no MVP; pipeline CI/CD vira spec futura.

### Revisão v1.1 (2026-06-21) — Banco: Aurora → Neon

Na primeira tentativa de deploy, a conta AWS (no **Free plan**) bloqueou a criação de clusters
Aurora. Reavaliadas as alternativas, optou-se por **Neon (Postgres serverless)**: free tier
cobre o MVP (~US$0), mantém Postgres + Drizzle (schema/migrations/testes intactos) e **elimina
VPC, Secrets Manager e o NAT-free workaround**, simplificando o stack. Decisões afetadas:
**AD-7, AD-8, AD-9, AD-13, AD-15** e os requisitos **RNF-3, CA-3, CA-4, CA-6**.

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20; **revisada (v1.1)** em 2026-06-21.

## 10. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.
- [specs/README.md](./README.md) — convenção e índice.

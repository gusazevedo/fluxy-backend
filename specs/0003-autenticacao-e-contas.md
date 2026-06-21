# 0003 — Autenticação & Contas

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-06-21 |
| **Versão** | 1.2 |
| **Specs relacionadas** | [0001](./0001-visao-geral-do-produto.md), [0002](./0002-arquitetura-tecnica.md) |

## 1. Contexto e Objetivo

Especificar **contas de usuário** e **autenticação** do Fluxy (RF-1, RF-2 da 0001), usando o
mecanismo definido na 0002: **JWT próprio** (AD-10), **Argon2id** (AD-11), **Resend** (AD-12)
e **chave JWT no SSM** (AD-13). É a base que habilita as demais features, pois todo dado é
isolado por usuário (PD-3).

## 2. Escopo

- Cadastro de conta com **e-mail + senha**.
- **Verificação de e-mail** (envio e confirmação).
- **Login** e emissão de tokens.
- **Renovação** (refresh) e **logout** (revogação de sessão).
- **Recuperação de senha** (esqueci / redefinir).
- **Troca de senha** autenticada.
- Consulta da **conta atual** (`GET /me`).
- Modelo de dados de contas e tokens; padrões de segurança.

## 3. Fora de Escopo

- **Login social/OAuth** (Google, Apple, etc.).
- **MFA / 2FA**.
- **Gerenciamento de múltiplas sessões** (listar/revogar dispositivos individualmente).
- **Papéis/permissões** (RBAC) — o sistema tem um único tipo de usuário.
- Edição de perfil além de **nome** e senha (não há outros campos de perfil no MVP).
- **Exclusão de conta** (`DELETE /me`) — adiada para iteração futura.

## 4. Modelo de Dados

Convenções da 0002: UUID (PD-2), `timestamptz` (PD-6).

### `users`
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `name` | TEXT | Nome de exibição (obrigatório, 1–80 caracteres) |
| `email` | TEXT | Único, armazenado em **minúsculas** (unicidade case-insensitive) |
| `password_hash` | TEXT | **Argon2id** (AD-11) |
| `email_verified` | BOOLEAN | default `false` |
| `created_at` / `updated_at` | timestamptz | default `now()` |

### `refresh_tokens` (sessões)
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users` (on delete cascade) |
| `token_hash` | TEXT | **Hash** do refresh token (nunca o valor cru) |
| `expires_at` | timestamptz | |
| `revoked_at` | timestamptz | nulo enquanto válido |
| `created_at` | timestamptz | default `now()` |

### `auth_tokens` (verificação de e-mail e reset de senha)
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users` (on delete cascade) |
| `token_hash` | TEXT | **Hash** do token enviado por e-mail |
| `type` | ENUM | `email_verify` \| `password_reset` |
| `expires_at` | timestamptz | |
| `used_at` | timestamptz | marca uso único |
| `created_at` | timestamptz | default `now()` |

> Tokens de alta entropia (refresh, verificação, reset) são guardados como **hash SHA-256**
> (rápido e suficiente para segredos aleatórios). **Argon2id** é usado apenas para **senhas**.

## 5. Endpoints

Prefixo `/auth` (exceto `/me`). Erros seguem o envelope `{ error: { code, message } }` (PD-5).

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/auth/register` | público | Cria conta (com **nome**) e dispara e-mail de verificação |
| POST | `/auth/verify-email` | público | Confirma o e-mail via token |
| POST | `/auth/verify-email/resend` | público | Reenvia o e-mail de verificação |
| POST | `/auth/login` | público | Autentica e emite tokens |
| POST | `/auth/refresh` | refresh token | Rotaciona o par de tokens |
| POST | `/auth/logout` | refresh token | Revoga a sessão atual |
| POST | `/auth/forgot-password` | público | Inicia o reset (envia e-mail) |
| POST | `/auth/reset-password` | público | Define nova senha via token |
| POST | `/auth/change-password` | autenticado | Troca a senha sabendo a atual |
| GET | `/me` | autenticado | Dados da conta atual |
| PATCH | `/me` | autenticado | Atualiza o **nome** da conta |

**Códigos de erro** (exemplos): `EMAIL_IN_USE`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`,
`WEAK_PASSWORD`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_USED`, `UNAUTHORIZED`.

## 6. Estratégia de Tokens e Sessões

- **Access token** — JWT assinado (HS256) com a chave do SSM. TTL curto (**default 15min**).
  Claims mínimas: `sub` (id do usuário), `iat`, `exp`. Enviado em `Authorization: Bearer <token>`.
- **Refresh token** — string **opaca** aleatória (alta entropia), guardada **hasheada** em
  `refresh_tokens`. TTL longo (**default 30 dias**). **Rotação**: a cada `/auth/refresh`, o
  token usado é revogado e um novo par é emitido. **Reuso** de um refresh já rotacionado/revogado
  é tratado como suspeito (revoga a sessão).
- **Logout** revoga o refresh token corrente.
- **Entrega do refresh token**: retornado **no corpo da resposta** (JSON), guardado pelo web
  app. Cookie httpOnly só será viável com domínio próprio same-site (fora do MVP).
- **Tokens de e-mail** — verificação: TTL **default 24h**; reset: TTL **default 1h**; ambos de
  **uso único** (`used_at`).

## 7. Fluxos Principais

1. **Cadastro + verificação:** `register` cria o usuário (`email_verified=false`), gera token
   `email_verify`, envia link `APP_URL/verify-email?token=…` via Resend. O web app submete o
   token em `verify-email`, que marca o e-mail como verificado.
2. **Login:** valida senha (Argon2id) e **exige e-mail verificado** — se não verificado,
   retorna `EMAIL_NOT_VERIFIED`. Em sucesso, emite access + refresh.
3. **Refresh:** valida o refresh token, rotaciona e devolve novo par.
4. **Esqueci a senha:** `forgot-password` **sempre** responde 200 genérico (não revela se o
   e-mail existe); se existir, gera token `password_reset` e envia link via Resend.
5. **Redefinir senha:** `reset-password` valida o token, grava o novo hash, marca o token como
   usado e **revoga todas as sessões** (refresh tokens) do usuário.
6. **Trocar senha:** `change-password` exige a senha atual; ao trocar, **revoga todas as
   sessões** (refresh tokens) do usuário, que refaz login. (O endpoint é autenticado pelo
   access token, que não identifica a sessão atual, então a revogação é total — igual ao reset.)

## 8. Requisitos Funcionais

- **RF-1** Usuário cria conta com e-mail único e senha válida.
- **RF-2** Sistema envia e-mail de verificação no cadastro e permite reenviar.
- **RF-3** Usuário confirma o e-mail via token de uso único e expirável.
- **RF-4** Usuário **com e-mail verificado** autentica com e-mail e senha e recebe access + refresh tokens.
- **RF-5** Usuário renova os tokens via refresh (com rotação) e faz logout (revogação).
- **RF-6** Usuário solicita recuperação de senha e redefine via token enviado por e-mail.
- **RF-7** Usuário autenticado troca a própria senha informando a atual.
- **RF-8** Usuário autenticado consulta os dados da própria conta (`GET /me`).

## 9. Requisitos Não-Funcionais e Segurança

- **RNF-1** Senhas com **Argon2id**; nunca em texto puro; nunca retornadas.
- **RNF-2** Refresh/verify/reset guardados como **hash**; valor cru só trafega uma vez.
- **RNF-3** `forgot-password` e `register` **não revelam** existência de e-mail (respostas
  genéricas / mesmo tempo de resposta na medida do possível).
- **RNF-4** Endpoints de `login`, `forgot-password` e `reset-password` são **rate-limited**
  (AD/D2 da 0002).
- **RNF-5** Comparações de token/senha **timing-safe**.
- **RNF-6** Chave JWT vinda do **SSM** (AD-13); rotação de chave não quebra tokens já emitidos
  além do TTL do access.
- **RNF-7** Toda a comunicação via **HTTPS** (borda API Gateway).

## 10. Regras de Negócio

- **RN-1** E-mail é **único** (case-insensitive).
- **RN-2** Política de senha: **mínimo 8 caracteres**, sem complexidade obrigatória (orientação NIST).
- **RN-3** Token expirado/usado/inválido ⇒ erro específico, sem efeito colateral.
- **RN-4** Reset e troca de senha **revogam sessões** (refresh tokens) existentes.
- **RN-5** Login só é permitido com **e-mail verificado**; caso contrário, `EMAIL_NOT_VERIFIED`.

## 11. Critérios de Aceitação

- **CA-1** Não é possível cadastrar dois usuários com o mesmo e-mail (case-insensitive).
- **CA-2** Após `register`, um e-mail de verificação é disparado; o token confirma o e-mail.
- **CA-3** Login com credenciais corretas retorna access + refresh; com incorretas, `INVALID_CREDENTIALS`.
- **CA-4** Um access token expirado é rejeitado; o refresh gera um novo par e **invalida** o refresh anterior.
- **CA-5** `forgot-password` responde igual para e-mail existente e inexistente.
- **CA-6** Após `reset-password`, os refresh tokens antigos deixam de funcionar.
- **CA-7** `GET /me` só retorna dados do próprio usuário autenticado (PD-3).

## 12. Glossário

- **Access token** Credencial curta (JWT) enviada a cada requisição autenticada.
- **Refresh token** Credencial longa e opaca usada para obter novos access tokens.
- **Rotação** Substituição do refresh token a cada uso, invalidando o anterior.
- **Sessão** Vínculo representado por um refresh token válido.
- **Token de uso único** Token de verificação/reset válido até ser usado ou expirar.

## 13. Decisões e Questões em Aberto

### Defaults confirmados

- **D1 — TTLs:** access **15min**, refresh **30 dias**, verificação **24h**, reset **1h**.
- **D2 — Hash de tokens:** SHA-256 para tokens de alta entropia; Argon2id para senhas.
- **D3 — `change-password` no MVP:** incluído.

### Decisões confirmadas (Q1–Q4)

- **D4 (Q1) — Verificação:** login **exige e-mail verificado** (`EMAIL_NOT_VERIFIED` caso contrário).
- **D5 (Q2) — Refresh token:** entregue **no corpo da resposta**; cookie httpOnly fica para
  quando houver domínio próprio same-site.
- **D6 (Q3) — Exclusão de conta:** **fora do MVP** (iteração futura).
- **D7 (Q4) — Senha:** **mínimo 8 caracteres**, sem complexidade obrigatória.

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20.

## 14. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md)
- [0002 — Arquitetura Técnica](./0002-arquitetura-tecnica.md)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.

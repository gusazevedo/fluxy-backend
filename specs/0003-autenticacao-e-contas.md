# 0003 — Autenticação & Contas

| Campo | Valor |
|-------|-------|
| **Status** | Aprovada |
| **Autor** | Gustavo Azevedo |
| **Criada em** | 2026-06-20 |
| **Atualizada em** | 2026-07-26 |
| **Versão** | 2.0 |
| **Specs relacionadas** | [0001](./0001-visao-geral-do-produto.md), [0002](./0002-arquitetura-tecnica.md) |

## 1. Contexto e Objetivo

Especificar **contas de usuário** e **autenticação** do Fluxy (RF-1, RF-2 da 0001), usando o
mecanismo definido na 0002: **JWT próprio** (AD-10), **Argon2id** (AD-11), **Resend** (AD-12)
e **chave JWT no SSM** (AD-13). É a base que habilita as demais features, pois todo dado é
isolado por usuário (PD-3).

## 2. Escopo

- Cadastro de conta em **três etapas**, começando pela **verificação do e-mail** (D8).
- **Verificação de e-mail** (envio e confirmação) **antes** da criação da conta.
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
- Edição de perfil além de e-mail/senha (não há outros campos de perfil no MVP).
- **Exclusão de conta** (`DELETE /me`) — adiada para iteração futura.

## 4. Modelo de Dados

Convenções da 0002: UUID (PD-2), `timestamptz` (PD-6).

### `users`
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
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

### `auth_tokens` (reset de senha)
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users` (on delete cascade) |
| `token_hash` | TEXT | **Hash** do token enviado por e-mail |
| `type` | ENUM | `email_verify` \| `password_reset` |
| `expires_at` | timestamptz | |
| `used_at` | timestamptz | marca uso único |
| `attempts` | integer | tentativas erradas (default `0`) |
| `created_at` | timestamptz | default `now()` |

> A partir da v2.0 esta tabela serve **apenas** a `password_reset`: a verificação de e-mail
> acontece antes de existir usuário e mora em `signup_verifications`. O valor `email_verify`
> permanece no enum do Postgres por custo de migration, sem uso pela aplicação.

### `signup_verifications` (cadastro em andamento)

Uma linha por e-mail com cadastro pendente. Recomeçar o cadastro **atualiza** a linha existente
(novo código, `attempts` zerado, nova expiração), em vez de acumular registros.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `email` | TEXT | **Único**, armazenado em minúsculas |
| `otp_hash` | TEXT | **Hash** do código OTP de 6 dígitos |
| `attempts` | integer | tentativas erradas do OTP (default `0`); trava o código no limite |
| `expires_at` | timestamptz | validade do OTP |
| `verified_at` | timestamptz | nulo até o OTP conferir |
| `signup_token_hash` | TEXT | **Hash** do token de conclusão; nulo até a verificação |
| `signup_token_expires_at` | timestamptz | nulo até a verificação |
| `consumed_at` | timestamptz | marcado quando a conta é criada; encerra o registro |
| `created_at` / `updated_at` | timestamptz | default `now()` |

> Tokens de alta entropia (refresh, reset, signup) e o código de verificação são guardados como
> **hash SHA-256** (rápido e suficiente para segredos aleatórios). **Argon2id** é usado apenas
> para **senhas**.

## 5. Endpoints

Prefixo `/auth` (exceto `/me`). Erros seguem o envelope `{ error: { code, message } }` (PD-5).

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/auth/signup/start` | público | Inicia o cadastro por `{ email }` e envia o OTP; reenviar é chamar de novo |
| POST | `/auth/signup/verify` | público | Confere `{ email, code }` e devolve o `signupToken` |
| POST | `/auth/signup/complete` | público | Cria a conta com nome e senha, mediante `signupToken` |
| POST | `/auth/login` | público | Autentica e emite tokens |
| POST | `/auth/refresh` | refresh token | Rotaciona o par de tokens |
| POST | `/auth/logout` | refresh token | Revoga a sessão atual |
| POST | `/auth/forgot-password` | público | Inicia o reset (envia e-mail) |
| POST | `/auth/reset-password` | público | Define nova senha via token |
| POST | `/auth/change-password` | autenticado | Troca a senha sabendo a atual |
| GET | `/me` | autenticado | Dados da conta atual |

### Contratos do cadastro

```
POST /auth/signup/start     { email }
  → 202 { message }                    genérico (RNF-3)

POST /auth/signup/verify    { email, code }
  → 200 { signupToken, expiresIn }     token cru devolvido uma única vez

POST /auth/signup/complete  { signupToken, firstName, lastName, password, passwordConfirmation }
  → 201 { accessToken, refreshToken, tokenType, expiresIn }
```

**Códigos de erro** (exemplos): `EMAIL_IN_USE`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`,
`WEAK_PASSWORD`, `PASSWORD_MISMATCH`, `OTP_INVALID`, `OTP_EXPIRED`, `SIGNUP_TOKEN_INVALID`,
`SIGNUP_TOKEN_EXPIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_USED`, `UNAUTHORIZED`.

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
- **Tokens de e-mail** — verificação de cadastro: **código OTP de 6 dígitos**, TTL **default 5min**,
  com **limite de tentativas** (`attempts`, default 5) e **reenvio** com cooldown (default 60s);
  reset: token de link, TTL **default 1h**. Ambos de **uso único**.
- **Signup token** — string **opaca** aleatória emitida por `signup/verify` e guardada **hasheada**
  em `signup_verifications`. TTL curto (**default 15min**, `SIGNUP_TOKEN_TTL_MINUTES`). Autoriza
  **apenas** a conclusão do cadastro, é de **uso único** (`consumed_at`) e não vale como sessão.

## 7. Fluxos Principais

1. **Cadastro (3 etapas, e-mail primeiro):**
   1. `signup/start` recebe `{ email }`. Se o e-mail **já pertence a um usuário**, nada acontece;
      caso contrário, cria/atualiza a linha em `signup_verifications` com um **código OTP de 6
      dígitos** e o envia via Resend. A resposta é **sempre** a mesma (RNF-3). Chamar de novo com
      o mesmo e-mail é o **reenvio**: gera um código novo invalidando o anterior, respeitando o
      cooldown; dentro do cooldown, nada é enviado e a resposta não muda.
   2. `signup/verify` recebe `{ email, code }`. Código errado incrementa `attempts`; ao atingir o
      limite, o código é travado. Acertando, grava `verified_at`, emite o **signup token** e o
      devolve cru uma única vez. O OTP deixa de valer a partir daí.
   3. `signup/complete` recebe `{ signupToken, firstName, lastName, password, passwordConfirmation }`.
      Valida o token (existe, verificado, não expirado, não consumido) e a confirmação de senha,
      cria o usuário já com **`email_verified = true`**, semeia as **categorias padrão** (0004),
      marca `consumed_at` e **emite access + refresh** — o usuário entra logado (D9).

   A conta **só passa a existir na etapa 3**: cadastros abandonados não deixam usuário algum.
2. **Login:** valida senha (Argon2id) e **exige e-mail verificado** — se não verificado,
   retorna `EMAIL_NOT_VERIFIED`. Em sucesso, emite access + refresh. Toda conta criada pelo fluxo
   acima já nasce verificada; a checagem permanece como defesa em profundidade.
3. **Refresh:** valida o refresh token, rotaciona e devolve novo par.
4. **Esqueci a senha:** `forgot-password` **sempre** responde 200 genérico (não revela se o
   e-mail existe); se existir, gera token `password_reset` e envia link via Resend.
5. **Redefinir senha:** `reset-password` valida o token, grava o novo hash, marca o token como
   usado e **revoga todas as sessões** (refresh tokens) do usuário.
6. **Trocar senha:** `change-password` exige a senha atual; ao trocar, **revoga todas as
   sessões** (refresh tokens) do usuário, que refaz login. (O endpoint é autenticado pelo
   access token, que não identifica a sessão atual, então a revogação é total — igual ao reset.)

## 8. Requisitos Funcionais

- **RF-1** Usuário inicia o cadastro informando **apenas o e-mail** e recebe um código por e-mail;
  reenviar é repetir a mesma chamada, sujeita a cooldown.
- **RF-2** Usuário confirma a posse do e-mail via **código OTP de 6 dígitos**, de uso único,
  expirável e com limite de tentativas, recebendo um **signup token** de curta duração.
- **RF-3** Usuário conclui o cadastro apresentando o signup token com **nome, sobrenome, senha e
  confirmação de senha**; a conta é criada já verificada e a sessão é emitida na hora.
- **RF-4** Usuário **com e-mail verificado** autentica com e-mail e senha e recebe access + refresh tokens.
- **RF-5** Usuário renova os tokens via refresh (com rotação) e faz logout (revogação).
- **RF-6** Usuário solicita recuperação de senha e redefine via token enviado por e-mail.
- **RF-7** Usuário autenticado troca a própria senha informando a atual.
- **RF-8** Usuário autenticado consulta os dados da própria conta (`GET /me`).

## 9. Requisitos Não-Funcionais e Segurança

- **RNF-1** Senhas com **Argon2id**; nunca em texto puro; nunca retornadas.
- **RNF-2** Refresh/verify/reset guardados como **hash**; valor cru só trafega uma vez.
- **RNF-3** `forgot-password`, `signup/start` e `signup/verify` **não revelam** existência de
  e-mail (respostas genéricas / mesmo tempo de resposta na medida do possível).
- **RNF-4** Endpoints de `login`, `signup/start`, `signup/verify`, `forgot-password` e
  `reset-password` são **rate-limited** (AD/D2 da 0002).
- **RNF-5** Comparações de token/senha **timing-safe**.
- **RNF-6** Chave JWT vinda do **SSM** (AD-13); rotação de chave não quebra tokens já emitidos
  além do TTL do access.
- **RNF-7** Toda a comunicação via **HTTPS** (borda API Gateway).

## 10. Regras de Negócio

- **RN-1** E-mail é **único** (case-insensitive), tanto em `users` quanto entre cadastros pendentes.
- **RN-2** Política de senha: **mínimo 8 caracteres**, sem complexidade obrigatória (orientação NIST).
  `password` e `passwordConfirmation` devem ser **idênticas**; divergência ⇒ `PASSWORD_MISMATCH`.
- **RN-3** Token/código expirado, usado ou inválido ⇒ erro apropriado, sem efeito colateral. O
  código OTP é **travado** ao exceder o limite de tentativas (`VERIFY_OTP_MAX_ATTEMPTS`).
- **RN-4** Reset e troca de senha **revogam sessões** (refresh tokens) existentes.
- **RN-5** Login só é permitido com **e-mail verificado**; caso contrário, `EMAIL_NOT_VERIFIED`.
- **RN-6** A conta só é criada em `signup/complete`. Se o e-mail tiver sido registrado por outro
  caminho entre o início e a conclusão, o cadastro falha com `EMAIL_IN_USE`.
- **RN-7** O signup token **não é credencial de sessão**: só autoriza `signup/complete`.

## 11. Critérios de Aceitação

- **CA-1** Não é possível cadastrar dois usuários com o mesmo e-mail (case-insensitive).
- **CA-2** `signup/start` dispara um e-mail com código OTP de 6 dígitos e responde igual para
  e-mail livre e e-mail já cadastrado; no segundo caso, nenhum e-mail é enviado.
- **CA-3** Login com credenciais corretas retorna access + refresh; com incorretas, `INVALID_CREDENTIALS`.
- **CA-4** Um access token expirado é rejeitado; o refresh gera um novo par e **invalida** o refresh anterior.
- **CA-5** `forgot-password` responde igual para e-mail existente e inexistente.
- **CA-6** Após `reset-password`, os refresh tokens antigos deixam de funcionar.
- **CA-7** `GET /me` só retorna dados do próprio usuário autenticado (PD-3).
- **CA-8** Um cadastro interrompido após `signup/start` ou `signup/verify` **não cria usuário**, e
  o mesmo e-mail pode recomeçar o fluxo do zero.
- **CA-9** `signup/complete` com token válido cria a conta com `email_verified = true`, semeia as
  categorias padrão, devolve access + refresh e **não pode ser repetido** com o mesmo token.
- **CA-10** `signup/complete` com `password` diferente de `passwordConfirmation` falha com
  `PASSWORD_MISMATCH` e não cria conta alguma.

## 12. Glossário

- **Access token** Credencial curta (JWT) enviada a cada requisição autenticada.
- **Refresh token** Credencial longa e opaca usada para obter novos access tokens.
- **Rotação** Substituição do refresh token a cada uso, invalidando o anterior.
- **Sessão** Vínculo representado por um refresh token válido.
- **Token de uso único** Token de verificação/reset válido até ser usado ou expirar.
- **Signup token** Credencial curta e opaca que prova a verificação do e-mail e autoriza somente
  a conclusão do cadastro.
- **Cadastro pendente** Linha em `signup_verifications` para um e-mail que iniciou o fluxo mas
  ainda não virou conta.

## 13. Decisões e Questões em Aberto

### Defaults confirmados

- **D1 — TTLs:** access **15min**, refresh **30 dias**, verificação (OTP) **5min**, signup token
  **15min**, reset **1h**.
- **D2 — Hash de tokens:** SHA-256 para tokens de alta entropia; Argon2id para senhas.
- **D3 — `change-password` no MVP:** incluído.

### Decisões confirmadas (Q1–Q4)

- **D4 (Q1) — Verificação:** login **exige e-mail verificado** (`EMAIL_NOT_VERIFIED` caso contrário).
- **D5 (Q2) — Refresh token:** entregue **no corpo da resposta**; cookie httpOnly fica para
  quando houver domínio próprio same-site.
- **D6 (Q3) — Exclusão de conta:** **fora do MVP** (iteração futura).
- **D7 (Q4) — Senha:** **mínimo 8 caracteres**, sem complexidade obrigatória.

### Decisões da v2.0 (2026-07-26)

- **D8 — Cadastro com e-mail primeiro:** o fluxo é invertido. O usuário informa o e-mail, prova a
  posse com o OTP e só então envia nome e senha. Motivo: nenhuma conta é criada antes do e-mail
  ser comprovado, o que elimina usuários não verificados no banco e reduz o atrito de abandono
  no formulário longo. Substitui o fluxo `register → verify-email` da v1.1.
- **D9 — Sessão imediata:** `signup/complete` já devolve access + refresh. O e-mail foi
  comprovado pelo OTP, então exigir login em seguida seria atrito sem ganho de segurança.
- **D10 — Estado pendente em tabela própria:** `signup_verifications`, em vez de usuário parcial
  em `users` ou de afrouxar a FK de `auth_tokens`. Mantém `users` com todas as colunas
  `NOT NULL` e não espalha o conceito de "conta incompleta" pelo resto do sistema.
- **D11 — Reenvio sem endpoint próprio:** repetir `signup/start` com o mesmo e-mail regenera o
  código, sujeito ao mesmo cooldown. Um endpoint `/resend` seria um segundo caminho para a mesma
  operação.
- **D12 — Endpoints antigos removidos:** `POST /auth/register`, `/auth/verify-email` e
  `/auth/verify-email/resend` deixam de existir. O produto ainda não tem usuários em produção,
  então não há cliente antigo a sustentar.

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20; **v2.0 aprovada** em
> 2026-07-26.

## 14. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md)
- [0002 — Arquitetura Técnica](./0002-arquitetura-tecnica.md)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.

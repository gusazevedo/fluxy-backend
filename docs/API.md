# Fluxy API — Documentação

API REST de finanças pessoais para registrar receitas e despesas por categoria.

- **Versão:** 1.0.0
- **Formato:** JSON (`Content-Type: application/json`)
- **Spec OpenAPI / Swagger UI:** `GET /docs` (gerado a partir dos schemas das rotas)
- **Base URL:** o output `ApiUrl` do stack (ver `DEPLOY.md`). Em dev local: `http://localhost:3333`.

> Esta documentação é mantida à mão como visão geral. A fonte da verdade do contrato é o
> OpenAPI servido em `/docs`, gerado automaticamente dos schemas TypeBox de cada rota.

---

## Convenções

### Autenticação

Rotas protegidas exigem um **access token JWT** no header:

```
Authorization: Bearer <accessToken>
```

O par de tokens é obtido no `POST /auth/login`. O **access token** é curto (default 15min); quando
expira, use o **refresh token** em `POST /auth/refresh` para obter um novo par (com rotação).

### Valores monetários

Todos os valores são **inteiros em centavos** (`amountCents`), sempre **positivos** — o sinal vem do
campo `kind` (`expense` | `income`). Ex.: R$ 12,34 → `1234`.

### Datas

- `occurredAt` e filtros de período usam **data pura** no formato `YYYY-MM-DD`.
- Campos `createdAt` e afins são **timestamps ISO 8601** (UTC).

### Envelope de erro

Toda falha retorna o mesmo formato:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  }
}
```

`details` é opcional (presente, p.ex., em erros de validação de schema). Veja a
[tabela de códigos de erro](#códigos-de-erro).

### Rate limiting

Limite global de **100 requisições por minuto** por IP. Ao exceder, retorna **429**.

### CORS

Em produção, apenas a origem `APP_URL` é permitida. Em dev local, qualquer origem.

---

## Infraestrutura

### `GET /health`

Liveness probe. **Público.**

**200**
```json
{ "status": "ok", "stage": "dev", "timestamp": "2026-06-30T12:00:00.000Z" }
```

### `GET /docs`

Swagger UI (OpenAPI). **Público.**

---

## Autenticação e contas

Prefixo `/auth` (exceto `GET /me`). As rotas de cadastro, verificação e recuperação usam
**respostas genéricas** e **não revelam** se um e-mail existe.

### `POST /auth/register`

Cria uma conta e dispara o e-mail com o **código de verificação (OTP de 6 dígitos)**. **Público.**

**Body**
| Campo | Tipo | Regras |
|-------|------|--------|
| `email` | string | e-mail válido, ≤ 320 chars |
| `firstName` | string | 1–100 chars |
| `lastName` | string | 1–100 chars |
| `password` | string | 8–200 chars |

**201**
```json
{ "message": "If the e-mail is valid, a verification code has been sent." }
```
> Resposta genérica mesmo quando o e-mail já existe (anti-enumeração).

### `POST /auth/verify-email`

Confirma o e-mail com o **código OTP de 6 dígitos** enviado no cadastro. **Público.**

O código **expira em ~5 minutos** e é **travado** após exceder o limite de tentativas. A resposta é
genérica e nunca revela se o e-mail existe.

**Body**
| Campo | Tipo | Regras |
|-------|------|--------|
| `email` | string | e-mail da conta |
| `code` | string | exatamente 6 dígitos (`^[0-9]{6}$`) |

**200**
```json
{ "message": "E-mail verified. You can now sign in." }
```

**Erros:** `OTP_INVALID` (código errado, usuário inexistente ou código travado), `OTP_EXPIRED`,
`VALIDATION_ERROR` (formato inválido).

### `POST /auth/verify-email/resend`

Envia um **novo** código de verificação, invalidando o anterior. Sujeito a um **cooldown** entre
envios. Sempre responde genericamente. **Público.**

**Body**
| Campo | Tipo |
|-------|------|
| `email` | string |

**200**
```json
{ "message": "If the e-mail is valid, a verification code has been sent." }
```

### `POST /auth/login`

Autentica e emite o par de tokens. **Exige e-mail verificado.** **Público.**

**Body**
| Campo | Tipo |
|-------|------|
| `email` | string |
| `password` | string |

**200**
```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "x7Qf...",
  "tokenType": "Bearer",
  "expiresIn": "15m"
}
```

**Erros:** `INVALID_CREDENTIALS` (401), `EMAIL_NOT_VERIFIED` (403).

### `POST /auth/refresh`

Rotaciona o par de tokens. O refresh usado é revogado e um novo par é emitido. **Reuso** de um
refresh já rotacionado revoga **todas** as sessões (proteção contra roubo de token). **Público.**

**Body**: `{ "refreshToken": "<token>" }` → **200** com novo par.
**Erros:** `TOKEN_INVALID`, `TOKEN_EXPIRED` (401).

### `POST /auth/logout`

Revoga o refresh token corrente. **Público.**

**Body**: `{ "refreshToken": "<token>" }` → **200** `{ "message": "Signed out." }`

### `POST /auth/forgot-password`

Inicia a recuperação de senha (envia **link** por e-mail, se o e-mail existir). **Público.**
Sempre responde 200 genérico.

**Body**: `{ "email": "..." }`

### `POST /auth/reset-password`

Define a nova senha via **token do link** de recuperação; revoga todas as sessões do usuário.
**Público.**

**Body**
| Campo | Tipo | Regras |
|-------|------|--------|
| `token` | string | token do link recebido por e-mail |
| `password` | string | 8–200 chars |

**Erros:** `TOKEN_INVALID`, `TOKEN_EXPIRED` (400).

### `POST /auth/change-password` 🔒

Troca a própria senha informando a atual; revoga todas as sessões. **Requer Bearer token.**

**Body**
| Campo | Tipo | Regras |
|-------|------|--------|
| `currentPassword` | string | 8–200 chars |
| `newPassword` | string | 8–200 chars |

**Erros:** `INVALID_CREDENTIALS` (401, senha atual incorreta).

### `GET /me` 🔒

Dados da conta autenticada. **Requer Bearer token.**

**200**
```json
{
  "id": "uuid",
  "email": "voce@exemplo.com",
  "firstName": "Ana",
  "lastName": "Silva",
  "emailVerified": true,
  "createdAt": "2026-06-30T12:00:00.000Z"
}
```

---

## Categorias 🔒

Todas exigem Bearer token. Categorias pertencem ao usuário autenticado.

### `GET /categories`

Lista as categorias do usuário.

**Query**
| Param | Tipo | Notas |
|-------|------|-------|
| `kind` | `expense` \| `income` | filtra por tipo (opcional) |
| `includeArchived` | boolean | inclui arquivadas (default `false`) |

**200** — array de **Category**:
```json
[
  { "id": "uuid", "name": "Mercado", "kind": "expense", "archived": false, "createdAt": "..." }
]
```

### `POST /categories`

Cria uma categoria. Nome **único** por (usuário, tipo), case-insensitive, entre as ativas.

**Body**
| Campo | Tipo | Regras |
|-------|------|--------|
| `name` | string | 1–60 chars |
| `kind` | `expense` \| `income` | obrigatório |

**201** — **Category**.
**Erros:** `CATEGORY_NAME_IN_USE` (409).

### `GET /categories/:id`

Retorna uma categoria. **Erros:** `CATEGORY_NOT_FOUND` (404).

### `PATCH /categories/:id`

Renomeia a categoria.

**Body**: `{ "name": "Novo nome" }` (1–60 chars) → **200** **Category**.
**Erros:** `CATEGORY_NOT_FOUND` (404), `CATEGORY_NAME_IN_USE` (409).

### `DELETE /categories/:id`

Remove a categoria. Se houver transações associadas, ela é **arquivada** (soft-delete); caso
contrário, é apagada. **204** sem corpo.
**Erros:** `CATEGORY_NOT_FOUND` (404).

---

## Transações 🔒

Todas exigem Bearer token.

### `GET /transactions`

Lista transações com filtros e **paginação por cursor (keyset)**.

**Query**
| Param | Tipo | Notas |
|-------|------|-------|
| `from` | `YYYY-MM-DD` | início do período (opcional) |
| `to` | `YYYY-MM-DD` | fim do período (opcional) |
| `categoryId` | uuid | filtra por categoria (opcional) |
| `kind` | `expense` \| `income` | filtra por tipo (opcional) |
| `limit` | inteiro | 1–100 (default 20) |
| `cursor` | string | cursor opaco; ausente = primeira página |

**200**
```json
{
  "items": [
    {
      "id": "uuid",
      "amountCents": 1234,
      "kind": "expense",
      "categoryId": "uuid",
      "description": "Almoço",
      "occurredAt": "2026-06-30",
      "createdAt": "2026-06-30T12:00:00.000Z"
    }
  ],
  "nextCursor": "eyJ..."
}
```
> `nextCursor` é `null` quando não há mais resultados; reenvie-o em `?cursor=` para a próxima página.

### `POST /transactions`

Cria uma transação. A categoria deve existir, pertencer ao usuário, **não estar arquivada** e ter o
**mesmo `kind`** da transação.

**Body**
| Campo | Tipo | Regras |
|-------|------|--------|
| `amountCents` | inteiro | **positivo** (centavos) |
| `kind` | `expense` \| `income` | obrigatório |
| `categoryId` | uuid | categoria ativa do usuário |
| `occurredAt` | `YYYY-MM-DD` | data do lançamento |
| `description` | string | opcional, ≤ 280 chars |

**201** — **Transaction**.
**Erros:** `INVALID_AMOUNT` (400), `CATEGORY_NOT_FOUND` (404), `CATEGORY_ARCHIVED` (409),
`CATEGORY_KIND_MISMATCH` (409).

### `GET /transactions/:id`

Retorna uma transação. **Erros:** `TRANSACTION_NOT_FOUND` (404).

### `PATCH /transactions/:id`

Atualiza campos de uma transação (todos opcionais). `description` pode ser `null` para limpar.

**Body** (qualquer subconjunto): `amountCents`, `kind`, `categoryId`, `occurredAt`, `description`.

**200** — **Transaction**.
**Erros:** `TRANSACTION_NOT_FOUND` (404), `INVALID_AMOUNT` (400), `CATEGORY_NOT_FOUND` (404),
`CATEGORY_ARCHIVED` (409), `CATEGORY_KIND_MISMATCH` (409).

### `DELETE /transactions/:id`

Remove a transação. **204** sem corpo. **Erros:** `TRANSACTION_NOT_FOUND` (404).

---

## Relatórios 🔒

### `GET /reports/summary`

Totais de receita/despesa, saldo e quebra por categoria para um período. **Requer Bearer token.**

**Query**
| Param | Tipo | Notas |
|-------|------|-------|
| `from` | `YYYY-MM-DD` | início do período (opcional) |
| `to` | `YYYY-MM-DD` | fim do período (opcional) |

**200**
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
    {
      "categoryId": "uuid",
      "name": "Mercado",
      "kind": "expense",
      "archived": false,
      "totalCents": 120000,
      "transactionCount": 15
    }
  ]
}
```

---

## Códigos de erro

| Código | HTTP | Quando ocorre |
|--------|------|---------------|
| `VALIDATION_ERROR` | 400 | Corpo/query/params fora do schema |
| `BAD_REQUEST` | 400 | Requisição inválida (genérico) |
| `INVALID_AMOUNT` | 400 | `amountCents` não positivo |
| `OTP_INVALID` | 400 | Código de verificação errado, inexistente ou travado |
| `OTP_EXPIRED` | 400 | Código de verificação expirado |
| `TOKEN_INVALID` | 400/401 | Token de verificação/reset/refresh inválido |
| `TOKEN_EXPIRED` | 400/401 | Token de verificação/reset/refresh expirado |
| `INVALID_CREDENTIALS` | 401 | E-mail/senha incorretos |
| `UNAUTHORIZED` | 401 | Sem token / token inválido em rota protegida |
| `EMAIL_NOT_VERIFIED` | 403 | Login antes de confirmar o e-mail |
| `FORBIDDEN` | 403 | Acesso negado |
| `NOT_FOUND` | 404 | Rota inexistente |
| `CATEGORY_NOT_FOUND` | 404 | Categoria inexistente ou de outro usuário |
| `TRANSACTION_NOT_FOUND` | 404 | Transação inexistente ou de outro usuário |
| `CONFLICT` | 409 | Conflito genérico |
| `CATEGORY_NAME_IN_USE` | 409 | Nome de categoria já usado no mesmo tipo |
| `CATEGORY_ARCHIVED` | 409 | Categoria arquivada usada em transação |
| `CATEGORY_KIND_MISMATCH` | 409 | `kind` da transação ≠ `kind` da categoria |
| `INTERNAL_SERVER_ERROR` | 500 | Erro inesperado |

---

## Fluxo típico (cliente)

1. `POST /auth/register` → usuário recebe um **código OTP de 6 dígitos** por e-mail.
2. `POST /auth/verify-email` com `{ email, code }` → e-mail confirmado.
   - Precisar de outro código? `POST /auth/verify-email/resend`.
3. `POST /auth/login` → guarda `accessToken` e `refreshToken`.
4. Chamadas autenticadas (`/categories`, `/transactions`, `/reports/summary`) com
   `Authorization: Bearer <accessToken>`.
5. Quando o access token expira, `POST /auth/refresh` com o `refreshToken` → novo par.

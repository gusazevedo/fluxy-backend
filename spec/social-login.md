# Spec de Implementação — Login Social (Google + Apple)

## 1. Contexto e decisão de arquitetura

**Decisão (2026-06-10):** a API é **social-only**. O login por email/senha
(`register`/`login`) foi **removido**. A autenticação acontece exclusivamente por
**Google** e **Apple**, usando o fluxo de **ID Token nativo**.

O Supabase **continua** sendo o auth provider por baixo: ele emite os JWTs e o
`auth.middleware.ts` segue validando com `supabase.auth.getUser(token)` — sem
mudança. Não há tabela `users` local; `auth.users` do Supabase é a fonte de
verdade e `transactions.userId` referencia esse id.

Como o cliente é um app **nativo**, **não** usamos o fluxo de redirect de browser
(`signInWithOAuth` / PKCE). Usamos o **fluxo de ID Token nativo**:

```
┌──────────┐   1. Sign-In nativo (Google/Apple)  ┌─────────────┐
│   App    │ ──────────────────────────────────► │ Google/Apple│
│ (native) │ ◄────────────────────────────────── │             │
└──────────┘   2. id_token (JWT do provider)      └─────────────┘
     │
     │ 3. POST /auth/google | /auth/apple { id_token }
     ▼
┌──────────────┐  4. signInWithIdToken         ┌─────────────┐
│  Fluxy API   │ ────────────────────────────► │  Supabase   │
│              │ ◄──────────────────────────── │   Auth      │
└──────────────┘  5. session (access/refresh)   └─────────────┘
     │
     │ 6. { access_token, refresh_token }
     ▼
   App guarda os tokens e usa nas rotas protegidas
```

### Por que Google **e** Apple?

App nativo iOS que oferece login social de terceiros (Google) precisa, pela
diretriz **4.8 da App Store**, oferecer **Sign in with Apple** também. Ambos os
provedores passam pelo mesmo `signInWithIdToken`, então o custo de incluir os dois
é mínimo.

### Por que mediar pelo backend (e não chamar o Supabase direto do app)?

- **Consistência**: o app fala só com a Fluxy API; a resposta é sempre `AuthTokens`.
- **Ponto único de evolução**: provisionamento futuro (ex.: categorias default no
  primeiro login) fica no service do backend.
- **Zero mudança** no middleware e nas rotas protegidas.

> No primeiro login o Supabase cria o registro em `auth.users`; nos seguintes
> reusa o mesmo id. Como não há mais cadastro por senha, **não existe cenário de
> colisão de email** — toda a lógica de account-linking foi eliminada.

## 2. Pré-requisitos (provedores + Supabase)

### Google
1. **Google Cloud Console** → OAuth 2.0 Client IDs:
   - Um **Web client** (usado pelo Supabase como `audience`).
   - Um **iOS** e/ou **Android client** (usados pelo app nativo).
2. **Supabase Dashboard** → Authentication → Providers → **Google**:
   - Habilitar, colar **Client ID/Secret** do Web client.
   - Em "Authorized Client IDs", adicionar os Client IDs **nativos** (iOS/Android).

### Apple
1. **Apple Developer** → criar um **Services ID** e uma **Sign in with Apple key**.
2. **Supabase Dashboard** → Authentication → Providers → **Apple**:
   - Habilitar e preencher Services ID, Team ID, Key ID e a private key.

Nenhum secret novo precisa ir para o `.env` do backend — o Supabase guarda os
secrets. O backend só usa `SUPABASE_URL` e `SUPABASE_ANON_KEY` (a service role key
**não** é mais necessária, já que não há pré-check via Admin API).

## 3. Contrato da API

### `POST /auth/google` e `POST /auth/apple`

**Request**
```json
{ "id_token": "<JWT emitido pelo provider>" }
```

**Response `200`**
```json
{
  "access_token": "<JWT Supabase>",
  "refresh_token": "<refresh token Supabase>"
}
```

**Erros**
| HTTP | `code`                 | Quando                                          |
|------|------------------------|-------------------------------------------------|
| 401  | `INVALID_SOCIAL_TOKEN` | `id_token` inválido/expirado ou audience errada |
| 422  | (validação AJV)        | body sem `id_token` ou formato inválido         |

## 4. Implementação (estado atual)

Padrão dos módulos existentes (`routes → controller → service`).

### `src/modules/auth/auth.service.ts`
```ts
export type SocialProvider = 'google' | 'apple'

async loginWithProvider(provider: SocialProvider, idToken: string): Promise<AuthTokens> {
  const { data, error } = await supabase.auth.signInWithIdToken({ provider, token: idToken })
  if (error || !data.session) {
    throw new AppError('INVALID_SOCIAL_TOKEN', `Invalid or expired ${provider} token`, 401)
  }
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }
}
```

### `src/modules/auth/auth.controller.ts`
`loginWithGoogle` e `loginWithApple` chamam `loginWithProvider` com o provider fixo.

### `src/modules/auth/auth.schema.ts`
`socialLoginSchema` — body `{ id_token: string (minLength 1) }`, `additionalProperties: false`.

### `src/modules/auth/auth.routes.ts`
```ts
fastify.post('/google', { schema: socialLoginSchema }, controller.loginWithGoogle.bind(controller))
fastify.post('/apple',  { schema: socialLoginSchema }, controller.loginWithApple.bind(controller))
```

### `spec/openapi.yaml`
Paths `/auth/google` e `/auth/apple` sob a tag `Auth`; schema `SocialLoginInput`;
resposta `200` reusa `AuthTokens`; `401` com exemplo `INVALID_SOCIAL_TOKEN`.

> O `auth.middleware.ts` **não muda**: o token devolvido é um JWT Supabase comum.

## 5. Casos de borda

- **Primeiro login** (Google ou Apple) → Supabase cria o usuário; `userId` passa a
  existir e funciona com `/transactions` imediatamente.
- **Apple só devolve email no 1º consentimento** — o Supabase persiste o usuário;
  logins seguintes reusam o id mesmo sem email no token.
- **Token de audience errada** → `401`. Garantir Client IDs nativos na lista de
  "Authorized Client IDs" (Google) e Services ID correto (Apple) no Supabase.
- **Refresh**: o `refresh_token` é Supabase; o app renova a sessão normalmente.

## 6. Em aberto

1. **Nonce**: o app vai gerar nonce no Sign-In nativo? Apple recomenda fortemente.
   Se sim, propagar o nonce (raw) para o `signInWithIdToken`. Fora da v1.
2. **Provisionamento pós-primeiro-login** (ex.: seed de categorias): fora da v1;
   hook natural seria no `loginWithProvider` detectando `created_at === last_sign_in_at`.

## 7. Critérios de aceite

- [ ] `POST /auth/google` com `id_token` válido retorna `200` + `AuthTokens`.
- [ ] `POST /auth/apple` com `id_token` válido retorna `200` + `AuthTokens`.
- [ ] Token retornado autentica com sucesso em `GET /transactions`.
- [ ] `id_token` inválido/expirado retorna `401 INVALID_SOCIAL_TOKEN`.
- [ ] Body sem `id_token` retorna `422`.
- [ ] Endpoints de senha (`/auth/register`, `/auth/login`) não existem mais.
- [ ] OpenAPI atualizado e visível em `/docs`.
- [ ] Nenhuma alteração necessária no `auth.middleware.ts`.

## 8. Teste manual rápido

```bash
# id_token obtido do app nativo (Google Sign-In ou Sign in with Apple)
curl -X POST http://localhost:3000/auth/google \
  -H 'Content-Type: application/json' \
  -d '{"id_token":"<ID_TOKEN>"}'

curl http://localhost:3000/transactions \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'
```

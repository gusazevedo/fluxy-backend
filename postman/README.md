# Postman — Fluxy API

Coleção para testar as rotas manualmente. Não faz parte do build nem dos testes
automatizados; é ferramental de desenvolvimento.

## Importar

No Postman: **Import** → arraste os dois arquivos:

- `fluxy.postman_collection.json` — as 22 rotas, em 6 pastas
- `fluxy.postman_environment.json` — o environment `Fluxy Local`

Depois selecione **Fluxy Local** no seletor de environment (canto superior direito).
Sem ele selecionado, nenhuma variável resolve e todas as requests falham.

## Subir a API

```sh
npm run dev:up   # sobe o Postgres, aplica as migrations e inicia o servidor
```

A API sobe em `http://localhost:3333`, que é o valor de `baseUrl`. Se você mudou
`PORT` no `.env`, ajuste a variável no environment.

Se as migrations já estiverem aplicadas, `npm run dev` sozinho basta e evita a etapa
de migrate.

## Primeiro fluxo, do zero

O cadastro é OTP-first: o código chega por e-mail antes de a conta existir.

1. **`Auth / Signup → 1. Start signup`** — dispara o e-mail. Responde `202` com uma
   mensagem genérica, sempre igual, quer o endereço esteja livre ou já seja uma conta.
2. Pegue o código no **log do servidor**:
   ```
   [email] verification code for <fluxy.dev+1@example.com>: 483920
   ```
   Cole os 6 dígitos na variável de environment `otpCode`.
3. **`2. Verify code`** — grava `signupToken` sozinho.
4. **`3. Complete signup`** — cria a conta e grava `accessToken` e `refreshToken`.
5. **`Categories → List categories`** — as categorias padrão já foram semeadas no passo
   anterior; esta request grava a primeira em `categoryId`.
6. **`Transactions → Create transaction`** — já usa o `categoryId` e grava `transactionId`.

Daí em diante, `Login` regrava os tokens quando eles expirarem (o access token vive
15 min por padrão) e todas as rotas protegidas funcionam sem configuração manual.

> O código só aparece no log enquanto não houver `RESEND_API_KEY` no `.env`. Com a chave
> configurada, o e-mail é enviado de verdade e você lê o código na caixa de entrada.

## Como a autenticação está montada

O Bearer é declarado **uma vez**, no nível da coleção, como `{{accessToken}}`. As rotas
públicas (`/health`, `/auth/signup/*`, `login`, `refresh`, `logout`, `forgot-password`,
`reset-password`) sobrescrevem individualmente com *No Auth*. Nenhuma das 12 rotas
protegidas precisa de header manual.

## Variáveis

| Variável | Preenchida por | Observação |
|---|---|---|
| `baseUrl` | você | `http://localhost:3333` |
| `testEmail` | você | usada por signup, login e forgot-password |
| `testPassword` | você | mínimo 8 caracteres |
| `otpCode` | você | copiado do log do servidor |
| `resetToken` | você | do link em `[email] password reset link for ...` |
| `signupToken` | `Verify code` | vida curta; só autoriza completar o cadastro |
| `accessToken` | `Complete signup`, `Login`, `Refresh` | limpo por `Logout` |
| `refreshToken` | `Complete signup`, `Login`, `Refresh` | limpo por `Logout` |
| `categoryId` | `List categories`, `Create category` | `List` só grava se estiver vazia |
| `transactionId` | `Create transaction` | |

Os tokens ficam no **environment**, não na coleção — o arquivo de environment
versionado tem esses campos vazios, então nada sensível entra no git pelo uso normal.

## Escopo

Só o caminho feliz: uma request por rota, com body válido de exemplo. Para provocar
erros (401, 409, validação), edite o body ou os headers na hora.

Os parâmetros de query opcionais (`from`, `to`, `limit`, `cursor`, `kind`,
`includeArchived`) vêm **desabilitados** nas listagens — visíveis na aba Params, sem
interferir até você marcar a caixinha.

## Manutenção

A coleção é escrita à mão e não se atualiza sozinha. Se um contrato mudar, ajuste aqui
também. A fonte de verdade continua sendo o OpenAPI gerado a partir dos schemas TypeBox,
servido em `http://localhost:3333/docs`.

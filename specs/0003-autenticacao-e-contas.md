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
| `first_name` | TEXT | Obrigatório; informado em `signup/complete` |
| `last_name` | TEXT | Obrigatório; informado em `signup/complete` |
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
| `attempts` | integer | tentativas erradas (default `0`); **sem uso** — o reset não conta tentativas |
| `created_at` | timestamptz | default `now()` |

> A partir da v2.0 esta tabela serve **apenas** a `password_reset`: a verificação de e-mail
> acontece antes de existir usuário e mora em `signup_verifications`. O valor `email_verify`
> permanece no enum do Postgres por custo de migration, sem uso pela aplicação; as linhas
> `email_verify` remanescentes são **descartadas** pela migration.

### `signup_verifications` (cadastro em andamento)

Uma linha por e-mail com cadastro pendente, em vez de acumular registros.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | PK |
| `email` | TEXT | **Único**, armazenado em minúsculas |
| `otp_hash` | TEXT | **Hash** do código OTP de 6 dígitos |
| `attempts` | integer | tentativas erradas **do código atual** (default `0`); trava o código no limite |
| `expires_at` | timestamptz | validade do OTP |
| `last_sent_at` | timestamptz | último envio; base do cooldown de reenvio |
| `verified_at` | timestamptz | nulo até o OTP conferir |
| `signup_token_hash` | TEXT | **Hash** do token de conclusão; **único**, indexado; nulo até a verificação |
| `signup_token_expires_at` | timestamptz | nulo até a verificação |
| `sends_in_window` | integer | códigos emitidos para este e-mail na janela corrente (RN-8) |
| `failures_in_window` | integer | tentativas erradas acumuladas na janela corrente (RN-8) |
| `window_started_at` | timestamptz | início da janela de 24h dos dois contadores acima |
| `created_at` / `updated_at` | timestamptz | default `now()` |

**Reinício do cadastro.** Um novo `signup/start` para um e-mail com linha pendente **atualiza**
essa linha: novo `otp_hash`, `attempts` zerado, nova `expires_at`, e `verified_at`,
`signup_token_hash` e `signup_token_expires_at` **limpos** — de modo que um signup token emitido
antes do reinício deixa de valer. Os contadores de janela (`sends_in_window`,
`failures_in_window`, `window_started_at`) **não** são zerados pelo reinício; só viram na janela.

**Retenção.** A linha é **apagada** no mesmo comando que cria a conta (a `users` passa a ser o
registro), e linhas **pendentes** expiradas há mais de 24h são descartadas. Por isso não existe
coluna `consumed_at`: consumir o token *é* apagar a linha, e "token já consumido" torna-se
indistinguível de "token inexistente" — ambos `SIGNUP_TOKEN_INVALID`. Sem essa limpeza, o índice
único de `email` prenderia o endereço indefinidamente e a tabela acumularia dado pessoal de quem
nunca virou usuário. A limpeza das pendentes é oportunista: `signup/start` apaga a linha vencida
do próprio e-mail antes de criar a nova.

> **Limitação conhecida.** Sendo oportunista, a limpeza só alcança e-mails que voltam a chamar
> `signup/start`. Linhas de cadastros abandonados — e, por causa da D17, também as criadas para
> e-mails que já são conta — permanecem até que isso aconteça. O volume é limitado a uma linha por
> e-mail pelo índice único, e a RN-8 limita quantas vezes cada uma pode ser reescrita. Uma purga
> agendada fica para quando houver volume que a justifique.

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
  → 202 { message }                          genérico (RNF-3)

POST /auth/signup/verify    { email, code }
  → 200 { signupToken, expiresInSeconds }    token cru devolvido uma única vez

POST /auth/signup/complete  { signupToken, firstName, lastName, password, passwordConfirmation }
  → 201 { accessToken, refreshToken, tokenType, expiresIn }
```

`expiresInSeconds` é um **inteiro em segundos** — diferente do `expiresIn` do par de tokens, que
é a string do TTL do access (ex.: `"15m"`), mantida por compatibilidade com o contrato existente.

**Erros do cadastro:**

| Endpoint | Situação | Status | Código |
|----------|----------|--------|--------|
| `signup/start` | e-mail já é conta, dentro do cooldown, ou teto da janela atingido | 202 | — (resposta genérica) |
| `signup/verify` | código errado, código travado por tentativas, ou sem cadastro pendente | 400 | `OTP_INVALID` |
| `signup/verify` | cadastro pendente existe mas o código expirou | 400 | `OTP_EXPIRED` |
| `signup/complete` | token inexistente, não verificado ou já usado | 400 | `SIGNUP_TOKEN_INVALID` |
| `signup/complete` | token válido, porém vencido | 400 | `SIGNUP_TOKEN_EXPIRED` |
| `signup/complete` | `password` ≠ `passwordConfirmation` | 400 | `PASSWORD_MISMATCH` |
| `signup/complete` | e-mail virou conta entre o início e a conclusão | 409 | `EMAIL_IN_USE` |

Senha fora da política é rejeitada pelo schema TypeBox antes do handler (400 de validação);
`WEAK_PASSWORD` fica reservado para regras de senha que não caibam no schema.

**Demais códigos:** `INVALID_CREDENTIALS` (401), `EMAIL_NOT_VERIFIED` (403), `TOKEN_INVALID` /
`TOKEN_EXPIRED` (401 no refresh, 400 no reset), `UNAUTHORIZED` (401).

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
- **Signup token** — string **opaca** aleatória de **32 bytes** (mesma geração do refresh token),
  emitida por `signup/verify` e guardada **hasheada** em `signup_verifications`. TTL curto
  (**default 15min**, `SIGNUP_TOKEN_TTL_MINUTES`). Autoriza **apenas** a conclusão do cadastro, é
  de **uso único** e não vale como sessão.

### Configuração

| Variável | Default | Uso |
|----------|---------|-----|
| `ACCESS_TOKEN_TTL` | `15m` | TTL do access token |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | TTL do refresh token |
| `VERIFY_OTP_TTL_MINUTES` | `5` | Validade do código OTP |
| `VERIFY_OTP_MAX_ATTEMPTS` | `5` | Tentativas erradas por código antes de travá-lo |
| `VERIFY_OTP_RESEND_COOLDOWN_SECONDS` | `60` | Intervalo mínimo entre dois envios |
| `SIGNUP_TOKEN_TTL_MINUTES` | `15` | Validade do signup token |
| `SIGNUP_MAX_SENDS_PER_DAY` | `10` | Teto de códigos por e-mail na janela de 24h (RN-8) |
| `SIGNUP_MAX_FAILURES_PER_DAY` | `20` | Teto de tentativas erradas por e-mail na janela (RN-8) |
| `RESET_TOKEN_TTL_HOURS` | `1` | Validade do token de reset |

## 7. Fluxos Principais

1. **Cadastro (3 etapas, e-mail primeiro):**
   1. `signup/start` recebe `{ email }` e **sempre** cria/atualiza a linha em
      `signup_verifications` com um **código OTP de 6 dígitos** — inclusive quando o e-mail já
      pertence a um usuário (D17). O que muda nesse caso é apenas que **o e-mail não é enviado**:
      o código existe no banco, mas ninguém o recebe, então é inadivinhável. A resposta é
      **sempre** a mesma (RNF-3) e é devolvida
      **antes** do envio ser concluído (D13), de modo que os dois caminhos levem o mesmo tempo;
      falha de envio vira log, não erro de resposta. Chamar de novo com o mesmo e-mail é o
      **reenvio**: gera um código novo invalidando o anterior, respeitando o cooldown e os tetos
      da janela (RN-8); bloqueado por qualquer um deles, nada é enviado e a resposta não muda.
   2. `signup/verify` recebe `{ email, code }`. Código errado incrementa `attempts` e
      `failures_in_window`; ao atingir o limite do código, ele é travado. Acertando, grava
      `verified_at`, emite o **signup token** e o devolve cru uma única vez. O OTP deixa de valer
      a partir daí, e uma linha **já verificada** rejeita novo `verify` com `OTP_INVALID` — assim
      uma segunda chamada não invalida o token entregue na primeira. Para recomeçar, o caminho é
      `signup/start`, que limpa a verificação e o token (§4).
   3. `signup/complete` recebe `{ signupToken, firstName, lastName, password, passwordConfirmation }`.
      Confere a confirmação de senha, valida o token (existe, verificado, não expirado), cria o
      usuário já com **`email_verified = true`**, semeia as **categorias padrão** (0004) e
      **emite access + refresh** — o usuário entra logado (D9).

      Consumo do token, criação do usuário e semeadura acontecem num **único comando SQL** com
      CTEs encadeadas (D14): ou a conta nasce completa e com categorias, ou nada é gravado e o
      token continua válido para nova tentativa. O consumo é o próprio `DELETE ... RETURNING` da
      linha, que o Postgres serializa — de duas chamadas simultâneas com o mesmo token, uma vence
      e a outra recebe `SIGNUP_TOKEN_INVALID`, nunca um 500 por violação de unicidade.

   A conta **só passa a existir na etapa 3**: cadastros abandonados não deixam usuário algum.

   O e-mail de verificação enviado na etapa 1 **não traz saudação nominal** — o nome do usuário só
   é conhecido na etapa 3. `sendVerificationEmail` passa a receber `(to, code)`.
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
- **RNF-2** Refresh, signup token, código de verificação e token de reset guardados como **hash**;
  o valor cru só trafega uma vez.
- **RNF-3** `forgot-password`, `signup/start` e `signup/verify` **não revelam** se um e-mail já é
  **conta**: resposta genérica, mesmo status e — em `signup/start` — mesmo tempo de resposta, já
  que o envio sai do caminho da resposta (D13). A distinção entre `OTP_INVALID` e `OTP_EXPIRED`
  em `signup/verify` **não** revela existência de conta, porque `signup/start` cria a linha
  pendente para qualquer e-mail (D17) — os dois casos são indistinguíveis pelo `verify`.
- **RNF-4** Endpoints de `login`, `signup/start`, `signup/verify`, `forgot-password` e
  `reset-password` são **rate-limited** por IP (AD/D2 da 0002). Como esse limite é grosseiro e
  por container, a proteção do cadastro contra força bruta e mail-bombing vem dos tetos **por
  e-mail** da RN-8, não dele.
- **RNF-5** Comparações de token/senha **timing-safe**.
- **RNF-6** Chave JWT vinda do **SSM** (AD-13); rotação de chave não quebra tokens já emitidos
  além do TTL do access.
- **RNF-7** Toda a comunicação via **HTTPS** (borda API Gateway).

## 10. Regras de Negócio

- **RN-1** E-mail é **único** (case-insensitive), tanto em `users` quanto entre cadastros pendentes.
- **RN-2** Política de senha: **mínimo 8 caracteres**, sem complexidade obrigatória (orientação NIST).
  Em **`signup/complete`**, `password` e `passwordConfirmation` devem ser **idênticas**;
  divergência ⇒ `PASSWORD_MISMATCH`. `reset-password` e `change-password` seguem sem campo de
  confirmação — a dupla digitação é exigida só na criação da conta.
- **RN-3** Token/código expirado, usado ou inválido ⇒ erro apropriado, sem efeito colateral. O
  código OTP é **travado** ao exceder o limite de tentativas (`VERIFY_OTP_MAX_ATTEMPTS`).
- **RN-4** Reset e troca de senha **revogam sessões** (refresh tokens) existentes.
- **RN-5** Login só é permitido com **e-mail verificado**; caso contrário, `EMAIL_NOT_VERIFIED`.
- **RN-6** A conta só é criada em `signup/complete`. Se o e-mail já pertencer a um usuário — seja
  porque virou conta entre o início e a conclusão, seja porque a linha pendente foi criada para um
  e-mail que já era conta (D17) —, o cadastro falha com `EMAIL_IN_USE`. A garantia final é o índice
  único de `users.email`.
- **RN-7** O signup token **não é credencial de sessão**: só autoriza `signup/complete`.
- **RN-8** Cada e-mail tem, numa janela de **24h**, um teto de **códigos emitidos**
  (`SIGNUP_MAX_SENDS_PER_DAY`) e de **tentativas erradas acumuladas**
  (`SIGNUP_MAX_FAILURES_PER_DAY`). Esses contadores **não são zerados** ao reiniciar o cadastro —
  só ao virar a janela. Sem eles, o `attempts` por código seria contornável reiniciando o
  cadastro (~7.200 tentativas/dia contra um espaço de 10⁶), e `signup/start` serviria de
  mail-bombing contra endereços arbitrários. Atingido qualquer teto, `signup/start` e
  `signup/verify` param de agir para aquele e-mail até a janela virar, **sem** alterar a resposta
  genérica (RNF-3).

## 11. Critérios de Aceitação

- **CA-1** Não é possível cadastrar dois usuários com o mesmo e-mail (case-insensitive).
- **CA-2** `signup/start` dispara um e-mail com código OTP de 6 dígitos e responde igual para
  e-mail livre e e-mail já cadastrado; no segundo caso, nenhum e-mail é enviado, mas a linha
  pendente é criada do mesmo jeito (D17).
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
- **CA-11** Um signup token vencido é rejeitado com `SIGNUP_TOKEN_EXPIRED`; um `signup/start`
  posterior invalida o signup token emitido antes dele.
- **CA-12** Dentro do cooldown, um novo `signup/start` não dispara e-mail e a resposta é
  indistinguível de um envio bem-sucedido.
- **CA-13** Esgotado o teto de tentativas erradas da janela (RN-8), novos códigos e novas
  tentativas deixam de ser aceitos para aquele e-mail, ainda que o cadastro seja reiniciado.
- **CA-14** Se a semeadura das categorias falhar durante `signup/complete`, nenhuma conta é
  gravada e o signup token continua válido para nova tentativa.
- **CA-15** Para um e-mail que já é conta, `signup/verify` com código errado responde igual ao de
  um e-mail livre nas mesmas condições — inclusive quanto a `OTP_INVALID` vs `OTP_EXPIRED` — e
  `signup/start` consome a mesma cota da RN-8 nos dois casos.

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

### Decisões da revisão da v2.0 (2026-07-26)

- **D13 — Envio fora do caminho da resposta:** `signup/start` responde 202 antes de o e-mail sair.
  Com o envio síncrono, o caminho "e-mail livre" (INSERT + chamada ao Resend) levaria centenas de
  ms a mais que o caminho "e-mail já cadastrado" (um SELECT), tornando a enumeração trivial por
  cronômetro e esvaziando a RNF-3.
- **D14 — `signup/complete` atômico via CTE:** consumo do token, criação do usuário e semeadura
  das categorias num **único comando SQL** (`WITH consumed AS (DELETE ... RETURNING) ...`). Evita
  conta sem categorias em falha parcial e transforma a corrida de duplo `complete` em erro
  previsto. **Não** se usa `db.transaction()`: o driver HTTP do Neon (AD-8 da 0002) não suporta
  transação — `drizzle-orm/neon-http` lança `"No transactions support in neon-http driver"` —
  enquanto `db.batch()`, que ele suporta, não existe no `postgres.js` (dev) nem no `pglite`
  (testes). Um comando único é atômico no Postgres em **qualquer** driver, então é a única
  primitiva comum aos três ambientes sem revisar a AD-8. Custo aceito: esse comando é SQL cru,
  isolado no repositório, em vez do query builder tipado.
- **D15 — `OTP_EXPIRED` mantido:** colapsar tudo em `OTP_INVALID` deixaria quem tem código vencido
  sem saber que basta pedir outro. **Revisada por D17**, que remove o vazamento que a justificava.
- **D16 — Tetos por e-mail (RN-8):** contadores de janela de 24h que o reinício do cadastro não
  zera, respondendo à força bruta viabilizada por D11 e ao mail-bombing.
- **D17 — `signup/start` cria a linha pendente para qualquer e-mail:** inclusive para endereços que
  já são conta; o que muda nesses casos é só o envio, que não acontece. Motivo: com a linha sendo
  criada apenas para e-mails livres, a D15 virava um **oráculo de conta**. Bastava chamar
  `signup/start(X)`, esperar o OTP expirar e chamar `signup/verify(X, "000000")` — `OTP_EXPIRED`
  provava que existia linha pendente, logo que X **não** era conta, e `OTP_INVALID` provava o
  contrário. Isso é exatamente o que a RNF-3 promete que o `verify` não faz. Criando a linha nos
  dois casos, os caminhos ficam indistinguíveis e a D15 pode ser mantida. O código gravado para um
  e-mail que já é conta nunca é enviado a ninguém, então é inadivinhável (10⁻⁶ por tentativa, com
  o teto de tentativas da RN-8); e, se ainda assim fosse acertado, `signup/complete` esbarra no
  índice único de `users.email` e devolve `EMAIL_IN_USE` (RN-6), sem criar conta alguma.

> Todas as decisões foram resolvidas. Spec **Aprovada** em 2026-06-20; **v2.0 aprovada** em
> 2026-07-26, após revisão que originou D13–D16 e a RN-8.

## 14. Referências

- [0001 — Visão Geral do Produto](./0001-visao-geral-do-produto.md)
- [0002 — Arquitetura Técnica](./0002-arquitetura-tecnica.md)
- [CLAUDE.md](../CLAUDE.md) — SSD, testes, lint.

# Guia de Deploy — Fluxy API (AWS + Neon, do zero)

Sobe: **Lambda + HTTP API** na AWS (`us-east-1`), com o banco em **Neon** (PostgreSQL serverless).
Siga **na ordem**. Onde aparecer `dev`, é o ambiente (depois você repete para `prod`).

> Regra de ouro: **Lambda e Neon na mesma região (`us-east-1` / AWS = `AWS, N. Virginia` no Neon)**
> — banco colado no compute, latência mínima (ver 0002/AD-9).

---

## 0. Pré-requisitos locais (você já tem)

Confira no terminal (todos devem responder uma versão):

```bash
node -v        # v22+
aws --version  # AWS CLI v2
sam --version  # SAM CLI
make --version # vem no macOS
```

No projeto, rode `npm install` uma vez (instala o esbuild usado no build).

---

## 1. Conta AWS + usuário (no Console da AWS, no navegador)

1. Crie/entre numa **conta AWS** (precisa de e-mail + cartão; tem free tier).
2. **Ative MFA na conta root** e **não use a conta root** no dia a dia.
3. Crie um **usuário IAM** para você:
   - Console → **IAM** → **Users** → **Create user**.
   - Permissões: anexe **`AdministratorAccess`** (simples para projeto pessoal; o deploy mexe em
     CloudFormation, Lambda, API Gateway, IAM, SSM e S3).
   - Aba **Security credentials** → **Create access key** → tipo **Command Line Interface (CLI)**
     → guarde o **Access key ID** e o **Secret access key** (o secret só aparece uma vez).

---

## 2. Banco no Neon (no navegador)

1. Crie conta em **neon.com** (free tier cobre o MVP) → **Create project**.
2. **Região:** escolha **AWS / US East (N. Virginia)** — a mesma do Lambda.
3. Em **Connection details**, pegue **duas** strings de conexão (botão de copiar):
   - **Pooled** (host com `-pooler`) → usada pelo **app** (driver HTTP do Neon).
   - **Direct / unpooled** (sem `-pooler`) → usada pelas **migrações** (DDL).
   - Ambas no formato `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require`.

> Guarde as duas; você usa a *pooled* no passo 4 e a *direct* no passo 6.

---

## 3. (E-mail) Resend — necessário para verificação de conta

O login exige e-mail verificado. Em produção, o link de verificação é enviado pelo **Resend**.

1. Crie conta em **resend.com** (free tier) → **API Keys** → crie uma key (guarde).
2. Para enviar a qualquer destinatário, **verifique um domínio** no Resend. Sem domínio, a key
   de teste só envia para o e-mail da sua própria conta Resend.

> **Atalho sem Resend (só para testar):** sem a key o app **não envia** e-mail — ele **escreve o
> link de verificação no CloudWatch Logs**. Aí você pega o token de lá e chama `/auth/verify-email`
> na mão (ver passo 8, nota).

---

## 4. Configurar o AWS CLI + criar os segredos no SSM (no terminal)

```bash
aws configure
# AWS Access Key ID     -> (do passo 1)
# AWS Secret Access Key -> (do passo 1)
# Default region name   -> us-east-1
# Default output format  -> json

aws sts get-caller-identity   # confirma autenticação + conta
```

O CloudFormation não cria segredos; você cria os parâmetros **SecureString** antes do deploy:

```bash
# Connection string do Neon (POOLED) — obrigatório:
aws ssm put-parameter --region us-east-1 --type SecureString \
  --name /fluxy/dev/database-url \
  --value "postgresql://USER:PASSWORD@HOST-pooler.../fluxy?sslmode=require"

# JWT (obrigatório) — gera um segredo forte:
aws ssm put-parameter --region us-east-1 --type SecureString \
  --name /fluxy/dev/jwt-secret --value "$(openssl rand -base64 48)"

# Resend (opcional — só se for enviar e-mail de verdade):
aws ssm put-parameter --region us-east-1 --type SecureString \
  --name /fluxy/dev/resend-api-key --value "RE_xxx_sua_key"
```

> Os nomes **precisam** ficar sob `/fluxy/dev/` (a permissão do Lambda é escopada nesse caminho).

**Conferir se um segredo existe** (não mostra o valor):

```bash
aws ssm describe-parameters --region us-east-1 \
  --parameter-filters "Key=Name,Values=/fluxy/dev/jwt-secret" \
  --query "Parameters[0].{Name:Name,Type:Type,Version:Version}" --output table
```

**Recriar / rotacionar um segredo** (sobrescreve — exige `--overwrite`):

```bash
aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
  --name /fluxy/dev/jwt-secret --value "$(openssl rand -base64 48)"
```

> Rotacionar o JWT invalida os tokens já emitidos (todo mundo precisa logar de novo).

---

## 5. Deploy (no terminal, na raiz do projeto)

```bash
npm run deploy
```

Isso roda `sam build` (empacota o app p/ linux-arm64) e `sam deploy`. Ele mostra um **changeset**
e pede confirmação → digite **`y`**. Como não há VPC/RDS, o deploy é **rápido** (segundos a poucos
minutos). Ao final, pegue os **outputs**:

```bash
aws cloudformation describe-stacks --stack-name fluxy-dev --region us-east-1 \
  --query "Stacks[0].Outputs" --output table
```

Anote a **`ApiUrl`**.

---

## 6. Aplicar as migrations no Neon (no terminal)

Cria as tabelas usando a connection string **direta (unpooled)** do passo 2:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST.../fluxy?sslmode=require" \
  npm run db:migrate:remote
```

> Use a string **sem** `-pooler` aqui (DDL não deve passar pelo pooler). O Neon acorda do
> scale-to-zero em alguns segundos na primeira conexão; se der timeout, **rode de novo**.

---

## 7. Smoke test (no terminal / navegador)

Use a `ApiUrl` do output:

```bash
API="<ApiUrl>"

curl $API/health                      # -> {"status":"ok",...}
# abra no navegador: $API/docs         (Swagger UI)

# fluxo completo:
curl -X POST $API/auth/register -H 'content-type: application/json' \
  -d '{"email":"voce@exemplo.com","password":"senha12345"}'
# -> verifique o e-mail (link do Resend) OU veja o link no CloudWatch (nota abaixo)
curl -X POST $API/auth/verify-email -H 'content-type: application/json' \
  -d '{"token":"<token-do-link>"}'
curl -X POST $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"voce@exemplo.com","password":"senha12345"}'
# -> use o accessToken: Authorization: Bearer <token> em /categories, /transactions, /reports/summary
```

> **Nota (sem Resend):** o link de verificação fica no CloudWatch.
> Console → **CloudWatch** → **Log groups** → `/aws/lambda/fluxy-dev-*` → procure
> `verification link for ...`. Copie o `token=` da URL e use no `/auth/verify-email`.

---

## 8. (Opcional) Produção

1. Crie um **projeto Neon de prod** separado (ou um banco/branch dedicado) e pegue as strings.
2. Crie os segredos sob `/fluxy/prod/` (passo 4, trocando `dev` por `prod`, incl. `database-url`).
3. No `samconfig.toml`, ajuste o `AppUrl` de prod para a **origem real do seu web app** (vira o CORS).
4. Deploy: `sam build && sam deploy --config-env prod`. Migrations: igual ao passo 6, com a
   connection string direta do Neon de prod.

---

## 9. Custo e como desligar tudo

- **AWS:** em repouso, praticamente **US$ 0** (Lambda free tier, sem VPC/NAT/RDS/Secrets Manager).
- **Neon:** o free tier cobre o MVP (scale-to-zero quando ocioso).
- Para **apagar o stack AWS:**

```bash
sam delete --stack-name fluxy-dev --region us-east-1
```

(Repita para `fluxy-prod` se tiver criado.) O banco no Neon você apaga pelo painel do Neon.

---

## 10. Problemas comuns

| Sintoma | O que fazer |
|--------|-------------|
| Deploy falha com `ROLLBACK_COMPLETE` preso | Stack anterior quebrado. Apague antes: `sam delete --stack-name fluxy-dev --region us-east-1`, depois `npm run deploy`. |
| Erro de permissão IAM no deploy | Rode `sam deploy --guided` e responda **Yes** em *Allow IAM role creation* (ou aceite `CAPABILITY_IAM`). |
| `/auth/...` retorna 5xx logo após deploy | Confira que os params `/fluxy/dev/database-url` e `/fluxy/dev/jwt-secret` existem (passo 4). |
| Migration/1ª request dá timeout | Neon acordando do scale-to-zero — espere alguns segundos e repita. |
| Migration falha de conexão | Garanta que está usando a string **direta (unpooled)** e com `?sslmode=require`. |
| Login retorna `EMAIL_NOT_VERIFIED` | Falta verificar o e-mail (passo 7 / nota do CloudWatch). |

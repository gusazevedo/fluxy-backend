# CLAUDE.md — Diretrizes do Projeto Fluxy

Estas regras são obrigatórias e têm precedência sobre qualquer preferência padrão.

## 1. SSD — System-Driven Development

O desenvolvimento é guiado pela especificação.

- **Nenhuma implementação ou ação deve ser tomada fora do escopo da especificação.**
- Se surgir qualquer necessidade não prevista na especificação (nova dependência,
  refatoração, decisão de arquitetura, mudança de contrato, etc.), **pare e consulte o
  desenvolvedor antes de prosseguir.** Não assuma, não antecipe, não "melhore" por conta própria.
- Em caso de dúvida sobre o escopo, perguntar é sempre preferível a implementar.

## 2. Testes (unitários + integração)

Toda implementação deve contemplar:

- **Testes unitários** — cobrindo a lógica/regras de negócio isoladamente.
- **Testes de integração** — cobrindo o comportamento ponta a ponta dos componentes.

Uma funcionalidade só é considerada concluída quando acompanhada de seus testes, e com a
suíte passando.

## 3. Lint — prioridade máxima

- O lint deve ser **sempre obedecido**, sem exceções.
- Código com erros ou avisos de lint **não é considerado pronto**.
- Não desabilitar regras de lint (inline ou na configuração) sem aprovação explícita do
  desenvolvedor.

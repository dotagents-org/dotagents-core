# Regra de commits

Vale para todo repositório. Regra de um projeto que contradiga esta fica no `.agents/rules/`
daquele projeto e diz o que muda.

Base: [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```
<emoji> <type>[optional scope]: <description>
```

- **Emoji obrigatório** (gitmoji), antes do `<type>`. Não é decoração opcional:
  a regra nasceu do histórico dos repositórios `modulo-web-backend` e
  `modulo-web-frontend` (another workspace), onde todo commit segue esse formato.
- `<type>` e `[scope]` seguem o Conventional Commits normal (`fix`, `feat`,
  `refactor`, `docs`, `chore`, `ci`, `style`, `perf`, `test`, `build`...).
  Escopo entre parênteses quando ajudar (`fix(auth): ...`).
- `nit` é uma extensão desta regra (não faz parte do Conventional Commits
  oficial) para correções cosméticas/não críticas — sempre com o emoji 🩹.
- **Descrição em inglês**, minúscula, sem ponto final.
- **Uma linha só** — sem corpo, sem lista de bullets.
- **Sem trailer de co-autoria** (`Co-Authored-By: ...`) mesmo quando o commit
  foi feito por um agente. Autoria do commit é sempre a do usuário (config
  local do `git`), nunca do agente.
- Mudança que quebra compatibilidade: `!` depois do type/scope, antes dos
  dois-pontos (`feat(api)!: ...`), ou rodapé `BREAKING CHANGE: ...` — mas
  como não há corpo/rodapé nesta convenção, prefira o `!` sempre que possível.
- Um commit por mudança logicamente independente. Não junte mudanças de
  schema com mudança de código de dois módulos não relacionados só porque
  aconteceram na mesma sessão — separe por tema, mesmo que exija reconstruir
  um arquivo em estágios (schema.prisma por exemplo).

## Legenda de emoji já em uso nestes repos

(Levantado de `git log`, não é lista fechada — mantenha o emoji que já
identifica o tipo de mudança quando existir precedente. Baseado no padrão
oficial [gitmoji.dev](https://gitmoji.dev).)

| Emoji | Uso |
|---|---|
| ✨ | `feat` — funcionalidade nova |
| 🐛 | `fix` — correção de bug |
| 🩹 | `nit` — correção não crítica, cosmética, de baixo impacto; descreve a ação de dar muita atenção a detalhes sem importância |
| ♻️ | `refactor` — refatoração sem mudar comportamento externo |
| 🗃️ | `feat(database)` / mudança de schema |
| 📝 | `docs` |
| 🚨 | `chore(lint)` — correção de warning de lint/compilador |
| ⚰️ | `chore` — remoção de código morto |
| 🧹 | `chore` — limpeza genérica (quando não é especificamente lint ou dead code) |
| 🔧 | `chore` — configuração |
| 👷 | `ci` |
| 💚 | `ci` — corrigir build da CI |
| 🐳 | mudança de Docker/Dockerfile |
| 🔒 | segurança / correção de vulnerabilidade |
| 🔐 | segredos (secrets, env, credenciais) |
| 🛂 | permissões / autorização |
| 🎨 | `style` — formatação, sem mudança de lógica |
| ✏️ | `fix` — correção de typo |
| 🔥 | remoção de código morto/arquivos (uso geral, além de ⚰️) |
| 🚚 | mover/renomear arquivos ou rotas |
| ⚡️ | `perf` — melhoria de performance |
| ✅ | `test` — adicionar/corrigir testes |
| 🚑️ | hotfix crítico |
| 🔖 | tag de release/versão |
| 🚧 | work in progress |
| 💥 | breaking change (alternativa ao `!`, usar `!` como preferência) |
| ⬆️ | upgrade de dependência |
| ⬇️ | downgrade de dependência |

## Exemplos reais deste histórico

```
🐛 fix(units): return null instead of throwing when a unit is not found
♻️ refactor: standardize file naming to kebab-case across modules
🗃️ feat(database): migrate schema and dev stack from MongoDB to PostgreSQL
🧹 chore(lint): clear remaining @typescript-eslint/no-unused-vars warnings
```

## Exemplos com os emojis novos

```
🩹 nit(ui): tighten spacing on button label
🚨 chore(lint): fix eslint warning on unused import
⚰️ chore: remove dead legacy auth middleware
✏️ fix(readme): correct typo in setup instructions
```

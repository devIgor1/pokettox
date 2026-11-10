# PokéCofre — Envio e Cofre de Cartas

Interface responsiva para colecionadores de Pokémon TCG, com registro persistente no cofre, integração SuperFrete, confirmação manual pela equipe e controle CSV de pedidos pagos.

Veja [OPERACAO.md](./OPERACAO.md) para configuração, fluxo de operação, limitações e testes.

## Rodando localmente

Requer Node 22.13+.

1. `npm ci` — instala as dependências.
2. Banco: Postgres no Neon (projeto `pokecofre`, branch `dev` para desenvolvimento).
   - `.env` → `DATABASE_URL_UNPOOLED` = URL **direta** (sem `-pooler`), usada pelas migrações.
   - `.env.local` → `DATABASE_URL` = URL **pooled** (com `-pooler`), usada pelo app.
   - Pegue as URLs com `neon connection-string dev` (direta) e `neon connection-string dev --pooled`.
3. `npm run db:migrate` — aplica as migrações de `drizzle/` no banco (rode de novo sempre que surgir migração nova).
4. Complete o `.env.local` com as demais variáveis do [OPERACAO.md](./OPERACAO.md) (ex.: `SUPERFRETE_TOKEN`, `ORIGIN_CEP`, `ADMIN_SETUP_TOKEN_HASH`...).
5. `npm run dev` — abre em http://localhost:3000.

Build: `npm run build` (Next.js). Produção local: `npm start`.

## Deploy (Vercel)

Projeto Next.js padrão; a Vercel detecta o framework sozinha (sem `vercel.json`).

1. Configure as variáveis do [OPERACAO.md](./OPERACAO.md) em **Settings → Environment Variables** (ambiente Production). `DATABASE_URL` = URL pooled do branch `production` do Neon.
2. Antes de publicar código com migração nova: `DATABASE_URL_UNPOOLED="<url direta do production>" npm run db:migrate`.
3. Deploy: push no `main` (com o repositório conectado na Vercel) ou `npx vercel --prod`.


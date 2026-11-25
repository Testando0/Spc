# Cloudflare Workers — Redspace

Esta configuração adiciona uma borda Cloudflare Workers sem substituir silenciosamente o backend Node/Socket.IO existente.

## Estado atual

O entrypoint `artifacts/api-server/src/worker.ts` já é um Worker Fetch válido e faz quatro coisas:

- serve o frontend compilado como Static Assets;
- responde `GET /api/healthz` e `GET /__worker_health` sem depender do Node;
- lê `/uploads/*` e `/avatars/*` de um bucket R2 quando o binding `MEDIA` estiver configurado;
- encaminha as rotas ainda não migradas para `LEGACY_ORIGIN`, preservando o comportamento atual durante a transição, inclusive o upgrade de `/socket.io/*`.

Isso é uma etapa de compatibilidade e não afirma que o monólito antigo já seja executável em Workers. O backend legado continua incompatível com Workers por depender de filesystem local, `child_process`/FFmpeg, pool PostgreSQL, SDK GCS/Replit, Express e Socket.IO em servidor Node.

## Desenvolvimento local

```bash
pnpm install
pnpm --filter @workspace/redspace-web build
pnpm exec wrangler dev --config wrangler.jsonc
```

A URL local de health é `http://localhost:8787/__worker_health`.

Para preservar todas as rotas enquanto a migração está em andamento, defina a origem do backend Node em um arquivo local não versionado ou na configuração do ambiente:

```bash
pnpm exec wrangler secret put LEGACY_ORIGIN
# informe, por exemplo, https://api.seu-dominio.example
```

Em produção, prefira uma variável de ambiente de ambiente (`[env.production.vars]`) para uma URL sem segredo e mantenha tokens somente em secrets. O repositório público não deve conter credenciais.

## Static Assets

O build do frontend produz `artifacts/redspace-web/dist/public`, que é o diretório configurado em `wrangler.jsonc`. A regra SPA mantém o `index.html` para rotas de navegação do cliente, enquanto `run_worker_first` garante que API, mídia e Socket.IO passem primeiro pelo Worker.

## Próximas etapas obrigatórias para remover o backend legado

1. Criar o D1 e substituir o SQL PostgreSQL por migrações SQLite versionadas. Não executar `CREATE TABLE` no cold start.
2. Migrar upload, avatar e sticker para R2 com chaves geradas pelo servidor. Não transportar mídia como base64 em JSON.
3. Substituir Socket.IO por WebSockets nativos com Durable Objects, preservando gradualmente os nomes de eventos usados pelo cliente.
4. Trocar timers residentes e mapas globais por alarmes de Durable Objects, D1 e Queues.
5. Retirar `fs`, `child_process`, FFmpeg/FFprobe, `pg`, GCS/Replit e `web-push` Node do bundle do Worker.
6. Migrar autenticação do header `x-username` para sessão assinada ou token verificável, mantendo compatibilidade somente durante a transição.
7. Exportar e validar os dados atuais antes do cutover. O proxy deve permanecer ativo até as rotas equivalentes passarem pelos testes de contrato.

A configuração de bindings de D1, R2, Durable Objects e Queues deve ser adicionada somente depois que os IDs e nomes reais dos recursos forem criados na conta Cloudflare. O arquivo atual é deliberadamente implantável sem apontar para recursos inexistentes.

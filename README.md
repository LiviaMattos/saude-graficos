# Gráficos de evolução dos exames

Lê a base **📈 Marcadores de exames** do Notion e publica uma página com um gráfico por marcador
(faixa de referência, último valor, tendência) no GitHub Pages. Roda todo dia às 6h e sob demanda.

Os dados não ficam no repositório: só no site publicado, num endereço com uma chave secreta.

## Configuração (uma vez)

1. **Integração do Notion:** em https://www.notion.so/profile/integrations crie uma integração interna
   ("Saúde gráficos", só leitura), copie o token. Na página Saúde do Notion: `•••` → *Conexões* → adicione a integração.
2. **Segredos do GitHub:** em *Settings → Secrets and variables → Actions* crie:
   - `NOTION_TOKEN`: o token da integração
   - `PAGE_KEY`: uma palavra longa e aleatória (ex.: `graf-8k2p9x4m7q`), que vira parte do endereço
3. **Pages:** em *Settings → Pages*, em *Source*, escolha **GitHub Actions**.
4. Em *Actions → Publicar gráficos → Run workflow*. A página fica em
   `https://liviamattos.github.io/saude-graficos/<PAGE_KEY>/`

## Usar no Notion

Na página Saúde digite `/embed` e cole o endereço. Filtros pelo endereço:
- `?g=Vitaminas` abre só um grupo
- `?m=Vitamina D,Ferritina` mostra só esses marcadores

## Teste local

```
DATA_FILE=exemplo.local.json node scripts/build.mjs
```

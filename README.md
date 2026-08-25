# Three Ar — Extensão de Automação de Cotações

Extensão do Chrome (Manifest V3) que automatiza operações de cotação no portal
[prycable.com.br](https://www.prycable.com.br) para a Three Ar Representações.

Em vez de clicar item por item na tela, você cola uma lista e a extensão faz o
trabalho chamando a própria API do portal, reaproveitando a sessão já logada.
Sem build, sem dependências, sem servidor.

> [!WARNING]
> Ferramenta **interna e não oficial**, sem vínculo com a Prycable. Duas abas
> **gravam dados reais** no ERP (`Adicionar Produtos` cria rascunho de cotação e
> `Follow-up` altera o status de cotações existentes). Teste sempre com uma
> cotação antes de rodar um lote.

---

## Recursos

| Aba | O que faz | Entrada | Saída |
| --- | --- | --- | --- |
| **Adicionar** | Cria um rascunho de cotação com vários produtos de uma vez | `código,quantidade` por linha | Cotação salva como rascunho no portal |
| **Descrições** | Busca descrição, quantidade mínima e múltiplo dos produtos | um código por linha | TSV no clipboard, pronto para colar no Excel |
| **Oferta CRM** | Valoriza os produtos com desconto e formata o bloco da oferta | `código,quantidade` + % de desconto | Texto formatado para colar no CRM |
| **Buscar Preço** | Só o preço unitário, na ordem exata da lista | `código` ou `código,quantidade` + % de desconto | Uma coluna de preços para colar no Excel |
| **Follow-up** | Muda o status ("motivo") de cotações | número da cotação por linha + motivo + observação | Status gravado no ERP |

Detalhes que economizam tempo no dia a dia:

- **Validações antes de gravar** — quantidade abaixo do mínimo ou produto
  inexistente pausam a execução, com opção de corrigir a linha e continuar,
  pular o item ou parar tudo.
- **Alinhamento com o Excel** — na aba Buscar Preço, linha vazia na entrada gera
  linha vazia na saída, então a coluna colada volta alinhada com a sua planilha.
- **Quantidade opcional** — na aba Buscar Preço, código sozinho é precificado na
  quantidade mínima do produto.
- **Tudo persistido** — listas, desconto, observação e o log das últimas 200
  linhas sobrevivem ao fechamento do popup (que o Chrome destrói a cada perda de
  foco), e a execução continua rodando na aba enquanto isso.
- **Parar a qualquer momento** — o botão de parada interrompe o laço na próxima
  iteração.
- **Confirmação em dois cliques** na aba Follow-up, por ser gravação em lote no ERP.

## Instalação

Não há etapa de build.

1. Baixe ou clone este repositório
2. Abra `chrome://extensions/`
3. Ative o **Modo do desenvolvedor**
4. **Carregar sem compactação** → selecione a pasta do projeto

Depois de qualquer alteração no código, clique no ícone de **atualizar** no card
da extensão.

## Uso

1. Abra o portal e **faça login** — a extensão usa a sua sessão, não tem login próprio
2. Para as abas de produto, selecione o cliente no portal (o nome aparece na
   barra do popup como confirmação)
3. Abra a extensão, escolha a aba, cole a lista e clique em **Executar**
4. Acompanhe pelo log; ao final, use o botão de copiar da aba

O prefixo de numeração é tolerado nas listas (`1. 26669814`, `23) 26669814`), e
`código,quantidade` também aceita `;` ou TAB como separador na aba Buscar Preço —
colar duas colunas do Excel funciona.

## Como funciona

O Manifest V3 isola o mundo dos scripts de extensão do mundo da página, então a
comunicação passa por três camadas:

```
popup.js  (contexto da extensão)
   │  chrome.scripting.executeScript({ func, world: 'MAIN' })
   ▼
script na página  (MAIN world — enxerga o localStorage e a sessão do site)
   │  window.postMessage({ source: 'PRYCABLE_AUTOMATION', ... })
   ▼
content-bridge.js  (ISOLATED world)
   │  chrome.runtime.sendMessage(...)
   ▼
popup.js  → log, barra de progresso, estado
```

O MAIN world é necessário porque é lá que estão o token e os dados do cliente
(`@cable-Token`, `@cable-User`, `@cable-Customer` no `localStorage`) e é de lá que
o `fetch` sai como se fosse o próprio site.

Endpoints do portal usados (todos same-origin):

- `GET /api/product/` — dados do produto
- `GET /services/dictionary/getOfferAuxTables` — condições padrão do cliente
- `POST /api/offer` — salva o rascunho da cotação
- `POST /api/product/valorize` — preços com desconto
- `GET /services/dictionary/getOfferSearchAuxTables` — dicionário de motivos
- `PUT /api/offer/{numero}` — grava o status no follow-up

Arquitetura detalhada em [CLAUDE.md](CLAUDE.md).

## Segurança e privacidade

- **Nenhum servidor externo.** Todas as chamadas vão para o próprio
  `prycable.com.br`. Não há telemetria, analytics ou envio de dados para
  terceiros — a única requisição externa é a fonte Inter do Google Fonts, usada
  pelo popup (offline ele cai na fonte do sistema).
- **O token nunca sai do navegador** e não é gravado em log nem em
  `chrome.storage`; é lido do `localStorage` da página no momento da chamada.
- **Permissões pedidas** no `manifest.json`: `activeTab` e `scripting` (injetar o
  script na aba que você abriu), `tabs` (identificar a aba ativa) e `storage`
  (guardar suas listas e o log). Não há `host_permissions` amplo — a extensão só
  age na aba ativa quando você abre o popup.
- **O log fica em `chrome.storage.local`** (últimas 200 linhas) e pode conter
  códigos de produto, números de cotação e preços. Use o botão *limpar* do
  console se for compartilhar a tela.

## Estrutura

```
manifest.json        Manifest V3, permissões, ícones
popup.html           UI: 5 abas, log, barras de progresso/pausa
popup.css            Tema escuro glassmorphism (Inter + ciano)
popup.js             Toda a lógica: scripts injetados + orquestração da UI
content-bridge.js    Ponte MAIN world → popup
background.js        Persiste log/estado com o popup fechado
images/LogoCRM.png   Ícone
CLAUDE.md            Notas de arquitetura para trabalho com IA no repo
```

## Limitações conhecidas

- O formato de `statusDate` para o motivo **Y08 (Em Negociação)** — o único que
  exige prazo — não foi capturado do portal; é enviado como ISO `AAAA-MM-DD` e
  ainda não foi validado em produção.
- A API de status não tem endpoint em lote: o follow-up faz um `PUT` sequencial
  por cotação.
- Não há testes automatizados; a verificação é manual, pelo log do popup.
- `images/LogoCRM.png` tem ~1,4 MB para um ícone de 38 px — vale reduzir.
- Os scripts injetados repetem blocos entre si (autenticação, busca de produto).
  É estrutural: `executeScript({ func })` serializa **uma** função, então helpers
  não podem ser compartilhados por referência.

## Licença e publicação

Este repositório documenta endpoints internos do ERP de um fornecedor. **Considere
mantê-lo privado.** Sem um arquivo de licença, o padrão do GitHub é "todos os
direitos reservados" — defina a licença antes de tornar o repositório público.

# PokéCofre — operação

Aplicação em português para registrar cartas no cofre e solicitar envios por PAC/SEDEX. Os dados ficam no banco D1. A cotação usa a API real do SuperFrete, sem preços de demonstração.

## Configuração pendente

Configure as seguintes variáveis no ambiente do Site e publique novamente. Não coloque tokens no navegador, no Git ou neste documento.

| Variável | Conteúdo |
| --- | --- |
| SUPERFRETE_TOKEN | Token de produção, armazenado como segredo |
| SUPERFRETE_CONTACT_EMAIL | E-mail de contato técnico exigido pelo SuperFrete |
| ORIGIN_CEP | CEP de onde as cartas serão postadas, 8 dígitos |
| PACKAGE_WEIGHT_KG | Peso da embalagem padrão, em kg, com ponto decimal |
| PACKAGE_HEIGHT_CM | Altura da embalagem, em cm |
| PACKAGE_WIDTH_CM | Largura, em cm |
| PACKAGE_LENGTH_CM | Comprimento, em cm |
| PAYMENT_INSTRUCTIONS | Instruções reais de pagamento; por padrão a equipe contata o cliente |
| ADMIN_EMAILS | E-mails permitidos na equipe, separados por vírgulas, após login pelo ChatGPT |

O proprietário já está na lista de acesso da equipe. O Site é publicado com acesso privado. Para clientes externos usarem, a política de compartilhamento precisa ser alterada explicitamente pelo proprietário.

## Cálculo do seguro

O cliente informa o valor declarado das cartas. O servidor consulta PAC e SEDEX com e sem seguro. Seguro = preço segurado − preço sem seguro. Total = frete sem seguro + seguro + R$ 4,00. Não adiciona o valor declarado ao frete, nem cobra o seguro duas vezes. Todos os valores internos são centavos inteiros.

Essa implementação usa o seguro da transportadora. Não existe uma tarifa extra de seguro da loja; se essa for a intenção, defina a regra antes de ativar. A equipe deve conferir o valor declarado e se as medidas padrão servem ao pedido antes de despachar. O sistema não compra etiquetas nem realiza pagamentos.

## Uso diário

1. O cliente preenche nome, CPF, telefone e endereço. O CEP pode preencher o endereço; se a consulta falhar, os campos continuam editáveis.
2. Cofre: confirmação grava status **no cofre**, sem cotação e sem pagamento.
3. Envio: cotação real, válida por 15 minutos e vinculada ao CEP e navegador. O cliente revisa o total e confirma. Status inicial: **aguardando pagamento**.
4. A equipe acessa `/equipe`, verifica o recebimento fora do sistema e confirma o pagamento. Nome do responsável e data são registrados no banco. Confirmar a solicitação como cliente nunca marca pagamento recebido.
5. O botão **Planilha de pagos** baixa um CSV UTF-8 com nome, telefone, PAC/SEDEX e **pago / pronto para envio**. Ele consulta todos os pedidos pagos e se atualiza a cada download, sem incluir cofre nem pedidos pendentes. Abre no Excel e pode ser importado no Google Sheets. Não há sincronização com uma planilha externa enquanto nenhum destino for configurado.

## Desenvolvimento e verificação

- `npm run dev`: prévia local.
- `npm run build`: build Vinext/Cloudflare.
- `node node_modules/typescript/bin/tsc --noEmit`: tipos.
- `node scripts/verify-domain.mjs`: CPF, cálculo e CSV.
- `node scripts/verify-api.mjs`: integração local; requer D1 migrado e `.dev.vars` com `ADMIN_EMAILS=seedy@sites.test`. Gera e remove somente suas próprias fixtures locais. Não executar contra produção.
- `npm run db:generate`: gerar novas migrações. Nunca editar migrações já publicadas.

Dados do cliente não são persistidos no armazenamento do navegador. Endpoints da equipe verificam autenticação e lista de e-mails no servidor. A confirmação e o registro são idempotentes; custos/status enviados pelo cliente não têm autoridade. Chamadas mutáveis conferem origem, JSON e tamanho da requisição. Limites de tentativas protegem cotação e criação de pedidos.

## Referências

- [SuperFrete: autenticação](https://superfrete.readme.io/reference/primeiros-passos)
- [SuperFrete: cotação e valor declarado](https://superfrete.readme.io/reference/cotacao-de-frete)
- [ViaCEP](https://viacep.com.br/)
- Arte do Pikachu: [PokeAPI, arte oficial](https://github.com/PokeAPI/sprites/blob/master/sprites/pokemon/other/official-artwork/25.png). Pokémon e personagens pertencem aos respectivos titulares. A página não implica vínculo oficial.

Sem token e configuração do pacote, o caminho do cofre funciona e o frete permanece indisponível. A integração com o SuperFrete precisa de um teste real depois da configuração da conta.

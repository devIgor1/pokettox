# PokéCofre — operação

Aplicação em português para registrar cartas no cofre e solicitar envios por PAC/SEDEX. Os dados ficam no banco D1. A cotação usa a API real do SuperFrete, sem preços de demonstração.

## Configuração

Configure as seguintes variáveis no ambiente do Site e publique novamente. Não coloque tokens no navegador, no Git ou neste documento.

| Variável | Conteúdo |
| --- | --- |
| SUPERFRETE_TOKEN | Token de produção, armazenado como segredo |
| SUPERFRETE_CONTACT_EMAIL | Opcional. Sem e-mail, o User-Agent identifica o site por sua URL |
| ORIGIN_CEP | CEP de onde as cartas serão postadas, 8 dígitos |
| PACKAGE_WEIGHT_KG | Peso da embalagem padrão, em kg, com ponto decimal |
| PACKAGE_HEIGHT_CM | Altura da embalagem, em cm |
| PACKAGE_WIDTH_CM | Largura, em cm |
| PACKAGE_LENGTH_CM | Comprimento, em cm |
| PAYMENT_INSTRUCTIONS | Instruções reais de pagamento; por padrão a equipe contata o cliente |
| ADMIN_SETUP_TOKEN_HASH | SHA-256 de um convite aleatório de 256 bits para cadastrar o primeiro administrador; segredo |
| ADMIN_SETUP_EXPIRES_AT | Expiração do convite, em milissegundos Unix |

O Site tem acesso público autorizado pelo proprietário; a área da equipe usa e-mail e senha próprios. O login do ChatGPT e a antiga variável ADMIN_EMAILS não concedem acesso administrativo. A origem está configurada como 02335-090, com embalagem de 6 cm de altura × 11 cm de largura × 16 cm de comprimento e peso de 0,300 kg. O token do SuperFrete fica no ambiente de produção como segredo.

## Acesso administrativo

1. O responsável recebe privadamente `/equipe/configurar#convite=TOKEN`. O token não fica no código nem no banco: apenas seu hash é configurado como segredo. O convite expira em 72 horas e só cria uma conta, mesmo com envios simultâneos.
2. Quem recebe o convite escolhe o e-mail (Gmail ou outro) e uma senha de 15 a 128 caracteres. O site não verifica a caixa postal e não usa a senha do provedor de e-mail.
3. O código de recuperação é exibido uma única vez, com opção de baixar. Ele permite redefinir a senha em `/equipe/recuperar`, sem depender de serviço de e-mail. Cada recuperação invalida o código anterior e mostra um novo. Guarde-o em local privado.
4. O login diário é `/equipe/entrar`. Em **Meu acesso**, o administrador pode trocar e-mail ou senha confirmando a senha atual. A troca encerra as outras sessões. **Sair** revoga a sessão no servidor.
5. Senhas usam scrypt com salt individual (N=32768, r=8, p=3). Sessões aleatórias de 256 bits são armazenadas por hash, expiram em 8 horas e usam cookie `__Host-`, Secure, HttpOnly e SameSite=Strict em produção. O cookie local de desenvolvimento nunca é aceito no build de produção. Tentativas são limitadas por IP e por e-mail.

Não existe cadastro público de administrador. Se o convite vencer antes do primeiro cadastro, gere um novo token e substitua as duas variáveis de configuração, publicando novamente. Depois de criado o administrador, trocar essas variáveis não cria outra conta nem redefine a senha. Para perda de senha, use o código de recuperação; não há envio automático de e-mail. Perder senha e código exige intervenção do responsável pela hospedagem.

O endereço dos formulários é relativo ao domínio acessado. Ao conectar domínio próprio, verifique login e cookies nesse domínio; sessões de outro domínio não são compartilhadas.

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
- `node scripts/verify-auth.mjs`: login, convite de uso único, recuperação, troca de acesso, bloqueios e revogação. Requer banco local migrado sem administrador principal e `.dev.vars` com hash SHA-256 de `t` repetido 43 vezes e expiração futura para o convite de teste. Nunca configure esse convite em produção.
- `node scripts/verify-api.mjs`: regressão local de pedidos e pagamentos; cria um administrador de teste, entra com senha e remove apenas suas fixtures. Requer D1 migrado. Não executar contra produção.
- `npm run db:generate`: gerar novas migrações. Nunca editar migrações já publicadas.

Dados do cliente não são persistidos no armazenamento do navegador. Todos os endpoints da equipe verificam a sessão e a conta ativa no servidor. A confirmação e o registro são idempotentes; custos/status enviados pelo cliente não têm autoridade. Chamadas mutáveis conferem origem, JSON e tamanho da requisição. Limites de tentativas protegem cotação e criação de pedidos.

## Referências

- [OWASP: armazenamento de senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Cloudflare: suporte a node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)

- [SuperFrete: autenticação](https://superfrete.readme.io/reference/primeiros-passos)
- [SuperFrete: cotação e valor declarado](https://superfrete.readme.io/reference/cotacao-de-frete)
- [ViaCEP](https://viacep.com.br/)
- Arte do Pikachu: [PokeAPI, arte oficial](https://github.com/PokeAPI/sprites/blob/master/sprites/pokemon/other/official-artwork/25.png). Pokémon e personagens pertencem aos respectivos titulares. A página não implica vínculo oficial.

Sem token e configuração do pacote, o caminho do cofre funciona e o frete permanece indisponível. Em 23/09/2026, a API de produção respondeu com sucesso para PAC e SEDEX, com e sem seguro, identificando a aplicação pela URL do site e sem e-mail.

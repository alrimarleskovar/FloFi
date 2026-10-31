// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet, the wallet origin's pages (pt-BR). "FloFi Wallet" is a product name and stays as is. */
export const portugueseWallet: Readonly<Record<string, string>> = {
  // Frame
  'FloFi Wallet': 'FloFi Wallet', 'FloFi account': 'Conta FloFi', 'Language': 'Idioma', 'Dark theme': 'Tema escuro',
  'Unlocked': 'Desbloqueada', 'Unlocked · {0} min left': 'Desbloqueada · {0} min restantes', 'Locked': 'Bloqueada', 'Lock': 'Bloquear', 'Locking…': 'Bloqueando…',
  'Codes are typed and signatures approved only here, at {0}. Nothing is signed without your click.':
    'Códigos são digitados e assinaturas aprovadas somente aqui, em {0}. Nada é assinado sem o seu clique.',
  'Nothing is signed without your click.': 'Nada é assinado sem o seu clique.',
  'FloFi Wallet isn’t available here': 'A FloFi Wallet não está disponível aqui',
  'This deployment has no FloFi Wallet configured, so it can’t create, unlock or sign anything. You can keep using MetaMask, Phantom or Solflare in FloFi.':
    'Esta implantação não tem a FloFi Wallet configurada, então ela não pode criar, desbloquear nem assinar nada. Você pode continuar usando MetaMask, Phantom ou Solflare no FloFi.',
  'Go to FloFi': 'Ir para o FloFi',
  // Window states
  'Opening FloFi Wallet…': 'Abrindo a FloFi Wallet…', 'Connecting to FloFi…': 'Conectando ao FloFi…',
  'Open FloFi Wallet from FloFi': 'Abra a FloFi Wallet pelo FloFi',
  'FloFi Wallet works together with FloFi. In FloFi, open Credentials → My wallets, or choose FloFi Wallet when you connect a wallet: FloFi opens this window for your account.':
    'A FloFi Wallet funciona junto com o FloFi. No FloFi, abra Credenciais → Minhas carteiras, ou escolha FloFi Wallet ao conectar uma carteira: o FloFi abre esta janela para a sua conta.',
  'For your safety, this window never takes its account from a link.': 'Para a sua segurança, esta janela nunca recebe a conta por um link.',
  'FloFi Wallet is locked': 'A FloFi Wallet está bloqueada', 'FloFi Wallet is not connected': 'A FloFi Wallet não está conectada',
  'Nothing can be signed from this window now. To use FloFi Wallet again, open it from FloFi.':
    'Nada pode ser assinado nesta janela agora. Para usar a FloFi Wallet de novo, abra-a pelo FloFi.',
  'Close window': 'Fechar janela', 'Your FloFi Wallets': 'Suas FloFi Wallets', 'No FloFi Wallet yet. Create or import one from FloFi.':
    'Nenhuma FloFi Wallet ainda. Crie ou importe uma pelo FloFi.',
  'Return to FloFi to continue. This window asks you whenever FloFi needs a signature.':
    'Volte ao FloFi para continuar. Esta janela pergunta a você sempre que o FloFi precisar de uma assinatura.',
  'FloFi can now see the addresses of your FloFi Wallets.': 'O FloFi agora pode ver os endereços das suas FloFi Wallets.',
  'FloFi Wallet now serves another FloFi account: {0}. Check that it is yours before you continue.':
    'A FloFi Wallet agora atende outra conta FloFi: {0}. Confira se ela é sua antes de continuar.',
  'FloFi Wallet is unlocked': 'A FloFi Wallet está desbloqueada', 'Sign-in did not complete': 'O login não foi concluído',
  'You can close this window and return to FloFi Wallet.': 'Você pode fechar esta janela e voltar para a FloFi Wallet.',
  // Unlock
  'Verify it’s you': 'Confirme que é você', 'Unlock FloFi Wallet': 'Desbloquear a FloFi Wallet',
  'Unlocking proves it’s you to the wallet provider. Your keys stay with Turnkey; FloFi never holds them.':
    'Desbloquear prova ao provedor de carteiras que é você. Suas chaves ficam com a Turnkey; o FloFi nunca as guarda.',
  'Unlock again to export': 'Desbloqueie de novo para exportar',
  'Export needs an unlock in the last 5 minutes. Unlock again with your email code, Google or Apple.':
    'Exportar exige um desbloqueio nos últimos 5 minutos. Desbloqueie de novo com o código por email, Google ou Apple.',
  'Unlock now': 'Desbloquear agora',
  'Unlock now so FloFi Wallet is ready when FloFi asks for a signature. Unlocking never signs anything by itself.':
    'Desbloqueie agora para a FloFi Wallet estar pronta quando o FloFi pedir uma assinatura. Desbloquear nunca assina nada por si só.',
  'This FloFi account has no sign-in that can unlock FloFi Wallet. Add Google, Apple or email to your account in FloFi first.':
    'Esta conta FloFi não tem um login que desbloqueie a FloFi Wallet. Adicione Google, Apple ou email à sua conta no FloFi primeiro.',
  'Unlock methods': 'Formas de desbloquear', 'Email me a code': 'Enviar um código por email', 'Continue with Google': 'Continuar com Google',
  'Continue with Apple': 'Continuar com Apple', 'Sending code…': 'Enviando código…', 'Not available': 'Indisponível',
  'Not available on this deployment yet': 'Ainda não disponível nesta implantação',
  'We emailed an 8-character FloFi Wallet code to {0}.': 'Enviamos por email um código da FloFi Wallet de 8 caracteres para {0}.',
  'FloFi Wallet code': 'Código da FloFi Wallet',
  'Type this code only here, in FloFi Wallet at {0}. FloFi never asks for it anywhere else.':
    'Digite este código somente aqui, na FloFi Wallet em {0}. O FloFi nunca o pede em nenhum outro lugar.',
  'Unlock': 'Desbloquear', 'Unlocking…': 'Desbloqueando…', 'Send a new code': 'Enviar um novo código',
  'Finish signing in with Google in the window that opened.': 'Conclua o login com Google na janela que abriu.',
  'Finish signing in with Apple in the window that opened.': 'Conclua o login com Apple na janela que abriu.',
  'Cancel': 'Cancelar', 'Try again': 'Tentar novamente',
  // Requests
  'Requested by {0}': 'Solicitado por {0}', 'Review everything above, then sign.': 'Revise tudo acima e então assine.',
  'Sign becomes available in a moment.': 'Assinar fica disponível em um instante.', 'Click this window to continue.': 'Clique nesta janela para continuar.',
  'Sign': 'Assinar', 'Signing…': 'Assinando…', 'Opening…': 'Abrindo…',
  'New wallet': 'Nova carteira', 'Create a {0} wallet': 'Criar uma carteira {0}', 'Create wallet': 'Criar carteira', 'Creating…': 'Criando…',
  'Turnkey generates the wallet in its secure enclave. FloFi saves only its public address to your account; you can export its recovery phrase here later.':
    'A Turnkey gera a carteira no seu enclave seguro. O FloFi salva na sua conta apenas o endereço público; você pode exportar a frase de recuperação aqui depois.',
  '{0} wallet created: {1}': 'Carteira {0} criada: {1}',
  'Import': 'Importar', 'Import a {0} key': 'Importar uma chave {0}', 'Import wallet': 'Importar carteira', 'Importing…': 'Importando…',
  'Paste the private key (64 hexadecimal characters) of the wallet you want to bring.': 'Cole a chave privada (64 caracteres hexadecimais) da carteira que você quer trazer.',
  'Paste the private key (base58) of the Solana wallet you want to bring.': 'Cole a chave privada (base58) da carteira Solana que você quer trazer.',
  'Type or paste it only into the secure field below. It belongs to Turnkey, on its own domain: FloFi cannot read it, and it is encrypted before it leaves this field.':
    'Digite ou cole somente no campo seguro abaixo. Ele pertence à Turnkey, no próprio domínio dela: o FloFi não consegue lê-lo, e a chave é criptografada antes de sair desse campo.',
  'Turnkey secure key field': 'Campo seguro de chave da Turnkey', 'Opening the secure field…': 'Abrindo o campo seguro…', '{0} key imported: {1}': 'Chave {0} importada: {1}',
  'Export': 'Exportar', 'recovery phrase': 'frase de recuperação', 'private key': 'chave privada', 'Show the {0} of {1}': 'Mostrar a {0} de {1}',
  'Wallet': 'Carteira', 'Turnkey secure export': 'Exportação segura da Turnkey',
  'Anyone who sees this {0} can take everything in this wallet, on every network. FloFi and Turnkey can’t undo that. Make sure no one can see your screen.':
    'Qualquer pessoa que veja esta {0} pode levar tudo o que está nesta carteira, em todas as redes. O FloFi e a Turnkey não podem desfazer isso. Garanta que ninguém consiga ver sua tela.',
  'I understand, and I’m in a private place.': 'Eu entendo, e estou em um lugar reservado.',
  'Show recovery phrase': 'Mostrar frase de recuperação', 'Show private key': 'Mostrar chave privada',
  'Write it down and keep it offline. Choose Done to hide it.': 'Anote e guarde offline. Escolha Concluir para escondê-la.',
  'Done': 'Concluir', 'Export closed.': 'Exportação fechada.',
  // Signing
  'Sign-in': 'Login', 'Sign in to FloFi with {0}': 'Entrar no FloFi com {0}', 'FloFi’s own sign-in message': 'A mensagem de login do próprio FloFi',
  'It proves you control this wallet. It authorizes no transaction and moves no funds.': 'Ela prova que você controla esta carteira. Não autoriza nenhuma transação e não move fundos.',
  'Website': 'Site', 'Chain ID': 'ID da chain', 'Expires': 'Expira', 'Full message': 'Mensagem completa', 'Signed in to FloFi with {0}.': 'Login no FloFi feito com {0}.',
  'Transaction': 'Transação', 'Sign a transaction on {0}': 'Assinar uma transação na {0}', 'Sign a Solana transaction': 'Assinar uma transação Solana',

  'Checking this request against your Review in FloFi…': 'Conferindo este pedido com a sua Revisão no FloFi…',
  // Summary lines built by FloFi's server (server/managed-signing.ts)
  'Network fee (estimate)': 'Taxa de rede (estimativa)', 'Approve': 'Aprovar', 'For': 'Para', 'Max network fee': 'Taxa de rede máxima',
  'Max network fee (set by FloFi Wallet)': 'Taxa de rede máxima (definida pela FloFi Wallet)',
  'Max network fee before the L1 data fee': 'Taxa de rede máxima antes da taxa de dados L1',
  'Max network fee before the L1 data fee (set by FloFi Wallet)': 'Taxa de rede máxima antes da taxa de dados L1 (definida pela FloFi Wallet)',
  'Maximum cost before the L1 data fee': 'Custo máximo antes da taxa de dados L1',
  'The FloFi page that asked for this was closed, so FloFi Wallet signed nothing. Start again from FloFi.':
    'A página do FloFi que pediu isto foi fechada, então a FloFi Wallet não assinou nada. Comece de novo pelo FloFi.',
  'The FloFi page that asked for this was closed before it received the signature. FloFi Wallet discarded it and nothing was sent. Check the status in FloFi before you try again.':
    'A página do FloFi que pediu isto foi fechada antes de receber a assinatura. A FloFi Wallet a descartou e nada foi enviado. Confira o status no FloFi antes de tentar de novo.',
  'Prepared by FloFi': 'Preparado pelo FloFi', 'Exactly the transaction FloFi prepared for this strategy': 'Exatamente a transação que o FloFi preparou para esta estratégia',
  'Check every line below before you sign.': 'Confira cada linha abaixo antes de assinar.',
  'Network': 'Rede', 'Real funds': 'Fundos reais', 'Review expires': 'A Revisão expira',
  'Signed. FloFi sends the transaction and records the result.': 'Assinado. O FloFi envia a transação e registra o resultado.',
  'What you are signing': 'O que você está assinando', 'From': 'De', 'To': 'Para', 'Sends': 'Envia', 'Action': 'Ação', 'Nonce': 'Nonce', 'Gas limit': 'Limite de gas',
  'Max fee per gas': 'Taxa máxima por gas', 'Max priority fee': 'Taxa de prioridade máxima', 'Maximum total cost': 'Custo total máximo',
  'Plain transfer, no contract call': 'Transferência simples, sem chamada de contrato', 'Token transfer': 'Transferência de token',
  'Token transfer from another address': 'Transferência de token a partir de outro endereço', 'Token contract': 'Contrato do token', 'Recipient': 'Destinatário',
  'Amount': 'Quantia', '{0} (token base units)': '{0} (unidades base do token)', 'Token approval': 'Aprovação de token', 'Token permit': 'Permissão de token (permit)',
  'Allowance increase': 'Aumento de permissão', 'Spender': 'Quem pode gastar', 'Allowance': 'Permissão', 'Unlimited': 'Ilimitada',
  'Approval for all items': 'Aprovação para todos os itens', 'Revoke approval for all items': 'Revogar aprovação para todos os itens', 'Collection': 'Coleção',
  'Operator': 'Operador', 'Contract call (not decoded)': 'Chamada de contrato (não decodificada)', 'Function selector': 'Seletor de função', 'Call data': 'Dados da chamada',
  '{0} bytes': '{0} bytes', 'Show call data': 'Mostrar dados da chamada',
  'This gives the spender unlimited access to this token in your wallet, now and later.': 'Isto dá a quem pode gastar acesso ilimitado a este token na sua carteira, agora e depois.',
  'This lets the operator move every item of this collection in your wallet.': 'Isto permite ao operador mover todos os itens desta coleção na sua carteira.',
  'Fee payer': 'Pagador da taxa', 'Signatures': 'Assinaturas', 'Maximum network fee': 'Taxa máxima da rede', 'Message SHA-256': 'SHA-256 da mensagem',
  'Programs': 'Programas', 'Unknown program': 'Programa desconhecido', 'Instructions': 'Instruções',
  'This transaction uses a durable nonce: it stays valid until it is used, not for about a minute like most transactions.':
    'Esta transação usa um durable nonce: ela continua válida até ser usada, e não por cerca de um minuto como a maioria das transações.',
  'Some accounts come from address lookup tables; the network resolves them. FloFi checked them against your Review.':
    'Algumas contas vêm de tabelas de endereços (lookup tables); a rede as resolve. O FloFi as conferiu com a sua Revisão.',
  'Lookup table account #{0}': 'Conta da lookup table nº {0}', 'Send {0}': 'Enviar {0}', 'Create an account funded with {0}': 'Criar uma conta com {0}',
  'Use a durable nonce': 'Usar um durable nonce', 'Token transfer of {0}': 'Transferência de token de {0}', 'Token approval: unlimited': 'Aprovação de token: ilimitada',
  'Token approval of {0}': 'Aprovação de token de {0}', 'Delegate: {0}': 'Delegado: {0}', 'Revoke a token approval': 'Revogar uma aprovação de token',
  'Change a token account’s authority': 'Mudar a autoridade de uma conta de token', 'No authority (removed)': 'Sem autoridade (removida)',
  'Close a token account': 'Fechar uma conta de token', 'Rent goes to {0}': 'O aluguel (rent) vai para {0}', 'Compute limit: {0} units': 'Limite de computação: {0} unidades',
  'Priority fee: {0} micro-lamports per unit': 'Taxa de prioridade: {0} micro-lamports por unidade', 'Instruction (not decoded)': 'Instrução (não decodificada)',
  '{0} accounts, {1} bytes of data': '{0} contas, {1} bytes de dados',
  // Codes (src/wallet-app/wallet-messages.ts)
  'FloFi Wallet could not confirm the result of this signature. Any signature was discarded and nothing was sent. Check the status in FloFi before you try again.':
    'A FloFi Wallet não conseguiu confirmar o resultado desta assinatura. Qualquer assinatura foi descartada e nada foi enviado. Confira o status no FloFi antes de tentar de novo.',
  'The wallet provider returned a different transaction from the one you approved. FloFi Wallet discarded it and sent nothing.':
    'O provedor de carteiras devolveu uma transação diferente da que você aprovou. A FloFi Wallet a descartou e não enviou nada.',
  'The sign-in did not finish within 3 minutes. Nothing was unlocked. Try again.': 'O login não terminou em 3 minutos. Nada foi desbloqueado. Tente de novo.',
  'FloFi Wallet could not safely finish unlocking. Nothing was unlocked. Start again.': 'A FloFi Wallet não conseguiu concluir o desbloqueio com segurança. Nada foi desbloqueado. Comece de novo.',
  'Your browser blocked the sign-in window. Allow pop-ups for FloFi Wallet, then try again.': 'Seu navegador bloqueou a janela de login. Permita pop-ups para a FloFi Wallet e tente de novo.',
  'FloFi Wallet switched to another FloFi account. This request was cancelled and nothing was signed.':
    'A FloFi Wallet passou para outra conta FloFi. Este pedido foi cancelado e nada foi assinado.',
  'FloFi Wallet could not read this request, so it signed nothing.': 'A FloFi Wallet não conseguiu ler este pedido, então não assinou nada.',
  'You cancelled the request. Nothing was signed.': 'Você cancelou o pedido. Nada foi assinado.',
  'FloFi Wallet is already handling another request. Finish or cancel it first.': 'A FloFi Wallet já está cuidando de outro pedido. Conclua ou cancele-o primeiro.',
  'FloFi Wallet was locked. Nothing was signed.': 'A FloFi Wallet foi bloqueada. Nada foi assinado.',
  'FloFi found no reviewed strategy that matches this request, so FloFi Wallet signed nothing.':
    'O FloFi não encontrou nenhuma estratégia revisada que corresponda a este pedido, então a FloFi Wallet não assinou nada.',
  'FloFi Wallet can’t sign this action yet — use MetaMask, Phantom or Solflare.': 'A FloFi Wallet ainda não consegue assinar esta ação — use MetaMask, Phantom ou Solflare.',
  'This Review has expired. Simulate again in FloFi before you sign.': 'Esta Revisão expirou. Simule de novo no FloFi antes de assinar.',
  'FloFi Wallet could not load your Review right now. Nothing was signed. Try again.': 'A FloFi Wallet não conseguiu carregar sua Revisão agora. Nada foi assinado. Tente de novo.',
  'FloFi Wallet signs only actions you reviewed and authorized in FloFi. Nothing was signed.':
    'A FloFi Wallet assina somente ações que você revisou e autorizou no FloFi. Nada foi assinado.',
  'FloFi Wallet signs only on Ethereum, Base, Arbitrum and Robinhood Chain. Nothing was signed.':
    'A FloFi Wallet assina somente na Ethereum, Base, Arbitrum e Robinhood Chain. Nada foi assinado.',
  'FloFi Wallet signs only FloFi’s own, unexpired sign-in message for this wallet. Nothing was signed.':
    'A FloFi Wallet assina somente a mensagem de login do próprio FloFi, ainda válida, para esta carteira. Nada foi assinado.',
  'FloFi Wallet isn’t available on this deployment yet.': 'A FloFi Wallet ainda não está disponível nesta implantação.',
  'This window is no longer connected to your FloFi account. Open FloFi Wallet from FloFi again.':
    'Esta janela não está mais conectada à sua conta FloFi. Abra a FloFi Wallet pelo FloFi de novo.',
  'This FloFi Wallet link expired or was already used. Open FloFi Wallet from FloFi again.':
    'Este link da FloFi Wallet expirou ou já foi usado. Abra a FloFi Wallet pelo FloFi de novo.',
  'Your FloFi session ended. Sign in to FloFi again, then open FloFi Wallet from there.': 'Sua sessão no FloFi terminou. Entre no FloFi de novo e abra a FloFi Wallet por lá.',
  'FloFi Wallet refused a request that did not come from this window.': 'A FloFi Wallet recusou um pedido que não veio desta janela.',
  'FloFi Wallet could not complete that request. Nothing changed. Try again.': 'A FloFi Wallet não conseguiu concluir esse pedido. Nada mudou. Tente de novo.',
  'Unlock FloFi Wallet to continue.': 'Desbloqueie a FloFi Wallet para continuar.',
  'This FloFi account can’t unlock FloFi Wallet with that method.': 'Esta conta FloFi não pode desbloquear a FloFi Wallet com esse método.',
  'That Google or Apple account isn’t the one linked to this FloFi account. Nothing was unlocked.':
    'Essa conta Google ou Apple não é a vinculada a esta conta FloFi. Nada foi desbloqueado.',
  'That address isn’t a FloFi Wallet of this account. Nothing was signed.': 'Esse endereço não é uma FloFi Wallet desta conta. Nada foi assinado.',
  'FloFi Wallet refused this signing request. Nothing was signed.': 'A FloFi Wallet recusou este pedido de assinatura. Nada foi assinado.',
  'Unlock FloFi Wallet once to set it up, then try again.': 'Desbloqueie a FloFi Wallet uma vez para configurá-la e tente de novo.',
  'This browser could not create a secure key for FloFi Wallet. Allow site storage for FloFi Wallet and try again.':
    'Este navegador não conseguiu criar uma chave segura para a FloFi Wallet. Permita o armazenamento de site para a FloFi Wallet e tente de novo.',
  'The wallet provider could not be reached. Try again.': 'Não foi possível contatar o provedor de carteiras. Tente de novo.',
  'The wallet provider did not complete the request. Try again.': 'O provedor de carteiras não concluiu o pedido. Tente de novo.',
  'The wallet provider sent an answer FloFi Wallet could not verify, so it was not used.':
    'O provedor de carteiras enviou uma resposta que a FloFi Wallet não conseguiu verificar, então ela não foi usada.',
  'That key could not be read. Check it in the secure field and try again.': 'Não foi possível ler essa chave. Confira no campo seguro e tente de novo.',
  'Secure import could not start. Nothing was imported.': 'A importação segura não pôde começar. Nada foi importado.',
  'Secure export could not start. Nothing was revealed.': 'A exportação segura não pôde começar. Nada foi revelado.',
  'This wallet can’t be exported from FloFi Wallet.': 'Esta carteira não pode ser exportada pela FloFi Wallet.',
  'FloFi Wallet could not authorize this export. Nothing was revealed.': 'A FloFi Wallet não conseguiu autorizar esta exportação. Nada foi revelado.',
  'This wallet can’t be exported that way.': 'Esta carteira não pode ser exportada dessa forma.',
  'That wallet is no longer in your FloFi account.': 'Essa carteira não está mais na sua conta FloFi.',
  'The wallet provider could not confirm this wallet belongs to you. Nothing was saved.': 'O provedor de carteiras não conseguiu confirmar que esta carteira é sua. Nada foi salvo.',
  'The wallet was created but could not be saved to your FloFi account yet. Try again.': 'A carteira foi criada, mas ainda não pôde ser salva na sua conta FloFi. Tente de novo.',
  'That wallet already belongs to another FloFi account. Nothing was saved.': 'Essa carteira já pertence a outra conta FloFi. Nada foi salvo.',
  'FloFi accounts are temporarily unavailable. Try again in a moment.': 'As contas FloFi estão temporariamente indisponíveis. Tente de novo em instantes.',
  'Too many codes were requested for this address. Wait a while, then try again.': 'Muitos códigos foram pedidos para este endereço. Aguarde um pouco e tente de novo.',
  'Enter the 8-character code from the email.': 'Digite o código de 8 caracteres do email.',
  'That code is not valid or has expired. Check it, or request a new one.': 'Esse código não é válido ou expirou. Confira, ou peça um novo.',
  'That code expired or was tried too many times. Request a new one.': 'Esse código expirou ou foi tentado vezes demais. Peça um novo.',
  'FloFi Wallet could not verify the email provider’s encryption key. Your code was not sent. Request a new code.':
    'A FloFi Wallet não conseguiu verificar a chave de criptografia do provedor de email. Seu código não foi enviado. Peça um novo código.',
  'The email provider’s confirmation could not be verified. Nothing was unlocked.': 'A confirmação do provedor de email não pôde ser verificada. Nada foi desbloqueado.',
  'That confirmation is not for this account or this window. Nothing was unlocked.': 'Essa confirmação não é para esta conta ou esta janela. Nada foi desbloqueado.',
  'That code was already used. Request a new one.': 'Esse código já foi usado. Peça um novo.',
  'Unlocking with email did not complete. Nothing was unlocked. Try again.': 'O desbloqueio por email não foi concluído. Nada foi desbloqueado. Tente de novo.',
  'FloFi Wallet could not prove this window’s key to the wallet provider. Nothing was unlocked. Start again.':
    'A FloFi Wallet não conseguiu provar a chave desta janela ao provedor de carteiras. Nada foi desbloqueado. Comece de novo.',
  'Sign-in was cancelled. Nothing was unlocked.': 'O login foi cancelado. Nada foi desbloqueado.',
  'That sign-in expired or was finished in another browser. Start again.': 'Esse login expirou ou foi concluído em outro navegador. Comece de novo.',
  'This sign-in method isn’t available on this deployment yet.': 'Este método de login ainda não está disponível nesta implantação.',
  'That sign-in was already used. Start again.': 'Esse login já foi usado. Comece de novo.',
  'FloFi Wallet unlocks with the sign-in you first used for it. Choose that method.': 'A FloFi Wallet desbloqueia com o login que você usou primeiro para ela. Escolha esse método.',
  'FloFi Wallet could not verify that sign-in. Nothing was unlocked.': 'A FloFi Wallet não conseguiu verificar esse login. Nada foi desbloqueado.',
  'Something went wrong in FloFi Wallet. Try again.': 'Algo deu errado na FloFi Wallet. Tente de novo.',
};

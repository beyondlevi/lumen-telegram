// Every user-facing string lives in this file. English is the default;
// Portuguese (pt-BR copy) is chosen for any `pt-*` browser language.

const en = {
  appName: 'Telegram',
  chatsHeader: 'Chats',
  offlineMeta: 'Offline',
  chatListLabel: 'Telegram chats',
  emptyTitle: 'No chats yet',
  emptyBody: 'New Telegram conversations will appear here.',
  emptyLabel: 'No chats',

  setupHeader: 'Setup',
  setupTitle: 'Connect Telegram',
  setupBody:
    'Open the Lumen app on your phone and fill in the API ID, the API hash, and the session for this app. The session is created on a computer with npm run login.',
  setupMissingLabel: 'MISSING',
  setupLabel: 'Setup required',
  setupCheckAgain: 'Check again',
  setupStillMissing: 'Still not configured',
  fieldApiId: 'API ID',
  fieldApiHash: 'API hash',
  fieldSession: 'Session',

  loadingHeader: 'Loading…',
  connectingLabel: 'Connecting',

  errorHeader: 'Connection',
  errorLabel: 'Connection error',
  errorDetailLabel: 'DETAIL',
  retry: 'Try again',
  errNetworkTitle: "Can't reach Telegram",
  errNetworkBody: "Check the phone's internet connection. The app connects to Telegram through a secure WebSocket on port 443.",
  errAuthTitle: 'Session not accepted',
  errAuthBody:
    'Telegram refused this session or API ID. Create a new session with npm run login and update it in the Lumen app on your phone.',
  errFloodTitle: 'Too many requests',
  errFloodBody: 'Telegram asked to wait {seconds} s before trying again.',
  errServerTitle: 'Telegram error',
  errServerBody: 'Telegram could not answer. Try again in a moment.',
  errInvalidTitle: 'Invalid {field}',
  errInvalidApiId: 'The API ID is a number from my.telegram.org. Fix it in the Lumen app on your phone.',
  errInvalidApiHash: 'The API hash has 32 letters and digits, from my.telegram.org. Fix it in the Lumen app on your phone.',
  errInvalidSession: 'The session must be the text printed by npm run login. Paste it again in the Lumen app on your phone.',

  threadLabel: 'Conversation with {name}',
  threadEmptyTitle: 'No recent messages',
  threadEmptyBody: 'Messages in this chat will appear here.',
  replyHint: 'Reply',
  quoteHint: 'Reply to “{text}”',
  messageActionsLabel: 'Actions for message: {message}',
  replyAction: 'Reply',
  voiceAction: 'Voice',
  photosAction: 'Photos',
  viewAction: 'View',
  reactWith: 'React with {emoji}',
  reactionNotAllowed: '{emoji} is not allowed in this chat',
  reactionsOff: 'Reactions are off in this chat',
  reactionSent: 'Reacted {emoji}',
  reactionRemoved: 'Reaction removed',
  reactionFailed: 'Reaction not sent: {reason}',
  replyFieldLabel: 'Reply to {name}',
  sendLabel: 'Send',
  sendingLabel: 'Sending',
  messageSent: 'Message sent',
  sendFailed: 'Not sent: {reason}',
  connectionLost: 'Connection lost. Retrying…',

  reasonNetwork: 'no connection',
  reasonAuth: 'session not accepted',
  reasonRejected: 'not allowed in this chat',
  reasonFlood: 'too many requests',
  reasonServer: 'Telegram error',
  reasonFormat: 'format not supported',

  you: 'You',
  yesterday: 'Yesterday',
  unknownContact: 'Unknown contact',
  bubbleLabel: '{sender}: {text}, {time}',
  senderPrefix: '{sender}: {text}',
  markerWithCaption: '{marker}: {caption}',
  markerPhoto: 'Photo',
  markerVideo: 'Video',
  markerAudio: 'Audio',
  markerSticker: 'Sticker',
  markerDocument: 'Document',
  markerLocation: 'Location',
  markerContact: 'Contact',
  markerPoll: 'Poll',
  markerDeleted: 'Message deleted',
  markerUnsupported: 'Unsupported message',
  markerNoPreview: 'No messages',
  reactedTo: 'Reacted {emoji} to “{text}”',
  reactionsLabel: 'reactions {list}',

  photoHeader: 'Photo',
  photoLabel: 'Photo from {name}',
  photoLoading: 'Loading photo',
  photoFailedTitle: "Couldn't load the photo",
  photoFailedBody: 'Telegram could not send this photo ({reason}).',

  audioLabel: 'Voice message, {duration}',
  audioPlaying: 'Playing, {position} of {duration}',
  audioPaused: 'Paused, {position} of {duration}',
  audioLoading: 'Loading audio',
  audioFailed: "Couldn't play the audio: {reason}",
};

export type StringKey = keyof typeof en;
type Strings = Record<StringKey, string>;

const pt: Strings = {
  appName: 'Telegram',
  chatsHeader: 'Conversas',
  offlineMeta: 'Sem conexão',
  chatListLabel: 'Conversas do Telegram',
  emptyTitle: 'Nenhuma conversa',
  emptyBody: 'As novas conversas do Telegram aparecem aqui.',
  emptyLabel: 'Sem conversas',

  setupHeader: 'Configuração',
  setupTitle: 'Conectar o Telegram',
  setupBody:
    'Abra o app Lumen no celular e preencha o API ID, o API hash e a sessão deste app. A sessão é criada num computador com npm run login.',
  setupMissingLabel: 'FALTANDO',
  setupLabel: 'Configuração necessária',
  setupCheckAgain: 'Verificar de novo',
  setupStillMissing: 'Ainda não configurado',
  fieldApiId: 'API ID',
  fieldApiHash: 'API hash',
  fieldSession: 'Sessão',

  loadingHeader: 'Carregando…',
  connectingLabel: 'Conectando',

  errorHeader: 'Conexão',
  errorLabel: 'Erro de conexão',
  errorDetailLabel: 'DETALHE',
  retry: 'Tentar de novo',
  errNetworkTitle: 'Telegram inacessível',
  errNetworkBody: 'Verifique a internet do celular. O app conecta ao Telegram por um WebSocket seguro na porta 443.',
  errAuthTitle: 'Sessão não aceita',
  errAuthBody:
    'O Telegram recusou esta sessão ou o API ID. Crie uma nova sessão com npm run login e atualize-a no app Lumen do celular.',
  errFloodTitle: 'Muitas requisições',
  errFloodBody: 'O Telegram pediu para esperar {seconds} s antes de tentar de novo.',
  errServerTitle: 'Erro do Telegram',
  errServerBody: 'O Telegram não conseguiu responder. Tente de novo daqui a pouco.',
  errInvalidTitle: '{field} inválido',
  errInvalidApiId: 'O API ID é um número obtido em my.telegram.org. Corrija-o no app Lumen do celular.',
  errInvalidApiHash: 'O API hash tem 32 letras e dígitos, obtidos em my.telegram.org. Corrija-o no app Lumen do celular.',
  errInvalidSession: 'A sessão deve ser o texto mostrado por npm run login. Cole-a de novo no app Lumen do celular.',

  threadLabel: 'Conversa com {name}',
  threadEmptyTitle: 'Nenhuma mensagem recente',
  threadEmptyBody: 'As mensagens desta conversa aparecem aqui.',
  replyHint: 'Responder',
  quoteHint: 'Responder a “{text}”',
  messageActionsLabel: 'Ações da mensagem: {message}',
  replyAction: 'Responder',
  voiceAction: 'Voz',
  photosAction: 'Fotos',
  viewAction: 'Ver',
  reactWith: 'Reagir com {emoji}',
  reactionNotAllowed: '{emoji} não é permitida nesta conversa',
  reactionsOff: 'Reações desativadas nesta conversa',
  reactionSent: 'Reação {emoji} enviada',
  reactionRemoved: 'Reação removida',
  reactionFailed: 'Reação não enviada: {reason}',
  replyFieldLabel: 'Responder a {name}',
  sendLabel: 'Enviar',
  sendingLabel: 'Enviando',
  messageSent: 'Mensagem enviada',
  sendFailed: 'Não enviada: {reason}',
  connectionLost: 'Conexão perdida. Tentando de novo…',

  reasonNetwork: 'sem conexão',
  reasonAuth: 'sessão não aceita',
  reasonRejected: 'não permitido nesta conversa',
  reasonFlood: 'muitas requisições',
  reasonServer: 'erro do Telegram',
  reasonFormat: 'formato não suportado',

  you: 'Você',
  yesterday: 'Ontem',
  unknownContact: 'Contato desconhecido',
  bubbleLabel: '{sender}: {text}, {time}',
  senderPrefix: '{sender}: {text}',
  markerWithCaption: '{marker}: {caption}',
  markerPhoto: 'Foto',
  markerVideo: 'Vídeo',
  markerAudio: 'Áudio',
  markerSticker: 'Figurinha',
  markerDocument: 'Documento',
  markerLocation: 'Localização',
  markerContact: 'Contato',
  markerPoll: 'Enquete',
  markerDeleted: 'Mensagem apagada',
  markerUnsupported: 'Mensagem não suportada',
  markerNoPreview: 'Sem mensagens',
  reactedTo: 'Reagiu {emoji} a “{text}”',
  reactionsLabel: 'reações {list}',

  photoHeader: 'Foto',
  photoLabel: 'Foto de {name}',
  photoLoading: 'Carregando foto',
  photoFailedTitle: 'Não foi possível carregar a foto',
  photoFailedBody: 'O Telegram não conseguiu enviar esta foto ({reason}).',

  audioLabel: 'Mensagem de voz, {duration}',
  audioPlaying: 'Tocando, {position} de {duration}',
  audioPaused: 'Pausado, {position} de {duration}',
  audioLoading: 'Carregando áudio',
  audioFailed: 'Não foi possível tocar o áudio: {reason}',
};

const dictionaries = {en, pt} satisfies Record<string, Strings>;
export type Locale = keyof typeof dictionaries;

/** Picks the dictionary from the base language (`pt-PT` and `pt-BR` both map to `pt`). */
export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base in dictionaries) {
      return base as Locale;
    }
  }
  return 'en';
}

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  // Only the primary language decides; `navigator.languages` may list extras.
  return navigator.language ? [navigator.language] : [];
}

const deviceLocale: Locale = resolveLocale(browserLanguages());

/** Language in use: the device's, or English while demo mode forces it. */
export let locale: Locale = deviceLocale;

/** Forces a language (demo mode) or, with null, goes back to the device's. */
export function setLocaleOverride(next: Locale | null): void {
  locale = next ?? deviceLocale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function translate(
  target: Locale,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[target][key];
  if (params == null) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  return translate(locale, key, params);
}

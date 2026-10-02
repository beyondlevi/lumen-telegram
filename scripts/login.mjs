#!/usr/bin/env node
// Creates the Telegram session for the Lumen companion, on a computer: the
// glasses never see the phone number, the login code or the 2FA password.
//
//   npm run login
//   TELEGRAM_API_ID=… TELEGRAM_API_HASH=… npm run login   (skips those two questions)
//
// It asks for the API ID and hash (from https://my.telegram.org → API
// development tools), the phone number, the code Telegram sends to your other
// devices, and the 2FA password when the account has one. It prints the
// session; nothing is written to disk. The session gives full access to the
// account: paste it only into the Lumen app, and end it in Telegram →
// Settings → Devices ("Rokid Lumen") when you stop using the glasses.
import readline from 'node:readline';
import {TelegramClient} from 'telegram';
import {Logger, LogLevel} from 'telegram/extensions/Logger.js';
import {StringSession} from 'telegram/sessions/index.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const lines = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13);
  console.log(lines.map(line => line.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY});
let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) {
  rl._writeToOutput = text => {
    if (!muted || text.includes('\n')) write(muted ? '\n' : text);
  };
}

const lines = rl[Symbol.asyncIterator]();

/** Prints the question and waits for the next line (typed, or piped in). */
async function ask(question, {hidden = false} = {}) {
  process.stdout.write(question);
  muted = hidden && Boolean(process.stdin.isTTY);
  const {value, done} = await lines.next();
  muted = false;
  if (done) throw new Error('Input closed');
  return String(value).trim();
}

async function main() {
  const apiIdText = process.env.TELEGRAM_API_ID?.trim() || (await ask('API ID (my.telegram.org): '));
  const apiId = Number(apiIdText);
  if (!/^\d+$/.test(apiIdText) || apiId <= 0) throw new Error('The API ID is a number.');
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || (await ask('API hash (my.telegram.org, hidden): ', {hidden: true}));
  if (!/^[0-9a-f]{32}$/i.test(apiHash)) throw new Error('The API hash has 32 letters and digits.');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
    deviceModel: 'Rokid Lumen',
    systemVersion: 'Lumen',
    appVersion: 'lumen-telegram',
    baseLogger: new Logger(LogLevel.ERROR),
  });

  await client.start({
    phoneNumber: () => ask('Phone number, international format (e.g. +15550100123): '),
    phoneCode: () => ask('Login code from Telegram: '),
    password: hint => ask(`2FA password${hint ? ` (hint: ${hint})` : ''} (hidden): `, {hidden: true}),
    // true stops the login; false asks again (e.g. after a mistyped code).
    onError: async error => {
      console.error(`\nTelegram: ${error.message}`);
      return error.message === 'Input closed' || /API_ID|API_HASH|PHONE_NUMBER_BANNED|FLOOD/.test(error.message);
    },
  });

  const me = await client.getMe();
  const session = client.session.save();
  await client.disconnect();
  await client.destroy();

  console.log(`\nLogged in as ${[me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || me.id}.`);
  console.log('\nIn the Lumen app on your phone → Apps → Telegram, fill in:');
  console.log(`  API ID (my.telegram.org):   ${apiId}`);
  console.log('  API hash (my.telegram.org): the hash you typed');
  console.log('  Session (npm run login):    the line below (one line, no spaces)\n');
  console.log(session);
  console.log('\nThis session is full access to the account. Do not save it in files or chats.');
  console.log('To end it: Telegram → Settings → Devices → "Rokid Lumen".');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error.message === 'AUTH_USER_CANCEL' ? '\nLogin stopped.' : `\nLogin failed: ${error.message}`);
    process.exit(1);
  })
  .finally(() => rl.close());

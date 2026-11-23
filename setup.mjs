import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.mjs';

const username=process.argv[2]||'admin';
if(!/^[a-zA-Z0-9_.@-]{1,64}$/.test(username)) {
  console.error('Use a username of 1–64 letters, numbers, dots, @, hyphens, or underscores.');
  process.exitCode=1;
} else {
  const password=randomBytes(18).toString('base64url');
  const hash=await hashPassword(password);
  try {
    await writeFile(fileURLToPath(new URL('.env',import.meta.url)),`APP_USERNAME=${username}\nAPP_PASSWORD_HASH='${hash}'\nPORT=3000\n`,{flag:'wx',mode:0o600});
    console.log(`Local credentials created. Save this password in your password manager.\n\nUsername: ${username}\nPassword: ${password}\n\nOnly a password hash was saved in .env. Run npm start to begin.\nFor hosting, see README.txt. Never upload .env to a public repository.`);
  }catch(error){console.error(error.code==='EEXIST'?'A .env file already exists. It was not changed. See README.txt to change credentials.':`Setup failed: ${error.message}`);process.exitCode=1;}
}

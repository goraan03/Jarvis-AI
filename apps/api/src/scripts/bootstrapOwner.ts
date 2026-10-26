import "@jarvis/shared/src/loadRootEnv.js";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";

async function promptHidden(rl: readline.Interface, question: string): Promise<string> {
  // Node's readline has no built-in masked input; for a local single-run
  // bootstrap script, visible stdin is an accepted tradeoff over pulling
  // in a TTY-masking dependency. Documented in docs/security-model.md §2.
  return rl.question(question);
}

async function main() {
  const existing = await prisma.user.findFirst();
  if (existing) {
    console.error("An owner account already exists. Refusing to create another one.");
    process.exit(1);
  }

  let email = process.env.BOOTSTRAP_OWNER_EMAIL;
  let password = process.env.BOOTSTRAP_OWNER_PASSWORD;

  if (!email || !password) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    email ??= await promptHidden(rl, "Owner email: ");
    password ??= await promptHidden(rl, "Owner password: ");
    rl.close();
  }

  if (!email || !password || password.length < 8) {
    console.error("Email and a password of at least 8 characters are required.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      settings: { create: {} },
    },
  });

  console.log(`Owner account created: ${user.email} (id: ${user.id})`);
  console.log("Remove BOOTSTRAP_OWNER_EMAIL/BOOTSTRAP_OWNER_PASSWORD from .env now if you set them.");
}

main()
  .catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

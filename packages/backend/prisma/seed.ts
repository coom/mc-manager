import { PrismaClient } from '../generated/prisma/index.js';
const prisma = new PrismaClient();
async function main() {
  console.log('Seed: nothing to seed. Visit /setup to create the admin account.');
}
main().catch(console.error).finally(() => prisma.$disconnect());

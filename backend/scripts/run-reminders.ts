import "dotenv/config";
import { runPhase2ReminderScan } from "../src/lib/reminders";
import { prisma } from "../src/lib/prisma";

async function main() {
  const result = await runPhase2ReminderScan();
  console.log("Phase 2 reminder scan complete.");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

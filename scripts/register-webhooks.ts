// Registers the Unipile webhooks (account status, messages, new relations). Run once after going live.
import { registerWebhooks } from "../src/lib/unipile";

registerWebhooks()
  .then((r) => console.log("Registered:", JSON.stringify(r)))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

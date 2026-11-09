// Registers the Unipile account-status webhook for this deployment. Run once after going live.
import { registerAccountStatusWebhook } from "../src/lib/unipile";

registerAccountStatusWebhook()
  .then((r) => console.log("Registered:", JSON.stringify(r)))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

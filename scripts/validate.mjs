import { readJson, validateProviderConfig } from "./lib.mjs";

const config = await readJson("config/providers.json");
const { errors, warnings } = validateProviderConfig(config);

for (const w of warnings) console.warn("WARN:", w);
if (errors.length) {
  for (const e of errors) console.error("ERROR:", e);
  process.exit(1);
}
console.log(`OK: ${config.providers.length} provider(s), schemaVersion=${config.schemaVersion}`);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as api from '@actual-app/api';
import { loadActualConnConfig } from './config';
import { ActualClient } from './actual';
import { toMinorUnits } from './money';
import { normalizeName } from './mapping';
import { parseSeedConfig, computeSeedPlan, type ExistingSnapshot } from './seed_plan';
import { loadDotEnv } from './env';

// One-off migration: seed Actual with the current state (accounts + starting
// balances + category structure) from a seed.yaml. Idempotent — existing items
// are skipped. Run with `just cap-seed` (locally against the Actual server).

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadActualConnConfig(process.env);
  const seedPath = process.env.SEED_FILE ?? resolve(__dirname, '..', 'seed.yaml');
  const dataDir = process.env.ACTUAL_DATA_DIR ?? resolve(__dirname, '..', '.actual-cache');

  const config = parseSeedConfig(readFileSync(seedPath, 'utf8'));

  const client = new ActualClient(cfg, dataDir);
  console.log(`[seed] connecting to ${cfg.actualUrl}…`);
  await client.connect();

  const [accounts, groups, categories] = await Promise.all([
    api.getAccounts(),
    api.getCategoryGroups(),
    api.getCategories(),
  ]);
  const existing: ExistingSnapshot = {
    accounts: accounts.map((a) => ({ name: a.name })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    categories: categories
      .filter((c): c is { id: string; name: string; group_id: string } => 'group_id' in c)
      .map((c) => ({ name: c.name, groupId: c.group_id })),
  };

  const plan = computeSeedPlan(config, existing);
  console.log(
    `[seed] to create: ${plan.groupsToCreate.length} groups, ` +
      `${plan.categoriesToCreate.length} categories, ${plan.accountsToCreate.length} accounts`,
  );

  // Groups first, tracking name → id (existing + newly created).
  const groupId = new Map(existing.groups.map((g) => [normalizeName(g.name), g.id]));
  for (const g of plan.groupsToCreate) {
    const id = await api.createCategoryGroup({ name: g.name, is_income: false, hidden: false });
    groupId.set(normalizeName(g.name), id);
    console.log(`  + group   ${g.name}`);
  }

  for (const c of plan.categoriesToCreate) {
    const gid = groupId.get(normalizeName(c.group));
    if (!gid) {
      console.warn(`  ! skip category ${c.name}: group '${c.group}' not found`);
      continue;
    }
    await api.createCategory({ name: c.name, group_id: gid, is_income: false, hidden: false });
    console.log(`  + cat     ${c.group} / ${c.name}`);
  }

  for (const a of plan.accountsToCreate) {
    await api.createAccount({ name: a.name, offbudget: a.offbudget }, toMinorUnits(a.balance));
    console.log(`  + account ${a.name} (balance ${a.balance})`);
  }

  await api.sync();
  await client.disconnect();
  console.log('[seed] done.');
}

main().catch((err) => {
  console.error('[seed:fatal]', err);
  process.exit(1);
});

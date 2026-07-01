import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalizeName } from './mapping';

// Pure logic for the one-off "seed current state" migration: parse the seed
// file and diff it against what already exists in Actual, so a re-run is
// idempotent (existing accounts/groups/categories are skipped, never touched).

const seedAccountSchema = z.object({
  name: z.string().min(1),
  balance: z.number().default(0),
  offbudget: z.boolean().default(false),
});

const seedGroupSchema = z.object({
  name: z.string().min(1),
  categories: z.array(z.string().min(1)).default([]),
});

const seedConfigSchema = z.object({
  accounts: z.array(seedAccountSchema).default([]),
  categoryGroups: z.array(seedGroupSchema).default([]),
});

export type SeedAccount = z.infer<typeof seedAccountSchema>;
export type SeedGroup = z.infer<typeof seedGroupSchema>;
export type SeedConfig = z.infer<typeof seedConfigSchema>;

/** Parse and validate a seed YAML document. Throws a readable error on problems. */
export function parseSeedConfig(text: string): SeedConfig {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new Error(`seed file is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = seedConfigSchema.safeParse(doc ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`invalid seed file:\n${issues}`);
  }
  return parsed.data;
}

export interface ExistingSnapshot {
  accounts: { name: string }[];
  groups: { id: string; name: string }[];
  categories: { name: string; groupId: string }[];
}

export interface SeedPlan {
  groupsToCreate: { name: string }[];
  categoriesToCreate: { group: string; name: string }[];
  accountsToCreate: SeedAccount[];
}

/**
 * Diff the seed config against existing Actual data. Matching is by normalized
 * name. Categories are matched within their (existing) group; categories in a
 * to-be-created group are always created.
 */
export function computeSeedPlan(config: SeedConfig, existing: ExistingSnapshot): SeedPlan {
  const existingAccounts = new Set(existing.accounts.map((a) => normalizeName(a.name)));
  const existingGroupByName = new Map(existing.groups.map((g) => [normalizeName(g.name), g.id]));
  const existingCatKeys = new Set(
    existing.categories.map((c) => `${c.groupId}::${normalizeName(c.name)}`),
  );

  const groupsToCreate = config.categoryGroups
    .filter((g) => !existingGroupByName.has(normalizeName(g.name)))
    .map((g) => ({ name: g.name }));

  const categoriesToCreate: { group: string; name: string }[] = [];
  for (const group of config.categoryGroups) {
    const groupId = existingGroupByName.get(normalizeName(group.name));
    for (const catName of group.categories) {
      if (groupId) {
        // Existing group: skip categories already present in it.
        const key = `${groupId}::${normalizeName(catName)}`;
        if (existingCatKeys.has(key)) continue;
      }
      categoriesToCreate.push({ group: group.name, name: catName });
    }
  }

  const accountsToCreate = config.accounts.filter((a) => !existingAccounts.has(normalizeName(a.name)));

  return { groupsToCreate, categoriesToCreate, accountsToCreate };
}

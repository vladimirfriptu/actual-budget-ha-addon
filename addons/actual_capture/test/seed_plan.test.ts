import { describe, it, expect } from 'vitest';
import { parseSeedConfig, computeSeedPlan, type ExistingSnapshot } from '../src/seed_plan';

const YAML = `
accounts:
  - { name: "Наличные", balance: 100.5 }
  - { name: "Монобанк ·1234", balance: 5000 }
categoryGroups:
  - name: "Стройка"
    categories: ["Матеріали", "Робота"]
  - name: "Щоденні"
    categories: ["Продукти"]
`;

describe('parseSeedConfig', () => {
  it('parses accounts and groups with defaults', () => {
    const cfg = parseSeedConfig(YAML);
    expect(cfg.accounts).toHaveLength(2);
    expect(cfg.accounts[0]).toMatchObject({ name: 'Наличные', balance: 100.5, offbudget: false });
    expect(cfg.categoryGroups[0]).toMatchObject({ name: 'Стройка', categories: ['Матеріали', 'Робота'] });
  });

  it('defaults balance to 0 and categories to []', () => {
    const cfg = parseSeedConfig('accounts:\n  - { name: "Касса" }\ncategoryGroups:\n  - { name: "Прочее" }');
    expect(cfg.accounts[0]?.balance).toBe(0);
    expect(cfg.categoryGroups[0]?.categories).toEqual([]);
  });

  it('throws on an account without a name', () => {
    expect(() => parseSeedConfig('accounts:\n  - { balance: 10 }')).toThrow(/invalid seed file/);
  });

  it('throws on malformed YAML', () => {
    expect(() => parseSeedConfig('accounts: [ unclosed')).toThrow(/not valid YAML/);
  });
});

const empty: ExistingSnapshot = { accounts: [], groups: [], categories: [] };

describe('computeSeedPlan', () => {
  it('creates everything against an empty budget', () => {
    const plan = computeSeedPlan(parseSeedConfig(YAML), empty);
    expect(plan.accountsToCreate.map((a) => a.name)).toEqual(['Наличные', 'Монобанк ·1234']);
    expect(plan.groupsToCreate.map((g) => g.name)).toEqual(['Стройка', 'Щоденні']);
    expect(plan.categoriesToCreate).toHaveLength(3);
  });

  it('skips an existing account by normalized name', () => {
    const existing: ExistingSnapshot = { accounts: [{ name: '  наличные ' }], groups: [], categories: [] };
    const plan = computeSeedPlan(parseSeedConfig(YAML), existing);
    expect(plan.accountsToCreate.map((a) => a.name)).toEqual(['Монобанк ·1234']);
  });

  it('skips categories already present in an existing group, keeps new ones', () => {
    const existing: ExistingSnapshot = {
      accounts: [],
      groups: [{ id: 'g-build', name: 'Стройка' }],
      categories: [{ name: 'Матеріали', groupId: 'g-build' }],
    };
    const plan = computeSeedPlan(parseSeedConfig(YAML), existing);
    // 'Стройка' group already exists → not recreated
    expect(plan.groupsToCreate.map((g) => g.name)).toEqual(['Щоденні']);
    // 'Матеріали' exists in it → skipped; 'Робота' kept; 'Продукти' is under a new group → kept
    const cats = plan.categoriesToCreate.map((c) => `${c.group}/${c.name}`);
    expect(cats).toContain('Стройка/Робота');
    expect(cats).toContain('Щоденні/Продукти');
    expect(cats).not.toContain('Стройка/Матеріали');
  });
});

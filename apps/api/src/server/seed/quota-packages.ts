import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { quotaPackages } from '../db/schema.js';

export const initialQuotaPackages = [
  {
    name: '体验包',
    priceCents: 600,
    points: 60,
    description: '60 点数，适合初次体验',
    recommended: false,
    active: true,
    sortOrder: 1,
  },
  {
    name: '标准包',
    priceCents: 1800,
    points: 200,
    description: '200 点数，最超值的选择',
    recommended: true,
    active: true,
    sortOrder: 2,
  },
  {
    name: '沉浸包',
    priceCents: 3800,
    points: 450,
    description: '450 点数，深度沉浸体验',
    recommended: false,
    active: true,
    sortOrder: 3,
  },
];

export type SeedQuotaPackage = (typeof initialQuotaPackages)[number];

export async function upsertQuotaPackage(quotaPackage: SeedQuotaPackage) {
  const [existing] = await db
    .select({ id: quotaPackages.id })
    .from(quotaPackages)
    .where(eq(quotaPackages.name, quotaPackage.name))
    .limit(1);

  if (existing) {
    await db.update(quotaPackages).set(quotaPackage).where(eq(quotaPackages.id, existing.id));
    return;
  }

  await db.insert(quotaPackages).values(quotaPackage);
}

export async function seedQuotaPackages() {
  for (const quotaPackage of initialQuotaPackages) {
    await upsertQuotaPackage(quotaPackage);
  }
}

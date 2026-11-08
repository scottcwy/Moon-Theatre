import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index, check, foreignKey } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const modelTierEnum = pgEnum('model_tier', ['casual', 'standard', 'immersive']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);
export const moodTypeEnum = pgEnum('mood_type', ['neutral', 'happy', 'sad', 'angry', 'thinking']);
export const memoryTypeEnum = pgEnum('memory_type', ['user_info', 'relationship', 'story']);
export const orderStatusEnum = pgEnum('order_status', ['created', 'prepay_created', 'paid', 'credited', 'closed', 'failed', 'refunded']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'success', 'failed', 'cancelled']);
export const walletTxTypeEnum = pgEnum('wallet_tx_type', ['recharge', 'consume', 'adjust']);
export const modelUsageStatusEnum = pgEnum('model_usage_status', ['success', 'failed', 'filtered', 'out_of_scope']);
export const sessionStatusEnum = pgEnum('session_status', ['active', 'archived']);
export const userStatusEnum = pgEnum('user_status', ['active', 'banned']);
export const characterStatusEnum = pgEnum('character_status', ['active', 'inactive']);
export const reviewStatusEnum = pgEnum('review_status', ['normal', 'flagged', 'resolved']);
export const chatModeEnum = pgEnum('chat_mode', ['script', 'free']);
export const memoryScopeEnum = pgEnum('memory_scope', ['shared', 'script']);

export type ChatGenerationSnapshot = {
  modelTier: 'casual' | 'standard' | 'immersive';
  modelName: string;
  pointsPerCall: number;
  systemPrompt: string;
  scriptTitle?: string;
  worldSetting?: string;
  characterName: string;
  characterIdentity: string;
  agentId: string | null;
  mode: 'script' | 'free';
  scriptId: string | null;
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  openid: varchar('openid', { length: 128 }).notNull().unique(),
  nickname: varchar('nickname', { length: 64 }),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  status: userStatusEnum('status').default('active').notNull(),
  preferredName: varchar('preferred_name', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const scripts = pgTable('scripts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 128 }).notNull(),
  description: text('description').notNull(),
  worldSetting: text('world_setting').notNull(),
  slug: varchar('slug', { length: 128 }).notNull().unique(),
  genre: varchar('genre', { length: 128 }).notNull(),
  searchKeywords: text('search_keywords').notNull().default(''),
  coverUrl: varchar('cover_url', { length: 512 }),
  sortOrder: integer('sort_order').notNull().default(0),
  status: varchar('status', { length: 32 }).default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type StarterQuestions = {
  script: string[];
  free: string[];
};

export const characters = pgTable('characters', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 512 }).notNull(),
  identity: varchar('identity', { length: 128 }).notNull(),
  description: text('description').notNull(),
  scriptId: uuid('script_id').references(() => scripts.id),
  initialRelationship: varchar('initial_relationship', { length: 256 }).notNull(),
  agentId: varchar('agent_id', { length: 64 }),
  starterQuestions: jsonb('starter_questions')
    .$type<StarterQuestions>()
    .notNull()
    .default({ script: [], free: [] }),
  sortOrder: integer('sort_order').default(0).notNull(),
  status: characterStatusEnum('status').default('active').notNull(),
  publishedVersionId: uuid('published_version_id').references(() => contentVersions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const characterPrompts = pgTable('character_prompts', {
  id: uuid('id').defaultRandom().primaryKey(),
  characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }).notNull(),
  systemPrompt: text('system_prompt').notNull(),
  personalityPrompt: text('personality_prompt'),
  scenarioPrompt: text('scenario_prompt'),
  safetyPrompt: text('safety_prompt'),
  outputFormatPrompt: text('output_format_prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const scenes = pgTable('scenes', {
  id: uuid('id').defaultRandom().primaryKey(),
  scriptId: uuid('script_id').references(() => scripts.id).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const storyNodes = pgTable('story_nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  scriptId: uuid('script_id').references(() => scripts.id).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  triggerCondition: jsonb('trigger_condition'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userStoryState = pgTable('user_story_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  scriptId: uuid('script_id').references(() => scripts.id).notNull(),
  currentNodeId: uuid('current_node_id').references(() => storyNodes.id),
  state: jsonb('state').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  title: varchar('title', { length: 256 }),
  modelTier: modelTierEnum('model_tier').default('standard').notNull(),
  mode: chatModeEnum('mode').notNull(),
  scriptId: uuid('script_id').references(() => scripts.id),
  status: sessionStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  modeScriptIdCheck: check(
    'chat_sessions_mode_script_id_check',
    sql`(${table.mode} = 'script' AND ${table.scriptId} IS NOT NULL) OR (${table.mode} = 'free' AND ${table.scriptId} IS NULL)`,
  ),
  activeFreeSessionUnique: uniqueIndex('chat_sessions_active_free_unique')
    .on(table.userId, table.characterId, table.mode)
    .where(sql`${table.status} = 'active' and ${table.mode} = 'free'`),
  activeScriptSessionUnique: uniqueIndex('chat_sessions_active_script_unique')
    .on(table.userId, table.characterId, table.mode, table.scriptId)
    .where(sql`${table.status} = 'active' and ${table.mode} = 'script'`),
}));

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => chatSessions.id, { onDelete: 'cascade' }).notNull(),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  clientMessageId: varchar('client_message_id', { length: 128 }),
  outOfScope: boolean('out_of_scope').default(false).notNull(),
  excludedFromContext: boolean('excluded_from_context').default(false).notNull(),
  generationStatus: varchar('generation_status', { length: 32 }),
  generationLeaseExpiresAt: timestamp('generation_lease_expires_at', { withTimezone: true }),
  generationAttempt: integer('generation_attempt').default(1).notNull(),
  generationSnapshot: jsonb('generation_snapshot').$type<ChatGenerationSnapshot | null>(),
  mood: moodTypeEnum('mood'),
  modelTier: modelTierEnum('model_tier'),
  tokensUsed: integer('tokens_used'),
  pointsConsumed: integer('points_consumed'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userClientMessageUnique: uniqueIndex('messages_user_client_message_unique')
    .on(table.sessionId, table.role, table.clientMessageId)
    .where(sql`${table.role} = 'user' and ${table.clientMessageId} is not null`),
  sessionCreatedAtIdx: index('messages_session_id_created_at_idx').on(table.sessionId, table.createdAt),
}));

export const memories = pgTable('memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  type: memoryTypeEnum('type').notNull(),
  scope: memoryScopeEnum('scope').notNull(),
  scriptId: uuid('script_id').references(() => scripts.id),
  content: text('content').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  scopeScriptIdCheck: check(
    'memories_scope_script_id_check',
    sql`(${table.scope} = 'shared' AND ${table.scriptId} IS NULL) OR (${table.scope} = 'script' AND ${table.scriptId} IS NOT NULL)`,
  ),
}));

export const relationships = pgTable('relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  bondLevel: integer('bond_level').default(1).notNull(),
  bondExp: integer('bond_exp').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userCharacterUnique: uniqueIndex('relationships_user_character_unique').on(table.userId, table.characterId),
}));

export const relationshipBondExpEvents = pgTable('relationship_bond_exp_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  assistantMessageId: uuid('assistant_message_id').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  expIncrement: integer('exp_increment').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  assistantMessageUnique: uniqueIndex('relationship_bond_exp_events_assistant_message_unique')
    .on(table.assistantMessageId),
  assistantMessageFk: foreignKey({
    columns: [table.assistantMessageId],
    foreignColumns: [messages.id],
    name: 'relationship_bond_exp_events_assistant_message_id_messages_fk',
  }).onDelete('cascade'),
}));

export const titles = pgTable('titles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  iconUrl: varchar('icon_url', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameUnique: uniqueIndex('titles_name_unique').on(table.name),
}));

export const userTitles = pgTable('user_titles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  titleId: uuid('title_id').references(() => titles.id).notNull(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userTitleUnique: uniqueIndex('user_titles_user_title_unique').on(table.userId, table.titleId),
}));

export const achievements = pgTable('achievements', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  condition: jsonb('condition').notNull(),
  iconUrl: varchar('icon_url', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameUnique: uniqueIndex('achievements_name_unique').on(table.name),
}));

export const userAchievements = pgTable('user_achievements', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  achievementId: uuid('achievement_id').references(() => achievements.id).notNull(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userAchievementUnique: uniqueIndex('user_achievements_user_achievement_unique').on(table.userId, table.achievementId),
}));

export const modelProfiles = pgTable('model_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  tier: modelTierEnum('tier').notNull().unique(),
  modelName: varchar('model_name', { length: 128 }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  pointsPerCall: integer('points_per_call').notNull(),
  displayName: varchar('display_name', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  costEstimateCents: integer('cost_estimate_cents'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const modelUsageLogs = pgTable('model_usage_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  sessionId: uuid('session_id').references(() => chatSessions.id).notNull(),
  modelTier: modelTierEnum('model_tier').notNull(),
  modelName: varchar('model_name', { length: 128 }).notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costEstimateCents: integer('cost_estimate_cents'),
  pointsConsumed: integer('points_consumed').notNull(),
  walletTransactionId: uuid('wallet_transaction_id'),
  clientMessageId: varchar('client_message_id', { length: 128 }),
  errorCode: varchar('error_code', { length: 64 }),
  status: modelUsageStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  walletTransactionFk: foreignKey({
    columns: [table.walletTransactionId],
    foreignColumns: [walletTransactions.id],
    name: 'model_usage_logs_wallet_transaction_id_wallet_transactions_fk',
  }),
}));

export const chatEffectRuns = pgTable('chat_effect_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  assistantMessageId: uuid('assistant_message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  effectName: varchar('effect_name', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  error: varchar('error', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  assistantEffectUnique: uniqueIndex('chat_effect_runs_assistant_effect_unique')
    .on(table.assistantMessageId, table.effectName),
}));

export const quotaPackages = pgTable('quota_packages', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  priceCents: integer('price_cents').notNull(),
  points: integer('points').notNull(),
  description: varchar('description', { length: 256 }),
  recommended: boolean('recommended').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  quotaPackageId: uuid('quota_package_id').references(() => quotaPackages.id).notNull(),
  amountCents: integer('amount_cents').notNull(),
  pointsAmount: integer('points_amount').notNull(),
  status: orderStatusEnum('status').default('created').notNull(),
  merchantOrderNo: varchar('merchant_order_no', { length: 128 }).notNull().unique(),
  providerTransactionId: varchar('provider_transaction_id', { length: 256 }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  creditedAt: timestamp('credited_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  providerTransactionId: varchar('provider_transaction_id', { length: 256 }),
  prepayParams: jsonb('prepay_params'),
  callbackRawDigest: text('callback_raw_digest'),
  verifyResult: varchar('verify_result', { length: 32 }).default('pending').notNull(),
  status: paymentStatusEnum('status').default('pending').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  activeOrderUnique: uniqueIndex('payments_order_active_unique')
    .on(table.orderId)
    .where(sql`${table.active} = true`),
}));

export const walletAccounts = pgTable('wallet_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull().unique(),
  balancePoints: integer('balance_points').default(0).notNull(),
  totalRechargedPoints: integer('total_recharged_points').default(0).notNull(),
  totalConsumedPoints: integer('total_consumed_points').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: walletTxTypeEnum('type').notNull(),
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  orderId: uuid('order_id').references(() => orders.id),
  modelUsageLogId: uuid('model_usage_log_id'),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull().unique(),
  description: varchar('description', { length: 256 }),
  adminUserId: uuid('admin_user_id').references(() => users.id),
  adminAccountId: uuid('admin_account_id').references(() => adminAccounts.id),
  adjustmentReason: varchar('adjustment_reason', { length: 256 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  adminCheck: check('wallet_transactions_admin_check', sql`${table.adminUserId} IS NULL OR ${table.adminAccountId} IS NULL`),
}));

export const reviewLogs = pgTable('review_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => chatSessions.id).notNull(),
  messageId: uuid('message_id').references(() => messages.id),
  reviewerId: varchar('reviewer_id', { length: 128 }),
  reviewerAdminAccountId: uuid('reviewer_admin_account_id').references(() => adminAccounts.id),
  status: reviewStatusEnum('status').default('normal').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  reviewerCheck: check('review_logs_reviewer_check', sql`${table.reviewerId} IS NULL OR ${table.reviewerAdminAccountId} IS NULL`),
}));

export const blockedKeywords = pgTable('blocked_keywords', {
  id: uuid('id').defaultRandom().primaryKey(),
  keyword: varchar('keyword', { length: 128 }).notNull().unique(),
  category: varchar('category', { length: 64 }),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const characterReturnMessages = pgTable('character_return_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  messageId: uuid('message_id').references(() => messages.id),
  content: text('content').notNull(),
  reason: varchar('reason', { length: 16 }).notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => ({
  windowUnique: uniqueIndex('character_return_messages_window_unique')
    .on(table.userId, table.characterId, table.windowStart),
  unreadIdx: index('character_return_messages_unread_idx')
    .on(table.userId, table.readAt),
}));

// Web admin control-plane state. Status fields remain strings so recovery can
// represent partial/unknown cross-system outcomes without enum migrations.
export const adminAccounts = pgTable('admin_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').default(true).notNull(),
  mustChangePassword: boolean('must_change_password').default(true).notNull(),
  credentialVersion: integer('credential_version').default(1).notNull(),
  isProtected: boolean('is_protected').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  normalizedEmail: check('admin_accounts_normalized_email', sql`${table.email} = lower(btrim(${table.email})) AND length(${table.email}) > 0`),
  positiveVersion: check('admin_accounts_positive_version', sql`${table.credentialVersion} > 0`),
  protectedUnique: uniqueIndex('admin_accounts_protected_unique').on(table.isProtected).where(sql`${table.isProtected} = true`),
}));

// Fixed-window budgets are consumed atomically by the password login service.
export const adminLoginLimits = pgTable('admin_login_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => ({
  attemptsNonnegative: check('admin_login_limits_attempts_nonnegative', sql`${table.attempts} >= 0`),
  expiryIdx: index('admin_login_limits_expiry_idx').on(table.expiresAt),
}));

export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  adminAccountId: uuid('admin_account_id').references(() => adminAccounts.id),
  tokenHash: text('token_hash').unique(),
  credentialVersion: integer('credential_version'),
  provider: varchar('provider', { length: 32 }).notNull(),
  externalSubject: varchar('external_subject', { length: 256 }).notNull(),
  stateHash: varchar('state_hash', { length: 128 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identityCheck: check('admin_sessions_identity_check', sql`(${table.userId} IS NOT NULL AND ${table.adminAccountId} IS NULL AND ${table.tokenHash} IS NULL AND ${table.credentialVersion} IS NULL) OR (${table.userId} IS NULL AND ${table.adminAccountId} IS NOT NULL AND ${table.provider} = 'password' AND ${table.tokenHash} IS NOT NULL AND ${table.credentialVersion} IS NOT NULL AND ${table.credentialVersion} > 0)`),
  subjectUnique: uniqueIndex('admin_sessions_subject_unique').on(table.provider, table.externalSubject),
  activeIdx: index('admin_sessions_active_idx').on(table.userId, table.expiresAt),
}));

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorAdminAccountId: uuid('actor_admin_account_id').references(() => adminAccounts.id),
  actorSource: varchar('actor_source', { length: 32 }).default('legacy_user').notNull(),
  action: varchar('action', { length: 96 }).notNull(),
  objectType: varchar('object_type', { length: 64 }).notNull(),
  objectId: varchar('object_id', { length: 128 }),
  requestId: varchar('request_id', { length: 128 }),
  taskId: varchar('task_id', { length: 128 }),
  dedupeKey: varchar('dedupe_key', { length: 160 }),
  result: varchar('result', { length: 32 }).notNull(),
  summary: jsonb('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  actorCheck: check('admin_audit_logs_actor_check', sql`(${table.actorSource} = 'legacy_user' AND ${table.actorUserId} IS NOT NULL AND ${table.actorAdminAccountId} IS NULL) OR (${table.actorSource} = 'admin_account' AND ${table.actorUserId} IS NULL AND ${table.actorAdminAccountId} IS NOT NULL) OR (${table.actorSource} IN ('server_command', 'unauthenticated_request') AND ${table.actorUserId} IS NULL AND ${table.actorAdminAccountId} IS NULL)`),
  dedupeKeyUnique: uniqueIndex('admin_audit_logs_dedupe_key_unique').on(table.dedupeKey),
  requestIdx: index('admin_audit_logs_request_idx').on(table.requestId, table.createdAt),
  objectIdx: index('admin_audit_logs_object_idx').on(table.objectType, table.objectId, table.createdAt),
}));

export const contentVersions = pgTable('content_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: varchar('entity_type', { length: 32 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  versionNo: integer('version_no').notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  contentHash: varchar('content_hash', { length: 128 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdByAdminAccountId: uuid('created_by_admin_account_id').references(() => adminAccounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => ({
  creatorCheck: check('content_versions_creator_check', sql`NOT (${table.createdBy} IS NOT NULL AND ${table.createdByAdminAccountId} IS NOT NULL)`),
  entityVersionUnique: uniqueIndex('content_versions_entity_version_unique').on(table.entityType, table.entityId, table.versionNo),
  entityPublishedUnique: uniqueIndex('content_versions_entity_published_unique').on(table.entityType, table.entityId).where(sql`${table.status} = 'published'`),
  entityStatusIdx: index('content_versions_entity_status_idx').on(table.entityType, table.entityId, table.status),
}));

export const publishTasks = pgTable('publish_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull().unique(),
  entityType: varchar('entity_type', { length: 32 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  versionId: uuid('version_id').references(() => contentVersions.id).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  desiredHash: varchar('desired_hash', { length: 128 }).notNull(),
  appliedHash: varchar('applied_hash', { length: 128 }),
  lastError: text('last_error'),
  recoveryState: varchar('recovery_state', { length: 32 }),
  createdBy: uuid('created_by').references(() => users.id),
  createdByAdminAccountId: uuid('created_by_admin_account_id').references(() => adminAccounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  creatorCheck: check('publish_tasks_creator_check', sql`(${table.createdBy} IS NOT NULL) <> (${table.createdByAdminAccountId} IS NOT NULL)`),
}));

export const modelProfileVersions = pgTable('model_profile_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  profileId: uuid('profile_id').references(() => modelProfiles.id).notNull(),
  versionNo: integer('version_no').notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  modelName: varchar('model_name', { length: 128 }).notNull(),
  pointsPerCall: integer('points_per_call').notNull(),
  runtimeParams: jsonb('runtime_params').notNull().default({}),
  credentialRef: varchar('credential_ref', { length: 128 }),
  configHash: varchar('config_hash', { length: 128 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdByAdminAccountId: uuid('created_by_admin_account_id').references(() => adminAccounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => ({
  creatorCheck: check('model_profile_versions_creator_check', sql`NOT (${table.createdBy} IS NOT NULL AND ${table.createdByAdminAccountId} IS NOT NULL)`),
  profileVersionUnique: uniqueIndex('model_profile_versions_profile_version_unique').on(table.profileId, table.versionNo),
}));

// Batch 3 step 1 (plan W): one immutable record of the derived FastClaw base context (SOUL.md /
// IDENTITY.md / USER.md) rendered from a published character version. Identical content is one row
// (`agent_hash_unique`), so a repeat sync adds nothing and an existing capture is never rewritten.
export const agentContextVersions = pgTable('agent_context_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  // The roleplay agent id (`role-*`): the FastClaw agent whose three system files this records.
  agentId: text('agent_id').notNull(),
  contentHash: varchar('content_hash', { length: 128 }).notNull(),
  // The three rendered files + per-file hashes + character counts, exactly as written.
  snapshot: jsonb('snapshot').notNull(),
  source: varchar('source', { length: 16 }).notNull(),
  capturedByAdminAccountId: uuid('captured_by_admin_account_id').references(() => adminAccounts.id),
  // The published version this context was derived from (NULL for a legacy capture without one).
  contentVersionId: uuid('content_version_id').references(() => contentVersions.id),
  contentVersionNo: integer('content_version_no'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  agentHashUnique: uniqueIndex('agent_context_versions_agent_hash_unique').on(table.agentId, table.contentHash),
  latestIdx: index('agent_context_versions_agent_latest_idx').on(table.agentId, table.createdAt, table.id),
  agentIdNonEmpty: check('agent_context_versions_agent_id_nonempty', sql`length(btrim(${table.agentId})) > 0`),
  contentHashNonEmpty: check('agent_context_versions_content_hash_nonempty', sql`length(btrim(${table.contentHash})) > 0`),
  sourceCheck: check('agent_context_versions_source_check', sql`${table.source} IN ('publish', 'manual', 'startup')`),
  contentVersionNoPositive: check('agent_context_versions_content_version_no_positive', sql`${table.contentVersionNo} IS NULL OR ${table.contentVersionNo} > 0`),
}));

export const chatTurnSnapshots = pgTable('chat_turn_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  userMessageId: uuid('user_message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull().unique(),
  // Optional: legacy clients accept a turn without a client id; user_message_id is the unique key.
  clientMessageId: varchar('client_message_id', { length: 128 }),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  contentVersionId: uuid('content_version_id').references(() => contentVersions.id).notNull(),
  modelProfileVersionId: uuid('model_profile_version_id').references(() => modelProfileVersions.id).notNull(),
  modelTier: modelTierEnum('model_tier').notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  modelName: varchar('model_name', { length: 128 }).notNull(),
  pointsPerCall: integer('points_per_call').notNull(),
  // The base-context record that was current when this turn was accepted; NULL means "not recorded",
  // never "the latest one" (a legacy turn is not backfilled).
  agentContextVersionId: uuid('agent_context_version_id').references(() => agentContextVersions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  characterVersionIdx: index('chat_turn_snapshots_character_version_idx').on(table.characterId, table.contentVersionId),
}));

export const chatGenerationAttempts = pgTable('chat_generation_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  snapshotId: uuid('snapshot_id').references(() => chatTurnSnapshots.id, { onDelete: 'cascade' }),
  attemptNo: integer('attempt_no'),
  status: varchar('status', { length: 32 }),
  consumeKey: varchar('consume_key', { length: 160 }).unique(),
  refundKey: varchar('refund_key', { length: 160 }).unique(),
  consumeTransactionId: uuid('consume_transaction_id').references(() => walletTransactions.id),
  refundTransactionId: uuid('refund_transaction_id').references(() => walletTransactions.id),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  userMessageId: uuid('user_message_id').references(() => messages.id, { onDelete: 'cascade' }),
  attempt: integer('attempt'),
  pointsPerCall: integer('points_per_call'),
  chargeStatus: varchar('charge_status', { length: 16 }).default('pending'),
  chargeWalletTransactionId: uuid('charge_wallet_transaction_id'),
  refundStatus: varchar('refund_status', { length: 16 }).default('not_required'),
  refundWalletTransactionId: uuid('refund_wallet_transaction_id'),
}, (table) => ({
  snapshotAttemptUnique: uniqueIndex('chat_generation_attempts_snapshot_attempt_unique').on(table.snapshotId, table.attemptNo),
  userMessageAttemptUnique: uniqueIndex('chat_generation_attempts_message_attempt_unique').on(table.userMessageId, table.attempt),
}));

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  relationships: many(relationships),
  memories: many(memories),
  userTitles: many(userTitles),
  userAchievements: many(userAchievements),
  orders: many(orders),
  walletAccount: many(walletAccounts),
  walletTransactions: many(walletTransactions),
  characterReturnMessages: many(characterReturnMessages),
}));

export const scriptsRelations = relations(scripts, ({ many }) => ({
  characters: many(characters),
  scenes: many(scenes),
  storyNodes: many(storyNodes),
}));

export const charactersRelations = relations(characters, ({ one, many }) => ({
  script: one(scripts, { fields: [characters.scriptId], references: [scripts.id] }),
  prompts: many(characterPrompts),
  chatSessions: many(chatSessions),
  relationships: many(relationships),
  characterReturnMessages: many(characterReturnMessages),
}));

export const characterPromptsRelations = relations(characterPrompts, ({ one }) => ({
  character: one(characters, { fields: [characterPrompts.characterId], references: [characters.id] }),
}));

export const scenesRelations = relations(scenes, ({ one }) => ({
  script: one(scripts, { fields: [scenes.scriptId], references: [scripts.id] }),
}));

export const storyNodesRelations = relations(storyNodes, ({ one }) => ({
  script: one(scripts, { fields: [storyNodes.scriptId], references: [scripts.id] }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  character: one(characters, { fields: [chatSessions.characterId], references: [characters.id] }),
  script: one(scripts, { fields: [chatSessions.scriptId], references: [scripts.id] }),
  messages: many(messages),
  reviewLogs: many(reviewLogs),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(chatSessions, { fields: [messages.sessionId], references: [chatSessions.id] }),
}));

export const chatGenerationAttemptsRelations = relations(chatGenerationAttempts, ({ one }) => ({
  userMessage: one(messages, { fields: [chatGenerationAttempts.userMessageId], references: [messages.id] }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  user: one(users, { fields: [memories.userId], references: [users.id] }),
  character: one(characters, { fields: [memories.characterId], references: [characters.id] }),
  script: one(scripts, { fields: [memories.scriptId], references: [scripts.id] }),
}));

export const relationshipsRelations = relations(relationships, ({ one }) => ({
  user: one(users, { fields: [relationships.userId], references: [users.id] }),
  character: one(characters, { fields: [relationships.characterId], references: [characters.id] }),
}));

export const characterReturnMessagesRelations = relations(characterReturnMessages, ({ one }) => ({
  user: one(users, { fields: [characterReturnMessages.userId], references: [users.id] }),
  character: one(characters, { fields: [characterReturnMessages.characterId], references: [characters.id] }),
  message: one(messages, { fields: [characterReturnMessages.messageId], references: [messages.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  quotaPackage: one(quotaPackages, { fields: [orders.quotaPackageId], references: [quotaPackages.id] }),
  payments: many(payments),
  walletTransactions: many(walletTransactions),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const walletAccountsRelations = relations(walletAccounts, ({ one }) => ({
  user: one(users, { fields: [walletAccounts.userId], references: [users.id] }),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  user: one(users, { fields: [walletTransactions.userId], references: [users.id] }),
  order: one(orders, { fields: [walletTransactions.orderId], references: [orders.id] }),
}));

export const modelUsageLogsRelations = relations(modelUsageLogs, ({ one }) => ({
  user: one(users, { fields: [modelUsageLogs.userId], references: [users.id] }),
  character: one(characters, { fields: [modelUsageLogs.characterId], references: [characters.id] }),
  session: one(chatSessions, { fields: [modelUsageLogs.sessionId], references: [chatSessions.id] }),
  walletTransaction: one(walletTransactions, { fields: [modelUsageLogs.walletTransactionId], references: [walletTransactions.id] }),
}));

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  session: one(chatSessions, { fields: [reviewLogs.sessionId], references: [chatSessions.id] }),
  message: one(messages, { fields: [reviewLogs.messageId], references: [messages.id] }),
}));

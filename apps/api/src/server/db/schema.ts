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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reviewLogs = pgTable('review_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => chatSessions.id).notNull(),
  messageId: uuid('message_id').references(() => messages.id),
  reviewerId: varchar('reviewer_id', { length: 128 }),
  status: reviewStatusEnum('status').default('normal').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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

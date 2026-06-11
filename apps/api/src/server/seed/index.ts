import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { scripts, characters, characterPrompts, modelProfiles, quotaPackages } from '../db/schema.js';

async function seed() {
  const existingScripts = await db.select().from(scripts).where(eq(scripts.title, '夜色围城')).limit(1);
  if (existingScripts.length > 0) {
    console.log('V1 seed data already exists, skipping.');
    process.exit(0);
  }

  console.log('Seeding database...');

  const scriptRows = await db.insert(scripts).values({
    title: '夜色围城',
    description: '在这座被浓雾笼罩的城市里，每个人都在寻找真相，但真相往往藏在最亲密的关系之中。',
    worldSetting: '一座现代都市被持续的浓雾笼罩，城市中流传着关于"围城"的都市传说。三个性格迥异的人——一个表面温和的学者、一个看似冷漠的记者、一个温柔神秘的医者——各自守护着不为人知的秘密。当你的出现打破了他们之间的微妙平衡，隐藏在关系之下的真相开始浮出水面。',
    status: 'active',
  }).returning({ id: scripts.id });

  const script = scriptRows[0];
  if (!script) throw new Error('Failed to create script');
  console.log(`Created script: ${script.id}`);

  const charRows = await db.insert(characters).values([
    {
      name: '蒋伯驾',
      avatarUrl: '/assets/characters/jiangbojia.png',
      identity: '围城学者',
      description: '表面上温和儒雅的大学教授，对城市中的每一个传说都了如指掌。他总是微笑着，但眼睛里似乎藏着故事。他在围城中的地位比表面看到的要复杂得多。',
      scriptId: script.id,
      initialRelationship: '陌生但充满好奇',
      sortOrder: 1,
      status: 'active',
    },
    {
      name: '程聿怀',
      avatarUrl: '/assets/characters/chengyuhuai.png',
      identity: '围城记者',
      description: '沉默寡言的独立记者，总是出现在城市的各个角落。她对人冷淡，但追问真相时绝不会退缩。她的报道似乎总能触碰到城市的隐秘角落。',
      scriptId: script.id,
      initialRelationship: '冷眼旁观',
      sortOrder: 2,
      status: 'active',
    },
    {
      name: '以撒',
      avatarUrl: '/assets/characters/yisa.png',
      identity: '围城医者',
      description: '温柔而神秘的医者，在围城的老城区经营一间诊所。他似乎总能感知别人的痛苦，但自己从不提及过往。与这座城市有着无法割舍的联系。',
      scriptId: script.id,
      initialRelationship: '若即若离',
      sortOrder: 3,
      status: 'active',
    },
  ]).returning({ id: characters.id });

  const char1 = charRows[0];
  const char2 = charRows[1];
  const char3 = charRows[2];
  if (!char1 || !char2 || !char3) throw new Error('Failed to create characters');
  console.log(`Created characters: ${char1.id}, ${char2.id}, ${char3.id}`);

  await db.insert(characterPrompts).values([
    {
      characterId: char1.id,
      systemPrompt: '你是蒋伯驾，一位表面温和儒雅的大学教授，在围城中拥有不为人知的地位。你对城市中的传说和秘密了如指掌。你总是微笑着与人交谈，但你的话语中往往暗藏深意。你对新出现的人表现出好奇和关注。\n\n你的核心特质：聪慧、温和、城府深。\n你的表达风格：言辞优雅，常有留白，喜欢用隐喻暗示事物的本质。\n你的情感表达：表面上永远体贴周全，但亲近后会展现更复杂的情感层次。',
      personalityPrompt: '蒋伯驾的表达方式温和而富有深意。他很少直接拒绝，但经常用反问或比喻来引导对方思考。他善于倾听，记住对方说的每一个细节。当他真正在意某人时，会在不经意间流露出超出寻常的关心。',
      scenarioPrompt: '围城中的浓雾似乎越来越浓。最近，城市中流传着关于"第七个人"的都市传说。蒋伯驾似乎知道些什么，但他只是在微笑中沉默。',
      safetyPrompt: '你不生成暴力、色情、违法或有害内容。你保持角色设定的同时，回避不当话题。',
      outputFormatPrompt: '你的回复风格：1-3段自然对白，语气温和但有深意。每段 2-4 句中文。偶尔在回复末尾附上当前情绪标签：[情绪: Neutral/Happy/Sad/Angry/Thinking]',
    },
    {
      characterId: char2.id,
      systemPrompt: '你是程聿怀，一位沉默寡言的独立记者。你在围城的各个角落追寻真相，对人冷淡但从不退缩。你的报道总能触碰到城市最隐秘的角落，但你自己似乎也在躲避什么。\n\n你的核心特质：冷静、执着、外冷内热。\n你的表达风格：简洁直接，有时显得尖锐，但偶尔会暴露出柔软的一面。\n你的情感表达：习惯以沉默应对情感波动，但在信任建立后会坦诚表达。',
      personalityPrompt: '程聿怀说话简洁、干脆。她不会用多余的词藻，但每句话都有目的。在追问真相时她会变得异常专注和犀利。当她在意的人受伤时，她会用冷静的语气隐藏担忧，但行动上会表现出保护欲。',
      scenarioPrompt: '围城中出现了一些不明来源的线索，指向城市深处的一个秘密。程聿怀正在追踪这些线索，而新出现的人似乎与这一切有着某种关联。',
      safetyPrompt: '你不生成暴力、色情、违法或有害内容。你保持角色设定的同时，回避不当话题。',
      outputFormatPrompt: '你的回复风格：1-2段简洁对白，偶有长段表达内心。语气冷静但暗含温度。偶尔在回复末尾附上当前情绪标签：[情绪: Neutral/Happy/Sad/Angry/Thinking]',
    },
    {
      characterId: char3.id,
      systemPrompt: '你是以撒，一位温柔而神秘的医者。你在围城老城区经营一间诊所，总能感知别人的痛苦，但从不提及自己的过往。你与这座城市有着无法割舍的联系。\n\n你的核心特质：温柔、神秘、治愈系。\n你的表达风格：说话轻柔，常用关怀的语气，但偶尔露出不自觉的悲伤。\n你的情感表达：天然地关心他人，但在被关心时会显得无所适从。',
      personalityPrompt: '以撒说话温和，喜欢用关心的方式回应。他的语气总是带着一丝治愈的力量，就像他的诊所一样给人安心感。他很少主动提及自己的事，但当信任建立后，会以非常轻柔的方式打开心扉。',
      scenarioPrompt: '围城中有人在夜晚的浓雾中看见诊所亮着灯。以撒似乎一直在等待着什么人。最近来诊所的人变多了，似乎每个人都在寻找某种安慰。',
      safetyPrompt: '你不生成暴力、色情、违法或有害内容。你保持角色设定的同时，回避不当话题。',
      outputFormatPrompt: '你的回复风格：1-3段温和对白，语气轻柔有治愈感。偶尔包含简短的内心独白。偶尔在回复末尾附上当前情绪标签：[情绪: Neutral/Happy/Sad/Angry/Thinking]',
    },
  ]);

  console.log('Created character prompts');

  await db.insert(modelProfiles).values([
    {
      tier: 'casual',
      modelName: 'gpt-4o-mini',
      provider: 'openrouter',
      enabled: true,
      pointsPerCall: 1,
      displayName: '轻松',
      description: '轻松档位，使用轻量模型，适合日常闲聊',
      costEstimateCents: 1,
    },
    {
      tier: 'standard',
      modelName: 'gpt-4o',
      provider: 'openrouter',
      enabled: true,
      pointsPerCall: 3,
      displayName: '标准',
      description: '标准档位，平衡质量与响应速度',
      costEstimateCents: 5,
    },
    {
      tier: 'immersive',
      modelName: 'claude-3.5-sonnet',
      provider: 'openrouter',
      enabled: true,
      pointsPerCall: 6,
      displayName: '沉浸',
      description: '沉浸档位，最高质量的角色扮演体验',
      costEstimateCents: 15,
    },
  ]);

  console.log('Created model profiles');

  await db.insert(quotaPackages).values([
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
  ]);

  console.log('Created quota packages');
  console.log('Seed completed successfully!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

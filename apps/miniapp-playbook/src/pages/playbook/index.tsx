import { ScrollView, Text, View } from '@tarojs/components';
import {
  Badge,
  BaseButton,
  BalancePanel,
  BottomAction,
  CharacterAvatar,
  CharacterPosterCard,
  ChatBubble,
  ChatSessionRow,
  EmptyState,
  IconButton,
  MemoryCard,
  MoodChip,
  NoticeBlock,
  PageShell,
  PageSection,
  PointsBadge,
  PrimaryButton,
  QuotaPackageCard,
  SearchBar,
  StatusStateCard,
  TonalButton,
} from '@juben-sha/miniapp-ui';
import './index.scss';

const moods = ['neutral', 'happy', 'sad', 'angry', 'thinking'] as const;

export default function PlaybookPage() {
  return (
    <PageShell noPadding className="playbook-shell">
      <ScrollView scrollY className="playbook-scroll">
        <View className="playbook-hero">
          <Text className="playbook-eyebrow">Miniapp UI</Text>
          <Text className="playbook-title">组件 Playbook</Text>
          <Text className="playbook-subtitle">独立小程序预览正式 UI 组件，不接 API、不接登录、不污染主包。</Text>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Buttons</Text>
            <Badge tone="primary">ui</Badge>
          </View>
          <View className="playbook-stack">
            <PrimaryButton>开始对话</PrimaryButton>
            <TonalButton>稍后再说</TonalButton>
            <BaseButton variant="ghost" size="md">更多选项</BaseButton>
            <View className="playbook-icon-row">
              <IconButton label="返回" icon="‹" />
              <IconButton label="收藏" icon="☆" tone="tonal" />
              <IconButton label="确认" icon="✓" tone="primary" />
            </View>
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Inputs</Text>
            <Badge tone="secondary">search</Badge>
          </View>
          <View className="playbook-stack">
            <SearchBar placeholder="搜索角色、剧本或记忆" />
            <SearchBar value="白藏" placeholder="搜索聊天" />
            <SearchBar disabled placeholder="搜索聊天..." />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Badges</Text>
            <PointsBadge points={128} />
          </View>
          <View className="playbook-chip-grid">
            <Badge>默认</Badge>
            <Badge tone="primary">主状态</Badge>
            <Badge tone="secondary">关系</Badge>
            <Badge tone="success">成功</Badge>
            <Badge tone="error">异常</Badge>
            {moods.map((mood) => <MoodChip key={mood} mood={mood} />)}
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Lists</Text>
            <Badge tone="primary">sessions</Badge>
          </View>
          <View className="playbook-list-panel">
            <ChatSessionRow
              characterName="白藏"
              levelLabel="Lv.3"
              timeLabel="刚刚"
              preview="铃音，今夜的月很满。若你愿意，我会亲自带你穿过第一重鸟居。"
              unreadCount={1}
            />
            <ChatSessionRow
              characterName="贺茂清玄"
              levelLabel="标准"
              timeLabel="昨天"
              preview="别碰那根红线。它不是装饰，是契约留下的咒痕。"
            />
            <ChatSessionRow characterName="月岛澪" levelLabel="沉浸" timeLabel="6/09" preview="" />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Avatars</Text>
            <Badge tone="secondary">character</Badge>
          </View>
          <View className="playbook-avatar-row">
            <CharacterAvatar name="白藏" size="sm" online />
            <CharacterAvatar name="澪" size="md" />
            <CharacterAvatar name="久远" size="lg" online />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Discovery</Text>
            <Badge tone="secondary">cards</Badge>
          </View>
          <View className="playbook-poster-grid">
            <CharacterPosterCard title="白藏" subtitle="庭院狐神" imageUrl="/assets/characters/hakuzo.jpg" badge="在线" selected />
            <CharacterPosterCard title="贺茂清玄" subtitle="冷面阴阳师" badge="Lv.1" />
            <CharacterPosterCard title="月岛澪" subtitle="绘梦画师" />
            <CharacterPosterCard title="久远" subtitle="守门武士" badge="推荐" />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Commerce</Text>
            <Badge tone="points">quota</Badge>
          </View>
          <View className="playbook-stack">
            <BalancePanel value={128} hint="可用于继续角色对话" />
            <BalancePanel value={24} label="本次获得" unit="点" tone="success" hint="支付确认后自动入账" />
            <QuotaPackageCard
              name="月下小叙"
              points={30}
              price="¥6.00"
              description="适合轻量续聊，体验标准模型回复。"
            />
            <QuotaPackageCard
              name="沉浸一幕"
              points={128}
              price="¥18.00"
              description="推荐用于连续剧情推进和长对话。"
              recommended
              selected
            />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Memory</Text>
            <Badge tone="secondary">state</Badge>
          </View>
          <View className="playbook-stack">
            <MemoryCard
              typeLabel="关系状态"
              characterName="白藏"
              tone="relationship"
              content="用户曾在鸟居前选择相信白藏，因此白藏会更愿意主动解释庭院中的旧约。"
            />
            <MemoryCard
              typeLabel="剧情状态"
              characterName="月岛澪"
              tone="story"
              content="屏风上的桥已经第二次出现，桥对岸的人影开始能回应用户的问题。"
            />
            <MemoryCard
              typeLabel="用户信息"
              content="用户偏好更慢的节奏，希望角色先给出线索，再提出下一步行动。"
            />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Status</Text>
            <Badge tone="points">state</Badge>
          </View>
          <View className="playbook-stack">
            <EmptyState title="暂无记忆" message="继续对话后，角色会逐渐记住重要线索。" primaryText="去聊天" />
            <StatusStateCard
              title="点数不足"
              message="当前点数不足，请先购买额度包。"
              tone="points"
              icon="点"
              primaryText="购买点数"
              secondaryText="查看规则"
            />
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Page Primitives</Text>
            <Badge tone="secondary">layout</Badge>
          </View>
          <View className="playbook-stack">
            <PageSection title="世界观" kicker="月见庭院" surface>
              <Text className="playbook-section__body-text">薄包装现有 page-section 和 surface-card 语义，不新建页面样式体系。</Text>
            </PageSection>
            <NoticeBlock>
              本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
            </NoticeBlock>
          </View>
        </View>

        <View className="playbook-section">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Bottom Action</Text>
            <Badge tone="points">fixed</Badge>
          </View>
          <View className="playbook-bottom-demo">
            <Text className="playbook-bottom-demo__label">页面底部动作区</Text>
            <Text className="playbook-bottom-demo__text">实际使用时固定在屏幕底部，这里用缩略容器预览按钮宽度和安全区留白。</Text>
            <View className="playbook-bottom-demo__bar">
              <PrimaryButton>确认支付</PrimaryButton>
            </View>
          </View>
        </View>

        <View className="playbook-section playbook-section--chat">
          <View className="playbook-section__header">
            <Text className="playbook-section__title">Chat Bubble</Text>
            <Badge tone="primary">chat</Badge>
          </View>
          <View className="playbook-chat-panel">
            <ChatBubble role="system" content="第 3 幕 · 月下庭院" />
            <ChatBubble role="assistant" characterName="白藏" content="你终于来了。我等这句话，已经等了很久。" />
            <ChatBubble role="user" content="这里发生过什么？" />
            <ChatBubble role="assistant" characterName="白藏" fallback typing content="" />
          </View>
        </View>
      </ScrollView>
      <BottomAction className="playbook-floating-action">
        <PrimaryButton>进入真实页面测试</PrimaryButton>
      </BottomAction>
    </PageShell>
  );
}

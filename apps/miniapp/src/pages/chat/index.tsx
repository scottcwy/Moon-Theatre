import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter, useUnload } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CharacterHeader,
  ChatBubble,
  ChatInputBar,
  createBondViewModel,
  EmptyState,
  StatusStateCard,
} from '@juben-sha/miniapp-ui';
import { MODEL_TIER_COSTS } from '@juben-sha/shared';
import type { ChatMode, MoodType, StarterQuestions } from '../../types';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isLoggedIn, streamChat } from '../../services/api';
import type { StreamCallbacks } from '../../services/api';
import { navigateBackOrHome } from '../../utils/navigation';
import { getCharacterAvatarUrl } from '../home/index.model';
import { buildReturnMessagesReadBody, RETURN_MESSAGES_READ_PATH } from './list.model';
import {
  applyStarterQuestion,
  createClientMessageId,
  getBondFeedback,
  getDefaultChatMode,
  getEmptyModeScope,
  getFriendlyStreamErrorMessage,
  getInitialModelTier,
  getModeLabel,
  getReturnMessageReadCharacterId,
  getVisibleStarterQuestions,
  isSuccessfulDoneEvent,
  resolveCharacterScriptMetadata,
  shouldReconcileStreamError,
  shouldRenderStandaloneTypingIndicator,
} from './index.model';
import './index.scss';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mood?: MoodType;
  fallback?: boolean;
}

interface CharacterData {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  initialRelationship?: string;
  scriptId: string | null;
  script: null | { id: string; title: string };
  relationship?: { bondLevel: number; bondExp: number } | null;
  availableModes: ChatMode[];
  lastUsedMode: ChatMode | null;
  starterQuestions: StarterQuestions;
}

interface SessionMetadata {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl: string | null;
  characterIdentity: string;
  mode: ChatMode;
  scriptId: string | null;
  scriptTitle: string | null;
  canSend: boolean;
  hasSuccessfulTurn: boolean;
}

interface MessagesResponse {
  session: SessionMetadata;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    mood: string | null;
    createdAt: string;
  }>;
  page: number;
  limit: number;
}

interface SessionListItem {
  id: string;
  characterId: string;
  mode: ChatMode;
  scriptId: string | null;
  canSend: boolean;
}

interface ClientMessageLookupResponse {
  sessionId: string;
  clientMessageId: string;
  mode: ChatMode;
  scriptId: string | null;
  userMessage: {
    id: string;
    content: string;
    createdAt: string;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
  assistantMessage: null | {
    id: string;
    content: string;
    mood: string | null;
    createdAt: string;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
}

const EMPTY_STARTER_QUESTIONS: StarterQuestions = { script: [], free: [] };
function readRouteMode(value?: string): ChatMode | undefined {
  return value === 'script' || value === 'free' ? value : undefined;
}

export default function Chat() {
  const router = useRouter();
  const routeCharacterId = router.params.characterId || '';
  const routeSessionId = router.params.sessionId || undefined;
  const routeMode = readRouteMode(router.params.mode);
  const routeScriptId = router.params.scriptId || undefined;

  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(routeSessionId);
  const [mode, setMode] = useState<ChatMode>(routeMode || 'script');
  const [scriptId, setScriptId] = useState<string | undefined>(routeScriptId);
  const [scriptTitle, setScriptTitle] = useState('');
  const [availableModes, setAvailableModes] = useState<ChatMode[]>(routeMode ? [routeMode] : []);
  const [starterQuestions, setStarterQuestions] = useState<StarterQuestions>(EMPTY_STARTER_QUESTIONS);
  const [canSend, setCanSend] = useState(true);
  const [hasSuccessfulTurn, setHasSuccessfulTurn] = useState(false);
  const [scopeSwitching, setScopeSwitching] = useState(false);
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  // 模型档位选择已按产品决定收掉：对话统一走默认档（轻松，每轮 1 点），
  // 计费与余额判断照常，页面上不再出现三档控制器。
  const modelTier = getInitialModelTier();
  const [bondLevel, setBondLevel] = useState(1);
  const [bondExp, setBondExp] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState('');
  const { needsLogin, requireAuth, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  const sessionIdRef = useRef<string | undefined>(routeSessionId);
  const modeRef = useRef<ChatMode>(routeMode || 'script');
  const scriptIdRef = useRef<string | undefined>(routeScriptId);
  const scrollIntoViewRef = useRef('');
  const activeStreamRef = useRef<{ abort: () => void } | null>(null);
  const mountedRef = useRef(true);
  const historyLoadIdRef = useRef(0);

  const setScope = useCallback((next: { sessionId?: string; mode: ChatMode; scriptId?: string; scriptTitle?: string }) => {
    sessionIdRef.current = next.sessionId;
    modeRef.current = next.mode;
    scriptIdRef.current = next.scriptId;
    setSessionId(next.sessionId);
    setMode(next.mode);
    setScriptId(next.scriptId);
    setScriptTitle(next.scriptTitle || '');
  }, []);

  const abortActiveStream = useCallback(() => {
    activeStreamRef.current?.abort();
    activeStreamRef.current = null;
  }, []);

  const updateAssistantPlaceholder = useCallback((tempId: string, updater: (current: ChatMessage) => ChatMessage) => {
    setMessages((current) => current.map((message) => message.id === tempId ? updater(message) : message));
  }, []);

  const markReturnMessagesRead = useCallback((characterId: string) => {
    if (!isLoggedIn() || !characterId) return;
    // fire-and-forget：任意入口打开该角色会话即幂等标记已读，失败静默不阻断页面。
    void api.post(RETURN_MESSAGES_READ_PATH, buildReturnMessagesReadBody(characterId)).catch(() => {});
  }, []);

  const loadBalance = useCallback(async () => {
    if (!requireAuth()) {
      setPointsBalance(null);
      return;
    }
    try {
      const data = await api.get<{ balancePoints: number }>('/api/quota/balance');
      if (mountedRef.current) setPointsBalance(data.balancePoints);
    } catch (err) {
      if (mountedRef.current) {
        handleAuthError(err);
        setPointsBalance(null);
      }
    }
  }, [handleAuthError, requireAuth]);

  const applyCharacterDetail = useCallback((data: CharacterData) => {
    setCharacter(data);
    setAvailableModes(data.availableModes);
    setStarterQuestions(data.starterQuestions || EMPTY_STARTER_QUESTIONS);
    setBondLevel(data.relationship?.bondLevel ?? 1);
    setBondExp(data.relationship?.bondExp ?? 0);
  }, []);

  const loadCharacterDetail = useCallback(async (characterId: string, selectInitialScope: boolean) => {
    const data = await api.get<CharacterData>(`/api/characters/${characterId}`);
    if (!mountedRef.current) return data;
    applyCharacterDetail(data);

    if (selectInitialScope) {
      const selectedMode = routeMode || getDefaultChatMode(data.availableModes, data.lastUsedMode);
      if (!data.availableModes.includes(selectedMode)) {
        throw new Error('当前角色不支持所选聊天模式');
      }
      const selectedScriptId = selectedMode === 'script'
        ? (routeMode === 'script' ? routeScriptId : data.script?.id || data.scriptId || undefined)
        : undefined;
      if (selectedMode === 'script' && !selectedScriptId) {
        throw new Error('剧本模式缺少剧本信息');
      }
      setScope({
        mode: selectedMode,
        scriptId: selectedScriptId,
        scriptTitle: selectedMode === 'script' ? data.script?.title : undefined,
      });
      setCanSend(true);
      setHasSuccessfulTurn(false);
    }
    return data;
  }, [applyCharacterDetail, routeMode, routeScriptId, setScope]);

  const loadSessionHistory = useCallback(async (targetSessionId: string): Promise<MessagesResponse | null> => {
    const loadId = historyLoadIdRef.current + 1;
    historyLoadIdRef.current = loadId;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await api.get<MessagesResponse>(`/api/chat/sessions/${targetSessionId}/messages?page=1&limit=50`);
      if (!mountedRef.current || historyLoadIdRef.current !== loadId) return null;
      const historyMessages: ChatMessage[] = data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        mood: message.mood ? message.mood as MoodType : undefined,
      }));
      setMessages(historyMessages);
      setPageError('');
      setCharacter((current) => {
        const sameCharacter = current?.id === data.session.characterId ? current : null;
        const scriptMetadata = resolveCharacterScriptMetadata(sameCharacter, data.session);
        return {
          id: data.session.characterId,
          name: data.session.characterName,
          avatarUrl: data.session.characterAvatarUrl || '',
          identity: data.session.characterIdentity,
          initialRelationship: sameCharacter?.initialRelationship,
          scriptId: scriptMetadata.scriptId,
          script: scriptMetadata.script,
          relationship: sameCharacter?.relationship || null,
          availableModes: sameCharacter?.availableModes || [data.session.mode],
          lastUsedMode: data.session.mode,
          starterQuestions: sameCharacter?.starterQuestions || EMPTY_STARTER_QUESTIONS,
        };
      });
      setAvailableModes((current) => current.includes(data.session.mode) ? current : [data.session.mode]);
      setScope({
        sessionId: data.session.id,
        mode: data.session.mode,
        scriptId: data.session.scriptId || undefined,
        scriptTitle: data.session.scriptTitle || undefined,
      });
      setCanSend(data.session.canSend);
      setHasSuccessfulTurn(data.session.hasSuccessfulTurn);
      if (historyMessages.length > 0) {
        scrollIntoViewRef.current = `msg-${historyMessages[historyMessages.length - 1]!.id}`;
      }
      return data;
    } catch (err) {
      if (mountedRef.current && historyLoadIdRef.current === loadId) {
        if (!handleAuthError(err)) setHistoryError('历史对话加载失败，请重试');
      }
      return null;
    } finally {
      if (mountedRef.current && historyLoadIdRef.current === loadId) setHistoryLoading(false);
    }
  }, [handleAuthError, setScope]);

  const refreshCharacterRelationship = useCallback(async () => {
    const characterId = character?.id || routeCharacterId;
    if (!characterId) return;
    try {
      await loadCharacterDetail(characterId, false);
    } catch (err) {
      handleAuthError(err);
    }
  }, [character?.id, handleAuthError, loadCharacterDetail, routeCharacterId]);

  useUnload(() => {
    mountedRef.current = false;
    abortActiveStream();
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortActiveStream();
    };
  }, [abortActiveStream]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setPageLoading(true);
      setPageError('');
      try {
        const authenticated = await verifyAuth();
        if (cancelled || !authenticated) return;

        if (routeSessionId) {
          const history = await loadSessionHistory(routeSessionId);
          if (cancelled) return;
          if (!history) {
            setPageError('历史对话加载失败，请重试');
            return;
          }
          markReturnMessagesRead(getReturnMessageReadCharacterId(routeCharacterId, history.session.characterId) ?? '');
          void loadBalance();
          if (history.session.canSend) {
            await loadCharacterDetail(history.session.characterId, false);
          }
          return;
        }

        if (!routeCharacterId) {
          setPageError('缺少角色信息');
          return;
        }
        markReturnMessagesRead(routeCharacterId);
        await loadCharacterDetail(routeCharacterId, true);
        if (!cancelled) void loadBalance();
      } catch (err) {
        if (!cancelled && !handleAuthError(err)) {
          setPageError(err instanceof Error && /模式|剧本信息/.test(err.message) ? err.message : '无法进入当前对话，请稍后重试');
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, [handleAuthError, loadBalance, loadCharacterDetail, loadSessionHistory, markReturnMessagesRead, routeCharacterId, routeSessionId, verifyAuth]);

  const handleBuyPoints = () => {
    if (!requireAuth()) {
      goLogin();
      return;
    }
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  const handleShare = () => {
    if (!character?.id) return;
    Taro.navigateTo({ url: `/pages/share/preview?characterId=${character.id}` });
  };

  const handleModeChange = async (targetMode: ChatMode) => {
    if (targetMode === mode || sending || scopeSwitching || !canSend || !character) return;
    if (!availableModes.includes(targetMode)) return;
    const targetScope = getEmptyModeScope(targetMode, character);
    if (!targetScope) {
      Taro.showToast({ title: '当前没有可用剧本', icon: 'none' });
      return;
    }
    const targetScriptId = targetScope.scriptId;

    setScopeSwitching(true);
    setStreamError('');
    setMessages((current) => current.filter((message) => !(message.role === 'assistant' && message.id.startsWith('assistant-'))));
    try {
      const params = [
        `characterId=${encodeURIComponent(character.id)}`,
        `mode=${targetMode}`,
        'page=1',
        'limit=1',
      ];
      if (targetScriptId) params.push(`scriptId=${encodeURIComponent(targetScriptId)}`);
      const data = await api.get<{ sessions: SessionListItem[] }>(`/api/chat/sessions?${params.join('&')}`);
      const existing = data.sessions[0];
      if (existing) {
        await loadSessionHistory(existing.id);
      } else {
        setMessages([]);
        setHistoryError('');
        setScope(targetScope);
        setCanSend(true);
        setHasSuccessfulTurn(false);
      }
    } catch (err) {
      if (!handleAuthError(err)) {
        setStreamError('切换聊天模式失败，请稍后重试');
      }
    } finally {
      setScopeSwitching(false);
    }
  };

  const handleStarterQuestion = (question: string) => {
    const result = applyStarterQuestion(inputValue, question);
    if (!result.applied) {
      Taro.showToast({ title: '输入框已有内容，未覆盖', icon: 'none' });
      return;
    }
    setInputValue(result.value);
  };

  const handleRetryPageLoad = async () => {
    setPageLoading(true);
    setPageError('');
    try {
      if (routeSessionId) {
        const history = await loadSessionHistory(routeSessionId);
        if (!history) {
          setPageError('历史对话加载失败，请重试');
          return;
        }
        markReturnMessagesRead(getReturnMessageReadCharacterId(routeCharacterId, history.session.characterId) ?? '');
        void loadBalance();
        if (history.session.canSend) {
          await loadCharacterDetail(history.session.characterId, false);
        }
        return;
      }
      if (!routeCharacterId) {
        setPageError('缺少角色信息');
        return;
      }
      markReturnMessagesRead(routeCharacterId);
      await loadCharacterDetail(routeCharacterId, true);
      void loadBalance();
    } catch (err) {
      if (!handleAuthError(err)) setPageError('无法进入当前对话，请稍后重试');
    } finally {
      setPageLoading(false);
    }
  };

  const reconcileFailedSend = useCallback(async (clientMessageId: string, fallbackMessage: string, tempAssistantId: string) => {
    try {
      const lookup = await api.get<ClientMessageLookupResponse>(
        `/api/chat/messages/by-client-id?clientMessageId=${encodeURIComponent(clientMessageId)}`,
      );
      if (!mountedRef.current) return;
      setScope({
        sessionId: lookup.sessionId,
        mode: lookup.mode,
        scriptId: lookup.scriptId || undefined,
        scriptTitle,
      });
      if (lookup.assistantMessage) {
        updateAssistantPlaceholder(tempAssistantId, (current) => ({
          ...current,
          id: lookup.assistantMessage!.id,
          content: lookup.assistantMessage!.content,
          mood: lookup.assistantMessage!.mood as MoodType | undefined,
        }));
        if (!lookup.assistantMessage.outOfScope && !lookup.assistantMessage.excludedFromContext) {
          setHasSuccessfulTurn(true);
        }
        setStreamError('');
        scrollIntoViewRef.current = `msg-${lookup.assistantMessage.id}`;
      } else {
        const inProgressMessage = getFriendlyStreamErrorMessage('in_progress');
        updateAssistantPlaceholder(tempAssistantId, (current) => ({ ...current, content: current.content || `[发送失败] ${inProgressMessage}` }));
        setStreamError(inProgressMessage);
      }
    } catch {
      if (!mountedRef.current) return;
      updateAssistantPlaceholder(tempAssistantId, (current) => ({ ...current, content: current.content || `[发送失败] ${fallbackMessage}` }));
      setStreamError(fallbackMessage);
    } finally {
      if (!mountedRef.current) return;
      activeStreamRef.current = null;
      setSending(false);
      void loadBalance();
      void refreshCharacterRelationship();
    }
  }, [loadBalance, refreshCharacterRelationship, scriptTitle, setScope, updateAssistantPlaceholder]);

  const handleSend = () => {
    const characterId = character?.id;
    const userMessage = inputValue.trim();
    if (!userMessage || sending || !characterId || !canSend) return;
    if (!requireAuth()) {
      goLogin();
      return;
    }

    const currentMode = modeRef.current;
    const currentScriptId = scriptIdRef.current;
    if (currentMode === 'script' && !currentScriptId) {
      setStreamError('剧本模式缺少剧本信息，请重新进入角色详情');
      return;
    }

    const clientMessageId = createClientMessageId();
    const tempAssistantId = `assistant-${clientMessageId}`;
    const userMsgId = `user-${clientMessageId}`;
    setInputValue('');
    setSending(true);
    setStreamError('');
    setMessages((current) => [
      ...current,
      { id: userMsgId, role: 'user', content: userMessage },
      { id: tempAssistantId, role: 'assistant', content: '' },
    ]);
    scrollIntoViewRef.current = `msg-${tempAssistantId}`;

    const callbacks: StreamCallbacks = {
      onDelta(content) {
        if (!mountedRef.current) return;
        updateAssistantPlaceholder(tempAssistantId, (current) => ({ ...current, content: current.content + content }));
        scrollIntoViewRef.current = `msg-${tempAssistantId}`;
      },
      onDone(result) {
        if (!mountedRef.current) return;
        setScope({
          sessionId: result.sessionId,
          mode: result.mode,
          scriptId: result.mode === 'script' ? currentScriptId : undefined,
          scriptTitle: result.mode === 'script' ? scriptTitle : undefined,
        });
        updateAssistantPlaceholder(tempAssistantId, (current) => ({
          ...current,
          id: result.messageId,
          mood: result.mood as MoodType | undefined,
          fallback: result.fallback,
        }));
        if (isSuccessfulDoneEvent(result)) setHasSuccessfulTurn(true);
        if (typeof result.bondLevel === 'number') {
          setBondLevel(result.bondLevel);
          if (typeof result.bondExp === 'number') setBondExp(result.bondExp);
          else void refreshCharacterRelationship();
        } else {
          void refreshCharacterRelationship();
        }
        if (typeof result.balanceAfter === 'number') setPointsBalance(result.balanceAfter);
        else void loadBalance();
        const bondFeedback = getBondFeedback({ ...result, previousBondExp: bondExp });
        if (bondFeedback) {
          Taro.showToast({
            title: bondFeedback.kind === 'leveledUp'
              ? `羁绊提升至「${bondFeedback.levelName}」`
              : `羁绊 +${bondFeedback.delta}`,
            icon: 'none',
          });
        }
        const unlockedCount = (result.unlockedAchievements?.length || 0) + (result.unlockedTitles?.length || 0);
        if (unlockedCount > 0) Taro.showToast({ title: `解锁了 ${unlockedCount} 项新记录`, icon: 'none' });
        activeStreamRef.current = null;
        setSending(false);
        scrollIntoViewRef.current = `msg-${result.messageId}`;
      },
      onError(code) {
        if (!mountedRef.current) return;
        const friendlyMessage = getFriendlyStreamErrorMessage(code);
        if (code === 'script_unavailable') setCanSend(false);
        if (!shouldReconcileStreamError(code)) {
          setMessages((current) => current.filter((message) => message.id !== tempAssistantId));
          setStreamError(friendlyMessage);
          activeStreamRef.current = null;
          setSending(false);
          if (code === 'session_scope_mismatch' && sessionIdRef.current) {
            void loadSessionHistory(sessionIdRef.current);
          }
          if (code === 'script_unavailable') {
            if (sessionIdRef.current) void loadSessionHistory(sessionIdRef.current);
            else setMessages((current) => current.filter((message) => message.id !== userMsgId));
          }
          return;
        }
        void reconcileFailedSend(clientMessageId, friendlyMessage, tempAssistantId);
      },
      onAuthExpired() {
        if (!mountedRef.current) return;
        setPointsBalance(null);
        goLogin();
      },
    };

    activeStreamRef.current = currentMode === 'script'
      ? streamChat({
        characterId,
        sessionId: sessionIdRef.current,
        message: userMessage,
        modelTier,
        clientMessageId,
        mode: 'script',
        scriptId: currentScriptId!,
      }, callbacks)
      : streamChat({
        characterId,
        sessionId: sessionIdRef.current,
        message: userMessage,
        modelTier,
        clientMessageId,
        mode: 'free',
      }, callbacks);
  };

  const selectedTierCost = MODEL_TIER_COSTS[modelTier];
  const isInsufficientPoints = typeof pointsBalance === 'number' && pointsBalance < selectedTierCost;
  const scopeUnavailable = mode === 'script' && !scriptId;
  const interactionDisabled = sending || scopeSwitching || !canSend || scopeUnavailable;
  const characterAvatarUrl = character ? getCharacterAvatarUrl(character.name, character.avatarUrl) : '';
  const bondViewModel = createBondViewModel({ bondLevel, bondExp });
  const visibleStarterQuestions = getVisibleStarterQuestions(starterQuestions, mode, hasSuccessfulTurn);

  if (pageLoading) {
    return (
      <View className="chat-page chat-page--state">
        <StatusStateCard title={routeSessionId ? '正在恢复对话' : '正在连接角色'} message="会话状态和角色资料加载中。" icon="…" />
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="chat-page chat-page--state">
        <StatusStateCard title="登录后进入对话" message="登录后可以保存会话、点数和角色关系。" primaryText="去登录" onPrimary={goLogin} />
      </View>
    );
  }

  if (!character || pageError) {
    return (
      <View className="chat-page chat-page--state">
        <StatusStateCard
          title="无法进入对话"
          message={pageError || '角色信息不可用'}
          tone="error"
          icon="!"
          primaryText="重新加载"
          onPrimary={() => { void handleRetryPageLoad(); }}
        />
      </View>
    );
  }

  return (
    <View className="chat-page">
      <CharacterHeader
        name={character.name}
        identity={character.identity}
        avatarUrl={characterAvatarUrl}
        bond={bondViewModel}
        points={pointsBalance}
        onPointsTap={handleBuyPoints}
        onBack={navigateBackOrHome}
      />

      <View className="chat-page__scope-bar">
        <View className="chat-page__scope-copy">
          <Text className="chat-page__scope-label">{getModeLabel(mode)}</Text>
          <Text className="chat-page__scope-title">{mode === 'script' ? scriptTitle || '当前剧本' : '保留角色身份，不强制推进剧情'}</Text>
        </View>
        {availableModes.length > 1 && (
          <View className={`chat-page__mode-control${interactionDisabled ? ' chat-page__mode-control--disabled' : ''}`}>
            {availableModes.map((item) => (
              <View
                key={item}
                className={`chat-page__mode-option${mode === item ? ' chat-page__mode-option--active' : ''}`}
                onTap={interactionDisabled ? undefined : () => { void handleModeChange(item); }}
              >
                <Text className="chat-page__mode-option-text">{item === 'script' ? '剧本' : '自由'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {!canSend && (
        <StatusStateCard
          className="chat-page__notice-card"
          title="历史对话只读"
          message="该剧本已下架，历史对话仍可查看。"
          tone="error"
          icon="锁"
        />
      )}

      {canSend && isInsufficientPoints && (
        <StatusStateCard
          className="chat-page__notice-card"
          title="点数余额不足"
          message="当前点数不足，请先补充点数后再继续对话。"
          tone="points"
          icon="点"
          primaryText="立即充值"
          secondaryText="稍后再说"
          onPrimary={handleBuyPoints}
        />
      )}

      <ScrollView className="chat-page__messages" scrollY scrollIntoView={scrollIntoViewRef.current} scrollWithAnimation>
        <View className="chat-page__messages-content">
          {historyLoading && <StatusStateCard title="正在切换会话" message="另一种聊天模式的历史加载中。" icon="…" />}
          {historyError && (
            <StatusStateCard
              title="历史对话加载失败"
              message={historyError}
              tone="error"
              icon="!"
              primaryText="重新加载"
              onPrimary={sessionId ? () => { void loadSessionHistory(sessionId); } : undefined}
            />
          )}

          {visibleStarterQuestions.length > 0 && (
            <View className="chat-page__starters">
              <Text className="chat-page__starters-title">可以这样开场</Text>
              <Text className="chat-page__starters-hint">点击后只会填入输入框，由你确认发送。</Text>
              <View className="chat-page__starter-list">
                {visibleStarterQuestions.map((question) => (
                  <View key={question} className="chat-page__starter" onTap={() => handleStarterQuestion(question)}>
                    <Text className="chat-page__starter-text">{question}</Text>
                    <Text className="chat-page__starter-arrow">›</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {messages.length === 0 && visibleStarterQuestions.length === 0 && !sending && !historyLoading && (
            <EmptyState
              title={mode === 'script' ? '从当前剧情开始' : '从一句日常问候开始'}
              message={mode === 'script' ? `问问 ${character.name} 关于当前角色、线索或剧情。` : `可以和 ${character.name} 聊聊近况、想法或共同记得的事。`}
            />
          )}

          {messages.map((message, index) => (
            <View key={message.id} id={`msg-${message.id}`}>
              <ChatBubble
                role={message.role}
                content={message.content}
                mood={message.mood}
                fallback={message.fallback}
                avatarUrl={characterAvatarUrl}
                characterName={character.name}
                typing={sending && index === messages.length - 1 && message.role === 'assistant' && !message.content}
              />
            </View>
          ))}
          {shouldRenderStandaloneTypingIndicator(sending, messages) && (
            <ChatBubble role="assistant" content="正在输入..." avatarUrl={characterAvatarUrl} characterName={character.name} />
          )}
        </View>
      </ScrollView>

      {streamError && <StatusStateCard className="chat-page__stream-error" title="发送未完成" message={streamError} tone="error" icon="!" />}

      <ChatInputBar
        value={inputValue}
        placeholder={!canSend ? '历史对话仅供查看' : isInsufficientPoints ? '点数不足，请先充值' : `回应${character.name}...`}
        disabled={interactionDisabled || isInsufficientPoints}
        sending={sending}
        insufficientPoints={canSend && isInsufficientPoints}
        onInput={setInputValue}
        onSend={handleSend}
        onBuyPoints={handleBuyPoints}
        onShare={handleShare}
      />
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});

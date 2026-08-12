import { View, Canvas } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { BottomAction, createBondViewModel, PrimaryButton, SHARE_IDENTITY_FALLBACK, SharePreviewCard, TonalButton } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { FALLBACK_SHARE_EXCERPT, getShareExcerpt } from './preview.model';
import { navigateBackOrHome } from '../../utils/navigation';
import './preview.scss';

const CANVAS_ID = 'shareCanvas';
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 840;

// 身份徽章底色块：x/y 为左上角坐标，width/height 为尺寸。
const IDENTITY_BADGE_X = 250;
const IDENTITY_BADGE_Y = 580;
const IDENTITY_BADGE_WIDTH = 190;
const IDENTITY_BADGE_HEIGHT = 56;

interface ShareCharacter {
  name: string;
  identity?: string | null;
  description?: string | null;
  script?: {
    title?: string;
    description?: string | null;
  } | null;
  relationship?: {
    bondLevel: number;
    bondExp: number;
  } | null;
}

export default function SharePreview() {
  const router = useRouter();
  const characterId = router.params.characterId || '';
  const [saving, setSaving] = useState(false);
  const [character, setCharacter] = useState<ShareCharacter | null>(null);
  const [excerpt, setExcerpt] = useState(FALLBACK_SHARE_EXCERPT);
  const { verifyAuth, handleAuthError } = useAuthGuard();

  useEffect(() => {
    let cancelled = false;
    setCharacter(null);
    setExcerpt(FALLBACK_SHARE_EXCERPT);

    async function fetchCharacter() {
      if (!characterId) return;
      try {
        const authenticated = await verifyAuth();
        if (!authenticated || cancelled) return;
        const data = await api.get<ShareCharacter>(`/api/characters/${characterId}`);
        if (cancelled) return;
        setCharacter(data);
        setExcerpt(getShareExcerpt(data.script?.description, data.description));
      } catch (err) {
        if (!cancelled) {
          handleAuthError(err);
        }
      }
    }

    void fetchCharacter();
    return () => { cancelled = true; };
  }, [characterId, handleAuthError, verifyAuth]);

  const displayName = character?.name?.trim() || '月满楼';
  const displayIdentity = character?.identity?.trim() || SHARE_IDENTITY_FALLBACK;
  const bondViewModel = createBondViewModel(character?.relationship);

  const drawPoster = () => {
    const ctx = Taro.createCanvasContext(CANVAS_ID);
    ctx.setFillStyle('#1d1218');
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.setFillStyle('#5f423d');
    ctx.fillRect(0, 0, CANVAS_WIDTH, 430);

    ctx.setFillStyle('rgba(0,0,0,0.52)');
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.setFillStyle('rgba(255,255,255,0.24)');
    ctx.setFontSize(64);
    ctx.fillText('“', 44, 402);

    ctx.setFillStyle('#ffffff');
    ctx.setFontSize(38);
    wrapCanvasText(ctx, excerpt, 64, 444, CANVAS_WIDTH - 128, 56, 3);

    ctx.setFontSize(50);
    ctx.fillText(displayName, 64, 620);

    ctx.setFillStyle('#8b3454');
    ctx.fillRect(IDENTITY_BADGE_X, IDENTITY_BADGE_Y, IDENTITY_BADGE_WIDTH, IDENTITY_BADGE_HEIGHT);
    ctx.setFillStyle('#fff7f8');
    ctx.setFontSize(22);
    // 底块 IDENTITY_BADGE_X..IDENTITY_BADGE_X+IDENTITY_BADGE_WIDTH，文字起点 275，右侧留 25px 内边距 → 可用 140px，超长截断加省略号。
    ctx.fillText(fitCanvasTextToWidth(ctx, displayIdentity, 140), 275, 618);

    ctx.setFillStyle('#f6e6ea');
    ctx.setFontSize(22);
    ctx.fillText(bondViewModel.levelLabel, 64, 670);

    ctx.setFillStyle('#f8dfe7');
    ctx.setFontSize(22);
    ctx.fillText('月满楼', 64, 728);
    ctx.setFillStyle('rgba(255,255,255,0.58)');
    ctx.fillText('扫码加入故事 · AI 生成内容', 64, 762);

    return ctx;
  };

  const handleSave = () => {
    if (saving) return;
    setSaving(true);
    Taro.showLoading({ title: '生成中' });

    const ctx = drawPoster();
    ctx.draw(false, () => {
      Taro.canvasToTempFilePath({
        canvasId: CANVAS_ID,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        destWidth: CANVAS_WIDTH,
        destHeight: CANVAS_HEIGHT,
        success(res) {
          Taro.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success() {
              Taro.showToast({ title: '已保存到相册', icon: 'success' });
            },
            fail() {
              Taro.showModal({
                title: '保存失败',
                content: '需要相册权限才能保存海报，请在设置中开启后重试。',
                confirmText: '去设置',
                cancelText: '取消',
                success(modal) {
                  if (modal.confirm) void Taro.openSetting();
                },
              });
            },
            complete() {
              Taro.hideLoading();
              setSaving(false);
            },
          });
        },
        fail() {
          Taro.hideLoading();
          setSaving(false);
          Taro.showToast({ title: '生成分享图失败', icon: 'none' });
        },
      });
    });
  };

  return (
    <View className="share-preview-page">
      <SharePreviewCard characterName={displayName} excerpt={excerpt} bondLevel={bondViewModel.level} identity={displayIdentity} onClose={navigateBackOrHome} />

      <BottomAction variant="dark">
        <View className="share-preview-page__actions">
          <TonalButton className="share-preview-page__action-secondary" onTap={handleSave}>
            ↓ {saving ? '保存中…' : '保存图片'}
          </TonalButton>
          <PrimaryButton className="share-preview-page__action-primary" onTap={handleSave}>
            ↗ 立即分享
          </PrimaryButton>
        </View>
      </BottomAction>

      <Canvas
        canvasId={CANVAS_ID}
        className="share-preview-page__canvas"
        style={{ width: `${CANVAS_WIDTH}px`, height: `${CANVAS_HEIGHT}px` }}
      />
    </View>
  );
}

function fitCanvasTextToWidth(ctx: Taro.CanvasContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed ? `${trimmed}…` : '';
}

function wrapCanvasText(
  ctx: Taro.CanvasContext,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  let line = '';
  let lineCount = 0;

  for (const char of text) {
    const nextLine = line + char;
    const metrics = ctx.measureText(nextLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = char;
      lineCount += 1;
      if (lineCount >= maxLines) return;
    } else {
      line = nextLine;
    }
  }

  if (line && lineCount < maxLines) {
    ctx.fillText(line, x, y + lineCount * lineHeight);
  }
}

definePageConfig({
  navigationBarTitleText: '分享预览',
});

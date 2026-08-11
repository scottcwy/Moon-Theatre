import { View, Canvas } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { BottomAction, createBondViewModel, PrimaryButton, SharePreviewCard, TonalButton, getShareIdentityLabel } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { FALLBACK_SHARE_EXCERPT, getShareExcerpt } from './preview.model';
import './preview.scss';

const CANVAS_ID = 'shareCanvas';
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 840;

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
  const displayIdentity = character?.identity?.trim() || getShareIdentityLabel(displayName);
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
    ctx.fillRect(250, 580, 190, 56);
    ctx.setFillStyle('#fff7f8');
    ctx.setFontSize(22);
    ctx.fillText(displayIdentity, 275, 618);

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
              Taro.showToast({ title: '保存失败，请检查相册权限', icon: 'none' });
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
      <SharePreviewCard characterName={displayName} excerpt={excerpt} bondLevel={bondViewModel.level} identity={displayIdentity} />

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

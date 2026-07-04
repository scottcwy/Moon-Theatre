import { View, Canvas } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { BottomAction, PrimaryButton, SharePreviewCard, TonalButton, getShareIdentityLabel } from '@juben-sha/miniapp-ui';
import './preview.scss';

const CANVAS_ID = 'shareCanvas';
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 840;
const EXCERPT = '铃声响起时，北门的月光会替你照路。若你仍想知道前世真相，我会陪你走到门前。';

export default function SharePreview() {
  const router = useRouter();
  const characterId = router.params.characterId || 'char-hakuzo';
  const [saving, setSaving] = useState(false);

  const CHARACTER_MAP: Record<string, { name: string }> = {
    'char-hakuzo': { name: '白藏' },
    'char-kiyoharu': { name: '贺茂清玄' },
    'char-mio': { name: '月岛澪' },
    'char-kuon': { name: '久远' },
  };

  const character = CHARACTER_MAP[characterId] || { name: '白藏' };

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
    wrapCanvasText(ctx, EXCERPT, 64, 444, CANVAS_WIDTH - 128, 56, 3);

    ctx.setFontSize(50);
    ctx.fillText(character.name, 64, 620);

    ctx.setFillStyle('#8b3454');
    ctx.fillRect(250, 580, 190, 56);
    ctx.setFillStyle('#fff7f8');
    ctx.setFontSize(22);
    ctx.fillText(getShareIdentityLabel(character.name), 275, 618);

    ctx.setFillStyle('#f8dfe7');
    ctx.setFontSize(22);
    ctx.fillText('灵犀剧场', 64, 728);
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
      <SharePreviewCard characterName={character.name} excerpt={EXCERPT} />

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

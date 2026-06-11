import { View, Text, Canvas } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import './preview.scss';

const CANVAS_ID = 'shareCanvas';
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 840;
const EXCERPT = '夜巡的灯火，你若不怕，便随我来。城墙上只有我们两个人，风吹过来的时候，连铁骑都会觉得冷。';

export default function SharePreview() {
  const router = useRouter();
  const characterId = router.params.characterId || 'char-jiang';
  const [saving, setSaving] = useState(false);

  const CHARACTER_MAP: Record<string, { name: string }> = {
    'char-jiang': { name: '蒋伯驾' },
    'char-cheng': { name: '程聿怀' },
    'char-yisa': { name: '以撒' },
  };

  const character = CHARACTER_MAP[characterId] || { name: '蒋伯驾' };

  const drawPoster = () => {
    const ctx = Taro.createCanvasContext(CANVAS_ID);
    ctx.setFillStyle('#faf8f3');
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.setFillStyle('#e9dfcf');
    ctx.fillRect(48, 48, CANVAS_WIDTH - 96, CANVAS_HEIGHT - 96);

    ctx.setFillStyle('#7f5f2a');
    ctx.beginPath();
    ctx.arc(112, 128, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.setFillStyle('#fffaf0');
    ctx.setFontSize(38);
    ctx.fillText(character.name[0] ?? '角', 100, 142);

    ctx.setFillStyle('#241c15');
    ctx.setFontSize(34);
    ctx.fillText(character.name, 176, 118);

    ctx.setFillStyle('#6f675f');
    ctx.setFontSize(22);
    ctx.fillText('来自「夜色围城」', 176, 154);

    ctx.setFillStyle('#fffaf0');
    ctx.fillRect(72, 210, CANVAS_WIDTH - 144, 360);

    ctx.setFillStyle('#312820');
    ctx.setFontSize(30);
    wrapCanvasText(ctx, EXCERPT, 104, 280, CANVAS_WIDTH - 208, 48, 5);

    ctx.setFillStyle('#8a8176');
    ctx.setFontSize(22);
    ctx.fillText('AI 生成内容 · 剧本杀角色扮演', 142, 708);

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
      <View className="share-preview-page__card">
        <View className="share-preview-page__header">
          <View className="share-preview-page__avatar-placeholder">
            <Text className="share-preview-page__avatar-text">{character.name[0]}</Text>
          </View>
          <View className="share-preview-page__header-info">
            <Text className="share-preview-page__name">{character.name}</Text>
            <Text className="share-preview-page__source">来自「夜色围城」</Text>
          </View>
        </View>

        <View className="share-preview-page__excerpt">
          <Text className="share-preview-page__excerpt-text">{EXCERPT}</Text>
        </View>

        <View className="share-preview-page__watermark">
          <Text className="share-preview-page__watermark-text">
            AI 生成内容 · 剧本杀角色扮演
          </Text>
        </View>
      </View>

      <View className="share-preview-page__actions">
        <View className="button-primary" onClick={handleSave}>
          <Text className="share-preview-page__btn-text">{saving ? '保存中…' : '保存到相册'}</Text>
        </View>
      </View>

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

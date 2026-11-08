import { describe, expect, it } from 'vitest';
import {
  characterFieldLabel,
  describeCharacterReadiness,
  describeImageRisks,
  describePublishTask,
  fieldIssueText,
} from '../character-copy.js';

describe('character readiness copy', () => {
  it('names the published version problems that make every new turn fail', () => {
    const readiness = describeCharacterReadiness({
      status: 'active',
      publishedVersionId: 'version-1',
      validity: {
        valid: false,
        issues: [
          { path: 'prompt.systemPrompt', message: 'is required' },
          { path: 'agentId', message: 'is required' },
        ],
      },
    });
    expect(readiness.level).toBe('warning');
    expect(readiness.label).toBe('内容待补全：系统人设、Agent 标识');
    expect(readiness.missingFields).toEqual(['系统人设', 'Agent 标识']);
  });

  it('keeps the label readable when the same field carries several issues', () => {
    const readiness = describeCharacterReadiness({
      status: 'active',
      publishedVersionId: 'version-1',
      validity: {
        valid: false,
        issues: [
          { path: 'prompt.systemPrompt', message: 'is required' },
          { path: 'prompt.systemPrompt', message: 'must be at most 20000 characters' },
        ],
      },
    });
    expect(readiness.label).toBe('内容待补全：系统人设');
    expect(readiness.details).toEqual(['系统人设：为必填项', '系统人设：最多 20000 个字符']);
  });

  it('reports a missing published version for a live character', () => {
    const readiness = describeCharacterReadiness({ status: 'active', publishedVersionId: null, validity: null });
    expect(readiness.level).toBe('warning');
    expect(readiness.label).toBe('线上版本缺失：新回合会被拒绝，需发布一次');
  });

  it('does not invent a problem for a valid published version or an unpublished character', () => {
    expect(describeCharacterReadiness({ status: 'active', publishedVersionId: 'version-1', validity: { valid: true, issues: [] } }).level).toBe('none');
    expect(describeCharacterReadiness({ status: 'inactive', publishedVersionId: null, validity: null }).level).toBe('none');
  });

  it('translates known field paths and validation messages without exposing English internals', () => {
    expect(characterFieldLabel('name')).toBe('姓名');
    expect(characterFieldLabel('prompt.outputFormatPrompt')).toBe('输出格式');
    expect(characterFieldLabel('starterQuestions[2]')).toBe('开场引导');
    expect(characterFieldLabel('unknownField')).toBe('unknownField');
    expect(fieldIssueText({ path: 'prompt.systemPrompt', message: 'is required' })).toBe('系统人设：为必填项');
    expect(fieldIssueText({ path: 'agentId', message: 'must be a stable role-* routing id' })).toBe('Agent 标识：须为稳定的 role-* 标识');
    expect(fieldIssueText({ path: 'name', message: 'something new in english' })).toBe('姓名：格式不符合要求');
  });
});

describe('display preview image risks', () => {
  it('flags a missing avatar, a non-HTTPS asset and a missing script cover', () => {
    expect(describeImageRisks({ avatarUrl: '', scriptCoverUrl: null, scriptTitle: null })).toEqual([
      { level: 'warning', message: '头像为空：小程序卡片会显示占位图，请补充头像地址。' },
      { level: 'info', message: '尺寸与裁切需人工确认：后台不处理图片，头像按 1:1、剧本封面按 16:9 展示，超出比例可能被裁切。' },
    ]);
    const risks = describeImageRisks({ avatarUrl: 'http://cdn.example.test/a.png', scriptCoverUrl: '', scriptTitle: '月满楼' });
    expect(risks.map(risk => risk.message)).toContain('头像地址不是 HTTPS：正式环境可能无法加载。');
    expect(risks.map(risk => risk.message)).toContain('剧本《月满楼》没有封面：剧本卡片会显示占位图。');
  });

  it('keeps only the manual-verification note when both assets are present', () => {
    const risks = describeImageRisks({ avatarUrl: 'https://cdn.example.test/a.png', scriptCoverUrl: 'https://cdn.example.test/b.png', scriptTitle: '月满楼' });
    expect(risks).toEqual([{ level: 'info', message: '尺寸与裁切需人工确认：后台不处理图片，头像按 1:1、剧本封面按 16:9 展示，超出比例可能被裁切。' }]);
  });
});

describe('publish task copy', () => {
  it('separates committed, failed, in-progress and audit-pending states', () => {
    expect(describePublishTask(null)).toEqual({ tone: 'none', label: '暂无发布任务' });
    expect(describePublishTask({ status: 'committed', recoveryState: null })).toEqual({ tone: 'ok', label: '发布成功' });
    expect(describePublishTask({ status: 'processing', recoveryState: null })).toEqual({ tone: 'warn', label: '处理中' });
    expect(describePublishTask({ status: 'committed', recoveryState: 'audit_pending' })).toEqual({ tone: 'warn', label: '已提交，审计待恢复' });
    expect(describePublishTask({ status: 'failed', recoveryState: null })).toEqual({ tone: 'error', label: '发布失败' });
  });
});

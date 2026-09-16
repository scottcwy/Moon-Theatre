import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pilotFrameDefinitions, pilotFrames } from './frame-registry';
import type { PilotNodeSpec } from './types';

function walk(node: PilotNodeSpec, visit: (node: PilotNodeSpec) => void) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

describe('H5 design frame registry', () => {
  it('contains the 13 approved delivery frames', () => {
    expect(pilotFrameDefinitions.map((item) => item.key)).toEqual([
      '1-773',
      '1-863',
      '1-1164',
      '1-387',
      '1-494',
      '1-626',
      '1-1657',
      '1-2325',
      '1-1766',
      '1-1892',
      '1-1987',
      '1-2080',
      '1-2180',
    ]);
    expect(Object.keys(pilotFrames.frames)).toHaveLength(13);
  });

  it('keeps every frame renderable and excludes approved system mock copy', () => {
    for (const definition of pilotFrameDefinitions) {
      const frame = pilotFrames.frames[definition.key];
      expect(frame, definition.key).toBeTruthy();
      if (!frame) throw new Error(`missing frame ${definition.key}`);
      expect(frame.nodes.length, definition.key).toBeGreaterThan(0);

      walk({ ...frame.nodes[0], children: frame.nodes } as PilotNodeSpec, (node) => {
        if (node.kind !== 'text') return;
        expect(node.text?.characters, definition.key).not.toMatch(/^(9:41|999|89\/200|YUE MANLOU|文本内容|玩家文本|文字文字)/);
      });
    }
  });

  it('resolves every generated asset path inside the playground directory', () => {
    const playgroundRoot = path.resolve(__dirname, '../../../../playground');
    for (const frame of Object.values(pilotFrames.frames)) {
      for (const node of frame.nodes) {
        walk(node, (entry) => {
          if (!entry.asset) return;
          const relative = entry.asset.replace(/^\/playground\//, '');
          expect(existsSync(path.join(playgroundRoot, relative)), `${frame.id} ${entry.id} ${entry.asset}`).toBe(true);
        });
      }
    }
  });
});

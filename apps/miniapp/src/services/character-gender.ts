import Taro from '@tarojs/taro';
import type { CharacterGender } from '../types';

const STORAGE_KEY = 'characterAvatarGender';

type GenderMap = Record<string, CharacterGender>;

function readMap(): GenderMap {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY);
    if (!raw) return {};
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed as GenderMap : {};
  } catch {
    return {};
  }
}

/** 读取用户为该角色选择的头像性别变体；未选择时返回 null。 */
export function getCharacterGender(name: string): CharacterGender | null {
  const value = readMap()[name];
  return value === 'male' || value === 'female' ? value : null;
}

/** 保存用户为该角色选择的头像性别变体（本地持久化）。 */
export function setCharacterGender(name: string, gender: CharacterGender): void {
  const map = readMap();
  map[name] = gender;
  Taro.setStorageSync(STORAGE_KEY, JSON.stringify(map));
}

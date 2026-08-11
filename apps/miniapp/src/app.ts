import { PropsWithChildren, useEffect, useRef } from 'react';
import { useDidHide, useDidShow } from '@tarojs/taro';
import { startChatUnreadPolling } from './services/chat-red-dot';
import './app.scss';

function App({ children }: PropsWithChildren) {
  const stopPollingRef = useRef<(() => void) | null>(null);

  // 回访留言前台轮询：进前台立即查一次并启动周期轮询，退后台停止。
  useDidShow(() => {
    if (!stopPollingRef.current) {
      stopPollingRef.current = startChatUnreadPolling();
    }
  });

  useDidHide(() => {
    stopPollingRef.current?.();
    stopPollingRef.current = null;
  });

  useEffect(() => () => {
    stopPollingRef.current?.();
    stopPollingRef.current = null;
  }, []);

  return children;
}

export default App;

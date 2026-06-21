import Taro from '@tarojs/taro';
import { useCallback, useState } from 'react';
import { isAuthExpiredError, isLoggedIn, verifyStoredAuth } from '../services/api';

export function useAuthGuard() {
  const [needsLogin, setNeedsLogin] = useState(false);

  const requireAuth = useCallback(() => {
    const authenticated = isLoggedIn();
    setNeedsLogin(!authenticated);
    return authenticated;
  }, []);

  const verifyAuth = useCallback(async () => {
    const authenticated = await verifyStoredAuth();
    setNeedsLogin(!authenticated);
    return authenticated;
  }, []);

  const handleAuthError = useCallback((error: unknown) => {
    if (!isAuthExpiredError(error)) {
      return false;
    }
    setNeedsLogin(true);
    return true;
  }, []);

  const goLogin = useCallback(() => {
    Taro.navigateTo({ url: '/pages/login/index' });
  }, []);

  return {
    needsLogin,
    setNeedsLogin,
    requireAuth,
    verifyAuth,
    handleAuthError,
    goLogin,
  };
}
